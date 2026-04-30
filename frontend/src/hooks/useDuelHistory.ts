'use client';

/**
 * useDuelHistory, fetch DuelCompleted events, DB-backed.
 *
 * Primary path: GET /api/history/query?tokenId=N. The Postgres cache is
 * populated by /api/history/sync which polls the chain in small chunks
 * (throttled to once every ~25s). Clients never touch the RPC directly
 * anymore, so no more "limit exceeded" on the public BSC endpoint.
 *
 * Fallback: if the API returns 503 (DB not configured yet), we fall back
 * to the old client-side getLogs loop. Keeps the app working during the
 * Postgres provisioning window.
 */
import { useEffect, useMemo, useState } from 'react';
import { usePublicClient } from 'wagmi';
import { parseAbiItem, type Log } from 'viem';
import { requireEnv } from '@/lib/env';

const DUEL_COMPLETED_EVENT = parseAbiItem(
  'event DuelCompleted(uint256 indexed tokenA, uint256 indexed tokenB, uint32 winnerId, uint16 rounds, uint256 seed, uint256 nonce, uint32 newEloA, uint32 newEloB)',
);

type DuelCompletedLog = Log<bigint, number, false, typeof DUEL_COMPLETED_EVENT>;

export interface DuelHistoryRow {
  readonly tokenA: number;
  readonly tokenB: number;
  readonly winnerId: number;
  readonly rounds: number;
  readonly newEloA: number;
  readonly newEloB: number;
  readonly seed: bigint;
  readonly nonce: bigint;
  readonly txHash: `0x${string}`;
  readonly blockNumber: bigint;
  readonly logIndex: number;
}

export interface UseDuelHistoryResult {
  readonly rows: readonly DuelHistoryRow[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
  readonly source: 'db' | 'chain' | null;
}

// Fallback-only constants (used when the DB API isn't available).
const CHUNK_BLOCKS = 1000n;
const MAX_LOOKBACK_BLOCKS = 100_000n;
const MAX_EVENTS = 500;
const MIN_CHUNK = 100n;

interface ApiRow {
  tx_hash: string;
  log_index: number;
  block_number: string;
  token_a: number;
  token_b: number;
  winner_id: number;
  rounds: number;
  seed: string;
  nonce: string;
  new_elo_a: number;
  new_elo_b: number;
}

function apiRowToHistoryRow(r: ApiRow): DuelHistoryRow {
  return {
    tokenA: r.token_a,
    tokenB: r.token_b,
    winnerId: r.winner_id,
    rounds: r.rounds,
    newEloA: r.new_elo_a,
    newEloB: r.new_elo_b,
    seed: BigInt(r.seed),
    nonce: BigInt(r.nonce),
    txHash: r.tx_hash as `0x${string}`,
    blockNumber: BigInt(r.block_number),
    logIndex: r.log_index,
  };
}

export function useDuelHistory(tokenId?: number): UseDuelHistoryResult {
  const { env } = requireEnv();
  const publicClient = usePublicClient({ chainId: env.chainId });
  const [rows, setRows] = useState<DuelHistoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [source, setSource] = useState<'db' | 'chain' | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const filterTokenId = useMemo(
    () =>
      typeof tokenId === 'number' && Number.isInteger(tokenId) && tokenId > 0
        ? BigInt(tokenId)
        : null,
    [tokenId],
  );

  useEffect(() => {
    let cancelled = false;

    async function runDb(): Promise<boolean> {
      const params = new URLSearchParams();
      if (typeof tokenId === 'number' && Number.isInteger(tokenId) && tokenId > 0) {
        params.set('tokenId', String(tokenId));
      }
      params.set('limit', '500');
      const res = await fetch(`/api/history/query?${params.toString()}`, { cache: 'no-store' });
      if (res.status === 503) {
        // Not configured yet, caller should fall back to chain.
        return false;
      }
      if (!res.ok) {
        throw new Error(`History API HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        ok: boolean;
        rows: ApiRow[];
        error?: string;
      };
      if (!json.ok) throw new Error(json.error ?? 'History API returned ok:false');
      if (cancelled) return true;
      setRows(json.rows.map(apiRowToHistoryRow));
      setSource('db');
      return true;
    }

    async function runChainFallback(): Promise<void> {
      if (!publicClient) return;
      const latest = await publicClient.getBlockNumber();
      const earliest =
        latest > MAX_LOOKBACK_BLOCKS ? latest - MAX_LOOKBACK_BLOCKS : 0n;
      const all: DuelHistoryRow[] = [];
      const seenKeys = new Set<string>();
      let to = latest;
      let span = CHUNK_BLOCKS;
      while (to >= earliest && all.length < MAX_EVENTS) {
        if (cancelled) return;
        const from = to > span ? to - span : 0n;
        let logs: DuelCompletedLog[] | null = null;
        try {
          logs = (await publicClient.getLogs({
            address: env.duelAddress,
            event: DUEL_COMPLETED_EVENT,
            fromBlock: from,
            toBlock: to,
          })) as DuelCompletedLog[];
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/limit|exceed|rate|too many|too large/i.test(msg) && span > MIN_CHUNK) {
            span = span / 2n < MIN_CHUNK ? MIN_CHUNK : span / 2n;
            continue;
          }
          throw err;
        }
        for (const log of logs) {
          if (log.transactionHash === null || log.blockNumber === null || log.logIndex === null) continue;
          const key = `${log.transactionHash}-${log.logIndex}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
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
          const tokenA = Number(args.tokenA);
          const tokenB = Number(args.tokenB);
          if (filterTokenId !== null) {
            if (BigInt(tokenA) !== filterTokenId && BigInt(tokenB) !== filterTokenId) continue;
          }
          all.push({
            tokenA,
            tokenB,
            winnerId: Number(args.winnerId),
            rounds: Number(args.rounds),
            seed: args.seed,
            nonce: args.nonce,
            newEloA: Number(args.newEloA),
            newEloB: Number(args.newEloB),
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
          });
        }
        if (span < CHUNK_BLOCKS) {
          span = span * 2n > CHUNK_BLOCKS ? CHUNK_BLOCKS : span * 2n;
        }
        if (from === 0n) break;
        to = from - 1n;
      }
      all.sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) return a.blockNumber > b.blockNumber ? -1 : 1;
        return b.logIndex - a.logIndex;
      });
      if (!cancelled) {
        setRows(all);
        setSource('chain');
      }
    }

    async function run() {
      setIsLoading(true);
      setError(null);
      try {
        const dbOk = await runDb();
        if (!dbOk) await runChainFallback();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenId, refreshKey, publicClient, env.duelAddress]);

  return {
    rows,
    isLoading,
    error,
    refetch: () => setRefreshKey((k) => k + 1),
    source,
  };
}
