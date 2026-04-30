/**
 * Game state persistence.
 *
 * Stores all brawlers and duel history to a single JSON file at
 * `data/brawlers.json`. Bigints are handled via src/util/json.
 *
 * API is intentionally narrow: load, save, mutating helpers. The REPL and
 * command handlers talk to the store; they do not touch JSON or the filesystem
 * directly.
 *
 * Durability: we write to a temp file and atomically rename. If the process
 * dies mid-write the original file is still intact.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Brawler, FightResult } from '../core/types.js';
import { parse, stringify } from '../util/json.js';

/** Number of consecutive losses that kills a brawler. */
export const CONSECUTIVE_LOSSES_TO_DIE = 3;

/** Bumped whenever the schema shape changes. */
export const STATE_VERSION = 1;

/** Shape of the persisted JSON. */
export interface GameState {
  readonly version: number;
  /** Next token ID to assign on mint. Starts at 1. */
  nextTokenId: number;
  /** Master seed used to derive brawler traits. Stable for the life of the save. */
  masterSeed: bigint;
  /** All brawlers, alive and dead. */
  brawlers: Brawler[];
  /** Full duel history for audit / replay. */
  duelHistory: DuelRecord[];
  /** Transient per-brawler tracking (e.g. consecutive losses toward death). */
  streaks: Record<number, BrawlerStreak>;
}

/** Per-brawler mutable counters not stored on the Brawler record itself. */
export interface BrawlerStreak {
  /** Consecutive losses since last win/tie. Resets on non-loss. */
  consecutiveLosses: number;
}

/** A summary of one duel. Includes the seed so it's fully replayable. */
export interface DuelRecord {
  readonly id: number;
  readonly timestamp: number;
  readonly brawlerAId: number;
  readonly brawlerBId: number;
  readonly winnerId: number | null;
  readonly rounds: number;
  readonly seed: bigint;
  readonly eloDeltaA: number;
  readonly eloDeltaB: number;
}

/** Create a fresh empty state. Callers pass the master seed. */
export function newState(masterSeed: bigint): GameState {
  return {
    version: STATE_VERSION,
    nextTokenId: 1,
    masterSeed,
    brawlers: [],
    duelHistory: [],
    streaks: {},
  };
}

/**
 * Load state from disk. If the file doesn't exist, returns newState(masterSeed).
 * If the file exists but is corrupt, throws (we never silently reset).
 */
export function loadState(path: string, masterSeed: bigint): GameState {
  if (!existsSync(path)) {
    return newState(masterSeed);
  }
  const text = readFileSync(path, 'utf8');
  const parsed = parse<GameState>(text);
  // Minimal schema sanity check
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.brawlers)) {
    throw new Error(`Corrupt save file at ${path}: missing brawlers array`);
  }
  if (parsed.version !== STATE_VERSION) {
    throw new Error(
      `Save file at ${path} is version ${parsed.version}, expected ${STATE_VERSION}. ` +
        `Delete the file or run a migration.`,
    );
  }
  return parsed;
}

/**
 * Save state to disk atomically.
 *
 * Write to a temp file, fsync (implicit in Node's writeFileSync), then rename.
 * If the rename fails we clean up the temp file.
 */
export function saveState(path: string, state: GameState): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, stringify(state, 2), 'utf8');
  try {
    renameSync(tmpPath, path);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // swallow cleanup error; rename error is more interesting
    }
    throw err;
  }
}

/** Find a brawler by ID. Returns undefined if not found. */
export function findBrawler(state: GameState, tokenId: number): Brawler | undefined {
  return state.brawlers.find((b) => b.tokenId === tokenId);
}

/** List alive brawlers. */
export function aliveBrawlers(state: GameState): Brawler[] {
  return state.brawlers.filter((b) => b.status === 'alive');
}

/** List dead brawlers (graveyard). */
export function deadBrawlers(state: GameState): Brawler[] {
  return state.brawlers.filter((b) => b.status === 'dead');
}

/** Add a fresh brawler to state. Mutates `state`. */
export function addBrawler(state: GameState, brawler: Brawler): void {
  state.brawlers.push(brawler);
  state.streaks[brawler.tokenId] = { consecutiveLosses: 0 };
}

/**
 * Insert a brawler at its tokenId, replacing any existing brawler with the
 * same ID. Used by on-chain sync: chain state is authoritative, so if we had
 * a stale local copy it gets overwritten.
 *
 * Returns true if an existing brawler was replaced, false if newly added.
 * Initializes the streaks entry to zero if the token is new, we can't know
 * the current streak from chain alone (Duel contract has it but we don't
 * fetch it yet; Turn 2 sync starts fresh, Turn 3's duel flow will update it).
 */
