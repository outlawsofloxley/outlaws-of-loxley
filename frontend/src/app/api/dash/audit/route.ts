/**
 * POST /api/dash/audit, log an action into the audit_log table.
 *
 * Gated by the session cookie via middleware. The logged event records
 * what tx the dev initiated, it does NOT prove the tx succeeded on-chain
 * (the wallet itself is the source of truth for that). It's a light
 * journal so D can see what knobs have been turned.
 */
import { cookies } from 'next/headers';
import { ensureDashSchema, logAction } from '@/lib/dashDb';
import { isDbConfigured } from '@/lib/duelDb';
import { DASH_COOKIE_NAME, verifySessionCookie } from '@/lib/dashAuth';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (!isDbConfigured()) {
    return Response.json({ ok: false, error: 'POSTGRES_URL not configured' }, { status: 503 });
  }
  const jar = await cookies();
  const cookie = jar.get(DASH_COOKIE_NAME);
  const payload = await verifySessionCookie(cookie?.value);
  if (!payload) {
    return Response.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }
  let body: { action?: string; payload?: unknown };
  try {
    body = (await req.json()) as { action?: string; payload?: unknown };
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  const action = typeof body.action === 'string' ? body.action.slice(0, 128) : null;
  if (!action) {
    return Response.json({ ok: false, error: 'missing action' }, { status: 400 });
  }
  await ensureDashSchema();
  await logAction(action, body.payload ?? null, payload.addr);
  return Response.json({ ok: true });
}
