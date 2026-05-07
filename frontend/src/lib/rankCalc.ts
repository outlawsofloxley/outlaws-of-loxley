/**
 * Rank computation for the BASEic Brawlers collection.
 *
 * Score is the empirical "trait rarity" sum: for each trait the brawler has,
 * (totalMinted / countOfBrawlersWithSameTraitValue) × weight. Rarer traits
 * contribute more to the score. Ranks are assigned by sorting all minted
 * brawlers' scores descending — rank 1 = rarest.
 *
 * v1: ranks recompute against currently minted brawlers. They will shift
 * slightly as more mint. We disclaim this in the UI.
 *
 * v2 (post-launch): pre-compute all 2000 ranks deterministically and freeze.
 */
export interface BrawlerForRank {
  readonly tokenId: number;
  readonly rarity: string;        // Common / Uncommon / Rare / Legendary / Epic / King
  readonly weapon: string;
  readonly stats: {
    readonly strength: number;
    readonly dexterity: number;
    readonly constitution: number;
    readonly intelligence: number;
    readonly wisdom: number;
    readonly charisma: number;
  };
}

export interface RankedBrawler {
  readonly tokenId: number;
  readonly rank: number;
  readonly rankOf: number;
  readonly score: number;
  readonly rarity: string;
  readonly weapon: string;
}

const RARITY_WEIGHT = 100;
const WEAPON_WEIGHT = 20;
const STAT_WEIGHT = 1;

/**
 * Compute ranks for the given set of brawlers.
 *
 * @param brawlers Array of (rarity / weapon / stats) per minted brawler.
 * @returns rank assignments sorted by rank ascending (rank 1 first).
 */
export function computeRanks(brawlers: readonly BrawlerForRank[]): RankedBrawler[] {
  const total = brawlers.length;
  if (total === 0) return [];

  // Tally trait frequencies.
  const rarityCount = new Map<string, number>();
  const weaponCount = new Map<string, number>();
  // Per-stat-name buckets of value → count.
  const statBuckets: Record<string, Map<number, number>> = {
    strength: new Map(),
    dexterity: new Map(),
    constitution: new Map(),
    intelligence: new Map(),
    wisdom: new Map(),
    charisma: new Map(),
  };

  for (const b of brawlers) {
    rarityCount.set(b.rarity, (rarityCount.get(b.rarity) ?? 0) + 1);
    weaponCount.set(b.weapon, (weaponCount.get(b.weapon) ?? 0) + 1);
    for (const statName of Object.keys(statBuckets)) {
      const value = b.stats[statName as keyof BrawlerForRank['stats']];
      const bucket = statBuckets[statName]!;
      bucket.set(value, (bucket.get(value) ?? 0) + 1);
    }
  }

  // Score each brawler.
  const scored = brawlers.map((b) => {
    let score = 0;
    // Rarity tier (dominant).
    const rCount = rarityCount.get(b.rarity) ?? 1;
    score += (total / rCount) * RARITY_WEIGHT;
    // Weapon (moderate).
    const wCount = weaponCount.get(b.weapon) ?? 1;
    score += (total / wCount) * WEAPON_WEIGHT;
    // Each stat (subtle).
    for (const statName of Object.keys(statBuckets)) {
      const value = b.stats[statName as keyof BrawlerForRank['stats']];
      const bucket = statBuckets[statName]!;
      const vCount = bucket.get(value) ?? 1;
      score += (total / vCount) * STAT_WEIGHT;
    }
    return { tokenId: b.tokenId, score, rarity: b.rarity, weapon: b.weapon };
  });

  // Sort descending. Tiebreaker: lower tokenId wins (older mint).
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.tokenId - b.tokenId;
  });

  return scored.map((s, i) => ({
    tokenId: s.tokenId,
    rank: i + 1,
    rankOf: total,
    score: Math.round(s.score * 100) / 100,
    rarity: s.rarity,
    weapon: s.weapon,
  }));
}
