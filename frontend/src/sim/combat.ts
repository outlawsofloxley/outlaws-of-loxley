/**
 * Combat simulator. Duplicated from root src/sim/combat.ts — keep in sync so
 * that parity with Solidity's on-chain verifier is preserved.
 *
 * Given two brawlers and a seed, produce a deterministic FightResult.
 */
import type { Brawler, CombatEvent, FightResult } from '../core/types';
import { createRng, nextInt } from '../core/rng';
import { hasTypeAdvantage, TYPE_ADVANTAGE_MULTIPLIER } from '../core/weapons';
import { abilityModifier, armorClass, startingHp } from '../core/stats';

export const MAX_ROUNDS = 50;
export const CRIT_THRESHOLD = 20;

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

  let hpA = startingHp(a.stats, a.level);
  let hpB = startingHp(b.stats, b.level);

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

    if (hpA <= 0 || hpB <= 0) {
      break;
    }

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
    if (x.elo !== y.elo) {
      return x.elo > y.elo;
    }
    return x.tokenId < y.tokenId;
  }
}

interface AttackResult {
  readonly hit: boolean;
  readonly damage: number;
  readonly critical: boolean;
  readonly typeAdvantage: boolean;
}

function resolveAttack(
  attacker: Brawler,
  defender: Brawler,
  rng: { s0: bigint; s1: bigint },
): AttackResult {
  const rawRoll = nextInt(rng, 1, 20);
  const attackMod = abilityModifier(attacker.stats.dexterity);
  const total = rawRoll + attackMod;
  const defenderAc = armorClass(defender.stats);

  if (rawRoll === 1) {
    return { hit: false, damage: 0, critical: false, typeAdvantage: false };
  }

  const isCrit = rawRoll === CRIT_THRESHOLD;
  const hit = isCrit || total >= defenderAc;

  if (!hit) {
    return { hit: false, damage: 0, critical: false, typeAdvantage: false };
  }

  const baseDamage = nextInt(rng, attacker.weapon.damageMin, attacker.weapon.damageMax);
  const strMod = abilityModifier(attacker.stats.strength);
  let damage = baseDamage + strMod;
  if (damage < 1) {
    damage = 1;
  }

  if (isCrit) {
    damage *= 2;
  }

  const typeAdvantage = hasTypeAdvantage(attacker.weapon, defender.weapon);
  if (typeAdvantage) {
    damage = Math.round(damage * TYPE_ADVANTAGE_MULTIPLIER);
  }

  return { hit: true, damage, critical: isCrit, typeAdvantage };
}

function resolveWinner(
  a: Brawler,
  b: Brawler,
  hpA: number,
  hpB: number,
): number | null {
  if (hpA <= 0 && hpB <= 0) {
    return null;
  }
  if (hpA <= 0) {
    return b.tokenId;
  }
  if (hpB <= 0) {
    return a.tokenId;
  }
  if (hpA > hpB) {
    return a.tokenId;
  }
  if (hpB > hpA) {
    return b.tokenId;
  }
  return null;
}
