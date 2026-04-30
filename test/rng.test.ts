import { describe, it, expect } from 'vitest';
import { createRng, nextInt, nextFloat, nextUint64, dice, weightedPick } from '../src/core/rng.js';

describe('rng', () => {
  describe('createRng', () => {
    it('rejects negative seeds', () => {
      expect(() => createRng(-1n)).toThrow();
    });

    it('handles seed 0 without producing all-zero state', () => {
      const rng = createRng(0n);
      // Should not be the degenerate (0, 0) state
      expect(rng.s0 === 0n && rng.s1 === 0n).toBe(false);
      // And should produce non-zero output
      const first = nextUint64(rng);
      expect(first).toBeGreaterThan(0n);
    });

    it('produces identical sequences for identical seeds', () => {
      const a = createRng(12345n);
      const b = createRng(12345n);
      for (let i = 0; i < 100; i++) {
        expect(nextUint64(a)).toBe(nextUint64(b));
      }
    });

    it('produces different sequences for different seeds', () => {
      const a = createRng(12345n);
      const b = createRng(12346n);
      let differences = 0;
      for (let i = 0; i < 100; i++) {
        if (nextUint64(a) !== nextUint64(b)) {
          differences++;
        }
      }
      expect(differences).toBeGreaterThan(90);
    });
  });

  describe('nextInt', () => {
    it('returns values within range inclusive', () => {
      const rng = createRng(42n);
      for (let i = 0; i < 1000; i++) {
        const v = nextInt(rng, 5, 10);
        expect(v).toBeGreaterThanOrEqual(5);
        expect(v).toBeLessThanOrEqual(10);
      }
    });

    it('handles min === max', () => {
      const rng = createRng(42n);
      expect(nextInt(rng, 7, 7)).toBe(7);
    });

    it('rejects min > max', () => {
      const rng = createRng(42n);
      expect(() => nextInt(rng, 10, 5)).toThrow();
    });

    it('produces a uniform distribution (chi-squared sanity)', () => {
      const rng = createRng(42n);
      const counts = [0, 0, 0, 0, 0, 0];
      const trials = 60000;
      for (let i = 0; i < trials; i++) {
        counts[nextInt(rng, 0, 5)]!++;
      }
      // Expect each of 6 buckets to be within ±5% of 10,000
      for (const c of counts) {
        expect(c).toBeGreaterThan(9500);
        expect(c).toBeLessThan(10500);
      }
    });
  });

  describe('nextFloat', () => {
    it('returns values in [0, 1)', () => {
      const rng = createRng(42n);
      for (let i = 0; i < 1000; i++) {
        const v = nextFloat(rng);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });
  });

  describe('dice', () => {
    it('sums rolls correctly', () => {
      const rng = createRng(42n);
      // 1d20 always in [1, 20]
      for (let i = 0; i < 100; i++) {
        const v = dice(rng, 1, 20);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(20);
      }
    });

    it('applies bonus', () => {
      const rng = createRng(42n);
      // 1d1+5 always 6
      expect(dice(rng, 1, 1, 5)).toBe(6);
    });

    it('2d20 in [2, 40]', () => {
      const rng = createRng(42n);
      for (let i = 0; i < 100; i++) {
        const v = dice(rng, 2, 20);
        expect(v).toBeGreaterThanOrEqual(2);
        expect(v).toBeLessThanOrEqual(40);
      }
    });
  });

  describe('weightedPick', () => {
    it('never picks zero-weight item', () => {
      const rng = createRng(42n);
      for (let i = 0; i < 1000; i++) {
        const idx = weightedPick(rng, ['a', 'b', 'c'], [10, 0, 5]);
        expect(idx).not.toBe(1);
      }
    });

    it('respects weight ratios (approximately)', () => {
      const rng = createRng(42n);
      const counts = [0, 0, 0];
      for (let i = 0; i < 30000; i++) {
        counts[weightedPick(rng, ['a', 'b', 'c'], [70, 20, 10])]!++;
      }
      expect(counts[0]).toBeGreaterThan(20000);
      expect(counts[0]).toBeLessThan(22000);
      expect(counts[1]).toBeGreaterThan(5500);
      expect(counts[1]).toBeLessThan(6500);
      expect(counts[2]).toBeGreaterThan(2700);
      expect(counts[2]).toBeLessThan(3300);
    });

    it('rejects mismatched array lengths', () => {
      const rng = createRng(42n);
      expect(() => weightedPick(rng, ['a'], [1, 2])).toThrow();
    });

    it('rejects negative weights', () => {
      const rng = createRng(42n);
      expect(() => weightedPick(rng, ['a', 'b'], [1, -1])).toThrow();
    });

    it('rejects all-zero weights', () => {
      const rng = createRng(42n);
      expect(() => weightedPick(rng, ['a', 'b'], [0, 0])).toThrow();
    });

    it('rejects empty items', () => {
      const rng = createRng(42n);
      expect(() => weightedPick(rng, [], [])).toThrow();
    });
  });
});
