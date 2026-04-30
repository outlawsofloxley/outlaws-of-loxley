// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Xorshift} from "../../contracts/lib/Xorshift.sol";
import {Stats} from "../../contracts/lib/Stats.sol";
import {Combat} from "../../contracts/lib/Combat.sol";

/**
 * @title ParityTest
 * @notice Proves Solidity implementations produce byte-identical outputs to
 *         TypeScript counterparts. Reference vectors generated from the TS
 *         code at Phase 4 creation time. If either side drifts, these break.
 *
 *   Regenerate reference vectors:
 *     tsx -e "import { createRng, nextUint64 } from './src/core/rng.ts'; ..."
 *   (See comments at top of each test for the exact commands.)
 */
contract ParityTest is Test {
    // ─── Xorshift raw output ─────────────────────────────────────────

    function test_Xorshift_seed42_first10() public pure {
        // Reference from TS: createRng(42n); for i in 0..9 nextUint64(rng)
        uint64[10] memory expected = [
            uint64(0x15b92ce094fbe099),
            uint64(0x5103651900dd72c1),
            uint64(0xed1387e8a9935754),
            uint64(0x199117e88029aca6),
            uint64(0x390919ea9f2e8a36),
            uint64(0x2d37f0ba93206ff9),
            uint64(0xe67f92ae7db6979b),
            uint64(0x0f013effe0ff237d),
            uint64(0x9144879f5ad30233),
            uint64(0x0253d1657759ae60)
        ];
        Xorshift.State memory rng = Xorshift.create(42);
        for (uint256 i = 0; i < 10; i++) {
            uint64 got = Xorshift.nextUint64(rng);
            assertEq(got, expected[i], "xorshift sequence mismatch");
        }
    }

    function test_Xorshift_seed0_noDegenerate() public pure {
        // seed 0 must NOT produce (0, 0) state (the degenerate case).
        // Reference from TS: createRng(0n); first 5 nextUint64 values.
        uint64[5] memory expected = [
            uint64(0x89278568c8374c1e),
            uint64(0x00a261c70075accc),
            uint64(0xc2d751d93b4876ef),
            uint64(0xe4b5bc3bc96fc0d2),
            uint64(0x2dfba0778e29e174)
        ];
        Xorshift.State memory rng = Xorshift.create(0);
        for (uint256 i = 0; i < 5; i++) {
            uint64 got = Xorshift.nextUint64(rng);
            assertEq(got, expected[i], "xorshift seed-0 mismatch");
        }
    }

    function test_Xorshift_nextInt_bounds_seed42() public pure {
        // Reference from TS: createRng(42n); for i in 0..9 nextInt(rng, 1, 20)
        int256[10] memory expected = [
            int256(6),
            int256(14),
            int256(1),
            int256(3),
            int256(3),
            int256(6),
            int256(16),
            int256(18),
            int256(12),
            int256(9)
        ];
        Xorshift.State memory rng = Xorshift.create(42);
        for (uint256 i = 0; i < 10; i++) {
            int256 got = Xorshift.nextInt(rng, 1, 20);
            assertEq(got, expected[i], "nextInt mismatch");
        }
    }

    function test_Xorshift_determinism() public pure {
        Xorshift.State memory a = Xorshift.create(12345);
        Xorshift.State memory b = Xorshift.create(12345);
        for (uint256 i = 0; i < 100; i++) {
            assertEq(Xorshift.nextUint64(a), Xorshift.nextUint64(b), "determinism break");
        }
    }

    function test_Xorshift_differentSeeds_diverge() public pure {
        Xorshift.State memory a = Xorshift.create(1);
        Xorshift.State memory b = Xorshift.create(2);
        uint256 differences;
        for (uint256 i = 0; i < 100; i++) {
            if (Xorshift.nextUint64(a) != Xorshift.nextUint64(b)) differences++;
        }
        assertGt(differences, 90, "sequences should diverge for different seeds");
    }

    // ─── Stats math parity ───────────────────────────────────────────

    function test_Stats_abilityModifier_table() public pure {
        // Reference from D&D: floor((stat - 10) / 2).
        assertEq(Stats.abilityModifier(8), -1, "mod(8)");
        assertEq(Stats.abilityModifier(9), -1, "mod(9)"); // JS Math.floor(-0.5) = -1
        assertEq(Stats.abilityModifier(10), 0, "mod(10)");
        assertEq(Stats.abilityModifier(11), 0, "mod(11)"); // Math.floor(0.5) = 0
        assertEq(Stats.abilityModifier(12), 1, "mod(12)");
        assertEq(Stats.abilityModifier(14), 2, "mod(14)");
        assertEq(Stats.abilityModifier(16), 3, "mod(16)");
        assertEq(Stats.abilityModifier(18), 4, "mod(18)");
        assertEq(Stats.abilityModifier(20), 5, "mod(20)");
    }

    function test_Stats_pointBuyCost_table() public pure {
        assertEq(Stats.pointBuyCost(8), 0, "cost(8)");
        assertEq(Stats.pointBuyCost(14), 6, "cost(14)");
        assertEq(Stats.pointBuyCost(15), 8, "cost(15)");
        assertEq(Stats.pointBuyCost(16), 10, "cost(16)");
        assertEq(Stats.pointBuyCost(17), 13, "cost(17)");
        assertEq(Stats.pointBuyCost(18), 16, "cost(18)");
    }

    function test_Stats_startingHp_baseline() public pure {
        // 10 CON, level 0: 25 + 0*3 + 0*2 = 25
        Stats.StatBlock memory s = _uniform(10);
        assertEq(Stats.startingHp(s, 0), 25, "HP baseline");
        // 14 CON (+2 mod), level 1: 25 + 2*3 + 1*2 = 33
        s.constitution = 14;
        assertEq(Stats.startingHp(s, 1), 33, "HP with CON and level");
    }

    function test_Stats_armorClass_baseline() public pure {
        Stats.StatBlock memory s = _uniform(10);
        assertEq(Stats.armorClass(s), 10, "AC baseline");
        // 16 DEX (+3), 14 CON (+2 -> conMod/2 = 1)
        s.dexterity = 16;
        s.constitution = 14;
        assertEq(Stats.armorClass(s), 14, "AC with DEX and CON");
    }

    function _uniform(uint8 v) private pure returns (Stats.StatBlock memory s) {
        s.strength = v;
        s.dexterity = v;
        s.constitution = v;
        s.intelligence = v;
        s.wisdom = v;
        s.charisma = v;
    }

    // ─── Combat type advantage ───────────────────────────────────────

    function test_Combat_typeAdvantage_cycle() public pure {
        // blade=0 beats blunt=1, blunt=1 beats ranged=2, ranged=2 beats blade=0
        assertTrue(Combat.hasTypeAdvantage(0, 1), "blade>blunt");
        assertTrue(Combat.hasTypeAdvantage(1, 2), "blunt>ranged");
        assertTrue(Combat.hasTypeAdvantage(2, 0), "ranged>blade");
        assertFalse(Combat.hasTypeAdvantage(1, 0), "blunt NOT> blade");
        assertFalse(Combat.hasTypeAdvantage(2, 1), "ranged NOT> blunt");
        assertFalse(Combat.hasTypeAdvantage(0, 2), "blade NOT> ranged");
        assertFalse(Combat.hasTypeAdvantage(0, 0), "same type no advantage");
    }

    // ─── Combat full fight parity (the big one) ──────────────────────

    /**
     * Fight reference vectors from TS using:
     *   createBrawler(42n, 1) vs createBrawler(42n, 2)
     *
     * Brawler 1: Hank Vale
     *   stats: STR 13, DEX 13, CON 15, INT 14, WIS 12, CHA 12
     *   weapon: Baseball Bat (blunt, dmg 8-13, speed 6)
     *
     * Brawler 2: Stone the Wolf
     *   stats: STR 14, DEX 11, CON 13, INT 14, WIS 15, CHA 12
     *   weapon: Knife (blade, dmg 6-11, speed 9)
     */
    function test_Combat_fight_parity_seed100() public pure {
        Combat.Fighter memory a = _hankVale();
        Combat.Fighter memory b = _stoneTheWolf();
        Combat.Result memory r = Combat.simulate(a, b, 100);
        assertEq(r.winnerId, 1, "seed 0x64 winner");
        assertEq(r.rounds, 4, "seed 0x64 rounds");
    }

    function test_Combat_fight_parity_seed200() public pure {
        Combat.Fighter memory a = _hankVale();
        Combat.Fighter memory b = _stoneTheWolf();
        Combat.Result memory r = Combat.simulate(a, b, 200);
        assertEq(r.winnerId, 1, "seed 0xc8 winner");
        assertEq(r.rounds, 3, "seed 0xc8 rounds");
    }

    function test_Combat_fight_parity_seed300() public pure {
        Combat.Fighter memory a = _hankVale();
        Combat.Fighter memory b = _stoneTheWolf();
        Combat.Result memory r = Combat.simulate(a, b, 300);
        assertEq(r.winnerId, 1, "seed 0x12c winner");
        assertEq(r.rounds, 4, "seed 0x12c rounds");
    }

    function test_Combat_fight_parity_seed1000() public pure {
        Combat.Fighter memory a = _hankVale();
        Combat.Fighter memory b = _stoneTheWolf();
        Combat.Result memory r = Combat.simulate(a, b, 1000);
        assertEq(r.winnerId, 2, "seed 0x3e8 winner");
        assertEq(r.rounds, 2, "seed 0x3e8 rounds");
    }

    function test_Combat_fight_parity_seedDEADBEEF() public pure {
        Combat.Fighter memory a = _hankVale();
        Combat.Fighter memory b = _stoneTheWolf();
        Combat.Result memory r = Combat.simulate(a, b, 0xdeadbeef);
        assertEq(r.winnerId, 1, "seed 0xdeadbeef winner");
        assertEq(r.rounds, 5, "seed 0xdeadbeef rounds");
    }

    function test_Combat_determinism() public pure {
        Combat.Fighter memory a = _hankVale();
        Combat.Fighter memory b = _stoneTheWolf();
        Combat.Result memory r1 = Combat.simulate(a, b, 0xcafe);
        Combat.Result memory r2 = Combat.simulate(a, b, 0xcafe);
        assertEq(r1.winnerId, r2.winnerId, "determinism winner");
        assertEq(r1.rounds, r2.rounds, "determinism rounds");
    }

    function test_Combat_rejects_self_fight() public {
        // Library reverts happen at the same call depth as the test, which
        // conflicts with vm.expectRevert. Wrap via an external call on self.
        Combat.Fighter memory a = _hankVale();
        vm.expectRevert();
        this.externalSimulate(a, a, 1);
    }

    /// @notice External wrapper so vm.expectRevert works with library call.
    function externalSimulate(Combat.Fighter memory a, Combat.Fighter memory b, uint256 seed)
        external
        pure
        returns (Combat.Result memory)
    {
        return Combat.simulate(a, b, seed);
    }

    // ─── Test fixture factories ──────────────────────────────────────

    function _hankVale() private pure returns (Combat.Fighter memory f) {
        f.tokenId = 1;
        f.stats = Stats.StatBlock({
            strength: 13,
            dexterity: 13,
            constitution: 15,
            intelligence: 14,
            wisdom: 12,
            charisma: 12
        });
        f.level = 1;
        f.weaponType = Combat.BLUNT;
        f.speed = 6;
        f.damageMin = 8;
        f.damageMax = 13;
        f.elo = 1000;
    }

    function _stoneTheWolf() private pure returns (Combat.Fighter memory f) {
        f.tokenId = 2;
        f.stats = Stats.StatBlock({
            strength: 14,
            dexterity: 11,
            constitution: 13,
            intelligence: 14,
            wisdom: 15,
            charisma: 12
        });
        f.level = 1;
        f.weaponType = Combat.BLADE;
        f.speed = 9;
        f.damageMin = 6;
        f.damageMax = 11;
        f.elo = 1000;
    }
}
