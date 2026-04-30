/**
 * Combat simulator.
 *
 * Given two brawlers and a seed, simulate a fight. Deterministic: same
 * inputs always produce the same fight, round by round.
 *
 * Turn structure:
 *   1. Determine initiative: compare (weapon.speed + dex modifier). Higher
 *      goes first. Ties broken by ELO, then token ID.
 *   2. Rounds loop until someone's HP <= 0 or we hit MAX_ROUNDS.
 *   3. Each round: attacker rolls to hit, if hits rolls damage, defender
 *      takes damage. Then swap attacker/defender for next sub-turn.
 *   4. Type advantage: blade > blunt > ranged > blade gives +15% damage.
 *   5. Nat 20 on hit = critical, damage is doubled.
 *   6. Tie: if both hit 0 HP in the same round, it's a double-KO.
 *
 * MAX_ROUNDS: prevents infinite fights between two low-damage defensive
 * brawlers. If reached, the lower-HP one loses. If equal HP, tie.
 */
import type {
  Brawler,
  CombatEvent,
  FightResult,
} from '../core/types.js';
import { createRng, nextInt } from '../core/rng.js';
import { hasTypeAdvantage, TYPE_ADVANTAGE_MULTIPLIER } from '../core/weapons.js';
import { abilityModifier, armorClass, startingHp } from '../core/stats.js';

/** Hard cap on rounds. Reaching this means the fight stalemated. */
export const MAX_ROUNDS = 50;

/** Natural roll needed for a critical hit. */
export const CRIT_THRESHOLD = 20;

/**
 * Simulate a fight.
 *
 * Throws if the two brawlers have the same token ID (would be ambiguous in
 * the combat log).
 */
export function simulateFight(a: Brawler, b: Brawler, seed: bigint): FightResult {
  if (a.tokenId === b.tokenId) {
    throw new Error('Cannot fight a brawler against itself');
  }
  if (a.status !== 'alive') {
    throw new Error(`Brawler ${a.tokenId} is not alive (status: ${a.status})`);
  }
  if (b.status !== 'alive') {
    throw new Error(`Brawler ${b.tokenId} is not alive (status: ${b.status})`);
  }

  const rng = createRng(seed);
  const events: CombatEvent[] = [];

  // Starting HP for both
  let hpA = startingHp(a.stats, a.level);
  let hpB = startingHp(b.stats, b.level);

  // Armor class for both
  const acA = armorClass(a.stats);
  const acB = armorClass(b.stats);

  // Initiative
  const firstIsA = rollInitiative(a, b);

  let round = 0;

  while (round < MAX_ROUNDS && hpA > 0 && hpB > 0) {
    round++;
    const attackerFirst = firstIsA ? a : b;
    const defenderFirst = firstIsA ? b : a;
    const attackerSecond = firstIsA ? b : a;
    const defenderSecond = firstIsA ? a : b;

    events.push({
      type: 'round_start',
      round,
      attackerId: attackerFirst.tokenId,
      defenderId: defenderFirst.tokenId,
    });

    // First sub-turn
    const firstResult = resolveAttack(attackerFirst, defenderFirst, rng);
    if (firstResult.hit) {
      if (firstIsA) {
        hpB -= firstResult.damage;
        events.push({
          type: 'attack_hit',
          attackerId: attackerFirst.tokenId,
          defenderId: defenderFirst.tokenId,
          damage: firstResult.damage,
          isCritical: firstResult.critical,
          typeAdvantage: firstResult.typeAdvantage,
          defenderHpAfter: Math.max(0, hpB),
        });
      } else {
        hpA -= firstResult.damage;
        events.push({
          type: 'attack_hit',
          attackerId: attackerFirst.tokenId,
          defenderId: defenderFirst.tokenId,
          damage: firstResult.damage,
          isCritical: firstResult.critical,
          typeAdvantage: firstResult.typeAdvantage,
          defenderHpAfter: Math.max(0, hpA),
        });
      }
    } else {
      events.push({
        type: 'attack_miss',
        attackerId: attackerFirst.tokenId,
        defenderId: defenderFirst.tokenId,
      });
    }

    // If defender is dead, fight ends here; attacker wins.
    if (hpA <= 0 || hpB <= 0) {
      break;
    }

    // Second sub-turn (the other brawler's swing)
    const secondResult = resolveAttack(attackerSecond, defenderSecond, rng);
    if (secondResult.hit) {
      if (firstIsA) {
        hpA -= secondResult.damage;
        events.push({
          type: 'attack_hit',
          attackerId: attackerSecond.tokenId,
          defenderId: defenderSecond.tokenId,
          damage: secondResult.damage,
          isCritical: secondResult.critical,
          typeAdvantage: secondResult.typeAdvantage,
          defenderHpAfter: Math.max(0, hpA),
        });
      } else {
        hpB -= secondResult.damage;
        events.push({
          type: 'attack_hit',
          attackerId: attackerSecond.tokenId,
          defenderId: defenderSecond.tokenId,
          damage: secondResult.damage,
          isCritical: secondResult.critical,
          typeAdvantage: secondResult.typeAdvantage,
          defenderHpAfter: Math.max(0, hpB),
        });
      }
    } else {
      events.push({
        type: 'attack_miss',
        attackerId: attackerSecond.tokenId,
        defenderId: defenderSecond.tokenId,
      });
    }
  }

  // Determine outcome
  const winnerId = resolveWinner(a, b, hpA, hpB);

  events.push({
    type: 'fight_end',
    winnerId,
    rounds: round,
  });

  return {
    seed,
    brawlerAId: a.tokenId,
    brawlerBId: b.tokenId,
    winnerId,
    rounds: round,
    events,
  };

  function rollInitiative(x: Brawler, y: Brawler): boolean {
    const xInit = x.weapon.speed + abilityModifier(x.stats.dexterity);
    const yInit = y.weapon.speed + abilityModifier(y.stats.dexterity);
    if (xInit !== yInit) {
      return xInit > yInit;
    }
    // Tiebreak on ELO (higher goes first)
    if (x.elo !== y.elo) {
      return x.elo > y.elo;
    }
    // Final tiebreak on token ID (lower goes first)
    return x.tokenId < y.tokenId;
  }
}

