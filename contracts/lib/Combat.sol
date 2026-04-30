// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Xorshift} from "./Xorshift.sol";
import {Stats} from "./Stats.sol";

/**
 * @title Combat
 * @notice Deterministic fight simulator. Byte-identical to src/sim/combat.ts
 *         for the winner and rounds fields. We do NOT emit event logs here
 *         (would explode gas); full round-by-round logs are produced off-chain
 *         by the backend signer service and stored in the Duel event.
 *
 * @dev The contract is only invoked for verification/audit purposes, not on
 *      every duel. Normal duels use the signed-result fast path in Duel.sol.
 *      Anyone can call resolve() to re-run any historic duel and verify its
 *      outcome matches the stored result.
 */
library Combat {
    /// @notice Maximum rounds before the fight is judged by remaining HP.
    uint256 internal constant MAX_ROUNDS = 50;
    /// @notice Natural d20 threshold for a critical hit (exact match only).
    uint8 internal constant CRIT_THRESHOLD = 20;
    /// @notice Type-advantage damage multiplier numerator (1.15x = 115/100).
    uint256 internal constant TYPE_MUL_NUM = 115;
    uint256 internal constant TYPE_MUL_DEN = 100;

    /// @notice Weapon types for rock-paper-scissors.
    uint8 internal constant BLADE = 0;
    uint8 internal constant BLUNT = 1;
    uint8 internal constant RANGED = 2;

    /// @notice Minimal fighter snapshot needed for a fight simulation.
    struct Fighter {
        uint32 tokenId;
        Stats.StatBlock stats;
        uint16 level;
        // Weapon stats (inlined for ABI stability; source is Brawlers.sol)
        uint8 weaponType; // BLADE/BLUNT/RANGED
        uint8 speed; // 1..10 initiative modifier
        uint8 damageMin; // inclusive
        uint8 damageMax; // inclusive
        uint32 elo;
    }

    /// @notice Outcome of a simulated fight.
    struct Result {
        uint32 winnerId; // 0 on tie
        uint16 rounds;
    }

    /**
     * @notice Simulate a fight from its deterministic inputs.
     * @dev Reverts if the two fighters share a tokenId.
     * @param a First fighter.
     * @param b Second fighter.
     * @param seed RNG seed.
     * @return result The winner and round count.
     */
    function simulate(Fighter memory a, Fighter memory b, uint256 seed)
        internal
        pure
        returns (Result memory result)
    {
        require(a.tokenId != b.tokenId, "Combat: self-fight");

        Xorshift.State memory rng = Xorshift.create(seed);

        int256 hpA = Stats.startingHp(a.stats, a.level);
        int256 hpB = Stats.startingHp(b.stats, b.level);

        bool firstIsA = _rollInitiative(a, b);

        uint16 round = 0;
        while (round < MAX_ROUNDS && hpA > 0 && hpB > 0) {
            round++;
            Fighter memory attackerFirst = firstIsA ? a : b;
            Fighter memory defenderFirst = firstIsA ? b : a;
            Fighter memory attackerSecond = firstIsA ? b : a;
            Fighter memory defenderSecond = firstIsA ? a : b;

            // First sub-turn
            (bool hit1, int256 dmg1) = _resolveAttack(attackerFirst, defenderFirst, rng);
            if (hit1) {
                if (firstIsA) {
                    hpB -= dmg1;
                } else {
                    hpA -= dmg1;
                }
            }

            // Check KO from first hit
            if (hpA <= 0 || hpB <= 0) {
                break;
            }

            // Second sub-turn
            (bool hit2, int256 dmg2) = _resolveAttack(attackerSecond, defenderSecond, rng);
            if (hit2) {
                if (firstIsA) {
                    hpA -= dmg2;
                } else {
                    hpB -= dmg2;
                }
            }
        }

        result.rounds = round;
        result.winnerId = _resolveWinner(a, b, hpA, hpB);
    }

    /**
     * @notice Does attacker's weapon type beat defender's weapon type?
     *   blade > blunt, blunt > ranged, ranged > blade.
     */
    function hasTypeAdvantage(uint8 attackerType, uint8 defenderType)
        internal
        pure
        returns (bool)
    {
        if (attackerType == BLADE && defenderType == BLUNT) return true;
        if (attackerType == BLUNT && defenderType == RANGED) return true;
        if (attackerType == RANGED && defenderType == BLADE) return true;
        return false;
    }

    // ── internal helpers ──────────────────────────────────────────────

    /**
     * @dev Initiative: higher (weapon.speed + dexMod) goes first.
     *      Tiebreak on ELO (higher first), then tokenId (lower first).
     */
    function _rollInitiative(Fighter memory x, Fighter memory y)
        private
        pure
        returns (bool xFirst)
    {
        int256 xInit = int256(uint256(x.speed)) + Stats.abilityModifier(x.stats.dexterity);
        int256 yInit = int256(uint256(y.speed)) + Stats.abilityModifier(y.stats.dexterity);
        if (xInit != yInit) return xInit > yInit;
        if (x.elo != y.elo) return x.elo > y.elo;
        return x.tokenId < y.tokenId;
    }

    /**
     * @dev Resolve one attack. Returns (hit, damage).
     *
     * Rules (must match TypeScript resolveAttack exactly):
     *   1. Raw 1d20 roll.
     *   2. Natural 1 = auto miss.
     *   3. Natural 20 = auto hit AND critical.
     *   4. Otherwise hits if raw + dex mod >= defender AC.
     *   5. Damage = 1d(max-min+1)+min-1 + str mod, min 1, doubled on crit.
     *   6. Type advantage: * 115/100 with half-away-from-zero rounding.
     *
     * @dev Damage rounding uses half-away-from-zero to match JS Math.round.
     *      Since TypeAdvantage only applies to positive damage values (>= 1),
     *      we use the positive-rounded form directly.
     */
    function _resolveAttack(
        Fighter memory attacker,
        Fighter memory defender,
        Xorshift.State memory rng
    ) private pure returns (bool hit, int256 damage) {
        int256 rawRoll = Xorshift.nextInt(rng, 1, 20);
        int256 attackMod = Stats.abilityModifier(attacker.stats.dexterity);
        int256 total = rawRoll + attackMod;
        int256 defenderAc = Stats.armorClass(defender.stats);

        // Nat 1 always misses.
        if (rawRoll == 1) return (false, 0);

        bool isCrit = (rawRoll == int256(uint256(CRIT_THRESHOLD)));
        bool didHit = isCrit || total >= defenderAc;
        if (!didHit) return (false, 0);

        // Damage roll: nextInt(min, max) inclusive.
        int256 baseDamage =
            Xorshift.nextInt(rng, int256(uint256(attacker.damageMin)), int256(uint256(attacker.damageMax)));
        int256 strMod = Stats.abilityModifier(attacker.stats.strength);
        int256 dmg = baseDamage + strMod;
        if (dmg < 1) dmg = 1;
        if (isCrit) dmg *= 2;

        if (hasTypeAdvantage(attacker.weaponType, defender.weaponType)) {
            // dmg is always >= 1 here, so we only handle positive rounding.
            // Half-away-from-zero on positive: floor(x*num/den + den/2 / den)
            // Implement as: (dmg*num + den/2) / den  for unsigned semantics.
            uint256 mul = uint256(dmg) * TYPE_MUL_NUM + (TYPE_MUL_DEN / 2);
            dmg = int256(mul / TYPE_MUL_DEN);
        }

        return (true, dmg);
    }

    /// @dev Null winner (tokenId 0) if double-KO or tied HP at round cap.
    function _resolveWinner(Fighter memory a, Fighter memory b, int256 hpA, int256 hpB)
        private
        pure
        returns (uint32 winnerId)
    {
        if (hpA <= 0 && hpB <= 0) return 0;
        if (hpA <= 0) return b.tokenId;
        if (hpB <= 0) return a.tokenId;
        if (hpA > hpB) return a.tokenId;
        if (hpB > hpA) return b.tokenId;
        return 0; // tied HP at round cap
    }
}