export function upsertBrawler(state: GameState, brawler: Brawler): boolean {
  const idx = state.brawlers.findIndex((b) => b.tokenId === brawler.tokenId);
  if (idx >= 0) {
    state.brawlers[idx] = brawler;
    return true;
  }
  state.brawlers.push(brawler);
  if (!(brawler.tokenId in state.streaks)) {
    state.streaks[brawler.tokenId] = { consecutiveLosses: 0 };
  }
  return false;
}

/**
 * Apply a duel result to the state: update wins/losses/ELO/ties, increment
 * loss streaks, kill brawlers whose streak hits the death threshold, and
 * append to duel history. Mutates `state`.
 *
 * Returns the two post-duel brawler records (handy for CLI display).
 */
export function applyDuelResult(
  state: GameState,
  fight: FightResult,
  eloDeltaA: number,
  eloDeltaB: number,
  newEloA: number,
  newEloB: number,
): {
  a: Brawler;
  b: Brawler;
  aDiedNow: boolean;
  bDiedNow: boolean;
} {
  const aIdx = state.brawlers.findIndex((x) => x.tokenId === fight.brawlerAId);
  const bIdx = state.brawlers.findIndex((x) => x.tokenId === fight.brawlerBId);
  if (aIdx < 0 || bIdx < 0) {
    throw new Error(`Brawler not found: ${aIdx < 0 ? fight.brawlerAId : fight.brawlerBId}`);
  }
  const aOld = state.brawlers[aIdx]!;
  const bOld = state.brawlers[bIdx]!;

  const aWon = fight.winnerId === aOld.tokenId;
  const bWon = fight.winnerId === bOld.tokenId;
  const tied = fight.winnerId === null;

  // Streak bookkeeping, reset on win/tie, increment on loss.
  const aStreak = state.streaks[aOld.tokenId] ?? { consecutiveLosses: 0 };
  const bStreak = state.streaks[bOld.tokenId] ?? { consecutiveLosses: 0 };
  if (aWon || tied) {
    aStreak.consecutiveLosses = 0;
  } else {
    aStreak.consecutiveLosses += 1;
  }
  if (bWon || tied) {
    bStreak.consecutiveLosses = 0;
  } else {
    bStreak.consecutiveLosses += 1;
  }

  const aDiedNow = aStreak.consecutiveLosses >= CONSECUTIVE_LOSSES_TO_DIE && aOld.status === 'alive';
  const bDiedNow = bStreak.consecutiveLosses >= CONSECUTIVE_LOSSES_TO_DIE && bOld.status === 'alive';

  // Build new records
  const aNew: Brawler = {
    ...aOld,
    wins: aOld.wins + (aWon ? 1 : 0),
    losses: aOld.losses + (!aWon && !tied ? 1 : 0),
    ties: aOld.ties + (tied ? 1 : 0),
    elo: newEloA,
    status: aDiedNow ? 'dead' : aOld.status,
  };
  const bNew: Brawler = {
    ...bOld,
    wins: bOld.wins + (bWon ? 1 : 0),
    losses: bOld.losses + (!bWon && !tied ? 1 : 0),
    ties: bOld.ties + (tied ? 1 : 0),
    elo: newEloB,
    status: bDiedNow ? 'dead' : bOld.status,
  };

  state.brawlers[aIdx] = aNew;
  state.brawlers[bIdx] = bNew;
  state.streaks[aOld.tokenId] = aStreak;
  state.streaks[bOld.tokenId] = bStreak;

  // Append duel record
  state.duelHistory.push({
    id: state.duelHistory.length + 1,
    timestamp: Date.now(),
    brawlerAId: aOld.tokenId,
    brawlerBId: bOld.tokenId,
    winnerId: fight.winnerId,
    rounds: fight.rounds,
    seed: fight.seed,
    eloDeltaA,
    eloDeltaB,
  });

  return { a: aNew, b: bNew, aDiedNow, bDiedNow };
}

/** Rename a brawler in place. Mutates `state`. Throws if not found or dead. */
export function renameBrawler(state: GameState, tokenId: number, newName: string): Brawler {
  const idx = state.brawlers.findIndex((b) => b.tokenId === tokenId);
  if (idx < 0) {
    throw new Error(`Brawler ${tokenId} not found`);
  }
  const trimmed = newName.trim();
  if (trimmed.length === 0 || trimmed.length > 32) {
    throw new Error(`Name must be 1-32 characters, got ${trimmed.length}`);
  }
  const updated: Brawler = { ...state.brawlers[idx]!, name: trimmed };
  state.brawlers[idx] = updated;
  return updated;
}
