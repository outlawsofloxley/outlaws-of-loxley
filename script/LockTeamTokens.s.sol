// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title LockTeamTokens
 * @notice Vests a portion of the dev wallet's BRAWL allocation on UNCX V2
 *         Token Vesting. Linear, no cliff, single beneficiary = dev wallet.
 *
 *         Run after Deploy.s.sol and SeedAndLockLP.s.sol, before
 *         EnableTrading.s.sol — the BRAWL token's trading-paused gate
 *         must be off for non-whitelisted transfers, but the dev wallet
 *         + UNCX vesting contract can be pre-whitelisted to bypass.
 *
 *         Why this exists: trust.md / launch allocation commits to time-
 *         locked team tokens. This script converts 20,000 BRAWL (the
 *         "team vault" slice of the 100k supply per the 2026-05-15 launch
 *         allocation: 50k LP / 20k vault / 20k keeper / 10k dev) into an
 *         on-chain linear vest so the "team can't dump all at once" claim
 *         becomes verifiable on basescan + UNCX dashboard.
 *
 *         See LAUNCH_AUTOMATION.md §3 for the decision rationale.
 *
 *         Required env vars:
 *           PRIVATE_KEY            - deployer key (script runs from the wallet
 *                                    that held the initial 100k BRAWL; it
 *                                    still has 70k after Deploy auto-pushes
 *                                    dev+keeper allocations)
 *           BRAWL_ADDRESS          - deployed BRAWL ERC-20
 *           UNCX_VESTING           - 0x7ca3dE7D58A0bCAd115184597553485A919320c5 (Base)
 *           VEST_AMOUNT_WEI        - BRAWL to vest (default 20_000e18)
 *           VEST_DURATION_SECONDS  - linear-vest length (default 180 days)
 *           VEST_BENEFICIARY       - who can withdraw vested tokens
 *                                    (default = dev = PRIVATE_KEY signer)
 *           UNCX_FEE_WEI           - ETH fee to send (default 0.05 ether)
 *
 *         Pre-conditions:
 *           - dev wallet holds at least VEST_AMOUNT_WEI in BRAWL
 *           - BRAWL.tradingEnabled may still be false (we whitelist the
 *             UNCX vesting contract on BRAWL before this runs, so the
 *             transfer goes through)
 */
interface IUNCXVesting {
    struct LockParams {
        address owner;          // beneficiary — who can claim vested tokens
        uint256 amount;         // amount in token wei
        uint256 startEmission;  // unix ts vesting begins
        uint256 endEmission;    // unix ts vesting fully unlocks (linear between)
        address condition;      // optional release-condition contract (0 = pure time)
    }

    /// @notice UNCX V2 Token Vesting on Base.
    ///         Contract: 0x7ca3dE7D58A0bCAd115184597553485A919320c5
    ///         Fee: 0.05 ETH flat + 0.1% of vested tokens.
    function lock(address token, LockParams[] calldata lockParams) external payable;
}

interface IBRAWL {
    function setWhitelist(address addr, bool status) external;
    function whitelisted(address addr) external view returns (bool);
}

contract LockTeamTokens is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address dev = vm.addr(deployerKey);

        address brawl = vm.envAddress("BRAWL_ADDRESS");
        address vesting = vm.envOr(
            "UNCX_VESTING",
            address(0x7ca3dE7D58A0bCAd115184597553485A919320c5)
        );
        uint256 amount = vm.envOr("VEST_AMOUNT_WEI", uint256(20_000 * 10 ** 18));
        uint256 duration = vm.envOr("VEST_DURATION_SECONDS", uint256(180 days));
        address beneficiary = vm.envOr("VEST_BENEFICIARY", dev);
        uint256 fee = vm.envOr("UNCX_FEE_WEI", uint256(0.05 ether));

        console2.log("=== BRAWL team-token vesting ===");
        console2.log("Dev:                ", dev);
        console2.log("BRAWL:              ", brawl);
        console2.log("UNCX vesting:       ", vesting);
        console2.log("Amount (wei):       ", amount);
        console2.log("Duration (s):       ", duration);
        console2.log("Beneficiary:        ", beneficiary);
        console2.log("UNCX fee (wei):     ", fee);

        require(amount > 0, "VEST_AMOUNT_WEI = 0");
        require(duration > 0, "VEST_DURATION_SECONDS = 0");
        require(IERC20(brawl).balanceOf(dev) >= amount, "Dev short on BRAWL");
        require(dev.balance >= fee, "Dev short on ETH for UNCX fee");

        vm.startBroadcast(deployerKey);

        // Whitelist UNCX vesting contract on BRAWL so the transfer-in works
        // even before trading is enabled.
        IBRAWL b = IBRAWL(brawl);
        if (!b.whitelisted(vesting)) {
            b.setWhitelist(vesting, true);
            console2.log("Whitelisted UNCX vesting contract on BRAWL");
        }

        // Approve UNCX to pull the tokens.
        IERC20(brawl).approve(vesting, amount);

        // Compose the LockParams entry and fire.
        IUNCXVesting.LockParams[] memory params = new IUNCXVesting.LockParams[](1);
        params[0] = IUNCXVesting.LockParams({
            owner: beneficiary,
            amount: amount,
            startEmission: block.timestamp,
            endEmission: block.timestamp + duration,
            condition: address(0)
        });

        IUNCXVesting(vesting).lock{value: fee}(brawl, params);

        console2.log("");
        console2.log("Team tokens vested.");
        console2.log("startEmission ts:   ", block.timestamp);
        console2.log("endEmission ts:     ", block.timestamp + duration);
        console2.log("VERIFY URL: https://app.uncx.network/services/token-vesting");

        vm.stopBroadcast();
    }
}
