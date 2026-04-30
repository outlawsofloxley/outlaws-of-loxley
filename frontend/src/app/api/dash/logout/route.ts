/**
 * POST /api/dash/logout, clear the session cookie.
 * GET also supported so a stale session can be cleared via a link.
 */
import { buildClearCookieHeader } from '@/lib/dashAuth';

export const runtime = 'nodejs';

function respond() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': buildClearCookieHeader(),
    },
  });
}

export async function POST() {
  return respond();
}
export async function GET() {
  return respond();
}
