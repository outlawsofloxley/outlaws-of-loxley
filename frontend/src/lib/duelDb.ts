/**
 * Server-side DB helpers for the duel history cache.
 *
 * Schema (auto-created on first touch):
 *
 *   duel_events                                    -- one row per DuelCompleted event
 *     (tx_hash, log_index) PRIMARY KEY             idempotent upserts
 *     block_number, token_a, token_b, winner_id,
 *     rounds, seed, nonce, new_elo_a, new_elo_b,
 *     synced_at (defaults NOW)
 *
 *   sync_state (key PRIMARY KEY, value TEXT, updated_at)
 *     'last_block' → last block we've synced up to
 *     'last_run'   → timestamp of last sync_state update (redundant with updated_at)
 *
 * All migrations are IF NOT EXISTS so the sync route can safely be the
 * initial bootstrap. No separate migration step.
 */
import { sql } from '@vercel/postgres';

export interface DuelRow {
  tx_hash: string;
  log_index: number;
  block_number: string; // bigint as string from pg driver
  token_a: number;
  token_b: number;
  winner_id: number;
  rounds: number;
  seed: string;
  nonce: string;
  new_elo_a: number;
  new_elo_b: number;
}

/** Ensure all tables + indexes exist. Idempotent. */
export async function ensureSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS duel_events (
      tx_hash      TEXT     NOT NULL,
      log_index    INTEGER  NOT NULL,
      block_number BIGINT   NOT NULL,
      token_a      INTEGER  NOT NULL,
      token_b      INTEGER  NOT NULL,
      winner_id    INTEGER  NOT NULL,
      rounds       INTEGER  NOT NULL,
      seed         TEXT     NOT NULL,
      nonce        TEXT     NOT NULL,
      new_elo_a    INTEGER  NOT NULL,
      new_elo_b    INTEGER  NOT NULL,
      synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tx_hash, log_index)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_duel_events_block ON duel_events (block_number DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_duel_events_token_a ON duel_events (token_a)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_duel_events_token_b ON duel_events (token_b)`;
  await sql`
    CREATE TABLE IF NOT EXISTS sync_state (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function getLastSyncedBlock(): Promise<bigint | null> {
  const { rows } = await sql`SELECT value FROM sync_state WHERE key = 'last_block'`;
  const first = rows[0] as { value?: string } | undefined;
  if (!first || typeof first.value !== 'string') return null;
  try {
    return BigInt(first.value);
  } catch {
    return null;
  }
}

export async function getSyncState(): Promise<{
  lastBlock: bigint | null;
  updatedAt: Date | null;
}> {
  const { rows } = await sql`SELECT value, updated_at FROM sync_state WHERE key = 'last_block'`;
  const first = rows[0] as { value?: string; updated_at?: Date } | undefined;
  if (!first) return { lastBlock: null, updatedAt: null };
  let lastBlock: bigint | null = null;
  if (typeof first.value === 'string') {
    try {
      lastBlock = BigInt(first.value);
    } catch {
      lastBlock = null;
    }
  }
  const updatedAt = first.updated_at ?? null;
  return { lastBlock, updatedAt };
}

export async function setLastSyncedBlock(block: bigint): Promise<void> {
  const value = block.toString();
  await sql`
    INSERT INTO sync_state (key, value, updated_at)
    VALUES ('last_block', ${value}, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = EXCLUDED.updated_at
  `;
}

/** Upsert a single event, idempotent by (tx_hash, log_index). */
export async function upsertDuelEvent(ev: {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  tokenA: number;
  tokenB: number;
  winnerId: number;
  rounds: number;
  seed: bigint;
  nonce: bigint;
  newEloA: number;
  newEloB: number;
}): Promise<void> {
  await sql`
    INSERT INTO duel_events (
      tx_hash, log_index, block_number, token_a, token_b, winner_id,
      rounds, seed, nonce, new_elo_a, new_elo_b
    )
    VALUES (
      ${ev.txHash},
      ${ev.logIndex},
      ${ev.blockNumber.toString()}::bigint,
      ${ev.tokenA},
      ${ev.tokenB},
      ${ev.winnerId},
      ${ev.rounds},
      ${ev.seed.toString()},
      ${ev.nonce.toString()},
      ${ev.newEloA},
      ${ev.newEloB}
    )
    ON CONFLICT (tx_hash, log_index) DO NOTHING
  `;
}

export async function queryDuelEvents(opts: {
  tokenId?: number;
  limit: number;
}): Promise<DuelRow[]> {
  const limit = Math.max(1, Math.min(500, opts.limit));
  if (typeof opts.tokenId === 'number') {
    const { rows } = await sql<DuelRow>`
      SELECT tx_hash, log_index, block_number, token_a, token_b, winner_id,
             rounds, seed, nonce, new_elo_a, new_elo_b
      FROM duel_events
      WHERE token_a = ${opts.tokenId} OR token_b = ${opts.tokenId}
      ORDER BY block_number DESC, log_index DESC
      LIMIT ${limit}
    `;
    return rows;
  }
  const { rows } = await sql<DuelRow>`
    SELECT tx_hash, log_index, block_number, token_a, token_b, winner_id,
           rounds, seed, nonce, new_elo_a, new_elo_b
    FROM duel_events
    ORDER BY block_number DESC, log_index DESC
    LIMIT ${limit}
  `;
  return rows;
}

export async function countDuelEvents(): Promise<number> {
  const { rows } = await sql<{ c: number }>`SELECT COUNT(*)::int AS c FROM duel_events`;
  return rows[0]?.c ?? 0;
}

/** Is Vercel Postgres configured in this environment? */
export function isDbConfigured(): boolean {
  return (
    typeof process.env.POSTGRES_URL === 'string' ||
    typeof process.env.DATABASE_URL === 'string' ||
    typeof process.env.POSTGRES_PRISMA_URL === 'string'
  );
}
