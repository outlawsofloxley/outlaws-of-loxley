/**
 * Edge middleware: gates the dev dashboard on session-cookie presence.
 *
 * Only applies to:
 *   - /dash + /dash/:path*
 *   - /api/dash/:path* EXCEPT the three public auth endpoints (nonce, login,
 *     logout, session) which are what the client uses to obtain the cookie.
 *
 * When gated, missing or invalid cookies get:
 *   - 401 JSON for API calls
 *   - Passthrough for /dash page routes (the client-side DashAuthGate shows
 *     the sign-in flow, and API calls from it use the public auth endpoints).
 *
 * Uses Web Crypto via `verifySessionCookie` so it runs on the Edge runtime.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { DASH_COOKIE_NAME, verifySessionCookie } from '@/lib/dashAuth';

export const config = {
  matcher: ['/dash/:path*', '/dash', '/api/dash/:path*'],
};

// Public auth endpoints that MUST NOT be gated (otherwise you can't log in).
// `/api/dash/sync` is also public, same risk profile as the existing
// /api/history/sync and /api/marketplace/sync routes (read-only chain→DB
// population, idempotent, throttled).
const PUBLIC_API_PATHS = new Set([
  '/api/dash/nonce',
  '/api/dash/login',
  '/api/dash/logout',
  '/api/dash/session',
  '/api/dash/sync',
]);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always add no-index headers on the dashboard surface, protected or not.
  // Prevents search engines from indexing the login page.
  const makeResponse = (base?: NextResponse) => {
    const res = base ?? NextResponse.next();
    res.headers.set('x-robots-tag', 'noindex, nofollow, noarchive, nosnippet');
    return res;
  };

  // Public auth endpoints pass through (but still get no-index).
  if (PUBLIC_API_PATHS.has(pathname)) {
    return makeResponse();
  }

  const cookie = req.cookies.get(DASH_COOKIE_NAME)?.value ?? null;
  const payload = await verifySessionCookie(cookie);

  if (payload) {
    return makeResponse();
  }

  // Unauthenticated.
  if (pathname.startsWith('/api/dash/')) {
    return new NextResponse(
      JSON.stringify({ ok: false, error: 'unauthenticated' }),
      {
        status: 401,
        headers: {
          'content-type': 'application/json',
          'x-robots-tag': 'noindex, nofollow, noarchive, nosnippet',
        },
      },
    );
  }

  // Page route: pass through. The client-rendered DashAuthGate checks
  // /api/dash/session and presents the sign-in flow if not authed. This
  // is simpler than server-side redirect gymnastics and keeps the login
  // URL stable (no `?next=...` dance).
  return makeResponse();
}
