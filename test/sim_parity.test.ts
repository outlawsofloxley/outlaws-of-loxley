/**
 * Parity test: the frontend's duplicated sim must produce byte-identical
 * FightResults to the root sim for every (A, B, seed) input.
 *
 * Phase 6 Turn 4B duplicated src/sim + src/core into frontend/src/* to let
 * Next's server-side API route run the sim. Without this test, either copy
 * could drift and the contract's on-chain verifier would start rejecting
 * signed duels in ways that are painful to debug.
 *
 * Note: frontend's copies omit the `.js` import extensions (Turbopack
 * compatibility), so the two files aren't `diff`-able line-for-line. A
 * behavior-level check is what actually matters.
 */
import { describe, test, expect } from 'vitest';
import { simulateFight as simRoot } from '../src/sim/combat.js';
import type { Brawler as RootBrawler } from '../src/core/types.js';
import { simulateFight as simFrontend } from '../frontend/src/sim/combat';
import type { Brawler as FrontendBrawler } from '../frontend/src/core/types';

/**
 * A fixed Brawler used by every parity case. We deliberately avoid using the
 * live rollStats/rollWeapon helpers — they're also duplicated, and testing
 * combat parity against seeds derived from other duplicated code would tangle
 * the failure modes. Hand-picked fields keep the failure signal clean.
 */
function makeBrawler(partial: {
  tokenId: number;
  weapon: {
    name: string;
    damageMin: number;
    damageMax: number;
    speed: number;
    type: 'blade' | 'blunt' | 'ranged';
    rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
    weight: number;
  };
  stats: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
  elo?: number;
  level?: number;
}): RootBrawler & FrontendBrawler {
  return {
    tokenId: partial.tokenId,
    name: `Parity #${partial.tokenId}`,
    stats: partial.stats,
    weapon: partial.weapon,
    level: partial.level ?? 1,
    xp: 0,
    elo: partial.elo ?? 1000,
    wins: 0,
    losses: 0,
    ties: 0,
    status: 'alive',
    createdAt: 0,
  } satisfies RootBrawler & FrontendBrawler;
}

// A handful of diverse fighters hitting different weapon types, speeds, and
// stat spreads. The crossproduct of these × many seeds exercises the full
// resolveAttack / resolveWinner / initiative code paths.
const BLADE_GLASS_CANNON = makeBrawler({
  tokenId: 1,
  weapon: {
    name: 'Machete',
    damageMin: 10,
    damageMax: 15,
    speed: 6,
    type: 'blade',
    rarity: 'uncommon',
    weight: 12,
  },
  stats: { strength: 16, dexterity: 14, constitution: 10, intelligence: 8, wisdom: 8, charisma: 10 },
  elo: 1100,
});

const BLUNT_TANK = makeBrawler({
  tokenId: 2,
  weapon: {
    name: 'Sledgehammer',
    damageMin: 14,
    damageMax: 24,
    speed: 3,
    type: 'blunt',
    rarity: 'rare',
    weight: 7,
  },
  stats: { strength: 18, dexterity: 8, constitution: 16, intelligence: 8, wisdom: 10, charisma: 8 },
  elo: 950,
});

const RANGED_SNIPER = makeBrawler({
  tokenId: 3,
  weapon: {
    name: 'Rail Gun',
    damageMin: 25,
    damageMax: 40,
    speed: 6,
    type: 'ranged',
    rarity: 'legendary',
    weight: 1,
  },
  stats: { strength: 10, dexterity: 16, constitution: 10, intelligence: 12, wisdom: 10, charisma: 8 },
  elo: 1500,
  level: 3,
});

const COMMON_AVERAGE = makeBrawler({
  tokenId: 4,
  weapon: {
    name: 'Baseball Bat',
    damageMin: 8,
    damageMax: 13,
    speed: 6,
    type: 'blunt',
    rarity: 'common',
    weight: 17,
  },
  stats: { strength: 12, dexterity: 12, constitution: 12, intelligence: 10, wisdom: 10, charisma: 10 },
});

const SEEDS: bigint[] = [
  1n,
  2n,
  42n,
  0xdeadbeefn,
  0x2an,
  0xffffffffffffffffn, // max u64, exercises nextUint64's high bits
  1234567890n,
  0x9e3779b97f4a7c15n, // a splitmix64 constant — tests the seed-mixer boundary
  (1n << 128n) + 7n, // big seed
];

const PAIRS: [RootBrawler & FrontendBrawler, RootBrawler & FrontendBrawler][] = [
  [BLADE_GLASS_CANNON, BLUNT_TANK],
  [BLUNT_TANK, RANGED_SNIPER],
  [RANGED_SNIPER, BLADE_GLASS_CANNON],
  [COMMON_AVERAGE, BLADE_GLASS_CANNON],
  [COMMON_AVERAGE, RANGED_SNIPER],
];

describe('frontend/sim parity with root/sim', () => {
  for (const [a, b] of PAIRS) {
    for (const seed of SEEDS) {
      test(`#${a.tokenId} vs #${b.tokenId}, seed=${seed.toString(16)}`, () => {
        const rootResult = simRoot(a, b, seed);
        const frontendResult = simFrontend(a, b, seed);
        expect(frontendResult).toEqual(rootResult);
      });
    }
  }

  test('both sims throw the same way on self-fight', () => {
    expect(() => simRoot(BLADE_GLASS_CANNON, BLADE_GLASS_CANNON, 1n)).toThrow(/itself/);
    expect(() => simFrontend(BLADE_GLASS_CANNON, BLADE_GLASS_CANNON, 1n)).toThrow(/itself/);
  });

  test('both sims throw on dead fighter', () => {
    const dead = { ...COMMON_AVERAGE, status: 'dead' as const };
    expect(() => simRoot(dead, BLADE_GLASS_CANNON, 1n)).toThrow(/not alive/);
    expect(() => simFrontend(dead, BLADE_GLASS_CANNON, 1n)).toThrow(/not alive/);
  });
});
