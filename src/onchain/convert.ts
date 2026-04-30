/**
 * Convert on-chain Brawler + Weapon tuples into local `Brawler` records.
 *
 * The contract returns Brawler as a plain tuple (defined in abi.ts). ethers v6
 * gives us a Result with both positional and named access. We use named access
 * for readability.
 *
 * createdAt is synthesised, we don't have a fast way to get the mint block
 * timestamp without another RPC roundtrip per token, and Turn 2 doesn't need
 * real timestamps. Use `Date.now()` at sync time; if accurate timestamps
 * matter later, we can fetch the transaction receipt for the BrawlerMinted
 * event and use block.timestamp.
 */
import type { Brawler, Weapon, WeaponRarity, WeaponType } from '../core/types.js';
import { findWeapon } from '../core/weapons.js';

/** Raw shape returned by Brawlers.getBrawler (result).  */
export interface OnchainBrawlerTuple {
  strength: bigint;
  dexterity: bigint;
  constitution: bigint;
  intelligence: bigint;
  wisdom: bigint;
  charisma: bigint;
  weaponId: bigint;
  level: bigint;
  xp: bigint;
  elo: bigint;
  wins: bigint;
  losses: bigint;
  ties: bigint;
  isDead: boolean;
  name: string;
}

/** Raw shape returned by Brawlers.getBrawlerWeapon / getWeapon. */
export interface OnchainWeaponTuple {
  name: string;
  damageMin: bigint;
  damageMax: bigint;
  speed: bigint;
  weaponType: bigint; // 0=blade, 1=blunt, 2=ranged
  weight: bigint;
}

const WEAPON_TYPE_MAP: Record<number, WeaponType> = {
  0: 'blade',
  1: 'blunt',
  2: 'ranged',
};

/**
 * Convert a chain weapon tuple to the local Weapon shape.
 *
 * For known weapons (all 11 of them), we look up the local `Weapon` record to
 * get `rarity`, that field doesn't exist on-chain because it's purely a
 * display concept. For unknown names (should never happen in practice), we
 * synthesise with rarity='common' so nothing else in the system crashes.
 */
export function fromOnchainWeapon(w: OnchainWeaponTuple): Weapon {
  const local = findWeapon(w.name);
  const wType = WEAPON_TYPE_MAP[Number(w.weaponType)];
  if (!wType) {
    throw new Error(`fromOnchainWeapon: invalid weaponType ${w.weaponType}`);
  }
  // Prefer the local record so rarity is correct; fall back to synthesised.
  if (local) {
    return local;
  }
  const rarity: WeaponRarity = 'common';
  return {
    name: w.name,
    damageMin: Number(w.damageMin),
    damageMax: Number(w.damageMax),
    speed: Number(w.speed),
    type: wType,
    rarity,
    weight: Number(w.weight),
  };
}

/**
 * Convert the chain Brawler tuple + already-derived Weapon + tokenId into a
 * local Brawler record.
 */
export function fromOnchainBrawler(
  tokenId: number,
  tuple: OnchainBrawlerTuple,
  weapon: Weapon,
  createdAt: number,
): Brawler {
  return {
    tokenId,
    name: tuple.name,
    stats: {
      strength: Number(tuple.strength),
      dexterity: Number(tuple.dexterity),
      constitution: Number(tuple.constitution),
      intelligence: Number(tuple.intelligence),
      wisdom: Number(tuple.wisdom),
      charisma: Number(tuple.charisma),
    },
    weapon,
    level: Number(tuple.level),
    xp: Number(tuple.xp),
    elo: Number(tuple.elo),
    wins: Number(tuple.wins),
    losses: Number(tuple.losses),
    ties: Number(tuple.ties),
    status: tuple.isDead ? 'dead' : 'alive',
    createdAt,
  };
}
