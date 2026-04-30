// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Marketplace} from "../../contracts/Marketplace.sol";
import {Brawlers} from "../../contracts/Brawlers.sol";

contract MarketplaceTest is Test {
    Marketplace internal market;
    Brawlers internal brawlers;

    address internal owner = address(this);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA501);
    address internal treasury = address(0xDE7);

    uint256 internal constant SEED = 0x2a;
    uint16 internal constant FEE_BPS = 500; // 5%

    function setUp() public {
        brawlers = new Brawlers(owner, SEED, address(0));
        market = new Marketplace(address(brawlers), treasury, FEE_BPS, owner);

        // Give alice two brawlers, bob one.
        vm.prank(owner);
        brawlers.mint(alice);
        vm.prank(owner);
        brawlers.mint(alice);
        vm.prank(owner);
        brawlers.mint(bob);

        // Fund buyers with native tBNB-equivalent.
        vm.deal(carol, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(alice, 100 ether);
    }

    // ─── Deploy / config ────────────────────────────────────────────

    function test_deploy_rejectsZeroAddresses() public {
        vm.expectRevert(Marketplace.ZeroAddress.selector);
        new Marketplace(address(0), treasury, FEE_BPS, owner);

        vm.expectRevert(Marketplace.ZeroAddress.selector);
        new Marketplace(address(brawlers), address(0), FEE_BPS, owner);

        // Zero initial owner is caught by Ownable's own constructor check,
        // not by ZeroAddress. Both are invalid; either error is fine.
        vm.expectRevert();
        new Marketplace(address(brawlers), treasury, FEE_BPS, address(0));
    }

    function test_deploy_rejectsFeeAboveCap() public {
        vm.expectRevert(abi.encodeWithSelector(Marketplace.FeeTooHigh.selector, 1001));
        new Marketplace(address(brawlers), treasury, 1001, owner);
    }

    function test_initialConfig() public view {
        assertEq(address(market.brawlers()), address(brawlers));
        assertEq(market.feeTreasury(), treasury);
        assertEq(market.feeBps(), FEE_BPS);
        assertEq(market.owner(), owner);
    }

    // ─── List ───────────────────────────────────────────────────────

    function test_list_happyPath() public {
        uint256 tokenId = 1; // alice owns
        vm.prank(alice);
        brawlers.approve(address(market), tokenId);

        vm.expectEmit(true, true, false, true);
        emit Marketplace.Listed(tokenId, alice, 1 ether);

        vm.prank(alice);
        market.list(tokenId, 1 ether);

        Marketplace.Listing memory l = market.listingOf(tokenId);
        assertEq(l.seller, alice);
        assertEq(l.price, 1 ether);
        assertTrue(market.isListed(tokenId));
    }

    function test_list_happyPath_viaSetApprovalForAll() public {
        uint256 tokenId = 1;
        vm.prank(alice);
        brawlers.setApprovalForAll(address(market), true);

        vm.prank(alice);
        market.list(tokenId, 0.5 ether);

        assertTrue(market.isListed(tokenId));
    }

    function test_list_revertsOnNonOwner() public {
        uint256 tokenId = 1; // alice owns
        vm.prank(bob);
        vm.expectRevert(Marketplace.NotOwner.selector);
        market.list(tokenId, 1 ether);
    }

    function test_list_revertsWithoutApproval() public {
        uint256 tokenId = 1;
        vm.prank(alice);
        vm.expectRevert(Marketplace.NotApproved.selector);
        market.list(tokenId, 1 ether);
    }

    function test_list_revertsOnZeroPrice() public {
        uint256 tokenId = 1;
        vm.prank(alice);
        brawlers.approve(address(market), tokenId);
        vm.prank(alice);
        vm.expectRevert(Marketplace.ZeroPrice.selector);
        market.list(tokenId, 0);
    }

    function test_list_revertsIfAlreadyListed() public {
        uint256 tokenId = 1;
        vm.prank(alice);
        brawlers.approve(address(market), tokenId);
        vm.prank(alice);
        market.list(tokenId, 1 ether);

        vm.prank(alice);
        brawlers.approve(address(market), tokenId);
        vm.prank(alice);
        vm.expectRevert(Marketplace.AlreadyListed.selector);
        market.list(tokenId, 2 ether);
    }

    // ─── Update price ───────────────────────────────────────────────

    function test_updatePrice_happyPath() public {
        uint256 tokenId = 1;
        vm.prank(alice);
        brawlers.approve(address(market), tokenId);
        vm.prank(alice);
        market.list(tokenId, 1 ether);

        vm.expectEmit(true, false, false, true);
        emit Marketplace.PriceUpdated(tokenId, 1 ether, 2 ether);

        vm.prank(alice);
        market.updatePrice(tokenId, 2 ether);

        Marketplace.Listing memory l = market.listingOf(tokenId);
        assertEq(l.price, 2 ether);
    }

    function test_updatePrice_revertsNonSeller() public {
        uint256 tokenId = 1;
        vm.prank(alice);
        brawlers.approve(address(market), tokenId);
        vm.prank(alice);
        market.list(tokenId, 1 ether);

        vm.prank(bob);
        vm.expectRevert(Marketplace.NotSeller.selector);
        market.updatePrice(tokenId, 3 ether);
    }

    // ─── Cancel ─────────────────────────────────────────────────────

    function test_cancel_happyPath() public {
        uint256 tokenId = 1;
        vm.prank(alice);
        brawlers.approve(address(market), tokenId);
        vm.prank(alice);
        market.list(tokenId, 1 ether);

        vm.expectEmit(true, true, false, true);
        emit Marketplace.Unlisted(tokenId, alice);

        vm.prank(alice);
        market.cancel(tokenId);

        assertFalse(market.isListed(tokenId));
    }

    function test_cancel_revertsNonSeller() public {
        uint256 tokenId = 1;
        vm.prank(alice);
        brawlers.approve(address(market), tokenId);
        vm.prank(alice);
        market.list(tokenId, 1 ether);

        vm.prank(bob);
        vm.expectRevert(Marketplace.NotSeller.selector);
        market.cancel(tokenId);
    }

    // ─── Buy ────────────────────────────────────────────────────────

    function test_buy_happyPath_feeAndProceeds() public {
        uint256 tokenId = 1;
        uint256 price = 1 ether;
        vm.prank(alice);
        brawlers.approve(address(market), tokenId);
        vm.prank(alice);
        market.list(tokenId, price);

        uint256 aliceBefore = alice.balance;
        uint256 treasuryBefore = treasury.balance;

        vm.expectEmit(true, true, true, true);
        emit Marketplace.Sold(tokenId, alice, carol, price, (price * FEE_BPS) / 10_000);

        vm.prank(carol);
        market.buy{value: price}(tokenId);

        uint256 fee = (price * FEE_BPS) / 10_000;
        uint256 proceeds = price - fee;

        assertEq(brawlers.ownerOf(tokenId), carol, "ownership transferred");
        assertEq(alice.balance - aliceBefore, proceeds, "seller got 95%");
        assertEq(treasury.balance - treasuryBefore, fee, "treasury got 5%");
        assertFalse(market.isListed(tokenId), "listing cleared");
    }

    function test_buy_refundsOverpayment() public {
        uint256 tokenId = 1;
        uint256 price = 1 ether;
        vm.prank(alice);
        brawlers.approve(address(market), tokenId);
        vm.prank(alice);
        market.list(tokenId, price);

        uint256 carolBefore = carol.balance;

        vm.prank(carol);
        market.buy{value: 3 ether}(tokenId);

        // Carol should have paid exactly `price`, 2 ether refunded.
        assertEq(carolBefore - carol.balance, price);
    }

    function test_buy_revertsOnInsufficientPayment() public {
        uint256 tokenId = 1;
        vm.prank(alice);
        brawlers.approve(address(market), tokenId);
        vm.prank(alice);
        market.list(tokenId, 1 ether);

        vm.prank(carol);
        vm.expectRevert(
            abi.encodeWithSelector(Marketplace.InsufficientPayment.selector, 1 ether, 0.5 ether)
        );
        market.buy{value: 0.5 ether}(tokenId);
    }

    function test_buy_revertsOnNotListed() public {
        vm.prank(carol);
        vm.expectRevert(Marketplace.NotListed.selector);
        market.buy{value: 1 ether}(42);
    }

    function test_buy_revertsAndRefundsOnStaleOwnership() public {
        uint256 tokenId = 1;
        vm.prank(alice);
        brawlers.approve(address(market), tokenId);
        vm.prank(alice);
        market.list(tokenId, 1 ether);

        // Alice transfers out after listing, stale.
        vm.prank(alice);
        brawlers.transferFrom(alice, bob, tokenId);

        uint256 carolBefore = carol.balance;

        vm.prank(carol);
        vm.expectRevert(Marketplace.NotOwner.selector);
        market.buy{value: 1 ether}(tokenId);

        // EVM refunds msg.value on revert automatically.
        assertEq(carol.balance, carolBefore, "buyer fully refunded via revert");
        // Listing stays in storage until someone calls sweep, by design.
        assertTrue(market.isListed(tokenId), "stale listing remains, awaiting sweep");
    }

    function test_buy_revertsOnRevokedApproval() public {
        uint256 tokenId = 1;
        vm.prank(alice);
        brawlers.approve(address(market), tokenId);
        vm.prank(alice);
        market.list(tokenId, 1 ether);

        // Revoke approval.
        vm.prank(alice);
        brawlers.approve(address(0), tokenId);

        uint256 carolBefore = carol.balance;

        vm.prank(carol);
        vm.expectRevert(Marketplace.NotApproved.selector);
        market.buy{value: 1 ether}(tokenId);

        assertEq(carol.balance, carolBefore, "buyer fully refunded via revert");
    }

    // ─── Sweep ──────────────────────────────────────────────────────

    function test_sweep_clearsStaleListing_byAnyone() public {
        uint256 tokenId = 1;
        vm.prank(alice);
        brawlers.approve(address(market), tokenId);
        vm.prank(alice);
        market.list(tokenId, 1 ether);

        // Go stale.
        vm.prank(alice);
        brawlers.transferFrom(alice, bob, tokenId);

        // Carol (random party) sweeps.
        vm.expectEmit(true, true, false, true);
        emit Marketplace.Unlisted(tokenId, alice);
        vm.prank(carol);
        market.sweep(tokenId);

        assertFalse(market.isListed(tokenId), "stale listing swept");
    }

    function test_sweep_revertsOnValidListing() public {
        uint256 tokenId = 1;
        vm.prank(alice);
        brawlers.approve(address(market), tokenId);
        vm.prank(alice);
        market.list(tokenId, 1 ether);

        vm.prank(carol);
        vm.expectRevert(Marketplace.NotStale.selector);
        market.sweep(tokenId);
    }

    function test_sweep_revertsOnNotListed() public {
        vm.prank(carol);
        vm.expectRevert(Marketplace.NotListed.selector);
        market.sweep(42);
    }

    // ─── Pause ──────────────────────────────────────────────────────

    function test_pause_blocksListAndBuy_butNotCancel() public {
        uint256 tokenId = 1;
        vm.prank(alice);
        brawlers.approve(address(market), tokenId);
        vm.prank(alice);
        market.list(tokenId, 1 ether);

        market.pause();

        // Second brawler can't be listed while paused.
        vm.prank(alice);
        brawlers.approve(address(market), 2);
        vm.prank(alice);
        vm.expectRevert(); // Pausable: paused
        market.list(2, 1 ether);

        // Can't buy while paused.
        vm.prank(carol);
        vm.expectRevert(); // Pausable: paused
        market.buy{value: 1 ether}(tokenId);

        // Cancel still works even when paused, emergency exit for sellers.
        vm.prank(alice);
        market.cancel(tokenId);
        assertFalse(market.isListed(tokenId));

        // Unpause and verify list works again.
        market.unpause();
        vm.prank(alice);
        brawlers.approve(address(market), 2);
        vm.prank(alice);
        market.list(2, 1 ether);
        assertTrue(market.isListed(2));
    }

    // ─── Admin ──────────────────────────────────────────────────────

    function test_setFee_ownerOnly_andCapped() public {
        market.setFee(250); // 2.5%, valid
        assertEq(market.feeBps(), 250);

        vm.expectRevert(abi.encodeWithSelector(Marketplace.FeeTooHigh.selector, 1001));
        market.setFee(1001);

        vm.prank(alice);
        vm.expectRevert(); // Ownable: caller not owner
        market.setFee(0);
    }

    function test_setFeeTreasury() public {
        address newTreasury = address(0xFEE5);
        vm.expectEmit(true, true, false, true);
        emit Marketplace.TreasuryChanged(treasury, newTreasury);
        market.setFeeTreasury(newTreasury);
        assertEq(market.feeTreasury(), newTreasury);

        vm.expectRevert(Marketplace.ZeroAddress.selector);
        market.setFeeTreasury(address(0));
    }

    // ─── Receive ───────────────────────────────────────────────────

    function test_directTransferRejected() public {
        vm.prank(carol);
        (bool ok, ) = address(market).call{value: 1 ether}("");
        assertFalse(ok, "direct send should fail");
    }
}
