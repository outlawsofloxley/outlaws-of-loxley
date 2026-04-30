/**
 * Core type definitions for Brawlers.
 *
 * All game data shapes live here. The contract ABI will be derived from these
 * in Phase 4 so the off-chain and on-chain representations stay in sync.
 */

// ─── Weapons ─────────────────────────────────────────────────────────────

/**
 * Weapon damage class. Used for rock-paper-scissors matchups in combat.
 * - BLADE beats BLUNT (cuts through)
 * - BLUNT beats RANGED (smashes the shooter before they can aim)
 * - RANGED beats BLADE (kills at distance)
 */
export type WeaponType = 'blade' | 'blunt' | 'ranged';

/**
 * Rarity tier. Drives both visual rarity and weapon power.
 * Kept in sync with the art pipeline's weapon tiers.
 */
export type WeaponRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface Weapon {
  /** Display name, e.g. "Baseball Bat" */
  readonly name: string;
  /** Minimum base damage roll (inclusive) */
  readonly damageMin: number;
  /** Maximum base damage roll (inclusive) */
  readonly damageMax: number;
  /** Speed 1-10. Higher = attacks first. Used for initiative. */
  readonly speed: number;
  /** Combat type for rock-paper-scissors matchups */
  readonly type: WeaponType;
  /** Rarity tier */
  readonly rarity: WeaponRarity;
  /** Weight in the rarity roll out of 100. All weights sum to 100. */
  readonly weight: number;
}

// ─── Stats ───────────────────────────────────────────────────────────────

/**
 * The six D&D-style stats. Combat currently reads STR/DEX/CON.
 * INT/WIS/CHA are stored for future content (potions, perception, diplomacy).
 */
export interface Stats {
  readonly strength: number;
  readonly dexterity: number;
  readonly constitution: number;
  readonly intelligence: number;
  readonly wisdom: number;
  readonly charisma: number;
}

/** Minimum legal stat value */
export const STAT_MIN = 8;
/** Maximum legal stat value at creation */
export const STAT_MAX_AT_CREATION = 18;
/** Total points available in the point-buy system */
export const POINT_BUY_TOTAL = 32;

// ─── Brawler ─────────────────────────────────────────────────────────────

/**
 * Status of a brawler. Alive brawlers can duel. Dead ones go to the graveyard.
 */
export type BrawlerStatus = 'alive' | 'dead';

/**
 * A single Brawler NFT. This shape will be mirrored by the on-chain struct
 * in Phase 4, with a few fields computed from events (e.g. owner, createdAt).
 */
export interface Brawler {
  /** Token ID, 1-indexed. Immutable after mint. */
  readonly tokenId: number;
  /** Display name, e.g. "Marco Deathrow". Can be renamed (costs FTM later). */
  readonly name: string;
  /** Base stats at mint. In v1 these are immutable; v2 may add stat-up items. */
  readonly stats: Stats;
  /** Weapon at mint. In v1 immutable; v2 may add weapon swapping. */
  readonly weapon: Weapon;
  /** Current level. Starts at 1. Increases with wins. */
  readonly level: number;
  /** XP toward next level. */
  readonly xp: number;
  /** Current ELO rating. Starts at 1000. */
  readonly elo: number;
  /** Total wins */
  readonly wins: number;
  /** Total losses */
  readonly losses: number;
  /** Total ties (rare - happens if both brawlers hit 0 HP same round) */
  readonly ties: number;
  /** Alive or dead */
  readonly status: BrawlerStatus;
  /** Epoch millis when minted. Useful for sorting. */
  readonly createdAt: number;
}

// ─── Combat log ──────────────────────────────────────────────────────────

/**
 * A single event in a fight. Structured so presentations (CLI, web, Discord)
 * can format it however they want.
 */
export type CombatEvent =
  | {
      readonly type: 'round_start';
      readonly round: number;
      readonly attackerId: number;
      readonly defenderId: number;
    }
  | {
      readonly type: 'attack_hit';
      readonly attackerId: number;
      readonly defenderId: number;
      readonly damage: number;
      readonly isCritical: boolean;
      readonly typeAdvantage: boolean;
      readonly defenderHpAfter: number;
    }
  | {
      readonly type: 'attack_miss';
      readonly attackerId: number;
      readonly defenderId: number;
    }
  | {
      readonly type: 'fight_end';
      readonly winnerId: number | null; // null on tie
      readonly rounds: number;
    };

/**
 * Full result of a fight. `winnerId` is null on the rare double-KO tie.
 * `seed` is recorded so the fight can be replayed byte-for-byte.
 */
export interface FightResult {
  readonly seed: bigint;
  readonly brawlerAId: number;
  readonly brawlerBId: number;
  readonly winnerId: number | null;
  readonly rounds: number;
  readonly events: readonly CombatEvent[];
}
