/**
 * GET /api/dash/session — lightweight check for an existing session.
 * Used by the DashAuthGate to decide whether to show the sign-in flow or
 * render the dashboard.
 *
 * Returns { ok, authed, addr, expiresAt }. Never reveals details about
 * missing env or misconfig — those are surfaced via other endpoints.
 */
import { cookies } from 'next/headers';
import { DASH_COOKIE_NAME, verifySessionCookie } from '@/lib/dashAuth';

export const runtime = 'nodejs';

export async function GET() {
  const jar = await cookies();
  const cookie = jar.get(DASH_COOKIE_NAME);
  const payload = await verifySessionCookie(cookie?.value);
  if (!payload) {
    return Response.json({ ok: true, authed: false });
  }
  return Response.json({
    ok: true,
    authed: true,
    addr: payload.addr,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  });
}
