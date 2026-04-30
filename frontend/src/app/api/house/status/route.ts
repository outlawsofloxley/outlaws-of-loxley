/**
 * GET /api/house/status
 *
 * Read-only view of the keeper wallet: which brawlers it owns, their
 * alive/dead state, current BRAWL allowance + balance. Used by the client
 * to render a HOUSE badge + the admin dashboard view.
 */
import { readHouseState } from '@/lib/houseKeeper';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const state = await readHouseState();
    return Response.json({ ok: true, ...state });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
