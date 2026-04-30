// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title Stats
 * @notice Stat math for Brawlers. Matches src/core/stats.ts byte-for-byte.
 *
 * Point-buy system:
 *   Every stat starts at 8. Total budget is 32 points.
 *   Costs:
 *     8-14: 1 point per increase
 *     15-16: 2 points per increase
 *     17+:  3 points per increase
 *
 * Ability modifier: floor((stat - 10) / 2). Classic D&D.
 *
 * Derived values:
 *   HP = 25 + conMod * 3 + level * 2
 *   AC = 10 + dexMod + floor(conMod / 2)
 */
library Stats {
    uint8 internal constant STAT_MIN = 8;
    uint8 internal constant STAT_MAX_AT_CREATION = 18;
    /// @dev Declared uint256 so expressions like `POINT_BUY_TOTAL * 20` don't
    ///      overflow uint8 checked-math (32 * 20 = 640 > 255). A uint8 constant
    ///      would cause a panic even when assigning to a uint256 target,
    ///      because Solidity evaluates the multiplication in the narrower type.
    uint256 internal constant POINT_BUY_TOTAL = 32;

    /// @notice Stat block. Packed into a single uint48 (6 bytes) worth of data.
    struct StatBlock {
        uint8 strength;
        uint8 dexterity;
        uint8 constitution;
        uint8 intelligence;
        uint8 wisdom;
        uint8 charisma;
    }

    /**
     * @notice Cost to raise a stat from 8 to target.
     * @dev Reverts if target is out of legal range.
     */
    function pointBuyCost(uint8 target) internal pure returns (uint256 cost) {
        require(target >= STAT_MIN, "Stats: below min");
        require(target <= STAT_MAX_AT_CREATION, "Stats: above creation max");
        for (uint8 i = STAT_MIN + 1; i <= target; i++) {
            if (i <= 14) {
                cost += 1;
            } else if (i <= 16) {
                cost += 2;
            } else {
                cost += 3;
            }
        }
    }

    /// @notice Total cost of a stat block.
    function totalPointCost(StatBlock memory s) internal pure returns (uint256 total) {
        total = pointBuyCost(s.strength) + pointBuyCost(s.dexterity)
            + pointBuyCost(s.constitution) + pointBuyCost(s.intelligence)
            + pointBuyCost(s.wisdom) + pointBuyCost(s.charisma);
    }

    /**
     * @notice Validate a stat block.
     * @return ok True if legal.
     */
    function validate(StatBlock memory s) internal pure returns (bool ok) {
        if (
            s.strength < STAT_MIN || s.strength > STAT_MAX_AT_CREATION
                || s.dexterity < STAT_MIN || s.dexterity > STAT_MAX_AT_CREATION
                || s.constitution < STAT_MIN || s.constitution > STAT_MAX_AT_CREATION
                || s.intelligence < STAT_MIN || s.intelligence > STAT_MAX_AT_CREATION
                || s.wisdom < STAT_MIN || s.wisdom > STAT_MAX_AT_CREATION
                || s.charisma < STAT_MIN || s.charisma > STAT_MAX_AT_CREATION
        ) {
            return false;
        }
        return totalPointCost(s) == POINT_BUY_TOTAL;
    }

    /**
     * @notice D&D-style ability modifier: floor((stat - 10) / 2).
     * @dev Uses signed math to produce negative modifiers for low stats.
     *      Solidity's integer division rounds toward zero for positive and
     *      negative alike, but floor((stat - 10) / 2) requires floor-toward-
     *      negative-infinity for odd negatives. For stat in [1, 30] the only
     *      odd negative result would come from stat=9 (returns -1 correctly
     *      because (9-10)/2 = -0.5, JS floors to -1, Solidity truncates to 0).
     *      We hand-roll the floor to match TS exactly.
     * @param stat Any stat value.
     * @return mod Ability modifier.
     */
    function abilityModifier(uint8 stat) internal pure returns (int256 mod) {
        int256 diff = int256(uint256(stat)) - 10;
        // Floor division toward -infinity for matching JS Math.floor behavior.
        if (diff >= 0) {
            mod = diff / 2;
        } else {
            // For negative diff: -1/2 in TS Math.floor = -1, in Solidity = 0.
            // We compensate when diff is odd and negative.
            if (diff % 2 == 0) {
                mod = diff / 2;
            } else {
                mod = (diff / 2) - 1;
            }
        }
    }

    /// @notice Starting HP: 25 + conMod * 3 + level * 2.
    function startingHp(StatBlock memory s, uint16 level)
        internal
        pure
        returns (int256 hp)
    {
        int256 conMod = abilityModifier(s.constitution);
        hp = 25 + conMod * 3 + int256(uint256(level)) * 2;
    }

    /// @notice Armor class: 10 + dexMod + floor(conMod / 2).
    function armorClass(StatBlock memory s) internal pure returns (int256 ac) {
        int256 dexMod = abilityModifier(s.dexterity);
        int256 conMod = abilityModifier(s.constitution);
        int256 conHalf;
        if (conMod >= 0) {
            conHalf = conMod / 2;
        } else {
            if (conMod % 2 == 0) {
                conHalf = conMod / 2;
            } else {
                conHalf = (conMod / 2) - 1;
            }
        }
        ac = 10 + dexMod + conHalf;
    }
}
