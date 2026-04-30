/**
 * POST /api/profile/name
 *
 * Set a display name for a wallet. The user signs the message
 *   "BASEic Brawlers handle: <name>"
 * with their wallet, and the server recovers the address from the signature
 * to bind name → wallet. No auth required, the signature IS the auth.
 *
 * Body: { name: string, signature: 0x... }
 * Returns: { ok, address, name } on success.
 */
import { verifyMessage, isAddress } from 'viem';
import { ensureDashSchema, setWalletName, getWalletNames } from '@/lib/dashDb';
import { isDbConfigured } from '@/lib/duelDb';

export const runtime = 'nodejs';

const MIN_LEN = 2;
const MAX_LEN = 24;
// Letters, digits, underscore, period, hyphen, space. No emoji, no exotic
// unicode (avoids spoofing tricks like U+200B).
const NAME_RE = /^[A-Za-z0-9 _.\-]+$/;

const RESERVED_LOWER = new Set([
  'admin',
  'mod',
  'moderator',
  'dev',
  'team',
  'staff',
  'official',
  'support',
  'system',
  'baseic',
  'brawlers',
  'baseicbrawlers',
  'king',
  'kingbrawler',
  'kingbrawlers',
  'thekingbrawler',
  'undefined',
  'null',
  '0x0',
]);

function buildMessage(name: string): string {
  return `BASEic Brawlers handle: ${name}`;
}

export async function POST(req: Request): Promise<Response> {
  if (!isDbConfigured()) {
    return Response.json({ ok: false, error: 'db not configured' }, { status: 503 });
  }
  let body: { name?: unknown; signature?: unknown };
  try {
    body = (await req.json()) as { name?: unknown; signature?: unknown };
  } catch {
    return Response.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const rawName = typeof body.name === 'string' ? body.name.trim() : '';
  const sig = typeof body.signature === 'string' ? body.signature : '';
  if (rawName.length < MIN_LEN || rawName.length > MAX_LEN) {
    return Response.json(
      { ok: false, error: `name must be ${MIN_LEN}–${MAX_LEN} chars` },
      { status: 400 },
    );
  }
  if (!NAME_RE.test(rawName)) {
    return Response.json(
      { ok: false, error: 'name may only contain letters, digits, space, _ . -' },
      { status: 400 },
    );
  }
  if (RESERVED_LOWER.has(rawName.toLowerCase().replace(/\s+/g, ''))) {
    return Response.json({ ok: false, error: 'name is reserved' }, { status: 400 });
  }
  if (!sig.startsWith('0x') || sig.length !== 132) {
    return Response.json({ ok: false, error: 'invalid signature' }, { status: 400 });
  }

  const message = buildMessage(rawName);
  // verifyMessage returns the recovered signer (it does it under the hood
  // via personal_sign hashing). We DO need the address, viem's helper
  // returns boolean; switch to viem's recoverMessageAddress instead.
  const { recoverMessageAddress } = await import('viem');
  let recovered: string;
  try {
    recovered = await recoverMessageAddress({ message, signature: sig as `0x${string}` });
  } catch {
    return Response.json({ ok: false, error: 'signature recovery failed' }, { status: 400 });
  }
  if (!isAddress(recovered)) {
    return Response.json({ ok: false, error: 'invalid recovered address' }, { status: 400 });
  }
  // Sanity: the verifyMessage must round-trip too (defends against odd
  // signature shapes).
  const ok = await verifyMessage({
    address: recovered as `0x${string}`,
    message,
    signature: sig as `0x${string}`,
  });
  if (!ok) {
    return Response.json({ ok: false, error: 'signature verify failed' }, { status: 400 });
  }

  await ensureDashSchema();

  // Reject if name already taken by a different wallet.
  const existing = await getWalletNames([recovered]);
  // Use a quick lookup against the unique-lower index by attempting set.
  // Postgres unique violation surfaces here; map to a friendly error.
  try {
    await setWalletName(recovered, rawName);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return Response.json({ ok: false, error: 'name already taken' }, { status: 409 });
    }
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }

  return Response.json({ ok: true, address: recovered, name: rawName, prev: existing[recovered.toLowerCase()] ?? null });
}
