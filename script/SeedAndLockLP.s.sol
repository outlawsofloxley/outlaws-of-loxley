// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title SeedAndLockLP
 * @notice One-tx mainnet launch script - seeds the BRAWL/ETH liquidity pool
 *         on Aerodrome v2 and (optionally) locks the resulting LP token on
 *         Unicrypt for an extended period so the dev cannot pull liquidity.
 *
 *         Flow:
 *           1. Approve Aerodrome router to spend BRAWL.
 *           2. Call addLiquidityETH() → LP tokens minted to dev wallet.
 *           3. (optional) Approve Unicrypt to spend LP tokens.
 *           4. Call Unicrypt.lockLPToken() → LP tokens locked for LOCK_DURATION.
 *           5. Whitelist the LP pair on BRAWL (so trades aren't hit by limits).
 *
 *         Required env vars:
 *           PRIVATE_KEY         - dev key (signs all 5 txs)
 *           BRAWL_ADDRESS       - deployed BRAWL ERC-20
 *           BRAWL_AMOUNT_WEI    - BRAWL to put in LP (e.g. 2500e18)
 *           ETH_AMOUNT_WEI      - paired ETH (e.g. 0.125e18)
 *           AERODROME_ROUTER    - Base mainnet: 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43
 *           UNICRYPT_LOCKER     - set to address(0) to skip locking. Verify the
 *                                 current Base mainnet address before launch
 *                                 (https://app.uncx.network/lockers).
 *           LOCK_SECONDS        - lock duration (default 6 months = 15_552_000)
 *           DEV_WALLET          - receives LP token (or owner of the lock)
 *
 *         Pre-conditions:
 *           - Dev wallet holds BRAWL_AMOUNT_WEI in BRAWL
 *           - Dev wallet has ETH_AMOUNT_WEI + ~0.005 ETH for gas
 *           - BRAWL is deployed and Aerodrome router is whitelisted in BRAWL
 *           - (For lock) Unicrypt locker is verified at the right address
 */
interface IAerodromeRouter {
    function addLiquidityETH(
        address token,
        bool stable,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);

    function poolFor(address tokenA, address tokenB, bool stable, address factory)
        external
        view
        returns (address pool);

    function defaultFactory() external view returns (address);

    function weth() external view returns (address);
}

interface IUnicryptLocker {
    /// @notice Standard Unicrypt v3 LP locker signature. Confirm at deploy time.
    function lockLPToken(
        address lpToken,
        uint256 amount,
        uint256 unlockDate,
        address payable referral,
        bool feeInEth,
        address payable withdrawer
    ) external payable;
}

interface IBRAWL {
    function setWhitelist(address addr, bool status) external;
    function whitelisted(address addr) external view returns (bool);
}

contract SeedAndLockLP is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address dev = vm.addr(deployerKey);

        address brawl = vm.envAddress("BRAWL_ADDRESS");
        uint256 brawlAmount = vm.envUint("BRAWL_AMOUNT_WEI");
        uint256 ethAmount = vm.envUint("ETH_AMOUNT_WEI");
        address router = vm.envAddress("AERODROME_ROUTER");
        address locker = vm.envOr("UNICRYPT_LOCKER", address(0));
        uint256 lockSeconds = vm.envOr("LOCK_SECONDS", uint256(180 days));
        address devWallet = vm.envOr("DEV_WALLET", dev);

        console2.log("=== BASEic Brawlers LP seed + lock ===");
        console2.log("Dev:                ", dev);
        console2.log("BRAWL:              ", brawl);
        console2.log("BRAWL into LP:      ", brawlAmount);
        console2.log("ETH into LP (wei):  ", ethAmount);
        console2.log("Aerodrome router:   ", router);
        console2.log("Unicrypt locker:    ", locker);
        console2.log("Lock duration (s):  ", lockSeconds);
        console2.log("Dev wallet (LP rcv):", devWallet);

        require(brawlAmount > 0, "BRAWL_AMOUNT_WEI = 0");
        require(ethAmount > 0, "ETH_AMOUNT_WEI = 0");
        require(IERC20(brawl).balanceOf(dev) >= brawlAmount, "Dev short on BRAWL");
        require(dev.balance >= ethAmount, "Dev short on ETH");

        vm.startBroadcast(deployerKey);

        // ── 1. Whitelist router + WETH on BRAWL (if not already done) ──
        IBRAWL b = IBRAWL(brawl);
        if (!b.whitelisted(router)) {
            b.setWhitelist(router, true);
            console2.log("Whitelisted router on BRAWL");
        }

        // ── 2. Approve router to pull BRAWL ──
        IERC20(brawl).approve(router, brawlAmount);

        // ── 3. Add liquidity (volatile pool - BRAWL is not a stablecoin) ──
        (uint256 actualBrawl, uint256 actualEth, uint256 liquidity) = IAerodromeRouter(router)
            .addLiquidityETH{value: ethAmount}(
            brawl,
            false, // volatile pool
            brawlAmount,
            (brawlAmount * 95) / 100, // 5% slippage tolerance
            (ethAmount * 95) / 100,
            devWallet,
            block.timestamp + 1 hours
        );
        console2.log("LP added - BRAWL used: ", actualBrawl);
        console2.log("LP added - ETH used:   ", actualEth);
        console2.log("LP token minted (raw): ", liquidity);

        // ── 4. Find the LP pair address + whitelist it on BRAWL ──
        address weth = IAerodromeRouter(router).weth();
        address factory = IAerodromeRouter(router).defaultFactory();
        address pair = IAerodromeRouter(router).poolFor(brawl, weth, false, factory);
        console2.log("LP pair:            ", pair);
        if (!b.whitelisted(pair)) {
            b.setWhitelist(pair, true);
            console2.log("Whitelisted LP pair on BRAWL");
        }

        // ── 5. Optional: lock the LP token on Unicrypt ──
        if (locker != address(0)) {
            IERC20(pair).approve(locker, liquidity);
            uint256 unlockDate = block.timestamp + lockSeconds;
            // Note: Unicrypt has a small ETH fee for locks. 0.01 ETH covers
            // most ones; check the actual rate before launch.
            IUnicryptLocker(locker).lockLPToken{value: 0.01 ether}(
                pair, liquidity, unlockDate, payable(address(0)), true, payable(devWallet)
            );
            console2.log("LP locked until:    ", unlockDate);
            console2.log(
                "VERIFY URL: https://app.uncx.network/lockers/univ2/address/", pair
            );
        } else {
            console2.log("WARNING: UNICRYPT_LOCKER unset - LP NOT LOCKED.");
            console2.log("You should lock manually at https://app.uncx.network/");
        }

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== LP launch complete ===");
        console2.log("LP pair:        ", pair);
        if (locker != address(0)) {
            console2.log("Locked for:     ", lockSeconds, "seconds (~", lockSeconds / 86400);
            console2.log("days)");
        }
    }
}
