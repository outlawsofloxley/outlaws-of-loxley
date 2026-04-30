/**
 * Brawler factory and name generation.
 *
 * Creating a brawler from (seed, tokenId) is fully deterministic.
 * The same inputs always produce the same brawler, critical for
 * replayable mints.
 */
import type { Brawler, Stats, Weapon } from './types.js';
import { createRng, nextInt, weightedPick } from './rng.js';
import { rollStats } from './stats.js';
import { WEAPONS } from './weapons.js';
import { STARTING_ELO } from './elo.js';

// Name pools. Lifted from the art pipeline's names.py (abbreviated).
// Total name space: 30 first × 30 last = 900 unique possibilities,
// enough for a 1000-brawler collection with some collisions that we retry.
const FIRST_NAMES: readonly string[] = [
  'Knox', 'Hank', 'Quade', 'Enzo', 'Axel', 'Luna', 'Zara', 'Hatch', 'Rook', 'Marco',
  'Rex', 'Jade', 'Kane', 'Mira', 'Bolt', 'Vince', 'Ivy', 'Drake', 'Nova', 'Cash',
  'Jinx', 'Riggs', 'Fang', 'Stone', 'Crash', 'Ursa', 'Gunner', 'Vera', 'Gia', 'Phoenix',
];

const LAST_NAMES: readonly string[] = [
  'Smasher', 'Blackheart', 'Wrecker', 'Stormbreaker', 'Grimes', 'Snake', 'Ravenclaw',
  'Vance', 'Butcher', 'Deathrow', 'Harlow', 'Ives', 'Kane', 'Marrow', 'Nash', 'Warlow',
  'Cross', 'Emberly', 'Locke', 'Slayer', 'Wolf', 'Nightshade', 'Zorn', 'Crusher',
  'the Bull', 'the Wolf', 'the Snake', 'Ryker', 'Vale', 'Stoker',
];

/** Roll a display name. Returns e.g. "Marco Deathrow". */
export function rollName(seed: bigint): string {
  const rng = createRng(seed);
  const first = FIRST_NAMES[nextInt(rng, 0, FIRST_NAMES.length - 1)]!;
  const last = LAST_NAMES[nextInt(rng, 0, LAST_NAMES.length - 1)]!;
  return `${first} ${last}`;
}

/** Roll a weapon using the rarity weights. */
export function rollWeapon(seed: bigint): Weapon {
  const rng = createRng(seed);
  const weights = WEAPONS.map((w) => w.weight);
  const idx = weightedPick(rng, WEAPONS, weights);
  return WEAPONS[idx]!;
}

/** Roll stats from a seed. Helper for testing without threading RNG state. */
export function rollStatsFromSeed(seed: bigint): Stats {
  const rng = createRng(seed);
  return rollStats(rng);
}

/**
 * Create a new brawler deterministically.
 *
 * We derive three sub-seeds from (masterSeed, tokenId) so each domain
 * (name, stats, weapon) has independent randomness. If we changed the
 * name pool later, it wouldn't shift the stats/weapon distributions.
 */
export function createBrawler(
  masterSeed: bigint,
  tokenId: number,
  createdAt: number = Date.now(),
): Brawler {
  if (tokenId < 1) {
    throw new Error(`tokenId must be >= 1, got ${tokenId}`);
  }
  const tokenBig = BigInt(tokenId);
  const nameSeed = masterSeed ^ (tokenBig * 0x9e3779b97f4a7c15n);
  const statsSeed = masterSeed ^ (tokenBig * 0xbf58476d1ce4e5b9n);
  const weaponSeed = masterSeed ^ (tokenBig * 0x94d049bb133111ebn);

  return {
    tokenId,
    name: rollName(nameSeed),
    stats: rollStatsFromSeed(statsSeed),
    weapon: rollWeapon(weaponSeed),
    level: 1,
    xp: 0,
    elo: STARTING_ELO,
    wins: 0,
    losses: 0,
    ties: 0,
    status: 'alive',
    createdAt,
  };
}

/** Total games played, used for K-factor. */
export function totalGames(b: Brawler): number {
  return b.wins + b.losses + b.ties;
}
