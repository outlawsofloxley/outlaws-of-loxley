/**
 * Server-side DB helpers for the marketplace listings cache.
 *
 * Schema (auto-created on first touch):
 *
 *   market_listings                                -- one row per active listing
 *     token_id PRIMARY KEY                         only one listing per tokenId possible
 *     seller, price, listed_at, tx_hash, block_number, synced_at
 *
 * When a listing is cancelled / sold / auto-swept, the row is deleted.
 * When a listing is re-created for a previously-sold tokenId, we UPSERT.
 *
 *   market_sync_state (key PRIMARY KEY, value TEXT, updated_at)
 *     'last_block' → last block we've processed marketplace events up to
 *
 * Uses the same Postgres connection as duelDb.
 */
import { sql } from '@vercel/postgres';

export interface ListingRow {
  token_id: number;
  seller: string;
  price: string; // bigint as string
  listed_at: number;
  tx_hash: string;
  block_number: string;
}

export async function ensureMarketSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS market_listings (
      token_id     INTEGER  PRIMARY KEY,
      seller       TEXT     NOT NULL,
      price        TEXT     NOT NULL,
      listed_at    BIGINT   NOT NULL,
      tx_hash      TEXT     NOT NULL,
      block_number BIGINT   NOT NULL,
      synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_market_listings_seller ON market_listings (seller)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_market_listings_price ON market_listings (price)`;
  await sql`
    CREATE TABLE IF NOT EXISTS market_sync_state (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function getMarketSyncState(): Promise<{
  lastBlock: bigint | null;
  updatedAt: Date | null;
}> {
  const { rows } = await sql`SELECT value, updated_at FROM market_sync_state WHERE key = 'last_block'`;
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

export async function setMarketLastSyncedBlock(block: bigint): Promise<void> {
  const value = block.toString();
  await sql`
    INSERT INTO market_sync_state (key, value, updated_at)
    VALUES ('last_block', ${value}, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = EXCLUDED.updated_at
  `;
}

/// Reads the marketplace contract address the cache was built against. Used
/// to detect "operator swapped Marketplace contracts" and trigger a wipe.
export async function getTrackedMarketplaceAddress(): Promise<string | null> {
  const { rows } = await sql`SELECT value FROM market_sync_state WHERE key = 'marketplace_addr'`;
  const first = rows[0] as { value?: string } | undefined;
  return first?.value?.toLowerCase() ?? null;
}

export async function setTrackedMarketplaceAddress(addr: string): Promise<void> {
  const value = addr.toLowerCase();
  await sql`
    INSERT INTO market_sync_state (key, value, updated_at)
    VALUES ('marketplace_addr', ${value}, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = EXCLUDED.updated_at
  `;
}

/// Drop every cached listing. Used when the configured Marketplace contract
/// changes so old-deploy ghosts don't leak into the new UI.
export async function wipeAllListings(): Promise<number> {
  const result = await sql`DELETE FROM market_listings`;
  return result.rowCount ?? 0;
}

export async function upsertListing(ev: {
  tokenId: number;
  seller: string;
  price: bigint;
  listedAt: number;
  txHash: string;
  blockNumber: bigint;
}): Promise<void> {
  await sql`
    INSERT INTO market_listings (token_id, seller, price, listed_at, tx_hash, block_number, synced_at)
    VALUES (
      ${ev.tokenId},
      ${ev.seller},
      ${ev.price.toString()},
      ${ev.listedAt},
      ${ev.txHash},
      ${ev.blockNumber.toString()}::bigint,
      NOW()
    )
    ON CONFLICT (token_id) DO UPDATE
      SET seller = EXCLUDED.seller,
          price = EXCLUDED.price,
          listed_at = EXCLUDED.listed_at,
          tx_hash = EXCLUDED.tx_hash,
          block_number = EXCLUDED.block_number,
          synced_at = NOW()
  `;
}

export async function updateListingPrice(tokenId: number, newPrice: bigint): Promise<void> {
  await sql`
    UPDATE market_listings
    SET price = ${newPrice.toString()}, synced_at = NOW()
    WHERE token_id = ${tokenId}
  `;
}

export async function deleteListing(tokenId: number): Promise<void> {
  await sql`DELETE FROM market_listings WHERE token_id = ${tokenId}`;
}

export async function queryListings(opts: { limit: number }): Promise<ListingRow[]> {
  const limit = Math.max(1, Math.min(500, opts.limit));
  const { rows } = await sql<ListingRow>`
    SELECT token_id, seller, price, listed_at, tx_hash, block_number
    FROM market_listings
    ORDER BY listed_at DESC
    LIMIT ${limit}
  `;
  return rows;
}

/// Return every cached tokenId. Used by the sync reconciliation pass to
/// verify each row still exists on-chain.
export async function getAllCachedTokenIds(): Promise<number[]> {
  const { rows } = await sql<{ token_id: number }>`
    SELECT token_id FROM market_listings
  `;
  return rows.map((r) => r.token_id);
}
