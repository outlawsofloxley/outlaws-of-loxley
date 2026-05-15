// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title SeedAndLockLP
 * @notice One-tx mainnet launch script - seeds the BRAWL/ETH liquidity pool
 *         on Aerodrome v2 and BURNS the resulting LP token to 0xdead so
 *         liquidity is permanently locked.
 *
 *         Decision recap (D's 2026-05-15 launch-eve call): the LP is small
 *         (50,000 BRAWL + ~$200 ETH). UNCX V2 lock fee is 0.1 ETH flat,
 *         which is half the LP itself - economically silly. Burning the
 *         LP token to 0xdead is free, maximum trust signal, and permanent.
 *         If you ever want to recover the LP (you can't), don't burn.
 *
 *         Flow (default: BURN_LP=true):
 *           1. Whitelist Aerodrome router on BRAWL.
 *           2. Approve router to spend BRAWL_AMOUNT_WEI.
 *           3. Call addLiquidityETH() → LP token minted to dev wallet.
 *           4. Whitelist the resulting pair on BRAWL.
 *           5. Transfer LP token balance to 0xdead (permanent burn).
 *
 *         Optional legacy path (BURN_LP=false + UNICRYPT_LOCKER=0x30e522...):
 *           5b. Approve UNCX, lock LP for LOCK_SECONDS, pay UNCX fee.
 *
 *         Required env vars:
 *           PRIVATE_KEY         - deployer key (signs the LP seed + burn)
 *           BRAWL_ADDRESS       - deployed BRAWL ERC-20
 *           BRAWL_AMOUNT_WEI    - BRAWL to put in LP (50_000e18 launch default)
 *           ETH_AMOUNT_WEI      - paired ETH (~$200 worth at current price)
 *           AERODROME_ROUTER    - Base mainnet: 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43
 *
 *         Optional env vars:
 *           BURN_LP             - default true. Set to false to use UNCX path.
 *           UNICRYPT_LOCKER     - only used when BURN_LP=false.
 *           LOCK_SECONDS        - UNCX path only (default 6 months = 15_552_000)
 *           DEV_WALLET          - receives LP token before burn (default = signer)
 *
 *         Pre-conditions:
 *           - Deployer holds BRAWL_AMOUNT_WEI in BRAWL
 *           - Deployer has ETH_AMOUNT_WEI + ~0.005 ETH for gas
 *           - BRAWL deployed; trading may still be paused (deployer is
 *             whitelisted from construction, so the seed flows through)
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
    /// @notice UNCX Liquidity Locker V2.1 signature (Base, Aerodrome support).
    ///         The trailing `countryCode` was added in V2.1 — older 6-arg
    ///         variants will revert with no matching function.
    ///         Base locker contract: 0x30e522deDfFE3e3d11Cd53E27d18Cd4F016eD870
    ///         Fee on Base: 0.1 ETH flat + 1% of LP locked (paid in LP).
    function lockLPToken(
        address lpToken,
        uint256 amount,
        uint256 unlockDate,
        address payable referral,
        bool feeInEth,
        address payable withdrawer,
        uint16 countryCode
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

        // ── 5. Burn the LP token to 0xdead (default), or UNCX lock if BURN_LP=false ──
        // Burn sends LP tokens to 0x000...dEaD permanently. Zero cost,
        // unrecoverable, maximum scanner trust signal. The decision was made
        // on 2026-05-15 launch-eve given the small LP size — UNCX's 0.1 ETH
        // flat fee was ~50% of the LP itself, economically silly.
        // To switch back to UNCX lock: set BURN_LP=false + UNICRYPT_LOCKER=0x30e522...
        // See LAUNCH_AUTOMATION.md §2 for the full decision matrix.
        bool burnLP = vm.envOr("BURN_LP", true);
        if (burnLP) {
            address burnAddr = address(0x000000000000000000000000000000000000dEaD);
            IERC20(pair).transfer(burnAddr, liquidity);
            console2.log("LP BURNED to 0xdead:", liquidity);
            console2.log("Pair address:       ", pair);
            console2.log("VERIFY: basescan.org/address/", burnAddr);
        } else if (locker != address(0)) {
            IERC20(pair).approve(locker, liquidity);
            uint256 unlockDate = block.timestamp + lockSeconds;
            // UNCX V2 Base flat fee = 0.1 ETH; an extra small margin
            // protects against any minor rate change without overpaying much.
            // countryCode 36 = Australia per ISO 3166-1 numeric (Darren's loc).
            uint16 countryCode = uint16(vm.envOr("UNCX_COUNTRY_CODE", uint256(36)));
            uint256 uncxFee = vm.envOr("UNCX_FEE_WEI", uint256(0.1 ether));
            IUnicryptLocker(locker).lockLPToken{value: uncxFee}(
                pair, liquidity, unlockDate, payable(address(0)), true, payable(devWallet), countryCode
            );
            console2.log("LP locked until ts: ", unlockDate);
            console2.log("UNCX fee paid:      ", uncxFee);
            console2.log("CountryCode:        ", countryCode);
            console2.log(
                "VERIFY URL: https://app.uncx.network/lockers/univ2/address/", pair
            );
        } else {
            console2.log("WARNING: UNICRYPT_LOCKER unset and BURN_LP not set - LP NOT LOCKED.");
            console2.log("Set one of UNICRYPT_LOCKER=0x30e522de... or BURN_LP=true and re-run.");
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
