/**
 * GET /api/history/query?tokenId=123&limit=200
 *
 * Reads DuelCompleted events from the Postgres cache (populated by
 * /api/history/sync). Triggers a fire-and-forget sync on every call so
 * the cache stays fresh without any cron setup, if the last sync was
 * >25s ago the sync route will actually do work; otherwise it returns
 * instantly. Either way, this handler answers from what's already in
 * the DB so the user doesn't wait on the chain.
 */
import { countDuelEvents, ensureSchema, isDbConfigured, queryDuelEvents } from '@/lib/duelDb';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  if (!isDbConfigured()) {
    return Response.json(
      {
        ok: false,
        error: 'POSTGRES_URL not configured',
        configured: false,
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const tokenIdParam = url.searchParams.get('tokenId');
  const limitParam = url.searchParams.get('limit');
  const tokenId =
    tokenIdParam !== null && /^\d+$/.test(tokenIdParam)
      ? Number.parseInt(tokenIdParam, 10)
      : undefined;
  const limit =
    limitParam !== null && /^\d+$/.test(limitParam)
      ? Number.parseInt(limitParam, 10)
      : 200;

  try {
    await ensureSchema();
  } catch (e) {
    return Response.json(
      { ok: false, error: 'DB schema setup failed: ' + (e instanceof Error ? e.message : String(e)) },
      { status: 500 },
    );
  }

  // Kick off a background sync. We don't await, the response returns with
  // whatever's in cache right now; the next caller sees the fresher data.
  const syncUrl = new URL('/api/history/sync', url.origin);
  // Avoid awaiting; swallow errors silently.
  void fetch(syncUrl.toString(), { method: 'POST' }).catch(() => {});

  const rows = await queryDuelEvents({
    ...(tokenId !== undefined ? { tokenId } : {}),
    limit,
  });
  const total = await countDuelEvents();

  return Response.json({
    ok: true,
    configured: true,
    rows,
    total,
  });
}
