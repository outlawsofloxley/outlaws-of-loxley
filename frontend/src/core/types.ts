/**
 * Core type definitions for Brawlers.
 *
 * NOTE: this is a duplicate of root src/core/types.ts. Phase 6 keeps the
 * frontend standalone per CLAUDE.md; a Phase 7 workspace refactor will
 * deduplicate. Keep both copies in sync if either changes.
 */

// ─── Weapons ─────────────────────────────────────────────────────────────

export type WeaponType = 'blade' | 'blunt' | 'ranged';

export type WeaponRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface Weapon {
  readonly name: string;
  readonly damageMin: number;
  readonly damageMax: number;
  readonly speed: number;
  readonly type: WeaponType;
  readonly rarity: WeaponRarity;
  readonly weight: number;
}

// ─── Stats ───────────────────────────────────────────────────────────────

export interface Stats {
  readonly strength: number;
  readonly dexterity: number;
  readonly constitution: number;
  readonly intelligence: number;
  readonly wisdom: number;
  readonly charisma: number;
}

export const STAT_MIN = 8;
export const STAT_MAX_AT_CREATION = 18;
export const POINT_BUY_TOTAL = 32;

// ─── Brawler ─────────────────────────────────────────────────────────────

export type BrawlerStatus = 'alive' | 'dead';

export interface Brawler {
  readonly tokenId: number;
  readonly name: string;
  readonly stats: Stats;
  readonly weapon: Weapon;
  readonly level: number;
  readonly xp: number;
  readonly elo: number;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly status: BrawlerStatus;
  readonly createdAt: number;
}

// ─── Combat log ──────────────────────────────────────────────────────────

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
      readonly winnerId: number | null;
      readonly rounds: number;
    };

export interface FightResult {
  readonly seed: bigint;
  readonly brawlerAId: number;
  readonly brawlerBId: number;
  readonly winnerId: number | null;
  readonly rounds: number;
  readonly events: readonly CombatEvent[];
}
