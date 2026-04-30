import { describe, it, expect } from 'vitest';
import {
  pointBuyCost,
  totalPointCost,
  validateStats,
  abilityModifier,
  rollStats,
  startingHp,
  armorClass,
} from '../src/core/stats.js';
import { POINT_BUY_TOTAL } from '../src/core/types.js';
import { createRng } from '../src/core/rng.js';

describe('stats', () => {
  describe('pointBuyCost', () => {
    it('costs 0 at the minimum', () => {
      expect(pointBuyCost(8)).toBe(0);
    });

    it('costs 1 per point from 9 to 14', () => {
      expect(pointBuyCost(9)).toBe(1);
      expect(pointBuyCost(14)).toBe(6);
    });

    it('costs 2 per point from 15 to 16', () => {
      // 8->14 = 6 points, 14->15 = 2, 15->16 = 2
      expect(pointBuyCost(15)).toBe(8);
      expect(pointBuyCost(16)).toBe(10);
    });

    it('costs 3 per point from 17 up', () => {
      // 16 = 10, 17 = 13, 18 = 16
      expect(pointBuyCost(17)).toBe(13);
      expect(pointBuyCost(18)).toBe(16);
    });

    it('throws below minimum', () => {
      expect(() => pointBuyCost(7)).toThrow();
    });

    it('throws above creation max', () => {
      expect(() => pointBuyCost(19)).toThrow();
    });
  });

  describe('totalPointCost', () => {
    it('zero stats costs zero', () => {
      const stats = {
        strength: 8, dexterity: 8, constitution: 8,
        intelligence: 8, wisdom: 8, charisma: 8,
      };
      expect(totalPointCost(stats)).toBe(0);
    });

    it('all 18 costs 96', () => {
      const stats = {
        strength: 18, dexterity: 18, constitution: 18,
        intelligence: 18, wisdom: 18, charisma: 18,
      };
      expect(totalPointCost(stats)).toBe(96);
    });
  });

  describe('validateStats', () => {
    it('rejects stats below minimum', () => {
      const r = validateStats({
        strength: 7, dexterity: 10, constitution: 10,
        intelligence: 10, wisdom: 10, charisma: 10,
      });
      expect(r.ok).toBe(false);
    });

    it('rejects stats above creation max', () => {
      const r = validateStats({
        strength: 19, dexterity: 8, constitution: 8,
        intelligence: 8, wisdom: 8, charisma: 8,
      });
      expect(r.ok).toBe(false);
    });

    it('rejects non-integer stats', () => {
      const r = validateStats({
        strength: 10.5, dexterity: 8, constitution: 8,
        intelligence: 8, wisdom: 8, charisma: 8,
      });
      expect(r.ok).toBe(false);
    });

    it('rejects budget mismatch', () => {
      // All 10s cost 12 points total, but budget is 32
      const r = validateStats({
        strength: 10, dexterity: 10, constitution: 10,
        intelligence: 10, wisdom: 10, charisma: 10,
      });
      expect(r.ok).toBe(false);
    });

    it('accepts a valid 32-point block', () => {
      // 12+16+12+14+14+10 = 4+10+4+6+6+2 = 32
      const stats = {
        strength: 12, dexterity: 16, constitution: 12,
        intelligence: 14, wisdom: 14, charisma: 10,
      };
      expect(totalPointCost(stats)).toBe(32);
      const r = validateStats(stats);
      expect(r.ok).toBe(true);
    });
  });

  describe('abilityModifier', () => {
    it('matches D&D table', () => {
      expect(abilityModifier(8)).toBe(-1);
      expect(abilityModifier(10)).toBe(0);
      expect(abilityModifier(12)).toBe(1);
      expect(abilityModifier(14)).toBe(2);
      expect(abilityModifier(16)).toBe(3);
      expect(abilityModifier(18)).toBe(4);
      expect(abilityModifier(20)).toBe(5);
    });
  });

  describe('rollStats', () => {
    it('always produces valid stats', () => {
      for (let seed = 1; seed < 100; seed++) {
        const rng = createRng(BigInt(seed));
        const stats = rollStats(rng);
        const check = validateStats(stats);
        expect(check.ok, `seed ${seed}: ${check.ok ? '' : check.reason}`).toBe(true);
      }
    });

    it('always spends exactly the full budget', () => {
      for (let seed = 1; seed < 100; seed++) {
        const rng = createRng(BigInt(seed));
        const stats = rollStats(rng);
        expect(totalPointCost(stats)).toBe(POINT_BUY_TOTAL);
      }
    });

    it('is deterministic', () => {
      const a = rollStats(createRng(42n));
      const b = rollStats(createRng(42n));
      expect(a).toEqual(b);
    });
  });

  describe('startingHp', () => {
    it('is 25 at level 0 with 10 CON', () => {
      const stats = {
        strength: 10, dexterity: 10, constitution: 10,
        intelligence: 10, wisdom: 10, charisma: 10,
      };
      // 25 + (0 * 3) + (0 * 2) = 25
      expect(startingHp(stats, 0)).toBe(25);
    });

    it('scales with CON and level', () => {
      const stats = {
        strength: 10, dexterity: 10, constitution: 14,
        intelligence: 10, wisdom: 10, charisma: 10,
      };
      // 25 + (2 * 3) + (1 * 2) = 25 + 6 + 2 = 33
      expect(startingHp(stats, 1)).toBe(33);
    });
  });

  describe('armorClass', () => {
    it('is 10 at 10 DEX 10 CON', () => {
      const stats = {
        strength: 10, dexterity: 10, constitution: 10,
        intelligence: 10, wisdom: 10, charisma: 10,
      };
      expect(armorClass(stats)).toBe(10);
    });

    it('scales with DEX and half CON', () => {
      const stats = {
        strength: 10, dexterity: 16, constitution: 14,
        intelligence: 10, wisdom: 10, charisma: 10,
      };
      // 10 + 3 + floor(2/2) = 14
      expect(armorClass(stats)).toBe(14);
    });
  });
});
