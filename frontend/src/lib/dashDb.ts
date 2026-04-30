/**
 * Server-side DB helpers for the dev dashboard.
 *
 * Schema (auto-created on first touch via ensureDashSchema):
 *
 *   dash_nonces                                    -- SIWE-style one-shot nonces
 *     nonce PRIMARY KEY                            hex string, unguessable
 *     expires_at, used_at                          single-use, 5-min expiry
 *
 *   house_whitelist                                -- migrated from env var
 *     token_id PRIMARY KEY
 *     added_at, added_by                           who added it (wallet addr)
 *
 *   audit_log                                      -- dev-action journal
 *     id SERIAL PK
 *     action, payload (jsonb), actor, created_at
 *
 *   login_attempts                                 -- rate-limit dash login
 *     ip, attempted_at                             rolling 1h window
 *
 *   resurrect_events                               -- mirrors duel_events pattern
 *     (tx_hash, log_index) PK
 *     block_number, token_id, by_addr, paid (wei as text)
 *
 *   mint_events                                    -- MintDrop BrawlerSold
 *     (tx_hash, log_index) PK
 *     block_number, token_id, buyer, payment_type (0=ETH, 1=USDT),
 *     amount_paid (wei as text), airdropped (wei as text)
 *
 *   market_sales                                   -- Marketplace Sold (with fee)
 *     (tx_hash, log_index) PK
 *     block_number, token_id, seller, buyer,
 *     price (wei as text), fee (wei as text)
 */
import { sql } from '@vercel/postgres';

