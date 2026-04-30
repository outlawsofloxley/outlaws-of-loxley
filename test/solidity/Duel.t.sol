// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Brawlers} from "../../contracts/Brawlers.sol";
import {Duel} from "../../contracts/Duel.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract DuelTest is Test {
    using MessageHashUtils for bytes32;

    Brawlers internal brawlers;
    Duel internal duel;

    address internal owner;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA201);

    // Signer with known private key for signing test duels
    uint256 internal signerPk = 0xBEEF;
    address internal signerAddr;

    uint256 internal constant SEED = 0x2a;

    function setUp() public {
        // Make the test contract itself the Brawlers owner. Lets `brawlers.mint(...)`
        // calls from the test body pass the owner-or-mintDrop auth check on the
        // new gated mint() without requiring a vm.prank at every call site.
        owner = address(this);
        signerAddr = vm.addr(signerPk);
        brawlers = new Brawlers(owner, SEED, address(0));
        // fightCost=0, brawlToken=0x0 → fees disabled, existing Duel behavior preserved.
        duel = new Duel(owner, address(brawlers), signerAddr, address(0), owner, 0, 0);
        brawlers.setDuelContract(address(duel));
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    function _mintPair() internal returns (uint256 idA, uint256 idB) {
        idA = brawlers.mint(alice);
        idB = brawlers.mint(bob);
    }

    function _signResult(Duel.DuelResult memory r) internal view returns (bytes memory) {
        bytes32 hash = duel.hashDuelResult(r);
        bytes32 ethSigned = hash.toEthSignedMessageHash();
        (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(signerPk, ethSigned);
        return abi.encodePacked(rs, ss, v);
    }

    function _buildResult(uint256 idA, uint256 idB, uint32 winnerId, uint256 nonce)
        internal
        view
        returns (Duel.DuelResult memory)
    {
        return Duel.DuelResult({
            tokenA: idA,
            tokenB: idB,
            winnerId: winnerId,
            rounds: 3,
            seed: 0xdeadbeef,
            newEloA: winnerId == uint32(idA) ? 1016 : 984,
            newEloB: winnerId == uint32(idB) ? 1016 : 984,
            nonce: nonce,
            expiry: block.timestamp + 1 hours
        });
    }

    // ─── Happy path ──────────────────────────────────────────────────

    function test_submitDuel_validSig_updatesStats() public {
        (uint256 idA, uint256 idB) = _mintPair();
        Duel.DuelResult memory r = _buildResult(idA, idB, uint32(idA), 1);
        bytes memory sig = _signResult(r);

        vm.prank(alice);
        duel.submitDuel(r, sig);

        Brawlers.Brawler memory a = brawlers.getBrawler(idA);
        Brawlers.Brawler memory b = brawlers.getBrawler(idB);
        assertEq(a.wins, 1);
        assertEq(b.losses, 1);
        assertEq(a.elo, 1016);
        assertEq(b.elo, 984);
    }

    function test_submitDuel_byEitherOwner() public {
        (uint256 idA, uint256 idB) = _mintPair();
        Duel.DuelResult memory r = _buildResult(idA, idB, uint32(idA), 1);
        bytes memory sig = _signResult(r);
        // Bob (owner of B) can submit even though A won
        vm.prank(bob);
        duel.submitDuel(r, sig);
        assertTrue(duel.usedNonces(1));
    }

    function test_submitDuel_byNonOwner_reverts() public {
        (uint256 idA, uint256 idB) = _mintPair();
        Duel.DuelResult memory r = _buildResult(idA, idB, uint32(idA), 1);
        bytes memory sig = _signResult(r);
        vm.prank(carol);
        vm.expectRevert(Duel.NotOwnerOfEither.selector);
        duel.submitDuel(r, sig);
    }

    // ─── Signature ───────────────────────────────────────────────────

    function test_submitDuel_invalidSig_reverts() public {
        (uint256 idA, uint256 idB) = _mintPair();
        Duel.DuelResult memory r = _buildResult(idA, idB, uint32(idA), 1);
        // Sign with a different key
        uint256 wrongPk = 0xBADF00D;
        bytes32 hash = duel.hashDuelResult(r);
        bytes32 ethSigned = hash.toEthSignedMessageHash();
        (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(wrongPk, ethSigned);
        bytes memory sig = abi.encodePacked(rs, ss, v);
        vm.prank(alice);
        vm.expectRevert(Duel.InvalidSignature.selector);
        duel.submitDuel(r, sig);
    }

    function test_submitDuel_tamperedResult_reverts() public {
        (uint256 idA, uint256 idB) = _mintPair();
        Duel.DuelResult memory r = _buildResult(idA, idB, uint32(idA), 1);
        bytes memory sig = _signResult(r);
        // Tamper with ELO after signing
        r.newEloA = 99999;
        vm.prank(alice);
        vm.expectRevert(Duel.InvalidSignature.selector);
        duel.submitDuel(r, sig);
    }

    // ─── Replay protection ───────────────────────────────────────────

    function test_submitDuel_replayNonce_reverts() public {
        (uint256 idA, uint256 idB) = _mintPair();
        Duel.DuelResult memory r1 = _buildResult(idA, idB, uint32(idA), 42);
        bytes memory sig1 = _signResult(r1);
        vm.prank(alice);
        duel.submitDuel(r1, sig1);

        // Second submission with same nonce, even with a different outcome
        Duel.DuelResult memory r2 = _buildResult(idA, idB, uint32(idB), 42);
        bytes memory sig2 = _signResult(r2);
        vm.prank(alice);
        vm.expectRevert(Duel.NonceAlreadyUsed.selector);
        duel.submitDuel(r2, sig2);
    }

    function test_submitDuel_expired_reverts() public {
        (uint256 idA, uint256 idB) = _mintPair();
        Duel.DuelResult memory r = _buildResult(idA, idB, uint32(idA), 1);
        r.expiry = block.timestamp - 1;
        bytes memory sig = _signResult(r);
        vm.prank(alice);
        vm.expectRevert(Duel.Expired.selector);
        duel.submitDuel(r, sig);
    }

    // ─── Structural validation ───────────────────────────────────────

    function test_submitDuel_selfFight_reverts() public {
        uint256 idA = brawlers.mint(alice);
        Duel.DuelResult memory r = _buildResult(idA, idA, uint32(idA), 1);
        bytes memory sig = _signResult(r);
        vm.prank(alice);
        vm.expectRevert(Duel.SelfFight.selector);
        duel.submitDuel(r, sig);
    }

    function test_submitDuel_invalidWinner_reverts() public {
        (uint256 idA, uint256 idB) = _mintPair();
        Duel.DuelResult memory r = _buildResult(idA, idB, 999, 1); // 999 isn't A or B
        bytes memory sig = _signResult(r);
        vm.prank(alice);
        vm.expectRevert(Duel.InvalidWinnerId.selector);
        duel.submitDuel(r, sig);
    }

    function test_submitDuel_deadBrawler_reverts() public {
        (uint256 idA, uint256 idB) = _mintPair();
        // Kill A via mock duel contract path
        vm.prank(owner);
        brawlers.setDuelContract(address(this));
        brawlers.applyDuelResult(idA, idB, 990, 1010, uint32(idB), true, false);
        vm.prank(owner);
        brawlers.setDuelContract(address(duel));

        Duel.DuelResult memory r = _buildResult(idA, idB, uint32(idB), 1);
        bytes memory sig = _signResult(r);
        vm.prank(alice);
        vm.expectRevert();
        duel.submitDuel(r, sig);
    }

    // ─── Death tracking ──────────────────────────────────────────────

    function test_consecutiveLosses_killAfterThree() public {
        (uint256 idA, uint256 idB) = _mintPair();

        // Three duels where A loses each time, different nonces
        for (uint256 n = 1; n <= 3; n++) {
            Duel.DuelResult memory r = _buildResult(idA, idB, uint32(idB), n);
            bytes memory sig = _signResult(r);
            vm.prank(alice);
            duel.submitDuel(r, sig);
        }

        assertEq(duel.consecutiveLosses(idA), 3);
        assertFalse(brawlers.isAlive(idA), "A should be dead");
    }

    function test_consecutiveLosses_winResetsStreak() public {
        (uint256 idA, uint256 idB) = _mintPair();
        // A loses twice
        for (uint256 n = 1; n <= 2; n++) {
            Duel.DuelResult memory r = _buildResult(idA, idB, uint32(idB), n);
            bytes memory sig = _signResult(r);
            vm.prank(alice);
            duel.submitDuel(r, sig);
        }
        assertEq(duel.consecutiveLosses(idA), 2);
        // A wins
        Duel.DuelResult memory rWin = _buildResult(idA, idB, uint32(idA), 3);
        bytes memory sigWin = _signResult(rWin);
        vm.prank(alice);
        duel.submitDuel(rWin, sigWin);
        assertEq(duel.consecutiveLosses(idA), 0, "streak reset on win");
    }

    function test_consecutiveLosses_tieResetsBothStreaks() public {
        (uint256 idA, uint256 idB) = _mintPair();
        for (uint256 n = 1; n <= 2; n++) {
            Duel.DuelResult memory r = _buildResult(idA, idB, uint32(idB), n);
            bytes memory sig = _signResult(r);
            vm.prank(alice);
            duel.submitDuel(r, sig);
        }
        Duel.DuelResult memory rTie = _buildResult(idA, idB, 0, 3);
        bytes memory sigTie = _signResult(rTie);
        vm.prank(alice);
        duel.submitDuel(rTie, sigTie);
        assertEq(duel.consecutiveLosses(idA), 0);
        assertEq(duel.consecutiveLosses(idB), 0);
    }

    // ─── Admin ───────────────────────────────────────────────────────

    function test_setTrustedSigner_byOwner() public {
        address newSigner = address(0xC0FFEE);
        vm.prank(owner);
        duel.setTrustedSigner(newSigner);
        assertEq(duel.trustedSigner(), newSigner);
    }

    function test_setTrustedSigner_zero_reverts() public {
        vm.prank(owner);
        vm.expectRevert(Duel.SignerMustBeNonZero.selector);
        duel.setTrustedSigner(address(0));
    }

    function test_setTrustedSigner_byNonOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        duel.setTrustedSigner(alice);
    }

    function test_pause_blocksSubmission() public {
        (uint256 idA, uint256 idB) = _mintPair();
        Duel.DuelResult memory r = _buildResult(idA, idB, uint32(idA), 1);
        bytes memory sig = _signResult(r);
        vm.prank(owner);
        duel.pause();
        vm.prank(alice);
        vm.expectRevert();
        duel.submitDuel(r, sig);
    }
}
