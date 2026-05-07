'use client';

/**
 * useBrawlerRanks — fetch the full rank table once and provide per-token
 * lookups. Caches in-process so repeated <BrawlerCard> renders don't each
 * fetch.
 */
import { useEffect, useState } from 'react';

export interface RankRow {
  tokenId: number;
  rank: number;
  rankOf: number;
  score: number;
  rarity: string;
  weapon: string;
}

let CACHE: { at: number; rows: RankRow[] } | null = null;
const TTL_MS = 5 * 60 * 1000;

export function useBrawlerRanks(): {
  rankFor: (tokenId: number) => RankRow | null;
  rows: RankRow[];
  loading: boolean;
} {
  const [rows, setRows] = useState<RankRow[]>(CACHE?.rows ?? []);
  const [loading, setLoading] = useState(!CACHE);

  useEffect(() => {
    if (CACHE && Date.now() - CACHE.at < TTL_MS) return;
    let cancelled = false;
    fetch('/api/rank')
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.ok) {
          CACHE = { at: Date.now(), rows: j.ranks };
          setRows(j.ranks);
        }
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const map = new Map<number, RankRow>();
  for (const r of rows) map.set(r.tokenId, r);

  return {
    rows,
    loading,
    rankFor: (tokenId: number) => map.get(tokenId) ?? null,
  };
}
