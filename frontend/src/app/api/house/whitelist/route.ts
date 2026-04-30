/**
 * House fighter whitelist CRUD.
 *
 *   GET    /api/house/whitelist            — public (BrawlerCard reads this)
 *   POST   /api/house/whitelist { tokenId }  — dash-authed
 *   DELETE /api/house/whitelist?tokenId=N    — dash-authed
 *
 * Also triggers a fire-and-forget /api/house/sync after a mutation so the
 * new fighter gets resurrected/approved within seconds.
 *
 * Seeds the DB from NEXT_PUBLIC_HOUSE_BRAWLER_IDS on first access when the
 * table is empty, so this feature survives the env→DB migration without any
 * manual backfill.
 */
import { cookies } from 'next/headers';
import {
  ensureDashSchema,
  seedHouseWhitelistFromEnv,
  getHouseWhitelist,
  addToHouseWhitelist,
  removeFromHouseWhitelist,
  logAction,
} from '@/lib/dashDb';
import { isDbConfigured } from '@/lib/duelDb';
import { DASH_COOKIE_NAME, verifySessionCookie } from '@/lib/dashAuth';

export const runtime = 'nodejs';

async function assertDashAuth(): Promise<{ ok: true; addr: string } | { ok: false; status: number; error: string }> {
  const jar = await cookies();
  const cookie = jar.get(DASH_COOKIE_NAME);
  const payload = await verifySessionCookie(cookie?.value);
  if (!payload) {
    return { ok: false, status: 401, error: 'unauthenticated' };
  }
  return { ok: true, addr: payload.addr };
}

async function kickHouseSync() {
  // Fire-and-forget: the newly-added fighter gets approved/resurrected within
  // seconds of being whitelisted. Failure here is non-fatal.
  try {
    const url = new URL(
      '/api/house/sync',
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000',
    );
    void fetch(url.toString(), { method: 'POST' }).catch(() => {});
  } catch {
    /* ignore */
  }
}

async function listImpl() {
  if (!isDbConfigured()) {
    return Response.json({ ok: false, error: 'POSTGRES_URL not configured' }, { status: 503 });
  }
  await ensureDashSchema();
  const seeded = await seedHouseWhitelistFromEnv();
  const ids = await getHouseWhitelist();
  return Response.json({ ok: true, whitelist: ids, seeded });
}

export async function GET() {
  return listImpl();
}

export async function POST(req: Request) {
  if (!isDbConfigured()) {
    return Response.json({ ok: false, error: 'POSTGRES_URL not configured' }, { status: 503 });
  }
  const auth = await assertDashAuth();
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  await ensureDashSchema();
  let body: { tokenId?: number };
  try {
    body = (await req.json()) as { tokenId?: number };
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  const tokenId = Number(body.tokenId);
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > 10_000) {
    return Response.json({ ok: false, error: 'invalid tokenId' }, { status: 400 });
  }
  await addToHouseWhitelist(tokenId, auth.addr);
  await logAction('house:whitelist:add', { tokenId }, auth.addr);
  await kickHouseSync();
  const ids = await getHouseWhitelist();
  return Response.json({ ok: true, whitelist: ids });
}

export async function DELETE(req: Request) {
  if (!isDbConfigured()) {
    return Response.json({ ok: false, error: 'POSTGRES_URL not configured' }, { status: 503 });
  }
  const auth = await assertDashAuth();
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  await ensureDashSchema();
  const url = new URL(req.url);
  const tokenIdRaw = url.searchParams.get('tokenId');
  const tokenId = Number(tokenIdRaw);
  if (!Number.isInteger(tokenId) || tokenId < 1) {
    return Response.json({ ok: false, error: 'invalid tokenId' }, { status: 400 });
  }
  const removed = await removeFromHouseWhitelist(tokenId);
  await logAction('house:whitelist:remove', { tokenId, removed }, auth.addr);
  const ids = await getHouseWhitelist();
  return Response.json({ ok: true, whitelist: ids, removed });
}
