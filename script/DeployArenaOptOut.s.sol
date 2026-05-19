// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ArenaOptOut} from "../contracts/ArenaOptOut.sol";

/**
 * @title DeployArenaOptOut
 * @notice Deploys ArenaOptOut, points it at the existing Brawlers contract.
 *
 * Env:
 *   PRIVATE_KEY        deployer key (dev wallet ok, contract has no admin)
 *   BRAWLERS_ADDRESS   the live Brawlers ERC-721 contract
 *
 * Usage:
 *   forge script script/DeployArenaOptOut.s.sol \
 *     --rpc-url $RPC_URL --broadcast --verify --etherscan-api-key $ETHERSCAN_KEY
 */
contract DeployArenaOptOut is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address brawlers = vm.envAddress("BRAWLERS_ADDRESS");
        address deployer = vm.addr(pk);

        console.log("Deployer:", deployer);
        console.log("Brawlers (NFT) address:", brawlers);

        vm.startBroadcast(pk);
        ArenaOptOut opt = new ArenaOptOut(brawlers);
        vm.stopBroadcast();

        console.log("ArenaOptOut deployed:", address(opt));
        console.log("Wired to Brawlers:    ", address(opt.brawlers()));
    }
}
