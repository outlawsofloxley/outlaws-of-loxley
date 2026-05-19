// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ArenaOptOut} from "../../contracts/ArenaOptOut.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract MockBrawlers is ERC721 {
    constructor() ERC721("MockBrawlers", "MOCK") {}
    function mint(address to, uint256 tokenId) external { _mint(to, tokenId); }
    function transferTo(address from, address to, uint256 tokenId) external {
        _transfer(from, to, tokenId);
    }
}

contract ArenaOptOutTest is Test {
    MockBrawlers brawlers;
    ArenaOptOut opt;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    event ArenaOptOutSet(uint256 indexed tokenId, address indexed setter, bool optedOut);

    function setUp() public {
        brawlers = new MockBrawlers();
        opt = new ArenaOptOut(address(brawlers));
        brawlers.mint(alice, 1);
        brawlers.mint(alice, 2);
        brawlers.mint(alice, 3);
        brawlers.mint(bob, 99);
    }

    function test_constructor_setsBrawlers() public view {
        assertEq(address(opt.brawlers()), address(brawlers));
    }

    function test_revertsOnZeroBrawlers() public {
        vm.expectRevert(ArenaOptOut.ZeroAddress.selector);
        new ArenaOptOut(address(0));
    }

    function test_defaultIsFalse() public view {
        assertEq(opt.optedOut(1), false);
        assertEq(opt.optedOut(2), false);
        assertEq(opt.optedOut(99), false);
    }

    function test_setOptOut_byOwner() public {
        vm.expectEmit(true, true, false, true);
        emit ArenaOptOutSet(1, alice, true);
        vm.prank(alice);
        opt.setOptOut(1, true);
        assertEq(opt.optedOut(1), true);
    }

    function test_setOptOut_revertsForNonOwner() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ArenaOptOut.NotOwner.selector, uint256(1)));
        opt.setOptOut(1, true);
    }

    function test_setOptOut_revertsForRandomAddress() public {
        vm.prank(address(0xDEADBEEF));
        vm.expectRevert(abi.encodeWithSelector(ArenaOptOut.NotOwner.selector, uint256(1)));
        opt.setOptOut(1, true);
    }

    function test_setOptOut_toggleBack() public {
        vm.startPrank(alice);
        opt.setOptOut(1, true);
        assertEq(opt.optedOut(1), true);
        opt.setOptOut(1, false);
        assertEq(opt.optedOut(1), false);
        vm.stopPrank();
    }

    function test_setOptOut_revertsForNonExistentToken() public {
        // ownerOf reverts on non-existent token, our require chains through it
        vm.prank(alice);
        vm.expectRevert(); // ERC721 OwnerQueryForNonexistentToken
        opt.setOptOut(7777, true);
    }

    function test_setOptOutBatch_byOwner() public {
        uint256[] memory ids = new uint256[](3);
        ids[0] = 1;
        ids[1] = 2;
        ids[2] = 3;

        vm.prank(alice);
        opt.setOptOutBatch(ids, true);
        assertEq(opt.optedOut(1), true);
        assertEq(opt.optedOut(2), true);
        assertEq(opt.optedOut(3), true);
    }

    function test_setOptOutBatch_revertsOnFirstNonOwned() public {
        uint256[] memory ids = new uint256[](3);
        ids[0] = 1;
        ids[1] = 99; // bob's
        ids[2] = 3;

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ArenaOptOut.NotOwner.selector, uint256(99)));
        opt.setOptOutBatch(ids, true);

        // No partial application: 1 should still be false even though it
        // came before the failing 99.
        assertEq(opt.optedOut(1), false);
        assertEq(opt.optedOut(3), false);
    }

    function test_setOptOutBatch_revertsOnEmpty() public {
        uint256[] memory ids = new uint256[](0);
        vm.prank(alice);
        vm.expectRevert(ArenaOptOut.EmptyBatch.selector);
        opt.setOptOutBatch(ids, true);
    }

    function test_setOptOutBatch_emitsPerToken() public {
        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;

        vm.expectEmit(true, true, false, true);
        emit ArenaOptOutSet(1, alice, true);
        vm.expectEmit(true, true, false, true);
        emit ArenaOptOutSet(2, alice, true);

        vm.prank(alice);
        opt.setOptOutBatch(ids, true);
    }

    function test_optedOutMany_returnsCorrectFlags() public {
        vm.startPrank(alice);
        opt.setOptOut(1, true);
        opt.setOptOut(3, true);
        vm.stopPrank();

        uint256[] memory ids = new uint256[](4);
        ids[0] = 1; // true
        ids[1] = 2; // false
        ids[2] = 3; // true
        ids[3] = 99; // false (bob's, never set)

        bool[] memory flags = opt.optedOutMany(ids);
        assertEq(flags.length, 4);
        assertTrue(flags[0]);
        assertFalse(flags[1]);
        assertTrue(flags[2]);
        assertFalse(flags[3]);
    }

    function test_optedOutMany_emptyInputReturnsEmpty() public view {
        uint256[] memory ids = new uint256[](0);
        bool[] memory flags = opt.optedOutMany(ids);
        assertEq(flags.length, 0);
    }

    function test_flagSurvivesTransfer_newOwnerCanFlipIt() public {
        // Alice opts out #1
        vm.prank(alice);
        opt.setOptOut(1, true);
        assertTrue(opt.optedOut(1));

        // Alice transfers #1 to bob
        vm.prank(alice);
        brawlers.transferTo(alice, bob, 1);
        assertEq(brawlers.ownerOf(1), bob);

        // Flag persists on the tokenId regardless of owner
        assertTrue(opt.optedOut(1));

        // Alice (old owner) can no longer flip it
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ArenaOptOut.NotOwner.selector, uint256(1)));
        opt.setOptOut(1, false);

        // Bob (new owner) CAN flip it
        vm.prank(bob);
        opt.setOptOut(1, false);
        assertFalse(opt.optedOut(1));
    }

    function test_largeBatch_doesNotRunOutOfGas() public {
        // Mint 100 tokens to alice and batch-flip them all
        for (uint256 i = 1000; i < 1100; i++) {
            brawlers.mint(alice, i);
        }
        uint256[] memory ids = new uint256[](100);
        for (uint256 i = 0; i < 100; i++) {
            ids[i] = 1000 + i;
        }
        vm.prank(alice);
        opt.setOptOutBatch(ids, true);

        // Spot check
        assertTrue(opt.optedOut(1000));
        assertTrue(opt.optedOut(1099));
    }

    function test_eventsOnFalseAlsoFire() public {
        // Default is already false, but explicitly setting to false should
        // still emit (useful for "I changed my mind" UI signals).
        vm.expectEmit(true, true, false, true);
        emit ArenaOptOutSet(1, alice, false);
        vm.prank(alice);
        opt.setOptOut(1, false);
    }
}
