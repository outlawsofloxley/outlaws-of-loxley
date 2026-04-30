/**
 * GET /api/marketplace/listings?limit=200
 *
 * Reads active listings from the Postgres cache. Fires a background sync
 * on every call so the cache stays fresh without any cron.
 */
import { ensureMarketSchema, queryListings } from '@/lib/marketDb';
import { isDbConfigured } from '@/lib/duelDb';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  if (!isDbConfigured()) {
    return Response.json({ ok: false, error: 'POSTGRES_URL not configured' }, { status: 503 });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  const limit =
    limitParam !== null && /^\d+$/.test(limitParam)
      ? Number.parseInt(limitParam, 10)
      : 200;

  try {
    await ensureMarketSchema();
  } catch (e) {
    return Response.json(
      { ok: false, error: 'DB schema setup failed: ' + (e instanceof Error ? e.message : String(e)) },
      { status: 500 },
    );
  }

  // Fire-and-forget background sync.
  const syncUrl = new URL('/api/marketplace/sync', url.origin);
  void fetch(syncUrl.toString(), { method: 'POST' }).catch(() => {});

  const rows = await queryListings({ limit });
  return Response.json({ ok: true, rows });
}
