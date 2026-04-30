import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  newState,
  loadState,
  saveState,
  addBrawler,
  findBrawler,
  aliveBrawlers,
  deadBrawlers,
  applyDuelResult,
  renameBrawler,
  CONSECUTIVE_LOSSES_TO_DIE,
  STATE_VERSION,
} from '../src/cli/store.js';
import { createBrawler } from '../src/core/brawler.js';
import type { FightResult } from '../src/core/types.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'brawlers-test-'));
}

function fakeFight(aId: number, bId: number, winnerId: number | null): FightResult {
  return {
    seed: 0xdeadbeefn,
    brawlerAId: aId,
    brawlerBId: bId,
    winnerId,
    rounds: 3,
    events: [{ type: 'fight_end', winnerId, rounds: 3 }],
  };
}

describe('store', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = tempDir();
    path = join(dir, 'brawlers.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('newState', () => {
    it('starts with nextTokenId 1 and no brawlers', () => {
      const s = newState(42n);
      expect(s.nextTokenId).toBe(1);
      expect(s.brawlers).toEqual([]);
      expect(s.duelHistory).toEqual([]);
      expect(s.masterSeed).toBe(42n);
      expect(s.version).toBe(STATE_VERSION);
    });
  });

  describe('loadState', () => {
    it('returns fresh state if file missing', () => {
      const s = loadState(path, 42n);
      expect(s.brawlers.length).toBe(0);
    });

    it('loads a saved state', () => {
      const s = newState(42n);
      const b = createBrawler(42n, 1);
      addBrawler(s, b);
      s.nextTokenId = 2;
      saveState(path, s);

      const loaded = loadState(path, 999n); // masterSeed ignored since file exists
      expect(loaded.brawlers.length).toBe(1);
      expect(loaded.brawlers[0]?.name).toBe(b.name);
      expect(loaded.nextTokenId).toBe(2);
      expect(loaded.masterSeed).toBe(42n); // preserved from file
    });

    it('throws on wrong version', () => {
      const badState = JSON.stringify({ version: 999, brawlers: [] });
      saveStateRaw(path, badState);
      expect(() => loadState(path, 42n)).toThrow(/version/);
    });

    it('throws on corrupt file', () => {
      saveStateRaw(path, 'not json at all');
      expect(() => loadState(path, 42n)).toThrow();
    });
  });

  describe('saveState', () => {
    it('atomically writes (no temp file left behind)', () => {
      const s = newState(42n);
      saveState(path, s);
      expect(existsSync(path)).toBe(true);
      expect(existsSync(path + '.tmp')).toBe(false);
    });

    it('creates parent directory', () => {
      const nested = join(dir, 'deep', 'nested', 'brawlers.json');
      const s = newState(42n);
      saveState(nested, s);
      expect(existsSync(nested)).toBe(true);
    });

    it('round-trips bigints (duel history seed)', () => {
      const s = newState(42n);
      const a = createBrawler(42n, 1);
      const b = createBrawler(42n, 2);
      addBrawler(s, a);
      addBrawler(s, b);
      s.nextTokenId = 3;
      const fight = fakeFight(1, 2, 1);
      applyDuelResult(s, fight, 10, -10, 1010, 990);
      saveState(path, s);
      const loaded = loadState(path, 42n);
      expect(loaded.duelHistory[0]?.seed).toBe(0xdeadbeefn);
      expect(typeof loaded.duelHistory[0]?.seed).toBe('bigint');
    });
  });

  describe('findBrawler / aliveBrawlers / deadBrawlers', () => {
    it('finds a brawler by ID', () => {
      const s = newState(42n);
      const b = createBrawler(42n, 5);
      addBrawler(s, b);
      expect(findBrawler(s, 5)?.name).toBe(b.name);
      expect(findBrawler(s, 99)).toBeUndefined();
    });

    it('splits alive and dead', () => {
      const s = newState(42n);
      addBrawler(s, createBrawler(42n, 1));
      const dead = { ...createBrawler(42n, 2), status: 'dead' as const };
      s.brawlers.push(dead);
      expect(aliveBrawlers(s).length).toBe(1);
      expect(deadBrawlers(s).length).toBe(1);
    });
  });

  describe('applyDuelResult', () => {
    it('updates wins and losses', () => {
      const s = newState(42n);
      addBrawler(s, createBrawler(42n, 1));
      addBrawler(s, createBrawler(42n, 2));
      const fight = fakeFight(1, 2, 1);
      const res = applyDuelResult(s, fight, 16, -16, 1016, 984);
      expect(res.a.wins).toBe(1);
      expect(res.a.losses).toBe(0);
      expect(res.b.wins).toBe(0);
      expect(res.b.losses).toBe(1);
      expect(res.a.elo).toBe(1016);
      expect(res.b.elo).toBe(984);
    });

    it('kills a brawler on Nth consecutive loss', () => {
      const s = newState(42n);
      addBrawler(s, createBrawler(42n, 1));
      addBrawler(s, createBrawler(42n, 2));
      let aDied = false;
      for (let i = 0; i < CONSECUTIVE_LOSSES_TO_DIE; i++) {
        const fight = fakeFight(1, 2, 2); // B wins every time
        const res = applyDuelResult(s, fight, -10, 10, 990, 1010);
        if (res.aDiedNow) aDied = true;
      }
      expect(aDied).toBe(true);
      expect(findBrawler(s, 1)?.status).toBe('dead');
      expect(findBrawler(s, 2)?.status).toBe('alive');
    });

    it('resets streak on a win', () => {
      const s = newState(42n);
      addBrawler(s, createBrawler(42n, 1));
      addBrawler(s, createBrawler(42n, 2));
      // Lose twice
      applyDuelResult(s, fakeFight(1, 2, 2), -10, 10, 990, 1010);
      applyDuelResult(s, fakeFight(1, 2, 2), -10, 10, 980, 1020);
      expect(s.streaks[1]?.consecutiveLosses).toBe(2);
      // Then win
      applyDuelResult(s, fakeFight(1, 2, 1), 10, -10, 990, 1010);
      expect(s.streaks[1]?.consecutiveLosses).toBe(0);
      // Two losses from here should NOT kill (streak reset)
      applyDuelResult(s, fakeFight(1, 2, 2), -10, 10, 980, 1020);
      applyDuelResult(s, fakeFight(1, 2, 2), -10, 10, 970, 1030);
      expect(findBrawler(s, 1)?.status).toBe('alive');
    });

    it('tie does not increment loss streak', () => {
      const s = newState(42n);
      addBrawler(s, createBrawler(42n, 1));
      addBrawler(s, createBrawler(42n, 2));
      for (let i = 0; i < 10; i++) {
        applyDuelResult(s, fakeFight(1, 2, null), 0, 0, 1000, 1000);
      }
      expect(findBrawler(s, 1)?.status).toBe('alive');
      expect(findBrawler(s, 2)?.status).toBe('alive');
      expect(findBrawler(s, 1)?.ties).toBe(10);
    });

    it('appends to duelHistory', () => {
      const s = newState(42n);
      addBrawler(s, createBrawler(42n, 1));
      addBrawler(s, createBrawler(42n, 2));
      applyDuelResult(s, fakeFight(1, 2, 1), 10, -10, 1010, 990);
      expect(s.duelHistory.length).toBe(1);
      expect(s.duelHistory[0]?.winnerId).toBe(1);
    });
  });

  describe('renameBrawler', () => {
    it('updates the name', () => {
      const s = newState(42n);
      addBrawler(s, createBrawler(42n, 1));
      const updated = renameBrawler(s, 1, 'Rex Steelfist');
      expect(updated.name).toBe('Rex Steelfist');
      expect(findBrawler(s, 1)?.name).toBe('Rex Steelfist');
    });

    it('rejects empty name', () => {
      const s = newState(42n);
      addBrawler(s, createBrawler(42n, 1));
      expect(() => renameBrawler(s, 1, '')).toThrow();
      expect(() => renameBrawler(s, 1, '   ')).toThrow();
    });

    it('rejects too-long name', () => {
      const s = newState(42n);
      addBrawler(s, createBrawler(42n, 1));
      expect(() => renameBrawler(s, 1, 'x'.repeat(33))).toThrow();
    });

    it('trims whitespace', () => {
      const s = newState(42n);
      addBrawler(s, createBrawler(42n, 1));
      const r = renameBrawler(s, 1, '  Hero Name  ');
      expect(r.name).toBe('Hero Name');
    });

    it('throws if brawler not found', () => {
      const s = newState(42n);
      expect(() => renameBrawler(s, 99, 'Nobody')).toThrow();
    });
  });
});

/** Helper for tests that need to write raw data (not valid GameState). */
function saveStateRaw(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}
