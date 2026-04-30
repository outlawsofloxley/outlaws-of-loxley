'use client';

/**
 * useMarketListings, read active marketplace listings from the Postgres
 * cache (populated by /api/marketplace/sync).
 *
 * Same architecture as useDuelHistory: client hits /api/marketplace/listings
 * which returns DB rows and kicks off a fire-and-forget sync. No direct
 * eth_getLogs from the browser, no more RPC rate-limit surprises.
 */
import { useEffect, useState } from 'react';

export interface MarketListingRow {
  readonly tokenId: number;
  readonly seller: `0x${string}`;
  readonly price: bigint;
  readonly listedAt: number;
  readonly txHash: `0x${string}`;
  readonly blockNumber: bigint;
}

interface ApiRow {
  token_id: number;
  seller: string;
  price: string;
  listed_at: number;
  tx_hash: string;
  block_number: string;
}

function apiRowToListing(r: ApiRow): MarketListingRow {
  return {
    tokenId: r.token_id,
    seller: r.seller as `0x${string}`,
    price: BigInt(r.price),
    listedAt: r.listed_at,
    txHash: r.tx_hash as `0x${string}`,
    blockNumber: BigInt(r.block_number),
  };
}

export interface UseMarketListingsResult {
  readonly listings: readonly MarketListingRow[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
  readonly source: 'db' | null;
}

export function useMarketListings(): UseMarketListingsResult {
  const [listings, setListings] = useState<MarketListingRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [source, setSource] = useState<'db' | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/marketplace/listings?limit=500', {
          cache: 'no-store',
        });
        if (!res.ok) {
          throw new Error(`Listings API HTTP ${res.status}`);
        }
        const json = (await res.json()) as {
          ok: boolean;
          rows: ApiRow[];
          error?: string;
        };
        if (!json.ok) throw new Error(json.error ?? 'Listings API returned ok:false');
        if (cancelled) return;
        setListings(json.rows.map(apiRowToListing));
        setSource('db');
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
  }, [refreshKey]);

  return {
    listings,
    isLoading,
    error,
    refetch: () => setRefreshKey((k) => k + 1),
    source,
  };
}
