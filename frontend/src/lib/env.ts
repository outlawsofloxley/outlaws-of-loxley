/**
 * Environment variable access. All public frontend env vars must be prefixed
 * with `NEXT_PUBLIC_` so Next.js inlines them at build time.
 *
 * Every address coming back from validateEnv is normalised through viem's
 * getAddress() so it lands in canonical EIP-55 checksum form. viem's
 * readContract / getLogs APIs throw on wrong-case mixed-checksum addresses
 * even when the underlying RPC would accept them, so normalising once at
 * the env boundary stops that bug from biting any route that uses these
 * addresses downstream.
 */
import { getAddress } from 'viem';

// Raw reads, deliberately literal `process.env.FOO` references so Next.js
// inlines them at build time. Dynamic `process.env[name]` access does NOT
// get inlined, so we unroll the read here.
export const envRaw = {
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL,
  chainId: process.env.NEXT_PUBLIC_CHAIN_ID,
  brawlersAddress: process.env.NEXT_PUBLIC_BRAWLERS_ADDRESS,
  duelAddress: process.env.NEXT_PUBLIC_DUEL_ADDRESS,
  graveyardAddress: process.env.NEXT_PUBLIC_GRAVEYARD_ADDRESS,
  brawlAddress: process.env.NEXT_PUBLIC_BRAWL_ADDRESS,
  mintDropAddress: process.env.NEXT_PUBLIC_MINTDROP_ADDRESS,
  usdtAddress: process.env.NEXT_PUBLIC_USDT_ADDRESS,
  usdcAddress: process.env.NEXT_PUBLIC_USDC_ADDRESS,
  marketplaceAddress: process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS,
  houseKeeperAddress: process.env.NEXT_PUBLIC_HOUSE_KEEPER_ADDRESS,
} as const;

function isHex40(s: string): s is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(s);
}

/// Try to parse a raw env value into a canonical EIP-55 checksum address.
/// Returns null and pushes a structured error message on failure.
function tryNormaliseAddress(
  raw: string | undefined,
  envName: string,
  errors: string[],
): `0x${string}` | null {
  if (!raw) {
    errors.push(`${envName} is not set`);
    return null;
  }
  if (!isHex40(raw)) {
    errors.push(`${envName} is not a valid address: "${raw}"`);
    return null;
  }
  try {
    return getAddress(raw);
  } catch {
    errors.push(`${envName} could not be checksummed: "${raw}"`);
    return null;
  }
}

/** Result of validating env vars. */
export type EnvValidation =
  | {
      ok: true;
      env: {
        rpcUrl: string;
        chainId: number;
        brawlersAddress: `0x${string}`;
        duelAddress: `0x${string}`;
        graveyardAddress: `0x${string}`;
        brawlAddress: `0x${string}`;
        mintDropAddress: `0x${string}`;
        usdtAddress: `0x${string}`;
        usdcAddress: `0x${string}`;
        marketplaceAddress: `0x${string}`;
        /** Optional, when set, brawlers owned by this address are labeled "HOUSE" and auto-resurrected. */
        houseKeeperAddress: `0x${string}` | null;
      };
    }
  | { ok: false; errors: string[] };

/** Validate all required env vars. Returns structured results (no throw). */
export function validateEnv(): EnvValidation {
  const errors: string[] = [];

  if (!envRaw.rpcUrl) {
    errors.push('NEXT_PUBLIC_RPC_URL is not set');
  }
  if (!envRaw.chainId) {
    errors.push('NEXT_PUBLIC_CHAIN_ID is not set');
  }

  const brawlersAddress = tryNormaliseAddress(
    envRaw.brawlersAddress, 'NEXT_PUBLIC_BRAWLERS_ADDRESS', errors,
  );
  const duelAddress = tryNormaliseAddress(
    envRaw.duelAddress, 'NEXT_PUBLIC_DUEL_ADDRESS', errors,
  );
  const graveyardAddress = tryNormaliseAddress(
    envRaw.graveyardAddress, 'NEXT_PUBLIC_GRAVEYARD_ADDRESS', errors,
  );
  const brawlAddress = tryNormaliseAddress(
    envRaw.brawlAddress, 'NEXT_PUBLIC_BRAWL_ADDRESS', errors,
  );
  const mintDropAddress = tryNormaliseAddress(
    envRaw.mintDropAddress, 'NEXT_PUBLIC_MINTDROP_ADDRESS', errors,
  );
  const usdtAddress = tryNormaliseAddress(
    envRaw.usdtAddress, 'NEXT_PUBLIC_USDT_ADDRESS', errors,
  );
  const usdcAddress = tryNormaliseAddress(
    envRaw.usdcAddress, 'NEXT_PUBLIC_USDC_ADDRESS', errors,
  );
  const marketplaceAddress = tryNormaliseAddress(
    envRaw.marketplaceAddress, 'NEXT_PUBLIC_MARKETPLACE_ADDRESS', errors,
  );

  const chainIdNum = envRaw.chainId ? Number.parseInt(envRaw.chainId, 10) : NaN;
  if (envRaw.chainId && (!Number.isInteger(chainIdNum) || chainIdNum <= 0)) {
    errors.push(`NEXT_PUBLIC_CHAIN_ID must be a positive integer, got "${envRaw.chainId}"`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Optional: house keeper address. Missing or invalid will be silently
  // null so the UI just skips the HOUSE badge logic.
  let houseKeeperAddress: `0x${string}` | null = null;
  if (envRaw.houseKeeperAddress && isHex40(envRaw.houseKeeperAddress)) {
    try {
      houseKeeperAddress = getAddress(envRaw.houseKeeperAddress);
    } catch {
      houseKeeperAddress = null;
    }
  }

  // All required addresses passed normalisation, so the non-null assertions
  // are safe.
  return {
    ok: true,
    env: {
      rpcUrl: envRaw.rpcUrl!,
      chainId: chainIdNum,
      brawlersAddress: brawlersAddress!,
      duelAddress: duelAddress!,
      graveyardAddress: graveyardAddress!,
      brawlAddress: brawlAddress!,
      mintDropAddress: mintDropAddress!,
      usdtAddress: usdtAddress!,
      usdcAddress: usdcAddress!,
      marketplaceAddress: marketplaceAddress!,
      houseKeeperAddress,
    },
  };
}

/**
 * Get validated env or throw. Use only in contexts where missing env means
 * the app can't function (e.g. inside client hooks).
 */
export function requireEnv(): EnvValidation & { ok: true } {
  const v = validateEnv();
  if (!v.ok) {
    throw new Error(
      'Frontend env is incomplete:\n  - ' +
        v.errors.join('\n  - ') +
        '\n\nCopy frontend/.env.example to frontend/.env.local and fill in values.',
    );
  }
  return v;
}
