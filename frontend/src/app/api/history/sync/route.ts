/**
 * POST /api/history/sync
 *
 * Walks the chain forward from `sync_state.last_block` to the current
 * head, writing any new DuelCompleted events into the `duel_events`
 * table. Chunks of 1000 blocks, capped at MAX_SYNC_CHUNKS per call so
 * the serverless function doesn't blow its timeout on a big catch-up.
 *
 * Throttled: if the last successful sync was less than STALE_SECONDS ago,
 * returns immediately without touching the chain. Clients can hit this
 * freely (e.g. on every /history page load) and it self-rate-limits.
 *
 * GET is also supported for Vercel Cron, which fires GET by default.
 */
import { createPublicClient, defineChain, http, parseAbiItem, type Log } from 'viem';
import {
  ensureSchema,
  getSyncState,
  isDbConfigured,
  setLastSyncedBlock,
  upsertDuelEvent,
} from '@/lib/duelDb';

export const runtime = 'nodejs';
// Vercel Hobby caps this at 10s; Pro 60s. 60s is plenty for ~10 chunks.
export const maxDuration = 60;

const DUEL_COMPLETED_EVENT = parseAbiItem(
  'event DuelCompleted(uint256 indexed tokenA, uint256 indexed tokenB, uint32 winnerId, uint16 rounds, uint256 seed, uint256 nonce, uint32 newEloA, uint32 newEloB)',
);

type DuelLog = Log<bigint, number, false, typeof DUEL_COMPLETED_EVENT>;

