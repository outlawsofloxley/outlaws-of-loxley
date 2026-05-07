'use client';

/**
 * /ranks — full rarity-rank table for the collection. Paginated, 20/page
 * default, up to 100/page on user request. Server-side slice for bandwidth.
 *
 * Rank 1 = rarest. Score is the empirical trait-rarity sum across all
 * minted brawlers. Different from Duel Rating — this is how rare the
 * brawler IS, not how good it fights.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PixelAvatar } from '@/components/PixelAvatar';
import { Pager } from '@/components/Pager';
import { rarityTextClass } from '@/lib/rarity';

interface RankRow {
  tokenId: number;
  rank: number;
  rankOf: number;
  score: number;
  rarity: string;
  weapon: string;
}

export default function RanksPage() {
  const [rows, setRows] = useState<RankRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/rank?page=${page}&limit=${pageSize}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.ok) {
          setRows(j.ranks);
          setTotal(j.total);
          setCachedAt(j.cachedAt);
        } else {
          setError(j.error ?? 'failed to load');
        }
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message ?? 'fetch error');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [page, pageSize]);

  return (
    <main className="min-h-screen bg-brawl-bg text-brawl-text">
      <div className="mx-auto max-w-4xl px-4 py-10">
        <div className="mb-8 border-b-2 border-brawl-orange pb-4">
          <h1 className="brawl-header text-3xl text-brawl-orange tracking-wider">
            🏆 RARITY RANK
          </h1>
          <p className="text-base text-brawl-text-dim mt-3 leading-relaxed">
            Rank 1 = rarest. Score combines tier, weapon, and stat-distribution
            rarity across the whole minted set. Different from your duel{' '}
            <span className="text-brawl-cyan font-semibold">Rating</span> — this
            is how rare the brawler <em>is</em>, not how good it fights.
          </p>
          {cachedAt && (
            <p className="text-sm text-brawl-text-dim mt-2">
              Last computed {new Date(cachedAt).toLocaleString()} · refreshes every 5 min
            </p>
          )}
          <p className="text-sm text-brawl-yellow mt-2">
            ⚠ Rank may shift as more brawlers mint. Locks once the 2,000 drop completes.
          </p>
        </div>

        <Pager
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />

        {loading && <p className="text-brawl-text-dim text-base py-4">Loading…</p>}
        {error && <p className="text-brawl-red text-base py-4">Error: {error}</p>}

        {!loading && !error && (
          <div className="space-y-2">
            {rows.map((row) => (
              <Link
                key={row.tokenId}
                href={`/brawler/${row.tokenId}`}
                className="flex items-center gap-4 rounded border border-brawl-rule bg-brawl-panel px-4 py-3 hover:bg-brawl-panel/70 transition"
              >
                <div className="w-14 text-right brawl-header text-base text-brawl-orange">
                  #{row.rank}
                </div>
                <PixelAvatar
                  tokenId={row.tokenId}
                  weaponName={row.weapon}
                  rarity={rarityToTier(row.rarity)}
                  className="w-12 h-12 flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-base truncate">
                    Brawler #{row.tokenId}
                  </div>
                  <div className="text-sm text-brawl-text-dim flex flex-wrap gap-x-2 items-center">
                    <span className={rarityTextClass(rarityToTier(row.rarity))}>
                      {row.rarity}
                    </span>
                    <span>·</span>
                    <span>{row.weapon}</span>
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div className="brawl-header text-brawl-yellow text-base">
                    {row.score.toFixed(1)}
                  </div>
                  <div className="text-brawl-text-dim font-mono">
                    {row.rank}/{row.rankOf}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {!loading && !error && rows.length > 0 && (
          <Pager
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
      </div>
    </main>
  );
}

function rarityToTier(rarity: string): 'common' | 'uncommon' | 'rare' | 'legendary' | 'epic' | 'king' {
  switch (rarity.toLowerCase()) {
    case 'common': return 'common';
    case 'uncommon': return 'uncommon';
    case 'rare': return 'rare';
    case 'legendary': return 'legendary';
    case 'epic': return 'epic';
    case 'king': return 'king';
    default: return 'common';
  }
}