export async function ensureDashSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS dash_nonces (
      nonce       TEXT PRIMARY KEY,
      expires_at  TIMESTAMPTZ NOT NULL,
      used_at     TIMESTAMPTZ
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_dash_nonces_expires ON dash_nonces (expires_at)`;

  await sql`
    CREATE TABLE IF NOT EXISTS house_whitelist (
      token_id  INTEGER PRIMARY KEY,
      added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      added_by  TEXT
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id          SERIAL PRIMARY KEY,
      action      TEXT NOT NULL,
      payload     JSONB,
      actor       TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS login_attempts (
      ip            TEXT NOT NULL,
      attempted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_at ON login_attempts (ip, attempted_at)`;

  await sql`
    CREATE TABLE IF NOT EXISTS resurrect_events (
      tx_hash      TEXT     NOT NULL,
      log_index    INTEGER  NOT NULL,
      block_number BIGINT   NOT NULL,
      token_id     INTEGER  NOT NULL,
      by_addr      TEXT     NOT NULL,
      paid         TEXT     NOT NULL,
      synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tx_hash, log_index)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_resurrect_events_block ON resurrect_events (block_number DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS mint_events (
      tx_hash      TEXT     NOT NULL,
      log_index    INTEGER  NOT NULL,
      block_number BIGINT   NOT NULL,
      token_id     INTEGER  NOT NULL,
      buyer        TEXT     NOT NULL,
      payment_type SMALLINT NOT NULL,
      amount_paid  TEXT     NOT NULL,
      airdropped   TEXT     NOT NULL,
      synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tx_hash, log_index)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_mint_events_block ON mint_events (block_number DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS market_sales (
      tx_hash      TEXT     NOT NULL,
      log_index    INTEGER  NOT NULL,
      block_number BIGINT   NOT NULL,
      token_id     INTEGER  NOT NULL,
      seller       TEXT     NOT NULL,
      buyer        TEXT     NOT NULL,
      price        TEXT     NOT NULL,
      fee          TEXT     NOT NULL,
      synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tx_hash, log_index)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_market_sales_block ON market_sales (block_number DESC)`;

  // Sync cursor for the combined dash-event sync (mint+resurrect+market-sales).
  // Reuses sync_state keys prefixed "dash_".
  await sql`
    CREATE TABLE IF NOT EXISTS dash_sync_state (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Player handles — wallet → display name. Set by the wallet owner via a
  // signed message ("BASEic Brawlers handle: <name>"). Verified server-side
  // before insert. Names are unique-folded (lowercased) so two wallets
  // can't claim the same handle.
  await sql`
    CREATE TABLE IF NOT EXISTS wallet_names (
      address      TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      name_lower   TEXT NOT NULL UNIQUE,
      set_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

// ─── Wallet names ─────────────────────────────────────────────────────

export async function setWalletName(address: string, name: string): Promise<void> {
  const lower = address.toLowerCase();
  const nameLower = name.toLowerCase();
  await sql`
    INSERT INTO wallet_names (address, name, name_lower, set_at)
    VALUES (${lower}, ${name}, ${nameLower}, NOW())
    ON CONFLICT (address) DO UPDATE SET
      name = ${name},
      name_lower = ${nameLower},
      set_at = NOW()
  `;
}

export async function getWalletNames(addresses: string[]): Promise<Record<string, string>> {
  if (addresses.length === 0) return {};
  // Postgres ANY array param keeps the query simple.
  const lower = addresses.map((a) => a.toLowerCase());
  const rows = await sql<{ address: string; name: string }>`
    SELECT address, name FROM wallet_names WHERE address = ANY(${lower as unknown as string})
  `;
  const out: Record<string, string> = {};
  for (const r of rows.rows) out[r.address] = r.name;
  return out;
}

// ─── Nonce helpers ────────────────────────────────────────────────

export async function createNonce(nonce: string, expiresAt: Date): Promise<void> {
  await sql`
    INSERT INTO dash_nonces (nonce, expires_at)
    VALUES (${nonce}, ${expiresAt.toISOString()})
    ON CONFLICT (nonce) DO NOTHING
  `;
}

export async function consumeNonce(
  nonce: string,
): Promise<{ ok: true; expiresAt: Date } | { ok: false; reason: string }> {
  const now = new Date();
  // Atomically mark used only if it's unused + unexpired.
  const { rows } = await sql`
    UPDATE dash_nonces
    SET used_at = NOW()
    WHERE nonce = ${nonce}
      AND used_at IS NULL
      AND expires_at > ${now.toISOString()}
    RETURNING expires_at
  `;
  const first = rows[0] as { expires_at?: Date | string } | undefined;
  if (!first) {
    return { ok: false, reason: 'nonce not found, already used, or expired' };
  }
  const expiresAt = first.expires_at instanceof Date ? first.expires_at : new Date(first.expires_at ?? '');
  return { ok: true, expiresAt };
}

export async function purgeExpiredNonces(): Promise<void> {
  await sql`DELETE FROM dash_nonces WHERE expires_at < NOW() - INTERVAL '1 hour'`;
}

// ─── Login-attempt rate limiting ──────────────────────────────────

const RATE_LIMIT_WINDOW_HOURS = 1;
const RATE_LIMIT_MAX_PER_WINDOW = 10;

export async function countRecentLoginAttempts(ip: string): Promise<number> {
  const { rows } = await sql<{ c: number }>`
    SELECT COUNT(*)::int AS c FROM login_attempts
    WHERE ip = ${ip}
      AND attempted_at > NOW() - (${RATE_LIMIT_WINDOW_HOURS} * INTERVAL '1 hour')
  `;
  return rows[0]?.c ?? 0;
}

export async function recordLoginAttempt(ip: string): Promise<void> {
  await sql`INSERT INTO login_attempts (ip) VALUES (${ip})`;
}

export async function purgeOldLoginAttempts(): Promise<void> {
  await sql`DELETE FROM login_attempts WHERE attempted_at < NOW() - INTERVAL '24 hours'`;
}

export function rateLimitConfig() {
  return {
    windowHours: RATE_LIMIT_WINDOW_HOURS,
    maxPerWindow: RATE_LIMIT_MAX_PER_WINDOW,
  };
}

// ─── House whitelist helpers ──────────────────────────────────────

export async function seedHouseWhitelistFromEnv(): Promise<number> {
  const raw = process.env.NEXT_PUBLIC_HOUSE_BRAWLER_IDS;
  if (!raw) return 0;
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map((s) => Number.parseInt(s, 10));
  if (ids.length === 0) return 0;

  // Only seed if the table is empty, so an explicit removal via dashboard
  // isn't re-added by a rogue deploy.
  const { rows } = await sql<{ c: number }>`SELECT COUNT(*)::int AS c FROM house_whitelist`;
  if ((rows[0]?.c ?? 0) > 0) return 0;

  for (const id of ids) {
    await sql`
      INSERT INTO house_whitelist (token_id, added_by)
      VALUES (${id}, ${'env-seed'})
      ON CONFLICT (token_id) DO NOTHING
    `;
  }
  return ids.length;
}

export async function getHouseWhitelist(): Promise<number[]> {
  const { rows } = await sql<{ token_id: number }>`
    SELECT token_id FROM house_whitelist ORDER BY token_id ASC
  `;
  return rows.map((r) => r.token_id);
}

export async function addToHouseWhitelist(tokenId: number, actor: string | null): Promise<void> {
  await sql`
    INSERT INTO house_whitelist (token_id, added_by)
    VALUES (${tokenId}, ${actor})
    ON CONFLICT (token_id) DO NOTHING
  `;
}

export async function removeFromHouseWhitelist(tokenId: number): Promise<boolean> {
  const { rowCount } = await sql`DELETE FROM house_whitelist WHERE token_id = ${tokenId}`;
  return (rowCount ?? 0) > 0;
}

// ─── Audit log ────────────────────────────────────────────────────

export async function logAction(
  action: string,
  payload: unknown,
  actor: string | null,
): Promise<void> {
  const json = payload === undefined || payload === null ? null : JSON.stringify(payload);
  await sql`
    INSERT INTO audit_log (action, payload, actor)
    VALUES (${action}, ${json}::jsonb, ${actor})
  `;
}

export interface AuditRow {
  id: number;
  action: string;
  payload: unknown;
  actor: string | null;
  created_at: string;
}

export async function recentAudit(limit: number): Promise<AuditRow[]> {
  const capped = Math.max(1, Math.min(200, limit));
  const { rows } = await sql<AuditRow>`
    SELECT id, action, payload, actor, created_at
    FROM audit_log
    ORDER BY created_at DESC
    LIMIT ${capped}
  `;
  return rows;
}

// ─── Event-stream readers (for dashboard stats) ───────────────────

export async function sumMintRevenueByType(): Promise<{
  ethTotalWei: string;
  usdtTotal: string;
  ethCount: number;
  usdtCount: number;
}> {
  const { rows } = await sql<{
    payment_type: number;
    total: string;
    count: number;
  }>`
    SELECT payment_type, COALESCE(SUM(amount_paid::numeric), 0)::text AS total, COUNT(*)::int AS count
    FROM mint_events
    GROUP BY payment_type
  `;
  let ethTotalWei = '0';
  let usdtTotal = '0';
  let ethCount = 0;
  let usdtCount = 0;
  for (const r of rows) {
    if (r.payment_type === 0) {
      ethTotalWei = r.total;
      ethCount = r.count;
    } else if (r.payment_type === 1) {
      usdtTotal = r.total;
      usdtCount = r.count;
    }
  }
  return { ethTotalWei, usdtTotal, ethCount, usdtCount };
}

export async function sumResurrectRevenue(): Promise<{ totalWei: string; count: number }> {
  const { rows } = await sql<{ total: string; count: number }>`
    SELECT COALESCE(SUM(paid::numeric), 0)::text AS total, COUNT(*)::int AS count
    FROM resurrect_events
  `;
  return {
    totalWei: rows[0]?.total ?? '0',
    count: rows[0]?.count ?? 0,
  };
}

export async function sumMarketFees(): Promise<{
  feeTotalWei: string;
  priceTotalWei: string;
  count: number;
}> {
  const { rows } = await sql<{ fee: string; price: string; count: number }>`
    SELECT
      COALESCE(SUM(fee::numeric), 0)::text AS fee,
      COALESCE(SUM(price::numeric), 0)::text AS price,
      COUNT(*)::int AS count
    FROM market_sales
  `;
  return {
    feeTotalWei: rows[0]?.fee ?? '0',
    priceTotalWei: rows[0]?.price ?? '0',
    count: rows[0]?.count ?? 0,
  };
}

/** Counts over a date window for the daily-bar charts. */
export async function dailyMintCounts(
  daysBack: number,
): Promise<Array<{ day: string; count: number }>> {
  const days = Math.max(1, Math.min(90, daysBack));
  const { rows } = await sql<{ day: string; count: number }>`
    SELECT TO_CHAR(DATE_TRUNC('day', synced_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
    FROM mint_events
    WHERE synced_at > NOW() - (${days} * INTERVAL '1 day')
    GROUP BY DATE_TRUNC('day', synced_at)
    ORDER BY DATE_TRUNC('day', synced_at) ASC
  `;
  return rows;
}

export async function dailyDuelCounts(
  daysBack: number,
): Promise<Array<{ day: string; count: number }>> {
  const days = Math.max(1, Math.min(90, daysBack));
  const { rows } = await sql<{ day: string; count: number }>`
    SELECT TO_CHAR(DATE_TRUNC('day', synced_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
    FROM duel_events
    WHERE synced_at > NOW() - (${days} * INTERVAL '1 day')
    GROUP BY DATE_TRUNC('day', synced_at)
    ORDER BY DATE_TRUNC('day', synced_at) ASC
  `;
  return rows;
}

export async function dailyMarketSales(
  daysBack: number,
): Promise<Array<{ day: string; count: number; fee: string; price: string }>> {
  const days = Math.max(1, Math.min(90, daysBack));
  const { rows } = await sql<{ day: string; count: number; fee: string; price: string }>`
    SELECT
      TO_CHAR(DATE_TRUNC('day', synced_at), 'YYYY-MM-DD') AS day,
      COUNT(*)::int AS count,
      COALESCE(SUM(fee::numeric), 0)::text AS fee,
      COALESCE(SUM(price::numeric), 0)::text AS price
    FROM market_sales
    WHERE synced_at > NOW() - (${days} * INTERVAL '1 day')
    GROUP BY DATE_TRUNC('day', synced_at)
    ORDER BY DATE_TRUNC('day', synced_at) ASC
  `;
  return rows;
}

// ─── Dash sync state (events not covered by history/sync or market/sync) ────

export async function getDashSyncState(key: string): Promise<{
  lastBlock: bigint | null;
  updatedAt: Date | null;
}> {
  const { rows } = await sql`SELECT value, updated_at FROM dash_sync_state WHERE key = ${key}`;
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
  return { lastBlock, updatedAt: first.updated_at ?? null };
}

export async function setDashSyncState(key: string, block: bigint): Promise<void> {
  await sql`
    INSERT INTO dash_sync_state (key, value, updated_at)
    VALUES (${key}, ${block.toString()}, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = EXCLUDED.updated_at
  `;
}

export async function upsertMintEvent(ev: {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  tokenId: number;
  buyer: string;
  paymentType: number;
  amountPaid: bigint;
  airdropped: bigint;
}): Promise<void> {
  await sql`
    INSERT INTO mint_events (
      tx_hash, log_index, block_number, token_id, buyer,
      payment_type, amount_paid, airdropped
    )
    VALUES (
      ${ev.txHash},
      ${ev.logIndex},
      ${ev.blockNumber.toString()}::bigint,
      ${ev.tokenId},
      ${ev.buyer},
      ${ev.paymentType},
      ${ev.amountPaid.toString()},
      ${ev.airdropped.toString()}
    )
    ON CONFLICT (tx_hash, log_index) DO NOTHING
  `;
}

export async function upsertResurrectEvent(ev: {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  tokenId: number;
  byAddr: string;
  paid: bigint;
}): Promise<void> {
  await sql`
    INSERT INTO resurrect_events (
      tx_hash, log_index, block_number, token_id, by_addr, paid
    )
    VALUES (
      ${ev.txHash},
      ${ev.logIndex},
      ${ev.blockNumber.toString()}::bigint,
      ${ev.tokenId},
      ${ev.byAddr},
      ${ev.paid.toString()}
    )
    ON CONFLICT (tx_hash, log_index) DO NOTHING
  `;
}

export async function upsertMarketSale(ev: {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  tokenId: number;
  seller: string;
  buyer: string;
  price: bigint;
  fee: bigint;
}): Promise<void> {
  await sql`
    INSERT INTO market_sales (
      tx_hash, log_index, block_number, token_id, seller, buyer, price, fee
    )
    VALUES (
      ${ev.txHash},
      ${ev.logIndex},
      ${ev.blockNumber.toString()}::bigint,
      ${ev.tokenId},
      ${ev.seller},
      ${ev.buyer},
      ${ev.price.toString()},
      ${ev.fee.toString()}
    )
    ON CONFLICT (tx_hash, log_index) DO NOTHING
  `;
}
