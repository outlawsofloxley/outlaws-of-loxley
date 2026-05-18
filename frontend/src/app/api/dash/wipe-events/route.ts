/**
 * POST /api/dash/wipe-events
 *
 * One-shot reset for the dashboard event tables. Used after a chain switch
 * (e.g. Sepolia → Base mainnet) where the old event rows belong to a
 * different deployment.
 *
 * TRUNCATEs:
 *   - mint_events
 *   - resurrect_events
 *   - market_sales
 *   - duel_events  (also resets sync_state.last_block, which feeds
 *                  /api/history and therefore the Discord bot's duel
 *                  watcher — if duel_events is stale and the history
 *                  cursor is far behind, the bot never sees new mainnet
 *                  duels)
 *
 * Resets the cursors so the next /api/dash/sync + /api/history/sync calls
 * walk forward from `fromBlock`.
 *
 * Optional body: { fromBlock?: string } — sets BOTH cursors to this block
 * minus 1 so sync re-walks from `fromBlock` forward. If omitted, the
 * cursors are cleared and sync backfills from `head - INITIAL_BACKFILL`.
 *
 * Session-gated (middleware enforces /api/dash/* auth).
 */
import { sql } from '@vercel/postgres';
import { isDbConfigured, setLastSyncedBlock } from '@/lib/duelDb';
import { ensureDashSchema, setDashSyncState } from '@/lib/dashDb';

export const runtime = 'nodejs';
export const maxDuration = 15;

export async function POST(req: Request) {
  if (!isDbConfigured()) {
    return Response.json(
      { ok: false, error: 'POSTGRES_URL not configured' },
      { status: 503 },
    );
  }

  await ensureDashSchema();

  let fromBlock: bigint | null = null;
  try {
    const body = (await req.json()) as { fromBlock?: string } | null;
    if (body && typeof body.fromBlock === 'string' && body.fromBlock.length > 0) {
      fromBlock = BigInt(body.fromBlock);
    }
  } catch {
    fromBlock = null;
  }

  const counts = {
    mint_events: 0,
    resurrect_events: 0,
    market_sales: 0,
    duel_events: 0,
  };

  const { rows: m } = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM mint_events`;
  counts.mint_events = m[0]?.n ?? 0;
  const { rows: r } = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM resurrect_events`;
  counts.resurrect_events = r[0]?.n ?? 0;
  const { rows: s } = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM market_sales`;
  counts.market_sales = s[0]?.n ?? 0;
  const { rows: d } = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM duel_events`;
  counts.duel_events = d[0]?.n ?? 0;

  await sql`TRUNCATE mint_events`;
  await sql`TRUNCATE resurrect_events`;
  await sql`TRUNCATE market_sales`;
  await sql`TRUNCATE duel_events`;

  if (fromBlock !== null) {
    const cursor = fromBlock > 0n ? fromBlock - 1n : 0n;
    await setDashSyncState('events_last_block', cursor);
    await setLastSyncedBlock(cursor);
  } else {
    await sql`DELETE FROM dash_sync_state WHERE key = 'events_last_block'`;
    await sql`DELETE FROM sync_state WHERE key = 'last_block'`;
  }

  return Response.json({
    ok: true,
    wiped: counts,
    cursorReset: fromBlock !== null ? (fromBlock - 1n).toString() : 'null (sync will backfill from head)',
  });
}
