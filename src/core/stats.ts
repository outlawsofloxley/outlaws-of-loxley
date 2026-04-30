/**
 * Stat allocation and modifier math.
 *
 * Point-buy system (matches your reference image):
 *   Base: every stat starts at 8
 *   Budget: 32 points to distribute
 *   Costs:
 *     8-14: 1 point per increase
 *     15-16: 2 points per increase
 *     17+:  3 points per increase
 *
 * Ability modifier: floor((stat - 10) / 2). Classic D&D.
 *   stat 8  -> -1
 *   stat 10 -> +0
 *   stat 12 -> +1
 *   stat 14 -> +2
 *   stat 16 -> +3
 *   stat 18 -> +4
 */
import type { Stats } from './types.js';
import { POINT_BUY_TOTAL, STAT_MIN, STAT_MAX_AT_CREATION } from './types.js';
import type { RngState } from './rng.js';
import { nextInt } from './rng.js';

/** Cost to raise a stat from 8 to `target`. */
export function pointBuyCost(target: number): number {
  if (target < STAT_MIN) {
    throw new Error(`Stat target ${target} is below minimum ${STAT_MIN}`);
  }
  if (target > STAT_MAX_AT_CREATION) {
    throw new Error(`Stat target ${target} exceeds creation maximum ${STAT_MAX_AT_CREATION}`);
  }
  let cost = 0;
  for (let i = STAT_MIN + 1; i <= target; i++) {
    if (i <= 14) {
      cost += 1;
    } else if (i <= 16) {
      cost += 2;
    } else {
      cost += 3;
    }
  }
  return cost;
}

/** Total points spent on a stat block. Must equal POINT_BUY_TOTAL for a valid brawler. */
export function totalPointCost(stats: Stats): number {
  return (
    pointBuyCost(stats.strength) +
    pointBuyCost(stats.dexterity) +
    pointBuyCost(stats.constitution) +
    pointBuyCost(stats.intelligence) +
    pointBuyCost(stats.wisdom) +
    pointBuyCost(stats.charisma)
  );
}

/** Check that a stat block is legal: all stats in range, total cost exactly matches budget. */
export function validateStats(stats: Stats): { ok: true } | { ok: false; reason: string } {
  const entries: [keyof Stats, number][] = [
    ['strength', stats.strength],
    ['dexterity', stats.dexterity],
    ['constitution', stats.constitution],
    ['intelligence', stats.intelligence],
    ['wisdom', stats.wisdom],
    ['charisma', stats.charisma],
  ];
  for (const [name, value] of entries) {
    if (!Number.isInteger(value)) {
      return { ok: false, reason: `${name} must be an integer, got ${value}` };
    }
    if (value < STAT_MIN) {
      return { ok: false, reason: `${name} is ${value}, minimum is ${STAT_MIN}` };
    }
    if (value > STAT_MAX_AT_CREATION) {
      return {
        ok: false,
        reason: `${name} is ${value}, maximum at creation is ${STAT_MAX_AT_CREATION}`,
      };
    }
  }
  const total = totalPointCost(stats);
  if (total !== POINT_BUY_TOTAL) {
    return {
      ok: false,
      reason: `point total is ${total}, must equal ${POINT_BUY_TOTAL}`,
    };
  }
  return { ok: true };
}

/** D&D-style ability modifier. Works for any stat in [1, 30]. */
export function abilityModifier(stat: number): number {
  return Math.floor((stat - 10) / 2);
}

/**
 * Roll a random valid stat block using point-buy.
 *
 * Strategy: repeatedly pick a random stat and try to increment it by 1.
 * If we can afford the increment and haven't hit the cap, do it. Stop when
 * the budget is exhausted. This produces a broad but valid distribution.
 *
 * We cap at STAT_MAX_AT_CREATION per stat and at POINT_BUY_TOTAL total.
 */
export function rollStats(state: RngState): Stats {
  // Mutable during rolling. Frozen at return.
  const working: Record<keyof Stats, number> = {
    strength: STAT_MIN,
    dexterity: STAT_MIN,
    constitution: STAT_MIN,
    intelligence: STAT_MIN,
    wisdom: STAT_MIN,
    charisma: STAT_MIN,
  };
  const keys: (keyof Stats)[] = [
    'strength',
    'dexterity',
    'constitution',
    'intelligence',
    'wisdom',
    'charisma',
  ];
  let remaining = POINT_BUY_TOTAL;

  // Safety bound, we shouldn't need more iterations than this.
  const maxIterations = POINT_BUY_TOTAL * 20;
  let iter = 0;
  while (remaining > 0 && iter < maxIterations) {
    iter++;
    const key = keys[nextInt(state, 0, keys.length - 1)]!;
    const current = working[key];
    if (current >= STAT_MAX_AT_CREATION) {
      continue;
    }
    const nextValue = current + 1;
    const incrementCost = pointBuyCost(nextValue) - pointBuyCost(current);
    if (incrementCost > remaining) {
      // Can't afford this increment. Try to find a stat we CAN afford to raise,
      // otherwise break.
      let canAffordAny = false;
      for (const k of keys) {
        const v = working[k];
        if (v >= STAT_MAX_AT_CREATION) {
          continue;
        }
        const cost = pointBuyCost(v + 1) - pointBuyCost(v);
        if (cost <= remaining) {
          canAffordAny = true;
          break;
        }
      }
      if (!canAffordAny) {
        break;
      }
      continue;
    }
    working[key] = nextValue;
    remaining -= incrementCost;
  }

  const stats: Stats = {
    strength: working.strength,
    dexterity: working.dexterity,
    constitution: working.constitution,
    intelligence: working.intelligence,
    wisdom: working.wisdom,
    charisma: working.charisma,
  };

  // Defense-in-depth: the result must validate.
  const check = validateStats(stats);
  if (!check.ok) {
    throw new Error(`rollStats produced invalid stats: ${check.reason}`);
  }
  return stats;
}

/**
 * Starting HP: 25 base + 3 per constitution modifier + 2 per level.
 * Average brawler has ~31 HP, which gives fights typical length of 3-6 rounds
 * given average weapon damage of ~12 per hit. Tuned for gameplay drama.
 */
export function startingHp(stats: Stats, level: number): number {
  const conMod = abilityModifier(stats.constitution);
  return 25 + conMod * 3 + level * 2;
}

/** Armor class (difficulty to hit): 10 + dex mod + floor(con mod / 2). */
export function armorClass(stats: Stats): number {
  const dexMod = abilityModifier(stats.dexterity);
  const conMod = abilityModifier(stats.constitution);
  return 10 + dexMod + Math.floor(conMod / 2);
}
