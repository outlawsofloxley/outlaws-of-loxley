/**
 * GET /api/rank
 *   ?id=N — return rank for one specific token
 *   ?page=K&limit=L — paginated slice (default page=1, limit=20, max 200)
 *   no params — full ranked list (entire collection, default behaviour)
 *
 * 5min cache + single-flight via lib/rankCache.ts.
 */
import { getCachedRanks } from '@/lib/rankCache';

export const runtime = 'nodejs';
export const maxDuration = 30;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const idParam = url.searchParams.get('id');
    const pageParam = url.searchParams.get('page');
    const limitParam = url.searchParams.get('limit');

    const { ranks, cachedAt } = await getCachedRanks();

    if (idParam !== null) {
      const idNum = Number(idParam);
      const hit = ranks.find((r) => r.tokenId === idNum);
      if (!hit) {
        return Response.json({ ok: false, error: `Token #${idNum} not found in ranks` }, { status: 404 });
      }
      return Response.json({ ok: true, rank: hit, cachedAt });
    }

    // Paginated path: only kicks in if either page or limit is provided.
    // Without those, return the full list (back-compat for the ranks hook
    // that wants to render ALL rows on the /ranks page.)
    if (pageParam !== null || limitParam !== null) {
      const limit = limitParam !== null
        ? Math.min(MAX_LIMIT, Math.max(1, Number(limitParam) || DEFAULT_LIMIT))
        : DEFAULT_LIMIT;
      const page = pageParam !== null
        ? Math.max(1, Number(pageParam) || 1)
        : 1;
      const start = (page - 1) * limit;
      const end = start + limit;
      const slice = ranks.slice(start, end);
      return Response.json({
        ok: true,
        total: ranks.length,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(ranks.length / limit)),
        cachedAt,
        ranks: slice,
      });
    }

    return Response.json({ ok: true, total: ranks.length, cachedAt, ranks });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
