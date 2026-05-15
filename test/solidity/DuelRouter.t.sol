// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Brawlers} from "../../contracts/Brawlers.sol";
import {Duel} from "../../contracts/Duel.sol";
import {BRAWL} from "../../contracts/BRAWL.sol";
import {DuelRouter} from "../../contracts/DuelRouter.sol";

/// @dev Mock Aerodrome router with configurable BRAWL/ETH rate.
///      Lets us simulate "good swap" and "bad swap (sandwich)" scenarios
///      without needing a fork.
contract MockAerodromeRouter {
    address public immutable weth = address(0xEEE);
    address public immutable defaultFactory = address(0xFAC);

    // Rate: how many BRAWL wei per 1 ETH wei (scaled 1e18-style ratio).
    // E.g., 500e18 means 500 BRAWL per 1 ETH (so BRAWL = $0.008 at $4k ETH).
    // For tests: 250e18 = 250 BRAWL per ETH (BRAWL=$0.016 at $4k); call it
    // whatever; the unit is BRAWL wei out per ETH wei in.
    uint256 public brawlPerEthRate;

    // Lets us simulate a sandwich attack: return less BRAWL than the
    // simple-rate calculation predicts.
    uint256 public outputHaircutBps; // 0 = ideal, 5000 = 50% haircut

    BRAWL public brawlToken;

    struct Route { address from; address to; bool stable; address factory; }

    constructor(BRAWL _brawl) {
        brawlToken = _brawl;
    }

    function setRate(uint256 _brawlPerEthRate) external {
        brawlPerEthRate = _brawlPerEthRate;
    }

    function setHaircutBps(uint256 _bps) external {
        outputHaircutBps = _bps;
    }

    receive() external payable {}

    function swapExactETHForTokens(
        uint256 amountOutMin,
        Route[] calldata /*routes*/,
        address to,
        uint256 /*deadline*/
    ) external payable returns (uint256[] memory amounts) {
        // ETH in: msg.value. BRAWL out: msg.value * rate / 1e18.
        uint256 brawlOut = (msg.value * brawlPerEthRate) / 1e18;
        brawlOut = brawlOut * (10_000 - outputHaircutBps) / 10_000;
        require(brawlOut >= amountOutMin, "INSUFFICIENT_OUTPUT");
        brawlToken.transfer(to, brawlOut);
        amounts = new uint256[](2);
        amounts[0] = msg.value;
        amounts[1] = brawlOut;
    }

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata /*routes*/,
        address to,
        uint256 /*deadline*/
    ) external returns (uint256[] memory amounts) {
        // BRAWL in: amountIn. ETH out: amountIn * 1e18 / rate.
        brawlToken.transferFrom(msg.sender, address(this), amountIn);
        uint256 ethOut = (amountIn * 1e18) / brawlPerEthRate;
        ethOut = ethOut * (10_000 - outputHaircutBps) / 10_000;
        require(ethOut >= amountOutMin, "INSUFFICIENT_OUTPUT");
        (bool ok, ) = to.call{value: ethOut}("");
        require(ok, "ETH_XFER_FAIL");
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = ethOut;
    }
}

