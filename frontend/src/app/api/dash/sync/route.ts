/**
 * POST/GET /api/dash/sync
 *
 * Walks the chain forward from the last dash-sync cursor to the current head,
 * capturing event streams that aren't already covered by history/sync +
 * marketplace/sync:
 *
 *   - MintDrop.BrawlerSold        → mint_events
 *   - Graveyard.Resurrected       → resurrect_events
 *   - Marketplace.Sold            → market_sales (with price + fee)
 *
 * Same RPC rotation / throttle / chunking pattern as history/sync for
 * BSC Testnet public-RPC friendliness. Idempotent via (tx_hash, log_index)
 * primary keys.
 *
 * Gated by the dash session cookie (checked via middleware on /api/dash/*).
 */
import { createPublicClient, defineChain, http, parseAbiItem, type Log } from 'viem';
import { isDbConfigured } from '@/lib/duelDb';
import {
  ensureDashSchema,
  getDashSyncState,
  setDashSyncState,
  upsertMintEvent,
  upsertResurrectEvent,
  upsertMarketSale,
} from '@/lib/dashDb';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BRAWLER_SOLD_EVENT = parseAbiItem(
  'event BrawlerSold(address indexed buyer, uint256 indexed tokenId, uint8 paymentType, uint256 amountPaid, uint256 airdropped)',
);
const RESURRECTED_EVENT = parseAbiItem(
  'event Resurrected(uint256 indexed tokenId, address indexed by, uint256 paid)',
);
const SOLD_EVENT = parseAbiItem(
  'event Sold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price, uint256 fee)',
);

type SoldLog = Log<bigint, number, false, typeof BRAWLER_SOLD_EVENT>;
type ResLog = Log<bigint, number, false, typeof RESURRECTED_EVENT>;
type MarketSoldLog = Log<bigint, number, false, typeof SOLD_EVENT>;