interface AttackResult {
  readonly hit: boolean;
  readonly damage: number;
  readonly critical: boolean;
  readonly typeAdvantage: boolean;
}

/**
 * Resolve one attack.
 *   1. Roll 1d20, add dex mod. Compare to defender AC.
 *   2. Natural 20 always hits and is a critical.
 *   3. Natural 1 always misses.
 *   4. On hit, roll weapon damage + str mod.
 *   5. Crit doubles damage.
 *   6. Type advantage applies 1.15× multiplier.
 */
function resolveAttack(
  attacker: Brawler,
  defender: Brawler,
  rng: { s0: bigint; s1: bigint },
): AttackResult {
  // Hit roll
  const rawRoll = nextInt(rng, 1, 20);
  const attackMod = abilityModifier(attacker.stats.dexterity);
  const total = rawRoll + attackMod;
  const defenderAc = armorClass(defender.stats);

  // Nat 1 always misses.
  if (rawRoll === 1) {
    return { hit: false, damage: 0, critical: false, typeAdvantage: false };
  }

  // Nat 20 always hits AND is a crit.
  const isCrit = rawRoll === CRIT_THRESHOLD;
  const hit = isCrit || total >= defenderAc;

  if (!hit) {
    return { hit: false, damage: 0, critical: false, typeAdvantage: false };
  }

  // Damage roll
  const baseDamage = nextInt(rng, attacker.weapon.damageMin, attacker.weapon.damageMax);
  const strMod = abilityModifier(attacker.stats.strength);
  let damage = baseDamage + strMod;
  if (damage < 1) {
    damage = 1; // Minimum 1 damage on a hit
  }

  if (isCrit) {
    damage *= 2;
  }

  const typeAdvantage = hasTypeAdvantage(attacker.weapon, defender.weapon);
  if (typeAdvantage) {
    // Round half-away-from-zero for predictability
    damage = Math.round(damage * TYPE_ADVANTAGE_MULTIPLIER);
  }

  return { hit: true, damage, critical: isCrit, typeAdvantage };
}

/** Who won. Null on tie (double-KO or equal HP at round cap). */
function resolveWinner(
  a: Brawler,
  b: Brawler,
  hpA: number,
  hpB: number,
): number | null {
  if (hpA <= 0 && hpB <= 0) {
    return null; // Double KO
  }
  if (hpA <= 0) {
    return b.tokenId;
  }
  if (hpB <= 0) {
    return a.tokenId;
  }
  // Hit round cap without a KO. Higher remaining HP wins.
  if (hpA > hpB) {
    return a.tokenId;
  }
  if (hpB > hpA) {
    return b.tokenId;
  }
  return null;
}
