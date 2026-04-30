/**
 * POST /api/dash/login
 *
 * Body: { nonce: string, signature: `0x${string}` }
 *
 * Verifies the signature recovers to the authorized dev address, consumes
 * the nonce (single-use + 5min expiry), issues an HMAC-signed session cookie.
 *
 * Rate-limited: 10 attempts per IP per hour (via Postgres counter). When
 * the limit is hit, returns 429 and does NOT consume the nonce.
 */
import { verifyMessage } from 'viem';
import {
  ensureDashSchema,
  consumeNonce,
  countRecentLoginAttempts,
  recordLoginAttempt,
  logAction,
  rateLimitConfig,
  purgeOldLoginAttempts,
} from '@/lib/dashDb';
import { isDbConfigured } from '@/lib/duelDb';
import {
  DEFAULT_SESSION_MS,
  buildLoginMessage,
  buildSetCookieHeader,
  getAuthorizedDevAddress,
  signSessionCookie,
} from '@/lib/dashAuth';

export const runtime = 'nodejs';

function extractIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return '0.0.0.0';
}

export async function POST(req: Request) {
  const dev = getAuthorizedDevAddress();
  if (!dev) {
    return Response.json(
      { ok: false, error: 'NEXT_PUBLIC_HOUSE_KEEPER_ADDRESS not configured' },
      { status: 500 },
    );
  }
  if (!isDbConfigured()) {
    return Response.json({ ok: false, error: 'POSTGRES_URL not configured' }, { status: 503 });
  }
  if (typeof process.env.DASH_SESSION_SECRET !== 'string') {
    return Response.json({ ok: false, error: 'DASH_SESSION_SECRET not configured' }, { status: 503 });
  }

  const ip = extractIp(req);
  await ensureDashSchema();
  await purgeOldLoginAttempts().catch(() => {});

  const rate = rateLimitConfig();
  const attempts = await countRecentLoginAttempts(ip);
  if (attempts >= rate.maxPerWindow) {
    return Response.json(
      {
        ok: false,
        error: `Rate limited: ${rate.maxPerWindow}/${rate.windowHours}h`,
      },
      { status: 429 },
    );
  }
  await recordLoginAttempt(ip);

  let body: { nonce?: string; signature?: string };
  try {
    body = (await req.json()) as { nonce?: string; signature?: string };
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const { nonce, signature } = body;
  if (typeof nonce !== 'string' || !/^[0-9a-f]{32,96}$/.test(nonce)) {
    return Response.json({ ok: false, error: 'missing or invalid nonce' }, { status: 400 });
  }
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    return Response.json({ ok: false, error: 'missing or invalid signature' }, { status: 400 });
  }

  const consumed = await consumeNonce(nonce);
  if (!consumed.ok) {
    await logAction('dash:login:nonce-reject', { ip, reason: consumed.reason }, null);
    return Response.json({ ok: false, error: consumed.reason }, { status: 401 });
  }

  const message = buildLoginMessage(nonce, consumed.expiresAt);

  // viem's verifyMessage handles both EOA personal_sign and EIP-1271
  // smart-contract wallets — no need to recoverMessageAddress manually.
  let valid = false;
  try {
    valid = await verifyMessage({
      address: dev as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    await logAction('dash:login:verify-error', { ip, err }, null);
    return Response.json({ ok: false, error: 'signature verification failed' }, { status: 401 });
  }

  if (!valid) {
    await logAction('dash:login:reject', { ip }, null);
    return Response.json({ ok: false, error: 'signature does not match authorized dev wallet' }, { status: 401 });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const cookieValue = await signSessionCookie({
    v: 1,
    addr: dev,
    iat: nowSec,
    exp: nowSec + Math.floor(DEFAULT_SESSION_MS / 1000),
  });

  await logAction('dash:login:success', { ip, addr: dev }, dev);

  return new Response(
    JSON.stringify({ ok: true, addr: dev, expiresAt: new Date((nowSec + Math.floor(DEFAULT_SESSION_MS / 1000)) * 1000).toISOString() }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': buildSetCookieHeader(cookieValue, {
          maxAgeSeconds: Math.floor(DEFAULT_SESSION_MS / 1000),
        }),
      },
    },
  );
}