const CHUNK_BLOCKS = 1000n;
const MAX_SYNC_CHUNKS = 4;
const STALE_SECONDS = 8;
const INITIAL_BACKFILL_BLOCKS = 10_000n;
const MIN_CHUNK = 100n;
const CHUNK_DELAY_MS = 150;
const RPC_TIMEOUT_MS = 2500;
const BASE_SEPOLIA_RPC_POOL = [
  'https://base-sepolia-rpc.publicnode.com',
  'https://sepolia.base.org',
  'https://base-sepolia.public.blastapi.io',
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
    return Response.json({ ok: false, error: 'POSTGRES_URL not configured' }, { status: 503 });
  }

  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
  const chainIdStr = process.env.NEXT_PUBLIC_CHAIN_ID;
  const mintDrop = process.env.NEXT_PUBLIC_MINTDROP_ADDRESS;
  const graveyard = process.env.NEXT_PUBLIC_GRAVEYARD_ADDRESS;
  const market = process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS;
  if (!rpcUrl || !chainIdStr || !mintDrop || !graveyard || !market) {
    return Response.json({ ok: false, error: 'missing env' }, { status: 500 });
  }
  const chainId = Number.parseInt(chainIdStr, 10);

  await ensureDashSchema();

  const state = await getDashSyncState('events_last_block');
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
    });
  }

  const rpcPool = chainId === 84532
    ? [...BASE_SEPOLIA_RPC_POOL, rpcUrl].filter((u, i, arr) => arr.indexOf(u) === i)
    : [rpcUrl];
  const clients = rpcPool.map((u) =>
    createPublicClient({
      chain: chain(chainId, u),
      transport: http(u, { timeout: RPC_TIMEOUT_MS }),
    }),
  );

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
    return Response.json({ ok: false, error: 'All RPCs failed' }, { status: 502 });
  }

  // Auto-reset cursor if it's ahead of the current chain head, happens
  // after switching chains (e.g. BSC → Base Sepolia) where the old cursor
  // is at a block number larger than the new chain has produced. Without
  // this, sync silently no-ops forever.
  const staleCursor = state.lastBlock !== null && state.lastBlock > latest;
  let from = staleCursor || state.lastBlock === null
    ? latest > INITIAL_BACKFILL_BLOCKS
      ? latest - INITIAL_BACKFILL_BLOCKS
      : 0n
    : state.lastBlock + 1n;
  if (staleCursor) {
    console.warn(
      `[dash/sync] cursor ${state.lastBlock} > head ${latest}, resetting to ${from} (chain switched?)`,
    );
  }

  let span = CHUNK_BLOCKS;
  let chunksRun = 0;
  let mintInserted = 0;
  let resurrectInserted = 0;
  let saleInserted = 0;

  while (from <= latest && chunksRun < MAX_SYNC_CHUNKS) {
    if (chunksRun > 0) await sleep(CHUNK_DELAY_MS);
    const to = from + span > latest ? latest : from + span - 1n;

    let gotLogs: {
      mints: SoldLog[];
      resurrections: ResLog[];
      sales: MarketSoldLog[];
    } | null = null;

    for (const c of clients) {
      try {
        const [mints, resurrections, sales] = await Promise.all([
          c.getLogs({
            address: mintDrop as `0x${string}`,
            event: BRAWLER_SOLD_EVENT,
            fromBlock: from,
            toBlock: to,
          }) as Promise<SoldLog[]>,
          c.getLogs({
            address: graveyard as `0x${string}`,
            event: RESURRECTED_EVENT,
            fromBlock: from,
            toBlock: to,
          }) as Promise<ResLog[]>,
          c.getLogs({
            address: market as `0x${string}`,
            event: SOLD_EVENT,
            fromBlock: from,
            toBlock: to,
          }) as Promise<MarketSoldLog[]>,
        ]);
        gotLogs = { mints, resurrections, sales };
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/limit|exceed|rate|too many|too large|timeout/i.test(msg)) continue;
        continue;
      }
    }

    if (gotLogs === null) {
      if (span > MIN_CHUNK) {
        span = span / 2n < MIN_CHUNK ? MIN_CHUNK : span / 2n;
        await sleep(500);
        continue;
      }
      await setDashSyncState('events_last_block', from === 0n ? 0n : from - 1n);
      return Response.json(
        { ok: false, error: 'All RPCs rate-limited at min chunk', chunksRun, stoppedAt: from.toString() },
        { status: 502 },
      );
    }

    for (const log of gotLogs.mints) {
      if (log.blockNumber === null || log.logIndex === null || !log.transactionHash) continue;
      const { buyer, tokenId, paymentType, amountPaid, airdropped } = log.args;
      if (
        buyer === undefined ||
        tokenId === undefined ||
        paymentType === undefined ||
        amountPaid === undefined ||
        airdropped === undefined
      ) continue;
      await upsertMintEvent({
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        tokenId: Number(tokenId),
        buyer,
        paymentType: Number(paymentType),
        amountPaid,
        airdropped,
      });
      mintInserted++;
    }

    for (const log of gotLogs.resurrections) {
      if (log.blockNumber === null || log.logIndex === null || !log.transactionHash) continue;
      const { tokenId, by, paid } = log.args;
      if (tokenId === undefined || by === undefined || paid === undefined) continue;
      await upsertResurrectEvent({
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        tokenId: Number(tokenId),
        byAddr: by,
        paid,
      });
      resurrectInserted++;
    }

    for (const log of gotLogs.sales) {
      if (log.blockNumber === null || log.logIndex === null || !log.transactionHash) continue;
      const { tokenId, seller, buyer, price, fee } = log.args;
      if (tokenId === undefined || seller === undefined || buyer === undefined || price === undefined || fee === undefined) continue;
      await upsertMarketSale({
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        tokenId: Number(tokenId),
        seller,
        buyer,
        price,
        fee,
      });
      saleInserted++;
    }

    if (span < CHUNK_BLOCKS) {
      span = span * 2n > CHUNK_BLOCKS ? CHUNK_BLOCKS : span * 2n;
    }

    from = to + 1n;
    chunksRun++;
  }

  const finalLastBlock = from === 0n ? 0n : from - 1n;
  await setDashSyncState('events_last_block', finalLastBlock);

  return Response.json({
    ok: true,
    synced: true,
    chunksRun,
    mintInserted,
    resurrectInserted,
    saleInserted,
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
