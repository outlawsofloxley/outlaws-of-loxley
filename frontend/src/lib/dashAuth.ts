/**
 * Dashboard session cookie helpers.
 *
 * Security model:
 *   - User signs an EIP-191 personal_sign message that includes a one-time
 *     nonce + expiry. Server verifies recovered address == authorized dev
 *     wallet (NEXT_PUBLIC_HOUSE_KEEPER_ADDRESS).
 *   - On success, server issues an HMAC-SHA256 signed cookie with:
 *         payload.v = 1
 *         payload.addr (lowercased dev address)
 *         payload.iat (issued at, seconds)
 *         payload.exp (expiry, seconds, default 24h)
 *     Cookie value = base64url(JSON.stringify(payload)) + "." + base64url(hmac)
 *   - Cookie is set HttpOnly + SameSite=Lax + Secure (in production).
 *   - Middleware + API routes verify via `verifySessionCookie` before serving
 *     any /dash or /api/dash/* response.
 *
 * Uses Web Crypto API (crypto.subtle) so the same module runs in both the
 * Next.js middleware edge runtime AND the Node.js API routes.
 */

export const DASH_COOKIE_NAME = 'brawlers_dash_session';
export const DEFAULT_SESSION_MS = 24 * 60 * 60 * 1000; // 24h
export const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const NONCE_BYTES = 24;

export interface DashSessionPayload {
  v: 1;
  addr: string;
  iat: number;
  exp: number;
}

function base64urlEncode(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    str += String.fromCharCode(byte);
  }
  // btoa exists in both modern Node (>=16) and the Edge Runtime.
  const b64 = btoa(str);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlEncodeString(s: string): string {
  const enc = new TextEncoder().encode(s);
  return base64urlEncode(enc);
}

function base64urlDecodeToString(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice(0, (4 - (s.length % 4)) % 4);
  return atob(padded);
}

function base64urlDecodeToBytes(s: string): Uint8Array {
  const bin = base64urlDecodeToString(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function getSecret(): string | null {
  const raw = process.env.DASH_SESSION_SECRET;
  if (typeof raw !== 'string' || raw.length < 32) return null;
  return raw;
}

async function hmacSha256(keyString: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(keyString),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

/** Constant-time byte compare, defeats timing leaks in signature checks. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    diff |= av ^ bv;
  }
  return diff === 0;
}

/** Issue a signed session cookie value. */
export async function signSessionCookie(
  payload: DashSessionPayload,
): Promise<string> {
  const secret = getSecret();
  if (!secret) {
    throw new Error('DASH_SESSION_SECRET not configured');
  }
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64urlEncodeString(payloadJson);
  const sig = await hmacSha256(secret, payloadB64);
  const sigB64 = base64urlEncode(sig);
  return `${payloadB64}.${sigB64}`;
}

/** Returns the parsed+verified payload, or null if invalid/expired. */
export async function verifySessionCookie(
  value: string | null | undefined,
): Promise<DashSessionPayload | null> {
  if (!value) return null;
  const secret = getSecret();
  if (!secret) return null;
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const payloadB64 = parts[0];
  const sigB64 = parts[1];
  if (!payloadB64 || !sigB64) return null;
  let expectedSig: Uint8Array;
  try {
    expectedSig = await hmacSha256(secret, payloadB64);
  } catch {
    return null;
  }
  let providedSig: Uint8Array;
  try {
    providedSig = base64urlDecodeToBytes(sigB64);
  } catch {
    return null;
  }
  if (!timingSafeEqual(expectedSig, providedSig)) return null;
  let payload: DashSessionPayload;
  try {
    const json = base64urlDecodeToString(payloadB64);
    const parsed = JSON.parse(json) as DashSessionPayload;
    if (parsed.v !== 1) return null;
    if (typeof parsed.addr !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(parsed.addr)) return null;
    if (typeof parsed.iat !== 'number' || typeof parsed.exp !== 'number') return null;
    payload = parsed;
  } catch {
    return null;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowSec) return null;
  return payload;
}

/** The address we'll compare the recovered-from-signature address against. */
// Hard-coded dev wallet for the BASEic Brawlers mainnet deploy. Burned in
// 2026-05-18 after Vercel env-var inlining failed to pick up
// NEXT_PUBLIC_DEV_WALLET cleanly. Edit the constant + redeploy if rotating.
const DASH_DEV_WALLET = '0x5b1A749cc7bF1dE8ecA505769BD34Ba65f456805';

export function getAuthorizedDevAddress(): string | null {
  // Priority: env override → hard-coded mainnet dev wallet → legacy
  // HOUSE_KEEPER fallback (testnet / pre-launch compat).
  const raw =
    process.env.NEXT_PUBLIC_DEV_WALLET ||
    DASH_DEV_WALLET ||
    process.env.NEXT_PUBLIC_HOUSE_KEEPER_ADDRESS;
  if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) return null;
  return raw.toLowerCase();
}

/** Build the exact message the client must sign for login. Must match server-side. */
export function buildLoginMessage(nonce: string, expiresAt: Date): string {
  // Use unix-seconds (not ISO) so the client↔server message is identical
  // even after Postgres microsecond precision round-trips.
  const expSec = Math.floor(expiresAt.getTime() / 1000);
  return [
    'Brawlers dev dashboard access',
    '',
    `Nonce: ${nonce}`,
    `Expires (unix): ${expSec}`,
    '',
    'Signing this message logs you into the /dash dev dashboard.',
    'It does not authorize any blockchain transaction or spend any funds.',
  ].join('\n');
}

/** Generate a random hex-encoded nonce using Web Crypto. */
export function generateNonce(): string {
  const bytes = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Build the Set-Cookie header value for the session cookie.
 * `secure` defaults to true in production.
 */
export function buildSetCookieHeader(
  value: string,
  opts: { maxAgeSeconds: number; secure?: boolean } = { maxAgeSeconds: 0 },
): string {
  const secure = opts.secure ?? process.env.NODE_ENV === 'production';
  const parts = [
    `${DASH_COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(opts.maxAgeSeconds))}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearCookieHeader(): string {
  const secure = process.env.NODE_ENV === 'production';
  const parts = [
    `${DASH_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
