// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Brawlers} from "../../contracts/Brawlers.sol";
import {Stats} from "../../contracts/lib/Stats.sol";

contract BrawlersTest is Test {
    Brawlers internal brawlers;
    address internal owner;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal duelMock = address(0xD0E1);
    address internal graveMock = address(0x67AAE);

    uint256 internal constant SEED = 0x2a;

    function setUp() public {
        // Test contract owns Brawlers so the new owner-or-mintDrop mint() gate
        // accepts direct `brawlers.mint(...)` calls from tests. Non-owner
        // negative tests still work via `vm.prank(alice)`.
        owner = address(this);
        brawlers = new Brawlers(owner, SEED, address(0));
    }

    // ─── Minting ─────────────────────────────────────────────────────

    function test_mint_assignsSequentialIds() public {
        uint256 id1 = brawlers.mint(alice);
        uint256 id2 = brawlers.mint(alice);
        uint256 id3 = brawlers.mint(bob);
        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(id3, 3);
    }

    function test_mint_setsOwner() public {
        uint256 id = brawlers.mint(alice);
        assertEq(brawlers.ownerOf(id), alice);
    }

    function test_mint_isDeterministic() public {
        uint256 id = brawlers.mint(alice);
        Brawlers.Brawler memory b = brawlers.getBrawler(id);
        // Redeploy with the same seed, mint tokenId 1 -> same stats
        Brawlers b2 = new Brawlers(owner, SEED, address(0));
        b2.mint(alice);
        Brawlers.Brawler memory b_second = b2.getBrawler(id);
        assertEq(b.strength, b_second.strength, "str");
        assertEq(b.dexterity, b_second.dexterity, "dex");
        assertEq(b.constitution, b_second.constitution, "con");
        assertEq(b.weaponId, b_second.weaponId, "weapon");
    }

    function test_mint_producesValidStats() public {
        uint256 id = brawlers.mint(alice);
        Stats.StatBlock memory s = brawlers.getStats(id);
        assertTrue(Stats.validate(s), "stats must validate");
        assertEq(Stats.totalPointCost(s), Stats.POINT_BUY_TOTAL, "budget");
    }

    function test_mint_startingState() public {
        uint256 id = brawlers.mint(alice);
        Brawlers.Brawler memory b = brawlers.getBrawler(id);
        assertEq(b.level, 1, "level");
        assertEq(b.xp, 0, "xp");
        assertEq(b.elo, brawlers.STARTING_ELO(), "elo");
        assertEq(b.wins, 0, "wins");
        assertEq(b.losses, 0, "losses");
        assertEq(b.ties, 0, "ties");
        assertEq(b.isDead, false, "alive");
    }

    function test_mint_differentSeeds_produceDifferentBrawlers() public {
        uint256 id = brawlers.mint(alice);
        Brawlers.Brawler memory b1 = brawlers.getBrawler(id);
        Brawlers b2 = new Brawlers(owner, SEED + 1, address(0));
        b2.mint(alice);
        Brawlers.Brawler memory b1_alt = b2.getBrawler(id);
        bool differs = b1.strength != b1_alt.strength || b1.dexterity != b1_alt.dexterity
            || b1.weaponId != b1_alt.weaponId;
        assertTrue(differs, "different seeds must differ");
    }

    function test_mint_whenPaused_reverts() public {
        vm.prank(owner);
        brawlers.pause();
        vm.expectRevert();
        brawlers.mint(alice);
    }

    // ─── Weapon catalog ──────────────────────────────────────────────

    function test_weapons_count_is12() public view {
        // 11 normal-drop weapons + Kingsblade = 12
        assertEq(brawlers.weaponCount(), 12);
    }

    function test_weapons_weightsSumTo100() public view {
        uint256 total;
        for (uint8 i = 0; i < 11; i++) {
            total += brawlers.getWeapon(i).weight;
        }
        assertEq(total, 100, "weights must sum to 100");
    }

    function test_weapons_firstIsKnife() public view {
        Brawlers.Weapon memory w = brawlers.getWeapon(0);
        assertEq(w.name, "Knife");
        assertEq(w.damageMin, 6);
        assertEq(w.damageMax, 11);
        assertEq(w.speed, 9);
        assertEq(w.weaponType, 0); // blade
        assertEq(w.weight, 18);
    }

    function test_weapons_lastIsRailGun() public view {
        Brawlers.Weapon memory w = brawlers.getWeapon(10);
        assertEq(w.name, "Rail Gun");
        assertEq(w.damageMin, 25);
        assertEq(w.damageMax, 40);
        assertEq(w.weight, 1);
    }

    function test_weapons_rejectsInvalidId() public {
        vm.expectRevert();
        brawlers.getWeapon(12); // 12 weapons now; index 12 is out-of-range
    }

    // ─── Name rolling ────────────────────────────────────────────────

    function test_mint_rolls_first_last_name() public {
        uint256 id = brawlers.mint(alice);
        string memory name = brawlers.getBrawler(id).name;
        // Name should be "First Last" — has a space and is non-empty.
        bytes memory nb = bytes(name);
        assertGt(nb.length, 2, "name too short");
        bool hasSpace = false;
        for (uint256 i = 0; i < nb.length; i++) {
            if (nb[i] == 0x20) {
                hasSpace = true;
                break;
            }
        }
        assertTrue(hasSpace, "name has no space (should be First Last)");
    }

    function test_mint_name_deterministic() public {
        uint256 id = brawlers.mint(alice);
        Brawlers b2 = new Brawlers(owner, SEED, address(0));
        uint256 id2 = b2.mint(alice);
        assertEq(
            brawlers.getBrawler(id).name,
            b2.getBrawler(id2).name,
            "same seed+tokenId should produce same name"
        );
    }

    // ─── Access control ──────────────────────────────────────────────

    function test_setDuelContract_byOwner() public {
        vm.prank(owner);
        brawlers.setDuelContract(duelMock);
        assertEq(brawlers.duelContract(), duelMock);
    }

    function test_setDuelContract_byNonOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        brawlers.setDuelContract(duelMock);
    }

    function test_applyDuelResult_byNonDuel_reverts() public {
        uint256 idA = brawlers.mint(alice);
        uint256 idB = brawlers.mint(bob);
        vm.prank(alice);
        vm.expectRevert();
        brawlers.applyDuelResult(idA, idB, 1016, 984, uint32(idA), false, false);
    }

    function test_applyDuelResult_byDuel_updatesStats() public {
        uint256 idA = brawlers.mint(alice);
        uint256 idB = brawlers.mint(bob);
        vm.prank(owner);
        brawlers.setDuelContract(duelMock);
        vm.prank(duelMock);
        brawlers.applyDuelResult(idA, idB, 1016, 984, uint32(idA), false, false);
        Brawlers.Brawler memory a = brawlers.getBrawler(idA);
        Brawlers.Brawler memory b = brawlers.getBrawler(idB);
        assertEq(a.wins, 1);
        assertEq(b.losses, 1);
        assertEq(a.elo, 1016);
        assertEq(b.elo, 984);
    }

    function test_applyDuelResult_tie_incrementsBothTies() public {
        uint256 idA = brawlers.mint(alice);
        uint256 idB = brawlers.mint(bob);
        vm.prank(owner);
        brawlers.setDuelContract(duelMock);
        vm.prank(duelMock);
        brawlers.applyDuelResult(idA, idB, 1000, 1000, 0, false, false);
        assertEq(brawlers.getBrawler(idA).ties, 1);
        assertEq(brawlers.getBrawler(idB).ties, 1);
    }

    function test_applyDuelResult_eloFloor_100() public {
        uint256 idA = brawlers.mint(alice);
        uint256 idB = brawlers.mint(bob);
        vm.prank(owner);
        brawlers.setDuelContract(duelMock);
        vm.prank(duelMock);
        brawlers.applyDuelResult(idA, idB, 50, 1000, uint32(idB), false, false);
        assertEq(brawlers.getBrawler(idA).elo, 100, "ELO floors at 100");
    }

    function test_applyDuelResult_marksDead() public {
        uint256 idA = brawlers.mint(alice);
        uint256 idB = brawlers.mint(bob);
        vm.prank(owner);
        brawlers.setDuelContract(duelMock);
        vm.prank(duelMock);
        brawlers.applyDuelResult(idA, idB, 990, 1010, uint32(idB), true, false);
        assertTrue(!brawlers.isAlive(idA));
    }

    function test_resurrect_byGraveyard() public {
        uint256 idA = brawlers.mint(alice);
        // Mark dead via the Duel mock
        vm.prank(owner);
        brawlers.setDuelContract(duelMock);
        vm.prank(owner);
        brawlers.setGraveyardContract(graveMock);
        uint256 idB = brawlers.mint(bob);
        vm.prank(duelMock);
        brawlers.applyDuelResult(idA, idB, 990, 1010, uint32(idB), true, false);
        assertFalse(brawlers.isAlive(idA));
        // Now resurrect
        vm.prank(graveMock);
        brawlers.resurrect(idA);
        assertTrue(brawlers.isAlive(idA));
    }

    function test_resurrect_byNonGraveyard_reverts() public {
        uint256 id = brawlers.mint(alice);
        vm.prank(alice);
        vm.expectRevert();
        brawlers.resurrect(id);
    }

    // ─── ERC-721 compliance ──────────────────────────────────────────

    function test_erc721_transfer() public {
        uint256 id = brawlers.mint(alice);
        vm.prank(alice);
        brawlers.transferFrom(alice, bob, id);
        assertEq(brawlers.ownerOf(id), bob);
    }

    function test_erc721_transferWhenPaused_reverts() public {
        uint256 id = brawlers.mint(alice);
        vm.prank(owner);
        brawlers.pause();
        vm.prank(alice);
        vm.expectRevert();
        brawlers.transferFrom(alice, bob, id);
    }
}
