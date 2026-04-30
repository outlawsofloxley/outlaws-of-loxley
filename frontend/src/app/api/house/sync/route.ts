/**
 * POST/GET /api/house/sync
 *
 * Runs the house-fighter keeper: auto-resurrects any dead house brawlers
 * and ensures the keeper wallet has unlimited BRAWL approval for the Duel
 * contract. Safe to call freely — idempotent (only broadcasts when an
 * action is actually needed).
 *
 * Triggered by:
 *   - Vercel Cron (daily backstop on Hobby, can be bumped to per-minute on Pro)
 *   - Fire-and-forget from /api/history/sync after it processes a DuelCompleted
 *     event (so house brawlers that just died come back within seconds)
 *   - Manual via the /api/house/status endpoint's "sync now" button
 */
import { runHouseMaintenance } from '@/lib/houseKeeper';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function run() {
  try {
    const result = await runHouseMaintenance();
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST() {
  return run();
}
export async function GET() {
  return run();
}