contract DuelRouterTest is Test {
    Brawlers internal brawlers;
    Duel internal duel;
    BRAWL internal brawl;
    DuelRouter internal router;
    MockAerodromeRouter internal aero;

    address internal owner;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal devTreasury = address(0xDE7);

    uint256 internal signerPk = 0xBEEF;
    address internal signerAddr;

    // Initial economics: $1 = 500 BRAWL at $0.002, $1 = 0.00025 ETH at $4k
    // These are arbitrary for tests; the ratio matters for mock swap math.
    uint256 internal constant FIGHT_COST_BRAWL = 500e18;
    uint256 internal constant FIGHT_COST_ETH = 0.00025 ether;
    // Mock rate: 1 ETH = 2_000_000 BRAWL (i.e., BRAWL = $0.002 at $4k ETH).
    // So 0.00025 ETH (= $1) → 500 BRAWL out. Matches fight costs.
    uint256 internal constant MOCK_BRAWL_PER_ETH = 2_000_000 * 1e18;

    function setUp() public {
        // Warp into the future so `block.timestamp - 1` doesn't underflow in
        // the expiry-revert test.
        vm.warp(1_000_000);
        owner = address(this);
        signerAddr = vm.addr(signerPk);

        brawlers = new Brawlers(owner, 0x2a, address(0));
        brawl = new BRAWL(owner, owner);
        duel = new Duel(
            owner,
            address(brawlers),
            signerAddr,
            address(brawl),
            owner,
            0, // fightCost = 0 in production (router handles it)
            0  // devShareBps = 0 in production
        );
        brawlers.setDuelContract(address(duel));

        aero = new MockAerodromeRouter(brawl);
        aero.setRate(MOCK_BRAWL_PER_ETH);

        router = new DuelRouter(
            owner,
            address(duel),
            address(brawlers),
            address(brawl),
            address(aero),
            signerAddr,
            devTreasury,
            FIGHT_COST_BRAWL,
            FIGHT_COST_ETH
        );

        duel.setAuthorizedRouter(address(router));

        // Anti-sniper window: whitelist everyone we move BRAWL between.
        address[] memory wl = new address[](6);
        wl[0] = address(router);
        wl[1] = address(aero);
        wl[2] = alice;
        wl[3] = bob;
        wl[4] = devTreasury;
        wl[5] = owner;
        brawl.setWhitelistBulk(wl, true);

        // Seed the mock with BRAWL liquidity (acts like LP reserve).
        brawl.transfer(address(aero), 50_000e18);
        // Seed mock with ETH liquidity for BRAWL→ETH swaps.
        vm.deal(address(aero), 50 ether);

        // Give players BRAWL + ETH for stakes.
        brawl.transfer(alice, 5_000e18);
        brawl.transfer(bob, 5_000e18);
        vm.deal(alice, 5 ether);
        vm.deal(bob, 5 ether);

        // Approvals from Alice + Bob — one-time setup in production too.
        vm.startPrank(alice);
        brawl.approve(address(router), type(uint256).max);
        brawlers.setApprovalForAll(address(router), true);
        vm.stopPrank();

        vm.startPrank(bob);
        brawl.approve(address(router), type(uint256).max);
        brawlers.setApprovalForAll(address(router), true);
        vm.stopPrank();
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    function _mintPair() internal returns (uint256 idA, uint256 idB) {
        idA = brawlers.mint(alice);
        idB = brawlers.mint(bob);
    }

    function _buildDuelResult(uint256 idA, uint256 idB, uint32 winnerId, uint256 nonce)
        internal
        view
        returns (Duel.DuelResult memory)
    {
        return Duel.DuelResult({
            tokenA: idA,
            tokenB: idB,
            winnerId: winnerId,
            rounds: 3,
            seed: 0xc0ffee,
            newEloA: winnerId == uint32(idA) ? 1016 : 984,
            newEloB: winnerId == uint32(idB) ? 1016 : 984,
            nonce: nonce,
            expiry: block.timestamp + 1 hours
        });
    }

    function _signDuel(Duel.DuelResult memory r) internal view returns (bytes memory) {
        bytes32 digest = duel.hashDuelResult(r);
        (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(signerPk, digest);
        return abi.encodePacked(rs, ss, v);
    }

    function _signQuote(DuelRouter.FightQuote memory q) internal view returns (bytes memory) {
        bytes32 digest = router.hashQuote(q);
        (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(signerPk, digest);
        return abi.encodePacked(rs, ss, v);
    }

    function _quoteBB(uint256 idA, uint256 idB, uint32 winnerId, uint256 nonce)
        internal
        view
        returns (DuelRouter.FightQuote memory q)
    {
        uint256 costA = router.fighterCostBrawl(idA);
        uint256 costB = router.fighterCostBrawl(idB);
        uint256 pot = costA + costB;
        uint256 devCut = (pot * router.devShareBps()) / 10_000;
        uint256 winnerShare = pot - devCut;

        q = DuelRouter.FightQuote({
            nonce: nonce,
            expiry: block.timestamp + 600,
            tokenA: idA,
            tokenB: idB,
            ownerA: alice,
            ownerB: bob,
            modeA: 0, // BRAWL
            modeB: 0, // BRAWL
            ethCostA: 0,
            ethCostB: 0,
            brawlCostA: costA,
            brawlCostB: costB,
            swapDir: 0,
            swapAmountIn: 0,
            swapMinOut: 0,
            payoutAAddr: winnerId == uint32(idA) ? alice : address(0),
            payoutACurrency: 0,
            payoutAAmount: winnerId == uint32(idA) ? winnerShare : 0,
            payoutBAddr: winnerId == uint32(idB) ? bob : address(0),
            payoutBCurrency: 0,
            payoutBAmount: winnerId == uint32(idB) ? winnerShare : 0,
            devEthAmount: 0,
            devBrawlAmount: devCut
        });
    }

    function _quoteEE(uint256 idA, uint256 idB, uint32 winnerId, uint256 nonce)
        internal
        view
        returns (DuelRouter.FightQuote memory q)
    {
        uint256 costA = router.fighterCostEth(idA);
        uint256 costB = router.fighterCostEth(idB);
        uint256 pot = costA + costB;
        uint256 devCut = (pot * router.devShareBps()) / 10_000;
        uint256 winnerShare = pot - devCut;

        q = DuelRouter.FightQuote({
            nonce: nonce,
            expiry: block.timestamp + 600,
            tokenA: idA,
            tokenB: idB,
            ownerA: alice,
            ownerB: bob,
            modeA: 1, // ETH
            modeB: 1, // ETH
            ethCostA: costA,
            ethCostB: costB,
            brawlCostA: 0,
            brawlCostB: 0,
            swapDir: 0,
            swapAmountIn: 0,
            swapMinOut: 0,
            payoutAAddr: winnerId == uint32(idA) ? alice : address(0),
            payoutACurrency: 1, // ETH
            payoutAAmount: winnerId == uint32(idA) ? winnerShare : 0,
            payoutBAddr: winnerId == uint32(idB) ? bob : address(0),
            payoutBCurrency: 1,
            payoutBAmount: winnerId == uint32(idB) ? winnerShare : 0,
            devEthAmount: devCut,
            devBrawlAmount: 0
        });
    }

    // ─── BRAWL/BRAWL ─────────────────────────────────────────────────

    function test_BB_aliceWins_devGetsBrawl() public {
        (uint256 idA, uint256 idB) = _mintPair();
        Duel.DuelResult memory r = _buildDuelResult(idA, idB, uint32(idA), 1);
        DuelRouter.FightQuote memory q = _quoteBB(idA, idB, uint32(idA), 1);
        bytes memory qsig = _signQuote(q);
        bytes memory dsig = _signDuel(r);

        uint256 aliceBefore = brawl.balanceOf(alice);
        uint256 bobBefore = brawl.balanceOf(bob);
        uint256 devBefore = brawl.balanceOf(devTreasury);

        vm.prank(alice);
        router.fight(q, qsig, r, dsig);

        // Founders 1 & 2 get the 25% fight discount, so brawlCostA/B are
        // each FIGHT_COST_BRAWL × 0.75. Use the quote's amounts directly.
        assertEq(brawl.balanceOf(alice), aliceBefore - q.brawlCostA + q.payoutAAmount);
        assertEq(brawl.balanceOf(bob), bobBefore - q.brawlCostB);
        assertEq(brawl.balanceOf(devTreasury) - devBefore, q.devBrawlAmount);
        assertEq(devTreasury.balance, 0);
    }

    function test_BB_directDuelCall_reverts_routerSet() public {
        (uint256 idA, uint256 idB) = _mintPair();
        Duel.DuelResult memory r = _buildDuelResult(idA, idB, uint32(idA), 99);
        bytes memory sig = _signDuel(r);

        vm.expectRevert(); // Duel.OnlyAuthorizedRouter

        vm.prank(alice);
        duel.submitDuel(r, sig);
    }

    // ─── ETH/ETH ─────────────────────────────────────────────────────

    function test_EE_aliceWins_devGetsEth() public {
        (uint256 idA, uint256 idB) = _mintPair();
        Duel.DuelResult memory r = _buildDuelResult(idA, idB, uint32(idA), 2);
        DuelRouter.FightQuote memory q = _quoteEE(idA, idB, uint32(idA), 2);
        bytes memory qsig = _signQuote(q);
        bytes memory dsig = _signDuel(r);

        uint256 aliceEthBefore = alice.balance;
        uint256 bobEthBefore = bob.balance;
        uint256 devEthBefore = devTreasury.balance;

        vm.prank(alice);
        router.fight{value: q.ethCostA + q.ethCostB}(q, qsig, r, dsig);

        // Alice is msg.sender and pays both ETH stakes (acceptable simplification
        // for the unit test). In production, each player would call separately
        // and only put up their own side's msg.value.
        assertEq(alice.balance, aliceEthBefore - (q.ethCostA + q.ethCostB) + q.payoutAAmount);
        assertEq(bob.balance, bobEthBefore);
        assertEq(devTreasury.balance - devEthBefore, q.devEthAmount);
    }

    // ─── ETH/BRAWL ───────────────────────────────────────────────────

    function _quoteMixed_winnerEth(
        uint256 idA,
        uint256 idB,
        uint256 nonce
    ) internal view returns (DuelRouter.FightQuote memory q) {
        // A pays ETH ($1 = 0.00025 ETH); B pays BRAWL ($1 = 500 BRAWL).
        // A wins → wants ETH. Pot in USD value = $2 = 0.0005 ETH worth.
        // Dev cut 10% = $0.20 = 0.00005 ETH worth.
        // Winner gets $1.80 = 0.00045 ETH worth.
        // B's 500 BRAWL needs swapping to ETH. At rate (2_000_000 BRAWL = 1 ETH),
        //   500 BRAWL → 500 / 2_000_000 = 0.00025 ETH.
        // Inputs after swap: alice's 0.00025 ETH + 0.00025 ETH from swap = 0.0005 ETH.
        // Pay alice 0.00045 ETH, dev 0.00005 ETH = 0.0005 ETH. Balanced.
        uint256 brawlSwapIn = router.fighterCostBrawl(idB); // 500 BRAWL
        uint256 ethFromSwap = (brawlSwapIn * 1e18) / MOCK_BRAWL_PER_ETH; // ideal 0.00025 ETH

        uint256 totalEthPot = router.fighterCostEth(idA) + ethFromSwap; // 0.0005 ETH
        uint256 devCut = (totalEthPot * router.devShareBps()) / 10_000; // 10% = 0.00005 ETH
        uint256 winnerShare = totalEthPot - devCut; // 0.00045 ETH

        q = DuelRouter.FightQuote({
            nonce: nonce,
            expiry: block.timestamp + 600,
            tokenA: idA,
            tokenB: idB,
            ownerA: alice,
            ownerB: bob,
            modeA: 1, // ETH
            modeB: 0, // BRAWL
            ethCostA: router.fighterCostEth(idA),
            ethCostB: 0,
            brawlCostA: 0,
            brawlCostB: router.fighterCostBrawl(idB),
            swapDir: 2, // BRAWL→ETH
            swapAmountIn: brawlSwapIn,
            swapMinOut: (ethFromSwap * 99) / 100, // 1% slip
            payoutAAddr: alice,
            payoutACurrency: 1, // ETH
            payoutAAmount: winnerShare,
            payoutBAddr: address(0),
            payoutBCurrency: 0,
            payoutBAmount: 0,
            devEthAmount: devCut,
            devBrawlAmount: 0
        });
    }

    function test_mixed_winnerEth_oneSwap() public {
        (uint256 idA, uint256 idB) = _mintPair();
        Duel.DuelResult memory r = _buildDuelResult(idA, idB, uint32(idA), 3);
        DuelRouter.FightQuote memory q = _quoteMixed_winnerEth(idA, idB, 3);
        bytes memory qsig = _signQuote(q);
        bytes memory dsig = _signDuel(r);

        uint256 aliceEthBefore = alice.balance;
        uint256 bobBrawlBefore = brawl.balanceOf(bob);
        uint256 devEthBefore = devTreasury.balance;

        vm.prank(alice);
        router.fight{value: q.ethCostA}(q, qsig, r, dsig);

        assertEq(alice.balance, aliceEthBefore - q.ethCostA + q.payoutAAmount);
        assertEq(brawl.balanceOf(bob), bobBrawlBefore - q.brawlCostB);
        assertEq(devTreasury.balance - devEthBefore, q.devEthAmount);
    }

    function _quoteMixed_winnerBrawl(
        uint256 idA,
        uint256 idB,
        uint256 nonce
    ) internal view returns (DuelRouter.FightQuote memory q) {
        // A pays ETH ($1), B pays BRAWL ($1). B wins → wants BRAWL.
        // Total pot $2. Dev gets $0.20 ETH = 0.00005 ETH. Winner B gets $1.80 BRAWL.
        // Inputs: A's 0.00025 ETH + B's 500 BRAWL.
        // Need to give B winnerShare BRAWL = $1.80 = 900 BRAWL.
        // B already paid 500 BRAWL; need extra 400 BRAWL.
        // Dev needs 0.00005 ETH. A's 0.00025 ETH is enough for dev with 0.0002 ETH
        //   left. Swap that 0.0002 ETH to BRAWL → 0.0002 * 2_000_000 = 400 BRAWL.
        // Pay B: 500 (their stake) + 400 (swap) = 900 BRAWL ✓
        // Pay dev: 0.00005 ETH ✓
        uint256 ethToBrawlSwapIn = q.ethCostA; // placeholder; reassigned below
        ethToBrawlSwapIn = router.fighterCostEth(idA) - ((router.fighterCostEth(idA) * router.devShareBps()) / 10_000) - (router.fighterCostEth(idA) * router.devShareBps() / 10_000);
        // simpler math: winner gets brawlPot from B + (totalEthIn - devEth) swapped
        uint256 ethTotal = router.fighterCostEth(idA);
        uint256 brawlStake = router.fighterCostBrawl(idB);
        uint256 totalUsdValueAsEth = ethTotal + (brawlStake * 1e18 / MOCK_BRAWL_PER_ETH);
        uint256 devEthCut = (totalUsdValueAsEth * router.devShareBps()) / 10_000;
        // ETH-to-BRAWL swap: convert (ethTotal - devEthCut) ETH to BRAWL.
        uint256 ethToSwap = ethTotal - devEthCut;
        uint256 brawlFromSwap = (ethToSwap * MOCK_BRAWL_PER_ETH) / 1e18;
        uint256 winnerBrawl = brawlStake + brawlFromSwap;

        q = DuelRouter.FightQuote({
            nonce: nonce,
            expiry: block.timestamp + 600,
            tokenA: idA,
            tokenB: idB,
            ownerA: alice,
            ownerB: bob,
            modeA: 1,
            modeB: 0,
            ethCostA: ethTotal,
            ethCostB: 0,
            brawlCostA: 0,
            brawlCostB: brawlStake,
            swapDir: 1, // ETH→BRAWL
            swapAmountIn: ethToSwap,
            swapMinOut: (brawlFromSwap * 99) / 100,
            payoutAAddr: address(0),
            payoutACurrency: 0,
            payoutAAmount: 0,
            payoutBAddr: bob,
            payoutBCurrency: 0, // BRAWL
            payoutBAmount: winnerBrawl,
            devEthAmount: devEthCut,
            devBrawlAmount: 0
        });
    }

    function test_mixed_winnerBrawl_oneSwap() public {
        (uint256 idA, uint256 idB) = _mintPair();
        Duel.DuelResult memory r = _buildDuelResult(idA, idB, uint32(idB), 4);
        DuelRouter.FightQuote memory q = _quoteMixed_winnerBrawl(idA, idB, 4);
        bytes memory qsig = _signQuote(q);
        bytes memory dsig = _signDuel(r);

        uint256 aliceEthBefore = alice.balance;
        uint256 bobBrawlBefore = brawl.balanceOf(bob);
        uint256 devEthBefore = devTreasury.balance;

        vm.prank(alice);
        router.fight{value: q.ethCostA}(q, qsig, r, dsig);

        assertEq(alice.balance, aliceEthBefore - q.ethCostA);
        assertEq(brawl.balanceOf(bob), bobBrawlBefore - q.brawlCostB + q.payoutBAmount);
        assertEq(devTreasury.balance - devEthBefore, q.devEthAmount);
    }

    // ─── Sandwich (slippage too high) ────────────────────────────────

    function test_swap_sandwichReverts() public {
        (uint256 idA, uint256 idB) = _mintPair();
        Duel.DuelResult memory r = _buildDuelResult(idA, idB, uint32(idA), 5);
        DuelRouter.FightQuote memory q = _quoteMixed_winnerEth(idA, idB, 5);
        bytes memory qsig = _signQuote(q);
        bytes memory dsig = _signDuel(r);

        // Simulate sandwich: pool returns 50% less than predicted.
        aero.setHaircutBps(5000);

        vm.expectRevert(); // INSUFFICIENT_OUTPUT from mock, or SlippageTooHigh from router
        vm.prank(alice);
        router.fight{value: q.ethCostA}(q, qsig, r, dsig);
    }

    // ─── Replay / expiry ─────────────────────────────────────────────

    function test_replayNonce_reverts() public {
        (uint256 idA, uint256 idB) = _mintPair();
        Duel.DuelResult memory r = _buildDuelResult(idA, idB, uint32(idA), 6);
        DuelRouter.FightQuote memory q = _quoteBB(idA, idB, uint32(idA), 6);

        vm.prank(alice);
        router.fight(q, _signQuote(q), r, _signDuel(r));

        // Second call same nonce → revert. Duel will revert first (its own nonce);
        // change Duel nonce but keep router nonce to isolate router replay check.
        Duel.DuelResult memory r2 = _buildDuelResult(idA, idB, uint32(idA), 7);
        DuelRouter.FightQuote memory q2 = q; // same router nonce
        q2.tokenA = idA;
        // Re-sign quote with same nonce
        bytes memory qsig = _signQuote(q2);
        bytes memory dsig = _signDuel(r2);

        vm.expectRevert(DuelRouter.QuoteNonceUsed.selector);
        vm.prank(alice);
        router.fight(q2, qsig, r2, dsig);
    }

    function test_expiredQuote_reverts() public {
        (uint256 idA, uint256 idB) = _mintPair();
        Duel.DuelResult memory r = _buildDuelResult(idA, idB, uint32(idA), 8);
        DuelRouter.FightQuote memory q = _quoteBB(idA, idB, uint32(idA), 8);
        q.expiry = block.timestamp - 1;
        bytes memory qsig = _signQuote(q);
        // Pre-compute the Duel sig OUTSIDE the prank/expectRevert window —
        // vm.prank only affects the next call, so inlining _signDuel would
        // consume the prank and the actual router.fight wouldn't be pranked.
        bytes memory dsig = _signDuel(r);

        vm.expectRevert(DuelRouter.QuoteExpired.selector);
        vm.prank(alice);
        router.fight(q, qsig, r, dsig);
    }

    // ─── Sig mismatch ─────────────────────────────────────────────────

    function test_invalidQuoteSig_reverts() public {
        (uint256 idA, uint256 idB) = _mintPair();
        Duel.DuelResult memory r = _buildDuelResult(idA, idB, uint32(idA), 9);
        DuelRouter.FightQuote memory q = _quoteBB(idA, idB, uint32(idA), 9);

        // Sign with a different key (bob's "wrong" pk)
        (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(0xDEAD, router.hashQuote(q));
        bytes memory badSig = abi.encodePacked(rs, ss, v);
        bytes memory dsig = _signDuel(r);

        vm.expectRevert(DuelRouter.InvalidQuoteSignature.selector);
        vm.prank(alice);
        router.fight(q, badSig, r, dsig);
    }

    // ─── Wrong msg.value ─────────────────────────────────────────────

    function test_wrongMsgValue_reverts() public {
        (uint256 idA, uint256 idB) = _mintPair();
        Duel.DuelResult memory r = _buildDuelResult(idA, idB, uint32(idA), 10);
        DuelRouter.FightQuote memory q = _quoteEE(idA, idB, uint32(idA), 10);
        bytes memory qsig = _signQuote(q);
        bytes memory dsig = _signDuel(r);

        vm.expectRevert(); // WrongMsgValue
        vm.prank(alice);
        router.fight{value: 0}(q, qsig, r, dsig);
    }

    // ─── Owner snapshot ─────────────────────────────────────────────

    function test_ownerChangedAfterQuote_reverts() public {
        (uint256 idA, uint256 idB) = _mintPair();
        Duel.DuelResult memory r = _buildDuelResult(idA, idB, uint32(idA), 11);
        DuelRouter.FightQuote memory q = _quoteBB(idA, idB, uint32(idA), 11);
        bytes memory qsig = _signQuote(q);
        bytes memory dsig = _signDuel(r);

        // Alice transfers brawler A to bob between quote-signing and execution.
        vm.prank(alice);
        brawlers.transferFrom(alice, bob, idA);

        vm.expectRevert(abi.encodeWithSelector(DuelRouter.WrongOwner.selector, idA));
        vm.prank(alice);
        router.fight(q, qsig, r, dsig);
    }

    // ─── Stale cost (keeper hasn't updated) ─────────────────────────

    function test_staleBrawlCost_reverts() public {
        (uint256 idA, uint256 idB) = _mintPair();
        Duel.DuelResult memory r = _buildDuelResult(idA, idB, uint32(idA), 12);
        DuelRouter.FightQuote memory q = _quoteBB(idA, idB, uint32(idA), 12);

        // Bump the on-chain peg AFTER the quote is built. The signed brawlCost
        // is now stale; router should reject.
        router.setFightEconomics(FIGHT_COST_BRAWL * 2, FIGHT_COST_ETH, router.devShareBps());

        bytes memory qsig = _signQuote(q);
        bytes memory dsig = _signDuel(r);

        vm.expectRevert(DuelRouter.StaleBrawlCost.selector);
        vm.prank(alice);
        router.fight(q, qsig, r, dsig);
    }
}
