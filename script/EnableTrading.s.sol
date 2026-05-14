// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";

/**
 * @title EnableTrading
 * @notice Flips BRAWL.enableTrading() — the public launch moment. Run after:
 *         1. Deploy.s.sol (all contracts up)
 *         2. SeedAndLockLP.s.sol (LP seeded + locked/burned)
 *         3. LockTeamTokens.s.sol (dev allocation vested)
 *
 *         And after the game contracts are whitelisted (so duels/mints don't
 *         hit the trading-paused gate). The Deploy.s.sol script already
 *         whitelists Duel/MintDrop/Graveyard/Marketplace at end of construction,
 *         but we re-check here defensively.
 *
 *         Once trading is enabled, the anti-bot window (1 block) is active,
 *         then max-tx (0.5%) and max-wallet (1%) limits stay on until
 *         liftLimits() is called (~24-48h post-launch).
 *
 *         Required env:
 *           PRIVATE_KEY    - dev (BRAWL owner) key
 *           BRAWL_ADDRESS  - deployed BRAWL ERC-20
 *
 *         Optional env (game-contracts whitelist):
 *           DUEL_ADDRESS, MINTDROP_ADDRESS, GRAVEYARD_ADDRESS, MARKETPLACE_ADDRESS
 *           — if set, these are whitelisted in a bulk call before enabling
 *             trading (idempotent — whitelist mapping is bool so re-setting is fine).
 */
interface IBRAWL {
    function enableTrading() external;
    function tradingEnabled() external view returns (bool);
    function whitelisted(address addr) external view returns (bool);
    function setWhitelistBulk(address[] calldata addrs, bool status) external;
}

contract EnableTrading is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address brawl = vm.envAddress("BRAWL_ADDRESS");

        IBRAWL b = IBRAWL(brawl);
        require(!b.tradingEnabled(), "Trading already enabled");

        // Compose the game-contracts whitelist if any of the optional env
        // vars are set.
        address[] memory pending = new address[](4);
        uint256 n;
        address d = vm.envOr("DUEL_ADDRESS", address(0));
        address m = vm.envOr("MINTDROP_ADDRESS", address(0));
        address g = vm.envOr("GRAVEYARD_ADDRESS", address(0));
        address mp = vm.envOr("MARKETPLACE_ADDRESS", address(0));
        if (d != address(0) && !b.whitelisted(d)) { pending[n++] = d; }
        if (m != address(0) && !b.whitelisted(m)) { pending[n++] = m; }
        if (g != address(0) && !b.whitelisted(g)) { pending[n++] = g; }
        if (mp != address(0) && !b.whitelisted(mp)) { pending[n++] = mp; }

        vm.startBroadcast(deployerKey);

        if (n > 0) {
            address[] memory addrs = new address[](n);
            for (uint256 i; i < n; ++i) addrs[i] = pending[i];
            b.setWhitelistBulk(addrs, true);
            console2.log("Whitelisted game contracts: ", n);
        }

        b.enableTrading();
        console2.log("");
        console2.log("============================");
        console2.log("BRAWL.enableTrading() FIRED");
        console2.log("============================");
        console2.log("Anti-bot window: 1 block");
        console2.log("Max-tx (default): 0.5% of supply (500 BRAWL)");
        console2.log("Max-wallet (default): 1% of supply (1,000 BRAWL)");
        console2.log("Lift limits with liftLimits() ~24-48h post-launch.");
        console2.log("Renounce ownership ~24-48h post-launch via RenounceOwnership.s.sol.");

        vm.stopBroadcast();
    }
}
