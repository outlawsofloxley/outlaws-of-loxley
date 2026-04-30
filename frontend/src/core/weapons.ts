/**
 * The 11 weapons in Brawlers. Duplicated from root src/core/weapons.ts — keep
 * in sync. Weights must sum to 100 (validated at import).
 */
import type { Weapon } from './types';

export const WEAPONS: readonly Weapon[] = [
  { name: 'Knife',         damageMin: 6,  damageMax: 11, speed: 9, type: 'blade',  rarity: 'common',    weight: 18 },
  { name: 'Baseball Bat',  damageMin: 8,  damageMax: 13, speed: 6, type: 'blunt',  rarity: 'common',    weight: 17 },
  { name: 'Crowbar',       damageMin: 8,  damageMax: 13, speed: 5, type: 'blunt',  rarity: 'common',    weight: 15 },
  { name: 'Machete',       damageMin: 10, damageMax: 15, speed: 6, type: 'blade',  rarity: 'uncommon',  weight: 12 },
  { name: 'Pistol',        damageMin: 11, damageMax: 16, speed: 7, type: 'ranged', rarity: 'uncommon',  weight: 11 },
  { name: 'Shotgun',       damageMin: 14, damageMax: 22, speed: 4, type: 'ranged', rarity: 'rare',      weight: 9  },
  { name: 'Sledgehammer',  damageMin: 14, damageMax: 24, speed: 3, type: 'blunt',  rarity: 'rare',      weight: 7  },
  { name: 'Flaming Sword', damageMin: 15, damageMax: 22, speed: 6, type: 'blade',  rarity: 'epic',      weight: 5  },
  { name: 'Electric Axe',  damageMin: 16, damageMax: 24, speed: 5, type: 'blade',  rarity: 'epic',      weight: 3  },
  { name: 'Bazooka',       damageMin: 22, damageMax: 35, speed: 2, type: 'ranged', rarity: 'legendary', weight: 2  },
  { name: 'Rail Gun',      damageMin: 25, damageMax: 40, speed: 6, type: 'ranged', rarity: 'legendary', weight: 1  },
];

const totalWeight = WEAPONS.reduce((sum, w) => sum + w.weight, 0);
if (totalWeight !== 100) {
  throw new Error(
    `Weapon weights must sum to 100, got ${totalWeight}. Fix frontend/src/core/weapons.ts.`,
  );
}

const names = new Set(WEAPONS.map((w) => w.name));
if (names.size !== WEAPONS.length) {
  throw new Error('Weapon names must be unique');
}

export function getWeapon(name: string): Weapon {
  const w = WEAPONS.find((w) => w.name === name);
  if (!w) {
    throw new Error(`Unknown weapon: ${name}`);
  }
  return w;
}

export function findWeapon(name: string): Weapon | undefined {
  return WEAPONS.find((w) => w.name === name);
}

export function hasTypeAdvantage(attacker: Weapon, defender: Weapon): boolean {
  if (attacker.type === 'blade' && defender.type === 'blunt') {
    return true;
  }
  if (attacker.type === 'blunt' && defender.type === 'ranged') {
    return true;
  }
  if (attacker.type === 'ranged' && defender.type === 'blade') {
    return true;
  }
  return false;
}

export const TYPE_ADVANTAGE_MULTIPLIER = 1.15;
