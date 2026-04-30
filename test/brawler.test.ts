import { describe, it, expect } from 'vitest';
import { createBrawler, rollName, rollWeapon, rollStatsFromSeed, totalGames } from '../src/core/brawler.js';
import { validateStats } from '../src/core/stats.js';

describe('brawler', () => {
  describe('createBrawler', () => {
    it('is deterministic', () => {
      const a = createBrawler(42n, 1, 1000);
      const b = createBrawler(42n, 1, 1000);
      expect(a).toEqual(b);
    });

    it('different tokenIds give different brawlers', () => {
      const a = createBrawler(42n, 1, 1000);
      const b = createBrawler(42n, 2, 1000);
      // At least one of these should differ
      const differs =
        a.name !== b.name ||
        a.weapon.name !== b.weapon.name ||
        JSON.stringify(a.stats) !== JSON.stringify(b.stats);
      expect(differs).toBe(true);
    });

    it('different master seeds give different brawlers', () => {
      const a = createBrawler(42n, 1, 1000);
      const b = createBrawler(43n, 1, 1000);
      const differs =
        a.name !== b.name ||
        a.weapon.name !== b.weapon.name ||
        JSON.stringify(a.stats) !== JSON.stringify(b.stats);
      expect(differs).toBe(true);
    });

    it('tokenId < 1 throws', () => {
      expect(() => createBrawler(42n, 0)).toThrow();
    });

    it('produces valid stats', () => {
      for (let tid = 1; tid <= 20; tid++) {
        const b = createBrawler(42n, tid);
        const check = validateStats(b.stats);
        expect(check.ok).toBe(true);
      }
    });

    it('starts at level 1 with 0 XP and 1000 ELO', () => {
      const b = createBrawler(42n, 1);
      expect(b.level).toBe(1);
      expect(b.xp).toBe(0);
      expect(b.elo).toBe(1000);
      expect(b.wins).toBe(0);
      expect(b.losses).toBe(0);
      expect(b.ties).toBe(0);
      expect(b.status).toBe('alive');
    });
  });

  describe('rollName', () => {
    it('is deterministic', () => {
      expect(rollName(1n)).toBe(rollName(1n));
    });

    it('different seeds give different names most of the time', () => {
      const names = new Set<string>();
      for (let i = 0; i < 100; i++) {
        names.add(rollName(BigInt(i)));
      }
      // With 900 possible names and 100 seeds, should see at least 50 unique
      expect(names.size).toBeGreaterThan(50);
    });

    it('contains a space (first last)', () => {
      for (let i = 0; i < 20; i++) {
        expect(rollName(BigInt(i)).includes(' ')).toBe(true);
      }
    });
  });

  describe('rollWeapon', () => {
    it('is deterministic', () => {
      expect(rollWeapon(1n).name).toBe(rollWeapon(1n).name);
    });

    it('over many rolls, rarity distribution matches weights (approximate)', () => {
      const counts = new Map<string, number>();
      const trials = 10000;
      for (let i = 0; i < trials; i++) {
        const w = rollWeapon(BigInt(i));
        counts.set(w.name, (counts.get(w.name) ?? 0) + 1);
      }
      // Knife is 18% — expect between 15% and 21%
      const knives = counts.get('Knife') ?? 0;
      expect(knives / trials).toBeGreaterThan(0.15);
      expect(knives / trials).toBeLessThan(0.21);
      // Rail Gun is 1% — expect between 0.5% and 1.5%
      const railGuns = counts.get('Rail Gun') ?? 0;
      expect(railGuns / trials).toBeGreaterThan(0.005);
      expect(railGuns / trials).toBeLessThan(0.015);
    });
  });

  describe('rollStatsFromSeed', () => {
    it('is deterministic', () => {
      const a = rollStatsFromSeed(42n);
      const b = rollStatsFromSeed(42n);
      expect(a).toEqual(b);
    });

    it('always produces valid stats', () => {
      for (let i = 1; i < 100; i++) {
        const stats = rollStatsFromSeed(BigInt(i));
        expect(validateStats(stats).ok).toBe(true);
      }
    });
  });

  describe('totalGames', () => {
    it('sums wins + losses + ties', () => {
      const b = createBrawler(42n, 1);
      expect(totalGames(b)).toBe(0);
      const b2 = { ...b, wins: 3, losses: 2, ties: 1 };
      expect(totalGames(b2)).toBe(6);
    });
  });
});
