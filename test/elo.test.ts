import { describe, it, expect } from 'vitest';
import {
  expectedScore,
  kFactor,
  ratingChange,
  applyRatingChange,
  applyDuelResult,
  STARTING_ELO,
} from '../src/core/elo.js';

describe('elo', () => {
  describe('expectedScore', () => {
    it('is 0.5 when ratings are equal', () => {
      expect(expectedScore(1000, 1000)).toBeCloseTo(0.5, 5);
    });

    it('is higher than 0.5 when player is favored', () => {
      expect(expectedScore(1400, 1000)).toBeGreaterThan(0.5);
    });

    it('is lower than 0.5 when opponent is favored', () => {
      expect(expectedScore(1000, 1400)).toBeLessThan(0.5);
    });

    it('400 diff is about 0.91', () => {
      expect(expectedScore(1400, 1000)).toBeCloseTo(10 / 11, 3);
    });
  });

  describe('kFactor', () => {
    it('is 32 for new players', () => {
      expect(kFactor(0)).toBe(32);
      expect(kFactor(10)).toBe(32);
    });

    it('is 24 for mid players', () => {
      expect(kFactor(11)).toBe(24);
      expect(kFactor(50)).toBe(24);
    });

    it('is 16 for veterans', () => {
      expect(kFactor(51)).toBe(16);
      expect(kFactor(1000)).toBe(16);
    });

    it('rejects negatives', () => {
      expect(() => kFactor(-1)).toThrow();
    });
  });

  describe('ratingChange', () => {
    it('equal ratings, win: gains about K/2', () => {
      const change = ratingChange(1000, 1000, 'win', 0);
      expect(change).toBe(16); // 32 * (1 - 0.5) = 16
    });

    it('equal ratings, loss: loses about K/2', () => {
      const change = ratingChange(1000, 1000, 'loss', 0);
      expect(change).toBe(-16);
    });

    it('tie between equals: no change', () => {
      expect(ratingChange(1000, 1000, 'tie', 0)).toBe(0);
    });

    it('upset (weaker beats stronger): big gain', () => {
      const change = ratingChange(1000, 1500, 'win', 0);
      expect(change).toBeGreaterThan(25);
    });

    it('expected win (stronger beats weaker): small gain', () => {
      const change = ratingChange(1500, 1000, 'win', 0);
      expect(change).toBeLessThan(10);
    });
  });

  describe('applyRatingChange', () => {
    it('adds positive change', () => {
      expect(applyRatingChange(1000, 15)).toBe(1015);
    });

    it('applies negative change', () => {
      expect(applyRatingChange(1000, -15)).toBe(985);
    });

    it('floors at 100', () => {
      expect(applyRatingChange(105, -50)).toBe(100);
      expect(applyRatingChange(100, -10)).toBe(100);
    });
  });

  describe('applyDuelResult', () => {
    it('symmetric delta on equal players', () => {
      const r = applyDuelResult(1000, 1000, 0, 0, 'win');
      expect(r.deltaA).toBe(16);
      expect(r.deltaB).toBe(-16);
      expect(r.newA).toBe(1016);
      expect(r.newB).toBe(984);
    });

    it('tie leaves both unchanged at equal ratings', () => {
      const r = applyDuelResult(1200, 1200, 5, 5, 'tie');
      expect(r.deltaA).toBe(0);
      expect(r.deltaB).toBe(0);
    });

    it('applies different K-factors to different experience levels', () => {
      // A is new (K=32), B is veteran (K=16). Equal ratings, A wins.
      const r = applyDuelResult(1000, 1000, 5, 100, 'win');
      expect(r.deltaA).toBe(16); // K=32 * 0.5 = 16
      expect(r.deltaB).toBe(-8); // K=16 * -0.5 = -8
    });

    it('STARTING_ELO is 1000', () => {
      expect(STARTING_ELO).toBe(1000);
    });
  });
});
