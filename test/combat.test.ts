import { describe, it, expect } from 'vitest';
import { simulateFight, MAX_ROUNDS } from '../src/sim/combat.js';
import { createBrawler } from '../src/core/brawler.js';
import type { Brawler } from '../src/core/types.js';

describe('combat', () => {
  describe('simulateFight', () => {
    it('is deterministic', () => {
      const a = createBrawler(42n, 1, 1000);
      const b = createBrawler(42n, 2, 1000);
      const r1 = simulateFight(a, b, 123n);
      const r2 = simulateFight(a, b, 123n);
      expect(r1).toEqual(r2);
    });

    it('different seeds produce different outcomes (usually)', () => {
      const a = createBrawler(42n, 1, 1000);
      const b = createBrawler(42n, 2, 1000);
      const r1 = simulateFight(a, b, 100n);
      const r2 = simulateFight(a, b, 200n);
      // Round counts differ even when winners are the same usually
      expect(
        r1.rounds !== r2.rounds ||
          r1.winnerId !== r2.winnerId ||
          r1.events.length !== r2.events.length,
      ).toBe(true);
    });

    it('produces a valid winner (A, B, or null)', () => {
      const a = createBrawler(42n, 1);
      const b = createBrawler(42n, 2);
      for (let seed = 1n; seed < 20n; seed++) {
        const r = simulateFight(a, b, seed);
        const valid = r.winnerId === a.tokenId || r.winnerId === b.tokenId || r.winnerId === null;
        expect(valid).toBe(true);
      }
    });

    it('ends within MAX_ROUNDS', () => {
      const a = createBrawler(42n, 1);
      const b = createBrawler(42n, 2);
      for (let seed = 1n; seed < 50n; seed++) {
        const r = simulateFight(a, b, seed);
        expect(r.rounds).toBeLessThanOrEqual(MAX_ROUNDS);
      }
    });

    it('events array ends with fight_end', () => {
      const a = createBrawler(42n, 1);
      const b = createBrawler(42n, 2);
      const r = simulateFight(a, b, 100n);
      expect(r.events[r.events.length - 1]?.type).toBe('fight_end');
    });

    it('events array starts with round_start', () => {
      const a = createBrawler(42n, 1);
      const b = createBrawler(42n, 2);
      const r = simulateFight(a, b, 100n);
      expect(r.events[0]?.type).toBe('round_start');
    });

    it('rejects same token ID vs itself', () => {
      const a = createBrawler(42n, 1);
      expect(() => simulateFight(a, a, 100n)).toThrow();
    });

    it('rejects dead brawler', () => {
      const a = createBrawler(42n, 1);
      const b = createBrawler(42n, 2);
      const dead: Brawler = { ...a, status: 'dead' };
      expect(() => simulateFight(dead, b, 100n)).toThrow();
      expect(() => simulateFight(a, { ...b, status: 'dead' }, 100n)).toThrow();
    });

    it('records the seed for replayability', () => {
      const a = createBrawler(42n, 1);
      const b = createBrawler(42n, 2);
      const r = simulateFight(a, b, 0xdeadbeefn);
      expect(r.seed).toBe(0xdeadbeefn);
    });

    it('records both brawler IDs', () => {
      const a = createBrawler(42n, 1);
      const b = createBrawler(42n, 2);
      const r = simulateFight(a, b, 100n);
      expect(r.brawlerAId).toBe(1);
      expect(r.brawlerBId).toBe(2);
    });

    it('over many fights both sides win sometimes (no hardcoded winner)', () => {
      const a = createBrawler(42n, 1);
      const b = createBrawler(42n, 2);
      let aWins = 0;
      let bWins = 0;
      for (let seed = 1n; seed < 200n; seed++) {
        const r = simulateFight(a, b, seed);
        if (r.winnerId === a.tokenId) aWins++;
        if (r.winnerId === b.tokenId) bWins++;
      }
      // Both must win at least once
      expect(aWins).toBeGreaterThan(5);
      expect(bWins).toBeGreaterThan(5);
    });

    it('attack_hit events have defenderHpAfter >= 0', () => {
      const a = createBrawler(42n, 1);
      const b = createBrawler(42n, 2);
      const r = simulateFight(a, b, 100n);
      for (const e of r.events) {
        if (e.type === 'attack_hit') {
          expect(e.defenderHpAfter).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('last hit reduces winner-side defender to 0 HP (if non-tie)', () => {
      const a = createBrawler(42n, 1);
      const b = createBrawler(42n, 2);
      for (let seed = 1n; seed < 30n; seed++) {
        const r = simulateFight(a, b, seed);
        if (r.winnerId === null) continue; // tie
        // Find the last attack_hit event
        const hits = r.events.filter((e) => e.type === 'attack_hit');
        if (hits.length === 0) continue; // possible if fight ends via round cap
        const lastHit = hits[hits.length - 1];
        if (lastHit?.type === 'attack_hit') {
          // The defender on the last hit must be the loser, and their HP must be 0 or match round cap
          const loserId = r.winnerId === a.tokenId ? b.tokenId : a.tokenId;
          if (r.rounds < MAX_ROUNDS && lastHit.defenderId === loserId) {
            expect(lastHit.defenderHpAfter).toBe(0);
          }
        }
      }
    });
  });
});
