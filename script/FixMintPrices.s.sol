// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MintDrop} from "../contracts/MintDrop.sol";

/**
 * @title FixMintPrices
 * @notice Hot-fix script: deploy.s.sol shipped without TIERED_PRICING=true,
 *         so MintDrop is currently serving Sepolia micro defaults
 *         (0.0001 ETH / 0.01 USDT). Apply the mainnet 5-tier calibration
 *         immediately so the price ladder is correct from the next mint.
 *
 *         Required env:
 *           PRIVATE_KEY     - the MintDrop owner (deployer wallet)
 *           MINTDROP_ADDRESS- the deployed MintDrop on Base mainnet
 *
 *         Tier table per Deploy.s.sol mainnet calibration (D's 2026-04-28
 *         lock-in, written into Deploy.s.sol header):
 *           Tier 1: ids 1-100   = FREE (founder)
 *           Tier 2: ids 101-500 = $40 = 0.010 ETH (@ $4k ETH)
 *           Tier 3: ids 501-1000= $45 = 0.01125 ETH
 *           Tier 4: ids 1001-1500=$50 = 0.0125 ETH
 *           Tier 5: ids 1501-2000=$60 = 0.015 ETH
 */
contract FixMintPrices is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address mintDropAddr = vm.envAddress("MINTDROP_ADDRESS");
        MintDrop mintDrop = MintDrop(mintDropAddr);

        vm.startBroadcast(pk);

        // Mainnet pricing per x-launch-thread.md (the canonical numbers
        // D shipped to copy). 6 tiers, founders pay BUT cheaper than the
        // ramp. NEVER free — D explicitly nixed the $0 tier mid-launch.
        MintDrop.PriceTier[] memory tiers = new MintDrop.PriceTier[](6);
        tiers[0] = MintDrop.PriceTier({
            upToSold: 50,
            ethPrice: uint128(5_000_000_000_000_000),     // 0.005 ETH = $20 @ $4k
            usdcPrice: uint128(20_000_000),
            usdtPrice: uint128(20_000_000)
        });
        tiers[1] = MintDrop.PriceTier({
            upToSold: 100,
            ethPrice: uint128(6_250_000_000_000_000),     // 0.00625 ETH = $25
            usdcPrice: uint128(25_000_000),
            usdtPrice: uint128(25_000_000)
        });
        tiers[2] = MintDrop.PriceTier({
            upToSold: 500,
            ethPrice: uint128(7_500_000_000_000_000),     // 0.0075 ETH = $30
            usdcPrice: uint128(30_000_000),
            usdtPrice: uint128(30_000_000)
        });
        tiers[3] = MintDrop.PriceTier({
            upToSold: 1000,
            ethPrice: uint128(8_750_000_000_000_000),     // 0.00875 ETH = $35
            usdcPrice: uint128(35_000_000),
            usdtPrice: uint128(35_000_000)
        });
        tiers[4] = MintDrop.PriceTier({
            upToSold: 1500,
            ethPrice: uint128(10_000_000_000_000_000),    // 0.010 ETH = $40
            usdcPrice: uint128(40_000_000),
            usdtPrice: uint128(40_000_000)
        });
        tiers[5] = MintDrop.PriceTier({
            upToSold: 2000,
            ethPrice: uint128(12_500_000_000_000_000),    // 0.0125 ETH = $50
            usdcPrice: uint128(50_000_000),
            usdtPrice: uint128(50_000_000)
        });
        mintDrop.setPriceTiers(tiers);
        console2.log("Tiered pricing applied:");
        console2.log("  T1 (1-50):     $20 / 0.005 ETH (founder)");
        console2.log("  T2 (51-100):   $25 / 0.00625 ETH (founder)");
        console2.log("  T3 (101-500):  $30 / 0.0075 ETH");
        console2.log("  T4 (501-1000): $35 / 0.00875 ETH");
        console2.log("  T5 (1001-1500):$40 / 0.010 ETH");
        console2.log("  T6 (1501-2000):$50 / 0.0125 ETH");

        vm.stopBroadcast();
    }
}
