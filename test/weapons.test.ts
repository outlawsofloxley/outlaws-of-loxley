import { describe, it, expect } from 'vitest';
import { WEAPONS, getWeapon, findWeapon, hasTypeAdvantage } from '../src/core/weapons.js';

describe('weapons', () => {
  describe('data integrity', () => {
    it('weights sum to 100', () => {
      const total = WEAPONS.reduce((s, w) => s + w.weight, 0);
      expect(total).toBe(100);
    });

    it('has 11 weapons', () => {
      expect(WEAPONS.length).toBe(11);
    });

    it('damageMin is always <= damageMax', () => {
      for (const w of WEAPONS) {
        expect(w.damageMin).toBeLessThanOrEqual(w.damageMax);
      }
    });

    it('speed is in [1, 10]', () => {
      for (const w of WEAPONS) {
        expect(w.speed).toBeGreaterThanOrEqual(1);
        expect(w.speed).toBeLessThanOrEqual(10);
      }
    });

    it('rarer weapons have higher max damage on average', () => {
      const commons = WEAPONS.filter((w) => w.rarity === 'common');
      const legendaries = WEAPONS.filter((w) => w.rarity === 'legendary');
      const avgCommon =
        commons.reduce((s, w) => s + w.damageMax, 0) / commons.length;
      const avgLegendary =
        legendaries.reduce((s, w) => s + w.damageMax, 0) / legendaries.length;
      expect(avgLegendary).toBeGreaterThan(avgCommon * 2);
    });
  });

  describe('lookups', () => {
    it('getWeapon returns the right weapon', () => {
      const w = getWeapon('Knife');
      expect(w.name).toBe('Knife');
    });

    it('getWeapon throws on unknown', () => {
      expect(() => getWeapon('Toothbrush')).toThrow();
    });

    it('findWeapon returns undefined on unknown', () => {
      expect(findWeapon('Toothbrush')).toBeUndefined();
    });
  });

  describe('hasTypeAdvantage', () => {
    const knife = getWeapon('Knife'); // blade
    const bat = getWeapon('Baseball Bat'); // blunt
    const pistol = getWeapon('Pistol'); // ranged

    it('blade beats blunt', () => {
      expect(hasTypeAdvantage(knife, bat)).toBe(true);
    });

    it('blunt beats ranged', () => {
      expect(hasTypeAdvantage(bat, pistol)).toBe(true);
    });

    it('ranged beats blade', () => {
      expect(hasTypeAdvantage(pistol, knife)).toBe(true);
    });

    it('blunt does NOT beat blade', () => {
      expect(hasTypeAdvantage(bat, knife)).toBe(false);
    });

    it('ranged does NOT beat blunt', () => {
      expect(hasTypeAdvantage(pistol, bat)).toBe(false);
    });

    it('blade does NOT beat ranged', () => {
      expect(hasTypeAdvantage(knife, pistol)).toBe(false);
    });

    it('same type is not advantaged', () => {
      const machete = getWeapon('Machete'); // blade
      expect(hasTypeAdvantage(knife, machete)).toBe(false);
    });
  });
});
