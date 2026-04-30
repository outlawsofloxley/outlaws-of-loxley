/**
 * Environment variable access. All public frontend env vars must be prefixed
 * with `NEXT_PUBLIC_` so Next.js inlines them at build time.
 *
 * Phase 7 extends the env with three new addresses (BRAWL, MintDrop, USDT)
 * used by the mint + duel flows.
 */

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

  const addressVars: [keyof typeof envRaw, string][] = [
    ['brawlersAddress', 'NEXT_PUBLIC_BRAWLERS_ADDRESS'],
    ['duelAddress', 'NEXT_PUBLIC_DUEL_ADDRESS'],
    ['graveyardAddress', 'NEXT_PUBLIC_GRAVEYARD_ADDRESS'],
    ['brawlAddress', 'NEXT_PUBLIC_BRAWL_ADDRESS'],
    ['mintDropAddress', 'NEXT_PUBLIC_MINTDROP_ADDRESS'],
    ['usdtAddress', 'NEXT_PUBLIC_USDT_ADDRESS'],
    ['usdcAddress', 'NEXT_PUBLIC_USDC_ADDRESS'],
    ['marketplaceAddress', 'NEXT_PUBLIC_MARKETPLACE_ADDRESS'],
  ];
  for (const [key, envName] of addressVars) {
    const value = envRaw[key];
    if (!value) {
      errors.push(`${envName} is not set`);
    } else if (!isHex40(value)) {
      errors.push(`${envName} is not a valid address: "${value}"`);
    }
  }

  const chainIdNum = envRaw.chainId ? Number.parseInt(envRaw.chainId, 10) : NaN;
  if (envRaw.chainId && (!Number.isInteger(chainIdNum) || chainIdNum <= 0)) {
    errors.push(`NEXT_PUBLIC_CHAIN_ID must be a positive integer, got "${envRaw.chainId}"`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Optional: house keeper address. Missing or invalid → null → UI skips
  // the HOUSE badge logic entirely.
  const houseKeeperAddress =
    envRaw.houseKeeperAddress && isHex40(envRaw.houseKeeperAddress)
      ? (envRaw.houseKeeperAddress as `0x${string}`)
      : null;

  // All checks passed, the non-null assertions are safe because we checked above.
  return {
    ok: true,
    env: {
      rpcUrl: envRaw.rpcUrl!,
      chainId: chainIdNum,
      brawlersAddress: envRaw.brawlersAddress as `0x${string}`,
      duelAddress: envRaw.duelAddress as `0x${string}`,
      graveyardAddress: envRaw.graveyardAddress as `0x${string}`,
      brawlAddress: envRaw.brawlAddress as `0x${string}`,
      mintDropAddress: envRaw.mintDropAddress as `0x${string}`,
      usdtAddress: envRaw.usdtAddress as `0x${string}`,
      usdcAddress: envRaw.usdcAddress as `0x${string}`,
      marketplaceAddress: envRaw.marketplaceAddress as `0x${string}`,
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