const CHUNK_BLOCKS = 1000n;
// Low enough to stay under Hobby's 10s serverless budget even with a couple
// RPC retries. Sync is idempotent, caller can invoke multiple times to
// catch up.
const MAX_SYNC_CHUNKS = 4;
const STALE_SECONDS = 8; // short throttle so consecutive page loads can catch up
// On first-ever run, backfill this far behind current head.
const INITIAL_BACKFILL_BLOCKS = 10_000n;
const MIN_CHUNK = 100n;
const CHUNK_DELAY_MS = 150;
const RPC_TIMEOUT_MS = 2500;
// Base Sepolia RPC fallback order. publicnode + sepolia.base.org are the
// most reliable. Used when chainId === 84532.
const BASE_SEPOLIA_RPC_POOL = [
  'https://base-sepolia-rpc.publicnode.com',
  'https://sepolia.base.org',
  // base-sepolia.public.blastapi.io was retired by Blast in 2026.
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function chain(chainId: number, rpc: string) {
  return defineChain({
    id: chainId,
    name: `Chain ${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
    testnet: chainId !== 1 && chainId !== 56 && chainId !== 8453,
  });
}

async function syncImpl(): Promise<Response> {
  if (!isDbConfigured()) {
    return Response.json(
      { ok: false, error: 'POSTGRES_URL not configured. Provision Vercel Postgres and redeploy.' },
      { status: 503 },
    );
  }

  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
  const chainIdStr = process.env.NEXT_PUBLIC_CHAIN_ID;
  const duelAddr = process.env.NEXT_PUBLIC_DUEL_ADDRESS;
  if (!rpcUrl || !chainIdStr || !duelAddr) {
    return Response.json({ ok: false, error: 'RPC/CHAIN/DUEL env missing' }, { status: 500 });
  }
  const chainId = Number.parseInt(chainIdStr, 10);

  await ensureSchema();

  const state = await getSyncState();
  const now = new Date();
  if (
    state.updatedAt &&
    (now.getTime() - state.updatedAt.getTime()) / 1000 < STALE_SECONDS
  ) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: 'throttled',
      lastBlock: state.lastBlock?.toString() ?? null,
      ageSec: Math.round((now.getTime() - state.updatedAt.getTime()) / 1000),
    });
  }

  // Build a client pool. For BSC testnet, prefer publicnode first (more
  // generous limits than Binance seeds). Env-configured RPC is kept as a
  // late fallback. For other chains, just use the env RPC.
  const rpcPool = chainId === 84532
    ? [...BASE_SEPOLIA_RPC_POOL, rpcUrl].filter((u, i, arr) => arr.indexOf(u) === i)
    : [rpcUrl];
  const clients = rpcPool.map((u) =>
    createPublicClient({
      chain: chain(chainId, u),
      transport: http(u, { timeout: RPC_TIMEOUT_MS }),
    }),
  );

  // Get the current head from whichever RPC answers first.
  let latest: bigint = 0n;
  for (const c of clients) {
    try {
      latest = await c.getBlockNumber();
      break;
    } catch {
      continue;
    }
  }
  if (latest === 0n) {
    return Response.json(
      { ok: false, error: 'All RPC endpoints failed on getBlockNumber' },
      { status: 502 },
    );
  }

  // Auto-reset stale cursor (cursor > head means a chain switch happened).
  const staleCursor = state.lastBlock !== null && state.lastBlock > latest;
  let from = staleCursor || state.lastBlock === null
    ? latest > INITIAL_BACKFILL_BLOCKS
      ? latest - INITIAL_BACKFILL_BLOCKS
      : 0n
    : state.lastBlock + 1n;
  if (staleCursor) {
    console.warn(
      `[history/sync] cursor ${state.lastBlock} > head ${latest}, resetting to ${from}`,
    );
  }

  let span = CHUNK_BLOCKS;
  let chunksRun = 0;
  let eventsInserted = 0;
  let rpcErrors = 0;

  while (from <= latest && chunksRun < MAX_SYNC_CHUNKS) {
    if (chunksRun > 0) await sleep(CHUNK_DELAY_MS);

    const to = from + span > latest ? latest : from + span - 1n;

    // Try each RPC in the pool until one answers without a rate limit.
    let logs: DuelLog[] | null = null;
    let lastErr: string | null = null;
    for (const c of clients) {
      try {
        logs = (await c.getLogs({
          address: duelAddr as `0x${string}`,
          event: DUEL_COMPLETED_EVENT,
          fromBlock: from,
          toBlock: to,
        })) as DuelLog[];
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        lastErr = msg;
        if (/limit|exceed|rate|too many|too large|timeout/i.test(msg)) {
          rpcErrors++;
          // Try next endpoint in the pool.
          continue;
        }
        // Non-rate-limit error from this endpoint, also try next.
        continue;
      }
    }

    if (logs === null) {
      // Every endpoint refused, halve span and retry from same `from`.
      if (span > MIN_CHUNK) {
        span = span / 2n < MIN_CHUNK ? MIN_CHUNK : span / 2n;
        await sleep(500);
        continue;
      }
      // Already at min chunk; save progress and bail.
      await setLastSyncedBlock(from === 0n ? 0n : from - 1n);
      return Response.json(
        {
          ok: false,
          error: `All RPCs rate-limited at min chunk: ${lastErr}`,
          chunksRun,
          eventsInserted,
          rpcErrors,
          stoppedAt: from.toString(),
        },
        { status: 502 },
      );
    }

    for (const log of logs) {
      if (log.transactionHash === null || log.blockNumber === null || log.logIndex === null) continue;
      const args = log.args;
      if (
        args.tokenA === undefined ||
        args.tokenB === undefined ||
        args.winnerId === undefined ||
        args.rounds === undefined ||
        args.seed === undefined ||
        args.nonce === undefined ||
        args.newEloA === undefined ||
        args.newEloB === undefined
      ) {
        continue;
      }
      await upsertDuelEvent({
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        tokenA: Number(args.tokenA),
        tokenB: Number(args.tokenB),
        winnerId: Number(args.winnerId),
        rounds: Number(args.rounds),
        seed: args.seed,
        nonce: args.nonce,
        newEloA: Number(args.newEloA),
        newEloB: Number(args.newEloB),
      });
      eventsInserted++;
    }

    // Drift span back toward CHUNK_BLOCKS on a success.
    if (span < CHUNK_BLOCKS) {
      span = span * 2n > CHUNK_BLOCKS ? CHUNK_BLOCKS : span * 2n;
    }

    const nextFrom = to + 1n;
    from = nextFrom;
    chunksRun++;
  }

  const finalLastBlock = from === 0n ? 0n : from - 1n;
  await setLastSyncedBlock(finalLastBlock);

  // Fire-and-forget: if any duels were processed and there's a house
  // keeper configured, kick off a house-maintenance run so dead house
  // brawlers come back to life within seconds of their loss.
  if (eventsInserted > 0 && typeof process.env.HOUSE_KEEPER_PRIVATE_KEY === 'string') {
    const syncUrl = new URL(
      '/api/house/sync',
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000',
    );
    void fetch(syncUrl.toString(), { method: 'POST' }).catch(() => {});
  }

  return Response.json({
    ok: true,
    synced: true,
    chunksRun,
    eventsInserted,
    rpcErrors,
    lastBlock: finalLastBlock.toString(),
    latestChainBlock: latest.toString(),
    fullyCaughtUp: finalLastBlock >= latest,
  });
}

export async function POST() {
  return syncImpl();
}

export async function GET() {
  return syncImpl();
}
