// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BRAWLTimelock} from "../../contracts/BRAWLTimelock.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock", "MCK") { _mint(msg.sender, 1_000_000e18); }
}

contract BRAWLTimelockTest is Test {
    MockToken token;
    BRAWLTimelock lock;
    address constant BENEFICIARY = address(0xBEEF);
    uint64 constant START = 1_000_000_000;
    uint64 constant CLIFF = 0;
    uint64 constant DURATION = 180 days; // 6 months

    function setUp() public {
        token = new MockToken();
        vm.warp(START);
        lock = new BRAWLTimelock(address(token), BENEFICIARY, START, CLIFF, DURATION);
        token.transfer(address(lock), 20_000e18);
    }

    function test_constructor_setsImmutables() public view {
        assertEq(address(lock.token()), address(token));
        assertEq(lock.beneficiary(), BENEFICIARY);
        assertEq(lock.startTimestamp(), START);
        assertEq(lock.cliffSeconds(), CLIFF);
        assertEq(lock.durationSeconds(), DURATION);
        assertEq(lock.endTimestamp(), START + DURATION);
        assertEq(lock.currentAllocation(), 20_000e18);
    }

    function test_revertsOnZeroToken() public {
        vm.expectRevert(BRAWLTimelock.ZeroAddress.selector);
        new BRAWLTimelock(address(0), BENEFICIARY, START, CLIFF, DURATION);
    }

    function test_revertsOnZeroBeneficiary() public {
        vm.expectRevert(BRAWLTimelock.ZeroAddress.selector);
        new BRAWLTimelock(address(token), address(0), START, CLIFF, DURATION);
    }

    function test_revertsOnZeroDuration() public {
        vm.expectRevert(BRAWLTimelock.InvalidDuration.selector);
        new BRAWLTimelock(address(token), BENEFICIARY, START, CLIFF, 0);
    }

    function test_revertsOnCliffGreaterThanDuration() public {
        vm.expectRevert(BRAWLTimelock.CliffGreaterThanDuration.selector);
        new BRAWLTimelock(address(token), BENEFICIARY, START, DURATION + 1, DURATION);
    }

    function test_vestedZeroAtStart() public view {
        assertEq(lock.vestedAmount(), 0);
        assertEq(lock.releasable(), 0);
        assertEq(lock.progressBps(), 0);
    }

    function test_vestedFullAtEnd() public {
        vm.warp(START + DURATION);
        assertEq(lock.vestedAmount(), 20_000e18);
        assertEq(lock.releasable(), 20_000e18);
        assertEq(lock.progressBps(), 10000);
    }

    function test_vestedHalfAtMidpoint() public {
        vm.warp(START + DURATION / 2);
        assertEq(lock.vestedAmount(), 10_000e18);
        assertEq(lock.releasable(), 10_000e18);
        assertEq(lock.progressBps(), 5000);
    }

    function test_releaseTransfersToBeneficiary() public {
        vm.warp(START + DURATION / 2);
        lock.release();
        assertEq(token.balanceOf(BENEFICIARY), 10_000e18);
        assertEq(lock.totalReleased(), 10_000e18);
        assertEq(lock.releasable(), 0);
    }

    function test_releaseAfterPartialClaim() public {
        vm.warp(START + DURATION / 4);
        lock.release();
        assertEq(token.balanceOf(BENEFICIARY), 5_000e18);

        vm.warp(START + DURATION / 2);
        assertEq(lock.releasable(), 5_000e18);
        lock.release();
        assertEq(token.balanceOf(BENEFICIARY), 10_000e18);
        assertEq(lock.totalReleased(), 10_000e18);
    }

    function test_releaseRevertsWhenNothingReleasable() public {
        vm.expectRevert(BRAWLTimelock.NothingToRelease.selector);
        lock.release();
    }

    function test_anyoneCanCallRelease() public {
        vm.warp(START + DURATION);
        vm.prank(address(0xDEAD));
        lock.release();
        assertEq(token.balanceOf(BENEFICIARY), 20_000e18);
    }

    function test_cliffBlocksReleaseUntilCliffPassed() public {
        BRAWLTimelock cliffLock = new BRAWLTimelock(address(token), BENEFICIARY, START, 30 days, 180 days);
        token.transfer(address(cliffLock), 20_000e18);
        vm.warp(START + 29 days);
        assertEq(cliffLock.releasable(), 0);
        vm.warp(START + 30 days);
        // At exactly cliff, vestedAmount = alloc * (30 days) / (180 days)
        uint256 expected = (uint256(20_000e18) * uint256(30 days)) / uint256(180 days);
        assertEq(cliffLock.releasable(), expected);
    }

    function test_topUpJoinsSchedule() public {
        vm.warp(START + DURATION / 2);
        token.transfer(address(lock), 4_000e18); // add 4k more after deploy
        // alloc is now 24k, half vested → 12k
        assertEq(lock.vestedAmount(), 12_000e18);
    }

    function test_noOwnershipNoAdminFn() public view {
        // Sanity: the contract has no `owner()` selector. We probe by trying
        // to call it through low-level — the call should revert (no function).
        (bool ok, ) = address(lock).staticcall(abi.encodeWithSignature("owner()"));
        assertFalse(ok);
        (ok, ) = address(lock).staticcall(abi.encodeWithSignature("transferOwnership(address)"));
        assertFalse(ok);
        (ok, ) = address(lock).staticcall(abi.encodeWithSignature("renounceOwnership()"));
        assertFalse(ok);
    }
}
