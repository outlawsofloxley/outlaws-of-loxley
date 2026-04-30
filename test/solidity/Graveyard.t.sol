// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Brawlers} from "../../contracts/Brawlers.sol";
import {Duel} from "../../contracts/Duel.sol";
import {Graveyard} from "../../contracts/Graveyard.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract GraveyardTest is Test {
    using MessageHashUtils for bytes32;

    Brawlers internal brawlers;
    Duel internal duel;
    Graveyard internal graveyard;

    address internal owner;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal treasury = address(0x7A5E);

    uint256 internal signerPk = 0xBEEF;
    address internal signerAddr;
    uint256 internal constant SEED = 0x2a;
    uint256 internal constant RESURRECT_COST = 0.01 ether;

    function setUp() public {
        owner = address(this);
        signerAddr = vm.addr(signerPk);
        brawlers = new Brawlers(owner, SEED, address(0));
        duel = new Duel(owner, address(brawlers), signerAddr, address(0), owner, 0, 0);
        graveyard =
            new Graveyard(owner, address(brawlers), address(duel), treasury, RESURRECT_COST);

        brawlers.setDuelContract(address(duel));
        brawlers.setGraveyardContract(address(graveyard));
        duel.setGraveyardContract(address(graveyard));

        vm.deal(alice, 1 ether);
        vm.deal(bob, 1 ether);
    }

    function _killBrawler(uint256 tokenId, uint256 opponentTokenId) internal {
        for (uint256 n = 1; n <= 3; n++) {
            Duel.DuelResult memory r = Duel.DuelResult({
                tokenA: tokenId,
                tokenB: opponentTokenId,
                winnerId: uint32(opponentTokenId),
                rounds: 3,
                seed: 0xdeadbeef + n,
                newEloA: 990,
                newEloB: 1010,
                nonce: 10_000 + n,
                expiry: block.timestamp + 1 hours
            });
            bytes32 hash = duel.hashDuelResult(r);
            bytes32 ethSigned = hash.toEthSignedMessageHash();
            (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(signerPk, ethSigned);
            bytes memory sig = abi.encodePacked(rs, ss, v);
            vm.prank(alice);
            duel.submitDuel(r, sig);
        }
    }

    function test_resurrect_payingCorrectly_revives() public {
        uint256 idA = brawlers.mint(alice);
        uint256 idB = brawlers.mint(bob);
        _killBrawler(idA, idB);
        assertFalse(brawlers.isAlive(idA));

        uint256 required = graveyard.costFor(idA); // scaled by rarity
        uint256 treasuryBefore = treasury.balance;
        vm.prank(alice);
        graveyard.resurrect{value: required}(idA);

        assertTrue(brawlers.isAlive(idA));
        assertEq(treasury.balance, treasuryBefore + required, "treasury received fee");
    }

    function test_resurrect_resetsStreak() public {
        uint256 idA = brawlers.mint(alice);
        uint256 idB = brawlers.mint(bob);
        _killBrawler(idA, idB);
        assertEq(duel.consecutiveLosses(idA), 3);

        uint256 required = graveyard.costFor(idA);
        vm.prank(alice);
        graveyard.resurrect{value: required}(idA);

        assertEq(duel.consecutiveLosses(idA), 0, "streak reset");
    }

    function test_resurrect_byNonOwner_reverts() public {
        uint256 idA = brawlers.mint(alice);
        uint256 idB = brawlers.mint(bob);
        _killBrawler(idA, idB);
        vm.prank(bob);
        vm.expectRevert(Graveyard.NotOwner.selector);
        graveyard.resurrect{value: RESURRECT_COST}(idA);
    }

    function test_resurrect_alive_reverts() public {
        uint256 idA = brawlers.mint(alice);
        vm.prank(alice);
        vm.expectRevert(Graveyard.NotDead.selector);
        graveyard.resurrect{value: RESURRECT_COST}(idA);
    }

    function test_resurrect_insufficientPayment_reverts() public {
        // Skip past founder cap (1..100) so the brawler doesn't get a free
        // first resurrect (which would make this test pass for the wrong
        // reason). EOA recipient for _safeMint compliance.
        address sink = address(0xBEEF1);
        for (uint256 i = 0; i < 100; i++) {
            brawlers.mint(sink);
        }
        uint256 idA = brawlers.mint(alice);
        uint256 idB = brawlers.mint(bob);
        _killBrawler(idA, idB);
        vm.prank(alice);
        vm.expectRevert();
        graveyard.resurrect{value: RESURRECT_COST - 1}(idA);
    }

    function test_resurrect_overpay_allAmountToTreasury() public {
        uint256 idA = brawlers.mint(alice);
        uint256 idB = brawlers.mint(bob);
        _killBrawler(idA, idB);
        uint256 overpay = graveyard.costFor(idA) * 2;
        uint256 treasuryBefore = treasury.balance;
        vm.prank(alice);
        graveyard.resurrect{value: overpay}(idA);
        assertEq(treasury.balance, treasuryBefore + overpay);
    }

    function test_setResurrectionCost_byOwner() public {
        vm.prank(owner);
        graveyard.setResurrectionCost(1 ether);
        assertEq(graveyard.resurrectionCost(), 1 ether);
    }

    function test_setTreasury_byOwner() public {
        address newTreasury = address(0xDEAD);
        vm.prank(owner);
        graveyard.setTreasury(newTreasury);
        assertEq(graveyard.treasury(), newTreasury);
    }

    function test_setTreasury_zero_reverts() public {
        vm.prank(owner);
        vm.expectRevert(Graveyard.ZeroTreasury.selector);
        graveyard.setTreasury(address(0));
    }

    function test_pause_blocksResurrect() public {
        uint256 idA = brawlers.mint(alice);
        uint256 idB = brawlers.mint(bob);
        _killBrawler(idA, idB);
        vm.prank(owner);
        graveyard.pause();
        vm.prank(alice);
        vm.expectRevert();
        graveyard.resurrect{value: RESURRECT_COST}(idA);
    }

    function test_directSend_reverts() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(graveyard).call{value: 0.01 ether}("");
        assertFalse(ok, "direct send should revert");
    }
}
