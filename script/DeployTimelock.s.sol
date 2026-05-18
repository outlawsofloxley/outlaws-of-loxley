// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {BRAWLTimelock} from "../contracts/BRAWLTimelock.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title DeployTimelock
 * @notice Deploys BRAWLTimelock + transfers the configured BRAWL amount in.
 *
 * Env:
 *   DEPLOYER_KEY               private key for the dev wallet (signer + funder)
 *   BRAWL_ADDRESS              the BRAWL ERC-20 contract
 *   TIMELOCK_BENEFICIARY       receiver of vested tokens (defaults to dev EOA)
 *   TIMELOCK_AMOUNT_WEI        amount of BRAWL to lock, in wei (default 20_000e18)
 *   TIMELOCK_START_TS          unix start timestamp (default = block.timestamp)
 *   TIMELOCK_CLIFF_SECONDS     cliff in seconds (default 0)
 *   TIMELOCK_DURATION_SECONDS  total vest duration (default 180 days)
 */
contract DeployTimelock is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address brawl = vm.envAddress("BRAWL_ADDRESS");
        address deployer = vm.addr(pk);

        address beneficiary = vm.envOr("TIMELOCK_BENEFICIARY", deployer);
        uint256 amount = vm.envOr("TIMELOCK_AMOUNT_WEI", uint256(20_000 ether));
        uint64 startTs = uint64(vm.envOr("TIMELOCK_START_TS", uint256(block.timestamp)));
        uint64 cliff = uint64(vm.envOr("TIMELOCK_CLIFF_SECONDS", uint256(0)));
        uint64 duration = uint64(vm.envOr("TIMELOCK_DURATION_SECONDS", uint256(180 days)));

        console.log("Deployer (BRAWL holder):", deployer);
        console.log("BRAWL token:", brawl);
        console.log("Beneficiary:", beneficiary);
        console.log("Amount to lock (wei):", amount);
        console.log("Start ts:", startTs);
        console.log("Cliff seconds:", cliff);
        console.log("Duration seconds:", duration);

        uint256 balBefore = IERC20(brawl).balanceOf(deployer);
        console.log("Deployer BRAWL bal before:", balBefore);
        require(balBefore >= amount, "deployer balance < lock amount");

        vm.startBroadcast(pk);
        BRAWLTimelock lock = new BRAWLTimelock(brawl, beneficiary, startTs, cliff, duration);
        bool ok = IERC20(brawl).transfer(address(lock), amount);
        require(ok, "transfer to lock failed");
        vm.stopBroadcast();

        console.log("BRAWLTimelock deployed:", address(lock));
        console.log("End ts:", lock.endTimestamp());
        console.log("Initial allocation:", lock.currentAllocation());
    }
}
