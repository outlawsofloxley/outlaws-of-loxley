/**
 * GET /api/dash/nonce, issue a single-use login nonce.
 *
 * The client then has the user sign a message containing the nonce + expiry
 * and posts the signature to /api/dash/login. Server verifies signature,
 * consumes the nonce, and issues a session cookie.
 */
import {
  ensureDashSchema,
  createNonce,
  purgeExpiredNonces,
} from '@/lib/dashDb';
import { isDbConfigured } from '@/lib/duelDb';
import {
  NONCE_TTL_MS,
  buildLoginMessage,
  generateNonce,
  getAuthorizedDevAddress,
} from '@/lib/dashAuth';

export const runtime = 'nodejs';

export async function GET() {
  const dev = getAuthorizedDevAddress();
  if (!dev) {
    return Response.json(
      { ok: false, error: 'NEXT_PUBLIC_HOUSE_KEEPER_ADDRESS not configured' },
      { status: 500 },
    );
  }
  if (!isDbConfigured()) {
    return Response.json(
      { ok: false, error: 'POSTGRES_URL not configured' },
      { status: 503 },
    );
  }
  if (typeof process.env.DASH_SESSION_SECRET !== 'string') {
    return Response.json(
      { ok: false, error: 'DASH_SESSION_SECRET not configured' },
      { status: 503 },
    );
  }

  await ensureDashSchema();
  // Housekeeping, cheap, keeps the table small.
  await purgeExpiredNonces().catch(() => {});

  const nonce = generateNonce();
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
  await createNonce(nonce, expiresAt);

  const message = buildLoginMessage(nonce, expiresAt);

  return Response.json({
    ok: true,
    nonce,
    expiresAt: expiresAt.toISOString(),
    message,
    devAddress: dev,
  });
}
