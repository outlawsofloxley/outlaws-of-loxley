import { describe, it, expect, beforeEach } from 'vitest';
import {
  commandHelp,
  commandMint,
  commandList,
  commandShow,
  commandDuel,
  commandGraveyard,
  commandLeaderboard,
  commandRename,
  commandHistory,
  commandReset,
  commandQuit,
} from '../src/cli/commands.js';
import {
  newState,
  findBrawler,
  applyDuelResult as storeApplyDuel,
  type GameState,
} from '../src/cli/store.js';

/** Strip ANSI escape codes for stable output assertions. */
function strip(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('commands', () => {
  let state: GameState;

  beforeEach(() => {
    state = newState(42n);
  });

  describe('commandHelp', () => {
    it('lists all commands', () => {
      const r = commandHelp();
      const out = strip(r.output);
      expect(out).toContain('mint');
      expect(out).toContain('duel');
      expect(out).toContain('list');
      expect(out).toContain('quit');
      expect(r.mutated).toBe(false);
    });
  });

  describe('commandMint', () => {
    it('mints 1 by default', () => {
      const r = commandMint(state, []);
      expect(state.brawlers.length).toBe(1);
      expect(state.nextTokenId).toBe(2);
      expect(r.mutated).toBe(true);
    });

    it('mints n brawlers', () => {
      commandMint(state, ['5']);
      expect(state.brawlers.length).toBe(5);
      expect(state.nextTokenId).toBe(6);
    });

    it('rejects non-integer count', () => {
      const r = commandMint(state, ['abc']);
      expect(r.mutated).toBe(false);
      expect(state.brawlers.length).toBe(0);
    });

    it('rejects negative count', () => {
      const r = commandMint(state, ['-5']);
      expect(r.mutated).toBe(false);
    });

    it('rejects count > 100', () => {
      const r = commandMint(state, ['101']);
      expect(r.mutated).toBe(false);
    });

    it('assigns sequential token IDs', () => {
      commandMint(state, ['3']);
      expect(state.brawlers.map((b) => b.tokenId)).toEqual([1, 2, 3]);
    });
  });

  describe('commandList', () => {
    it('handles empty state', () => {
      const r = commandList(state);
      expect(strip(r.output)).toContain('No living brawlers');
      expect(r.mutated).toBe(false);
    });

    it('shows all alive brawlers', () => {
      commandMint(state, ['3']);
      const r = commandList(state);
      const out = strip(r.output);
      expect(out).toContain('#001');
      expect(out).toContain('#002');
      expect(out).toContain('#003');
      expect(out).toContain('3 alive');
    });

    it('excludes dead brawlers', () => {
      commandMint(state, ['2']);
      state.brawlers[0] = { ...state.brawlers[0]!, status: 'dead' };
      const r = commandList(state);
      const out = strip(r.output);
      expect(out).toContain('1 alive');
    });
  });

  describe('commandShow', () => {
    it('shows brawler details', () => {
      commandMint(state, ['1']);
      const r = commandShow(state, ['1']);
      const out = strip(r.output);
      expect(out).toContain('STR');
      expect(out).toContain('DEX');
      expect(out).toContain('Weapon');
      expect(r.mutated).toBe(false);
    });

    it('rejects missing ID', () => {
      const r = commandShow(state, []);
      expect(strip(r.output)).toContain('need a brawler ID');
    });

    it('rejects unknown ID', () => {
      const r = commandShow(state, ['99']);
      expect(strip(r.output)).toContain('not found');
    });

    it('rejects non-integer ID', () => {
      const r = commandShow(state, ['abc']);
      expect(strip(r.output)).toContain('invalid');
    });
  });

  describe('commandDuel', () => {
    beforeEach(() => {
      commandMint(state, ['2']);
    });

    it('runs a duel with explicit seed', () => {
      const r = commandDuel(state, ['1', '2', '0x100']);
      expect(r.mutated).toBe(true);
      // One of the two brawlers must have gained wins, one losses (or both ties)
      const a = findBrawler(state, 1)!;
      const b = findBrawler(state, 2)!;
      expect(a.wins + a.losses + a.ties).toBe(1);
      expect(b.wins + b.losses + b.ties).toBe(1);
      expect(state.duelHistory.length).toBe(1);
    });

    it('accepts seed without 0x prefix', () => {
      const r = commandDuel(state, ['1', '2', 'abc']);
      expect(r.mutated).toBe(true);
    });

    it('generates random seed when none given', () => {
      const r = commandDuel(state, ['1', '2']);
      expect(r.mutated).toBe(true);
      const seed = state.duelHistory[0]?.seed;
      expect(typeof seed).toBe('bigint');
      expect(seed).toBeGreaterThan(0n); // crypto random is effectively always > 0
    });

    it('is deterministic given explicit seed', () => {
      const r1 = commandDuel(state, ['1', '2', '0x100']);

      // Reset and re-run
      const state2 = newState(42n);
      commandMint(state2, ['2']);
      const r2 = commandDuel(state2, ['1', '2', '0x100']);

      // Winners, ELO outcomes, and damage logs must match
      expect(state.duelHistory[0]?.winnerId).toBe(state2.duelHistory[0]?.winnerId);
      expect(state.duelHistory[0]?.rounds).toBe(state2.duelHistory[0]?.rounds);
      expect(strip(r1.output)).toBe(strip(r2.output));
    });

    it('rejects malformed args', () => {
      expect(commandDuel(state, ['1']).mutated).toBe(false);
      expect(commandDuel(state, ['1', '2', '3', '4']).mutated).toBe(false);
      expect(commandDuel(state, ['abc', 'def']).mutated).toBe(false);
      expect(commandDuel(state, ['1', '1']).mutated).toBe(false);
    });

    it('rejects unknown brawler', () => {
      expect(commandDuel(state, ['1', '99']).mutated).toBe(false);
      expect(commandDuel(state, ['99', '1']).mutated).toBe(false);
    });

    it('rejects dead brawler', () => {
      state.brawlers[0] = { ...state.brawlers[0]!, status: 'dead' };
      const r = commandDuel(state, ['1', '2']);
      expect(r.mutated).toBe(false);
      expect(strip(r.output)).toContain('graveyard');
    });

    it('rejects invalid hex seed', () => {
      const r = commandDuel(state, ['1', '2', 'xyz']);
      expect(r.mutated).toBe(false);
    });
  });

  describe('commandGraveyard', () => {
    it('reports empty graveyard', () => {
      const r = commandGraveyard(state);
      expect(strip(r.output)).toContain('empty');
    });

    it('lists dead brawlers', () => {
      commandMint(state, ['2']);
      state.brawlers[0] = { ...state.brawlers[0]!, status: 'dead' };
      const r = commandGraveyard(state);
      const out = strip(r.output);
      expect(out).toContain('GRAVEYARD');
      expect(out).toContain('#001');
      expect(out).not.toContain('#002');
    });
  });

  describe('commandLeaderboard', () => {
    it('handles empty state', () => {
      const r = commandLeaderboard(state);
      expect(strip(r.output)).toContain('No brawlers');
    });

    it('sorts by ELO descending', () => {
      commandMint(state, ['3']);
      state.brawlers[0] = { ...state.brawlers[0]!, elo: 1200 };
      state.brawlers[1] = { ...state.brawlers[1]!, elo: 1400 };
      state.brawlers[2] = { ...state.brawlers[2]!, elo: 1100 };
      const r = commandLeaderboard(state);
      const out = strip(r.output);
      const idx2 = out.indexOf('#002');
      const idx1 = out.indexOf('#001');
      const idx3 = out.indexOf('#003');
      expect(idx2).toBeLessThan(idx1);
      expect(idx1).toBeLessThan(idx3);
    });

    it('caps at 10', () => {
      commandMint(state, ['15']);
      const r = commandLeaderboard(state);
      const out = strip(r.output);
      expect(out).toContain('#001');
      // Only first 10 should appear
      expect(out).not.toContain('#015');
    });
  });

  describe('commandRename', () => {
    beforeEach(() => {
      commandMint(state, ['1']);
    });

    it('renames a brawler', () => {
      const r = commandRename(state, ['1', 'Rex', 'Steelfist']);
      expect(r.mutated).toBe(true);
      expect(findBrawler(state, 1)?.name).toBe('Rex Steelfist');
    });

    it('rejects missing args', () => {
      const r = commandRename(state, ['1']);
      expect(r.mutated).toBe(false);
    });

    it('reports nice error for unknown ID', () => {
      const r = commandRename(state, ['99', 'Nobody']);
      expect(r.mutated).toBe(false);
      expect(strip(r.output)).toContain('not found');
    });
  });

  describe('commandHistory', () => {
    it('reports no duels initially', () => {
      const r = commandHistory(state, []);
      expect(strip(r.output)).toContain('No duels');
    });

    it('lists recent duels', () => {
      commandMint(state, ['2']);
      commandDuel(state, ['1', '2', '0x100']);
      const r = commandHistory(state, []);
      const out = strip(r.output);
      expect(out).toContain('LAST 1 DUELS');
      expect(out).toContain('seed');
    });

    it('limits to n', () => {
      commandMint(state, ['2']);
      for (let i = 0; i < 5; i++) {
        commandDuel(state, ['1', '2', '0x' + (100 + i).toString(16)]);
      }
      const r = commandHistory(state, ['3']);
      const out = strip(r.output);
      expect(out).toContain('LAST 3 DUELS');
    });
  });

  describe('commandReset', () => {
    it('requires confirmation', () => {
      const r = commandReset([]);
      expect(r.mutated).toBe(false);
      expect(strip(r.output)).toContain('confirm');
    });

    it('reports confirmation accepted', () => {
      const r = commandReset(['confirm']);
      expect(r.mutated).toBe(true);
    });
  });

  describe('commandQuit', () => {
    it('sets exit flag', () => {
      const r = commandQuit();
      expect(r.exit).toBe(true);
    });
  });

  describe('end-to-end play loop', () => {
    it('mint, duel many times, observe death', () => {
      // Force brawler 1 to die by repeatedly applying a loss directly via the
      // store helper, since individual duels depend on RNG and might not
      // produce three consecutive losses for a specific brawler.
      // We use the CLI path for the mint, then exercise the refusal-to-duel
      // branch once the brawler is dead.
      commandMint(state, ['2']);

      // Apply three consecutive losses to brawler 1 using the store API.
      // (Fight simulation is RNG-dependent; forcing the outcome directly is
      // the correct test here — we're testing the death + refusal path,
      // not RNG luck.)
      const fakeFight = (winnerId: number) => ({
        seed: 0xdeadbeefn,
        brawlerAId: 1,
        brawlerBId: 2,
        winnerId,
        rounds: 3,
        events: [{ type: 'fight_end' as const, winnerId, rounds: 3 }],
      });
      for (let i = 0; i < 3; i++) {
        storeApplyDuel(state, fakeFight(2), -10, 10, 1000, 1000);
      }
      expect(findBrawler(state, 1)?.status).toBe('dead');
      // After death, further duels must refuse
      const r = commandDuel(state, ['1', '2']);
      expect(r.mutated).toBe(false);
      expect(strip(r.output)).toContain('graveyard');
    });
  });
});
