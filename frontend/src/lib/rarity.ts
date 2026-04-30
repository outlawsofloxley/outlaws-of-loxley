/**
 * Rarity tier helpers. A brawler's rarity is derived from its weapon's drop
 * weight — the weapon catalog in weapons.ts is banded into 6 tiers (including
 * the 1-of-1 King tier for the Kingsblade wielder).
 *
 * IMPORTANT: phase 7+ swapped the ranking of Epic and Legendary in the 500
 * drop so that EPIC is the rarest normal tier (5 brawlers, weapons 9-10 =
 * Bazooka / Rail Gun) and LEGENDARY sits below it (10 brawlers, weapons 7-8
 * = Flaming Sword / Electric Axe). KING sits above all at tokenId 501.
 *
 *   Weapon weight → tier mapping:
 *     weight == 0  → King        (Kingsblade — 1/1)
 *     weight 1-2   → Epic        (Bazooka, Rail Gun — rarest drop)
 *     weight 3-5   → Legendary   (Flaming Sword, Electric Axe)
 *     weight 7-9   → Rare        (Shotgun, Sledgehammer)
 *     weight 11-12 → Uncommon    (Machete, Pistol)
 *     weight 15+   → Common      (Knife, Baseball Bat, Crowbar)
 */
export type RarityTier = 'common' | 'uncommon' | 'rare' | 'legendary' | 'epic' | 'king';

/** Map weapon drop-weight to rarity tier. Thresholds match weapons.ts. */
export function rarityFromWeight(weight: number): RarityTier {
  if (weight === 0) return 'king';
  if (weight >= 15) return 'common';
  if (weight >= 11) return 'uncommon';
  if (weight >= 7) return 'rare';
  if (weight >= 3) return 'legendary';
  return 'epic';
}

/** Tailwind text color class for a tier. */
export function rarityTextClass(tier: RarityTier): string {
  switch (tier) {
    case 'common':
      return 'text-rarity-common';
    case 'uncommon':
      return 'text-rarity-uncommon';
    case 'rare':
      return 'text-rarity-rare';
    case 'legendary':
      return 'text-rarity-epic'; // use epic-orange for legendary visuals
    case 'epic':
      return 'text-brawl-yellow'; // brighter gold for the rarest normal tier
    case 'king':
      return 'text-brawl-orange'; // deep orange for the 1/1
  }
}

/** Tailwind border color class (for badges / borders). */
export function rarityBorderClass(tier: RarityTier): string {
  switch (tier) {
    case 'common':
      return 'border-rarity-common';
    case 'uncommon':
      return 'border-rarity-uncommon';
    case 'rare':
      return 'border-rarity-rare';
    case 'legendary':
      return 'border-rarity-epic';
    case 'epic':
      return 'border-brawl-yellow';
    case 'king':
      return 'border-brawl-orange';
  }
}

/** Human-readable label: "COMMON", "KING", etc. */
export function rarityLabel(tier: RarityTier): string {
  return tier.toUpperCase();
}
