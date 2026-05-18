/**
 * Server-side helpers for the "house fighters" system.
 *
 * Any brawler owned by `HOUSE_KEEPER_ADDRESS` (an env-configured wallet)
 * is considered a permanent arena fixture. The keeper wallet:
 *   1. Has approved BRAWL → Duel for unlimited spending (checked + auto-set).
 *   2. Has each of its brawlers auto-resurrected the moment they die, so
 *      there's always a match ready for real players.
 *
 * This file exposes two entry points used by /api/house/sync:
 *   - `readHouseState()`, returns the list of keeper brawlers + their
 *     alive status + current BRAWL allowance.
 *   - `runHouseMaintenance()`, broadcasts the necessary resurrect +
 *     approval txs from the keeper wallet.
 *
 * Keys required:
 *   - `NEXT_PUBLIC_HOUSE_KEEPER_ADDRESS`, the house wallet's public address
 *     (shown in UI for the HOUSE badge, safe to inline into client bundle).
 *   - `HOUSE_KEEPER_PRIVATE_KEY`, server-only, never client-exposed. Must be
 *     set on Vercel as a non-NEXT_PUBLIC env var.
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  fallback,
  http,
  parseAbi,
  type Address,
} from 'viem';

// Server-side RPC pool. mainnet.base.org rate-limits aggressively (429s after
// a handful of eth_call hits within a minute), which silently broke
// /api/house/status — endpoint returned ok:false and the frontend rendered
// "0 fighters in roster" while on-chain reality was 10. publicnode +
// blockpi are way more generous; we keep the env-configured URL first
// (for chain consistency) and only fall back on rate-limit/timeout.
function basePool(chainId: number, primary: string): string[] {
  if (chainId === 8453) {
    return [
      primary,
      'https://base-rpc.publicnode.com',
      'https://base.blockpi.network/v1/rpc/public',
    ].filter((u, i, a) => a.indexOf(u) === i);
  }
  if (chainId === 84532) {
    return [
      primary,
      'https://base-sepolia-rpc.publicnode.com',
      'https://sepolia.base.org',
    ].filter((u, i, a) => a.indexOf(u) === i);
  }
  return [primary];
}
import { privateKeyToAccount } from 'viem/accounts';
import {
  ensureDashSchema,
  getHouseWhitelist,
  seedHouseWhitelistFromEnv,
} from './dashDb';
import { isDbConfigured } from './duelDb';
import { validateEnv } from './env';

const BRAWLERS_READ_ABI = parseAbi([
  'function nextTokenId() view returns (uint32)',
  'function kingMinted() view returns (bool)',
  'function KING_TOKEN_ID() view returns (uint32)',
  'function ownerOf(uint256) view returns (address)',
  'function isAlive(uint256) view returns (bool)',
]);

const GRAVEYARD_ABI = parseAbi([
  'function costFor(uint256 tokenId) view returns (uint256)',
  'function resurrect(uint256 tokenId) payable',
]);

const BRAWL_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
]);

const DUEL_ABI = parseAbi([
  'function fightCost() view returns (uint256)',
]);

export interface HouseStatus {
  keeperAddress: Address | null;
  hasPrivateKey: boolean;
  whitelist: number[];
  brawlAllowance: string | null;
  brawlBalance: string | null;
  fightCost: string | null;
  brawlers: Array<{
    tokenId: number;
    isAlive: boolean;
    resurrectCost: string | null;
    /** false if tokenId is not in the whitelist OR not owned by keeper */
    isHouse: boolean;
  }>;
}

/**
 * Resolve the active house whitelist. Prefers the DB-backed list; falls
 * back to the NEXT_PUBLIC_HOUSE_BRAWLER_IDS env var when the DB isn't
 * configured. Seeds the DB from env on first access when the table is
 * empty, so the env→DB migration is transparent.
 */
async function readHouseWhitelist(): Promise<Set<number>> {
  if (isDbConfigured()) {
    try {
      await ensureDashSchema();
      await seedHouseWhitelistFromEnv();
      const ids = await getHouseWhitelist();
      return new Set(ids);
    } catch {
      // Fall through to env var on DB error.
    }
  }
  const raw = process.env.NEXT_PUBLIC_HOUSE_BRAWLER_IDS;
  if (!raw) return new Set();
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map((s) => Number.parseInt(s, 10));
  return new Set(ids);
}

export interface MaintenanceResult {
  actions: Array<{
    type: 'approve-brawl' | 'resurrect';
    tokenId?: number;
    txHash: string;
    detail?: string;
  }>;
  errors: string[];
  skipped: string[];
}

