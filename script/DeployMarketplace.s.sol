// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {Marketplace} from "../contracts/Marketplace.sol";

/**
 * @title DeployMarketplace
 * @notice Standalone deployer for the Marketplace contract. Reads existing
 *         Brawlers address + fee config from env so it can be slotted in
 *         next to an already-live deploy without redeploying anything else.
 *
 *         Required env:
 *           - PRIVATE_KEY            deployer private key
 *           - BRAWLERS_ADDRESS       Brawlers NFT contract address
 *           - FEE_TREASURY           where 5% sale fees go
 *         Optional env:
 *           - FEE_BPS (default 500)  basis points, capped at 1000 (10%)
 *           - INITIAL_OWNER          contract owner (defaults to deployer)
 */
contract DeployMarketplace is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address brawlersAddr = vm.envAddress("BRAWLERS_ADDRESS");
        address feeTreasury = vm.envAddress("FEE_TREASURY");
        uint16 feeBps = uint16(vm.envOr("FEE_BPS", uint256(500)));
        address initialOwner = vm.envOr("INITIAL_OWNER", deployer);

        console.log("=== Deploying Marketplace ===");
        console.log("Deployer:", deployer);
        console.log("Brawlers:", brawlersAddr);
        console.log("Fee treasury:", feeTreasury);
        console.log("Fee (bps):", feeBps);
        console.log("Initial owner:", initialOwner);

        vm.startBroadcast(deployerKey);
        Marketplace market = new Marketplace(
            brawlersAddr,
            feeTreasury,
            feeBps,
            initialOwner
        );
        vm.stopBroadcast();

        console.log("Marketplace deployed at:", address(market));
    }
}
