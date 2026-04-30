/**
 * GET /api/profile/names?addrs=0x...,0x...
 *
 * Bulk lookup of wallet display names. Used by the frontend to resolve
 * owner addresses → names on /browse, /brawler/[id], /owner/[address],
 * etc. Returns { names: { "0xabc...": "Alice", ... } }, only addresses
 * that have a name set are present.
 */
import { ensureDashSchema, getWalletNames } from '@/lib/dashDb';
import { isDbConfigured } from '@/lib/duelDb';

export const runtime = 'nodejs';

const MAX_ADDRS = 200;

export async function GET(req: Request): Promise<Response> {
  if (!isDbConfigured()) {
    return Response.json({ ok: false, error: 'db not configured' }, { status: 503 });
  }
  const url = new URL(req.url);
  const raw = url.searchParams.get('addrs') ?? '';
  if (!raw) return Response.json({ ok: true, names: {} });
  const addrs = raw
    .split(',')
    .map((a) => a.trim())
    .filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a))
    .slice(0, MAX_ADDRS);
  if (addrs.length === 0) return Response.json({ ok: true, names: {} });
  await ensureDashSchema();
  const names = await getWalletNames(addrs);
  return Response.json({ ok: true, names });
}