function chain(chainId: number, rpc: string) {
  return defineChain({
    id: chainId,
    name: `Chain ${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
    testnet: chainId !== 1 && chainId !== 56 && chainId !== 8453,
  });
}

/// Local pull from validateEnv. Keeps the local return-shape while routing
/// through the central env validator so addresses are always canonical
/// EIP-55 checksum form (avoids viem strict-checksum throw on readContract).
function requireEnv() {
  const v = validateEnv();
  if (!v.ok) {
    throw new Error('Missing NEXT_PUBLIC_* contract env vars: ' + v.errors.join('; '));
  }
  return {
    rpcUrl: v.env.rpcUrl,
    chainId: v.env.chainId,
    brawlers: v.env.brawlersAddress,
    graveyard: v.env.graveyardAddress,
    brawl: v.env.brawlAddress,
    duel: v.env.duelAddress,
    duelRouter: v.env.duelRouterAddress,
  };
}

export async function readHouseState(): Promise<HouseStatus> {
  const env = requireEnv();
  // validateEnv normalises the keeper address to canonical EIP-55 checksum.
  const v = validateEnv();
  const keeperAddress: Address | null = v.ok ? v.env.houseKeeperAddress : null;
  const hasPrivateKey = typeof process.env.HOUSE_KEEPER_PRIVATE_KEY === 'string';
  const whitelist = await readHouseWhitelist();

  if (!keeperAddress) {
    return {
      keeperAddress: null,
      hasPrivateKey,
      whitelist: [...whitelist],
      brawlAllowance: null,
      brawlBalance: null,
      fightCost: null,
      brawlers: [],
    };
  }

  const client = createPublicClient({
    chain: chain(env.chainId, env.rpcUrl),
    transport: fallback(
      basePool(env.chainId, env.rpcUrl).map((u) =>
        http(u, { timeout: 5000, retryCount: 1 }),
      ),
      { rank: false },
    ),
  });

  const nextTokenIdRaw = await client.readContract({
    abi: BRAWLERS_READ_ABI,
    address: env.brawlers,
    functionName: 'nextTokenId',
  });
  const kingMintedRaw = await client.readContract({
    abi: BRAWLERS_READ_ABI,
    address: env.brawlers,
    functionName: 'kingMinted',
  });
  const nextTokenId = Number(nextTokenIdRaw);
  const kingMinted = kingMintedRaw === true;

  const tokenIds: number[] = [];
  for (let i = 1; i < nextTokenId; i++) tokenIds.push(i);
  if (kingMinted) tokenIds.push(501);

  // Batch ownerOf reads via Promise.all. For a 500-token ceiling this is
  // ~500 RPC calls on the cold cache. In practice most are cached by viem
  // after the first sync run; later calls only hit the chain for new tokens.
  const ownerChecks = await Promise.all(
    tokenIds.map(async (id) => {
      try {
        const owner = await client.readContract({
          abi: BRAWLERS_READ_ABI,
          address: env.brawlers,
          functionName: 'ownerOf',
          args: [BigInt(id)],
        });
        return { id, owner: owner as Address };
      } catch {
        return { id, owner: null };
      }
    }),
  );

  // A token is "house" only when it's BOTH owned by the keeper AND listed
  // in the whitelist. If the whitelist is empty, nothing is house, the
  // feature is effectively opt-in.
  const keeperTokens = ownerChecks.filter(
    (x) =>
      x.owner !== null &&
      (x.owner as string).toLowerCase() === keeperAddress.toLowerCase() &&
      whitelist.has(x.id),
  );

  const brawlers = await Promise.all(
    keeperTokens.map(async (t) => {
      const [isAlive, cost] = await Promise.all([
        client
          .readContract({
            abi: BRAWLERS_READ_ABI,
            address: env.brawlers,
            functionName: 'isAlive',
            args: [BigInt(t.id)],
          })
          .then((r) => r as boolean)
          .catch(() => true),
        client
          .readContract({
            abi: GRAVEYARD_ABI,
            address: env.graveyard,
            functionName: 'costFor',
            args: [BigInt(t.id)],
          })
          .then((r) => (r as bigint).toString())
          .catch(() => null),
      ]);
      return {
        tokenId: t.id,
        isAlive,
        resurrectCost: cost,
        isHouse: true,
      };
    }),
  );

  // When the DuelRouter is active the relevant BRAWL spender is the router,
  // not the Duel contract. Duel.fightCost is 0 in router mode. Fall back to
  // Duel only for pre-router (legacy testnet) deployments.
  const brawlSpender: Address = env.duelRouter ?? env.duel;
  const [allowance, balance, fightCost] = await Promise.all([
    client
      .readContract({
        abi: BRAWL_ABI,
        address: env.brawl,
        functionName: 'allowance',
        args: [keeperAddress, brawlSpender],
      })
      .then((r) => (r as bigint).toString()),
    client
      .readContract({
        abi: BRAWL_ABI,
        address: env.brawl,
        functionName: 'balanceOf',
        args: [keeperAddress],
      })
      .then((r) => (r as bigint).toString()),
    client
      .readContract({
        abi: DUEL_ABI,
        address: env.duel,
        functionName: 'fightCost',
      })
      .then((r) => (r as bigint).toString()),
  ]);

  return {
    keeperAddress,
    hasPrivateKey,
    whitelist: [...whitelist],
    brawlAllowance: allowance,
    brawlBalance: balance,
    fightCost,
    brawlers,
  };
}

export async function runHouseMaintenance(): Promise<MaintenanceResult> {
  const env = requireEnv();
  // Use validateEnv's canonical-checksummed keeper address.
  const v = validateEnv();
  const keeperAddress = v.ok ? v.env.houseKeeperAddress : null;
  const privRaw = process.env.HOUSE_KEEPER_PRIVATE_KEY;

  const result: MaintenanceResult = { actions: [], errors: [], skipped: [] };

  if (!keeperAddress) {
    result.errors.push('NEXT_PUBLIC_HOUSE_KEEPER_ADDRESS not configured');
    return result;
  }
  if (!privRaw) {
    result.errors.push('HOUSE_KEEPER_PRIVATE_KEY not configured (server-side)');
    return result;
  }
  const whitelist = await readHouseWhitelist();
  if (whitelist.size === 0) {
    result.skipped.push('house whitelist empty, add fighters from /dash or set NEXT_PUBLIC_HOUSE_BRAWLER_IDS');
    return result;
  }
  const pkey = privRaw.startsWith('0x') ? (privRaw as `0x${string}`) : (`0x${privRaw}` as `0x${string}`);
  const account = privateKeyToAccount(pkey);
  if (account.address.toLowerCase() !== keeperAddress.toLowerCase()) {
    result.errors.push(
      `HOUSE_KEEPER_PRIVATE_KEY address mismatch: derived ${account.address}, expected ${keeperAddress}`,
    );
    return result;
  }

  const chainDef = chain(env.chainId, env.rpcUrl);
  const rpcTransport = fallback(
    basePool(env.chainId, env.rpcUrl).map((u) =>
      http(u, { timeout: 5000, retryCount: 1 }),
    ),
    { rank: false },
  );
  const publicClient = createPublicClient({ chain: chainDef, transport: rpcTransport });
  const walletClient = createWalletClient({
    account,
    chain: chainDef,
    transport: rpcTransport,
  });

  // 1) Ensure the keeper has approved the Duel contract to spend BRAWL.
  try {
    const [allowance, fightCost] = await Promise.all([
      publicClient.readContract({
        abi: BRAWL_ABI,
        address: env.brawl,
        functionName: 'allowance',
        args: [account.address, env.duel],
      }),
      publicClient.readContract({
        abi: DUEL_ABI,
        address: env.duel,
        functionName: 'fightCost',
      }),
    ]);
    if ((allowance as bigint) < (fightCost as bigint) * 1000n) {
      // Approve max uint256 so we never need to top up.
      const maxUint = (1n << 256n) - 1n;
      const hash = await walletClient.writeContract({
        abi: BRAWL_ABI,
        address: env.brawl,
        functionName: 'approve',
        args: [env.duel, maxUint],
      });
      result.actions.push({ type: 'approve-brawl', txHash: hash });
    } else {
      result.skipped.push('BRAWL allowance already sufficient');
    }
  } catch (e) {
    result.errors.push(
      'approve-brawl failed: ' + (e instanceof Error ? e.message : String(e)),
    );
  }

  // 2) For each keeper-owned brawler, resurrect if dead.
  const status = await readHouseState();
  const dead = status.brawlers.filter((b) => !b.isAlive);
  if (dead.length === 0) {
    result.skipped.push('no dead house brawlers');
  }
  for (const b of dead) {
    try {
      const cost = b.resurrectCost ? BigInt(b.resurrectCost) : 0n;
      const hash = await walletClient.writeContract({
        abi: GRAVEYARD_ABI,
        address: env.graveyard,
        functionName: 'resurrect',
        args: [BigInt(b.tokenId)],
        value: cost,
      });
      result.actions.push({
        type: 'resurrect',
        tokenId: b.tokenId,
        txHash: hash,
        detail: `cost ${cost.toString()} wei`,
      });
    } catch (e) {
      result.errors.push(
        `resurrect ${b.tokenId} failed: ` +
          (e instanceof Error ? e.message : String(e)),
      );
    }
  }

  return result;
}
