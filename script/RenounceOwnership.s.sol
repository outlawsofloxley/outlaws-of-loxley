// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";

/**
 * @title RenounceOwnership
 * @notice Calls BRAWL.liftLimits() (lifting max-tx + max-wallet caps) then
 *         renounceOwnership() — the irreversible "no more admin powers"
 *         flip. Run 24-48h after EnableTrading.s.sol once the launch
 *         volatility settles.
 *
 *         After this, the BRAWL token has:
 *           - owner() = address(0)
 *           - no one can change limits
 *           - no one can mint
 *           - no one can blacklist / whitelist
 *           - no one can pause trading (it can't be paused at all anymore)
 *
 *         Game contracts (Duel, Graveyard, etc) remain dev-owned and
 *         pausable, that's deliberate — see trust.md "game contracts
 *         stay dev-controlled (intentionally)".
 *
 *         Required env:
 *           PRIVATE_KEY    - current BRAWL owner key
 *           BRAWL_ADDRESS  - deployed BRAWL ERC-20
 *
 *         Skip-liftLimits override:
 *           SKIP_LIFT_LIMITS=true  — only renounce, don't lift first.
 *                                     Useful if limits were already lifted
 *                                     manually.
 */
interface IBRAWL {
    function liftLimits() external;
    function renounceOwnership() external;
    function owner() external view returns (address);
    function limitsActive() external view returns (bool);
}

contract RenounceOwnership is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address brawl = vm.envAddress("BRAWL_ADDRESS");
        bool skipLift = vm.envOr("SKIP_LIFT_LIMITS", false);

        IBRAWL b = IBRAWL(brawl);
        require(b.owner() != address(0), "Already renounced");

        vm.startBroadcast(deployerKey);

        if (!skipLift && b.limitsActive()) {
            b.liftLimits();
            console2.log("liftLimits() fired, caps off.");
        }

        b.renounceOwnership();
        console2.log("renounceOwnership() fired.");
        console2.log("BRAWL owner() now:  ", b.owner());
        console2.log("Verify on basescan: token contract -> Read Contract -> owner()");

        vm.stopBroadcast();
    }
}
