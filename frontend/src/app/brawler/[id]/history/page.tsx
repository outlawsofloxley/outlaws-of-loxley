'use client';

/**
 * Per-brawler fight history — scoped DuelCompleted events where this token
 * was tokenA or tokenB. Reuses the shared DuelHistoryTable.
 */
import { use, useMemo } from 'react';
import Link from 'next/link';
import { useBrawler } from '@/hooks/useBrawler';
import { useAllBrawlers } from '@/hooks/useAllBrawlers';
import { useDuelHistory } from '@/hooks/useDuelHistory';
import { DuelHistoryTable } from '@/components/DuelHistoryTable';

function parseTokenId(raw: string): number | undefined {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || String(n) !== raw) return undefined;
  return n;
}

export default function BrawlerHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = use(params);
  const tokenId = parseTokenId(rawId);
  const { brawler } = useBrawler(tokenId);
  const { brawlers } = useAllBrawlers();
  const { rows, isLoading, error, refetch } = useDuelHistory(tokenId);

  const nameOf = useMemo(() => {
    const m = new Map<number, string>();
    for (const b of brawlers) m.set(b.tokenId, b.name);
    return m;
  }, [brawlers]);

  const record = useMemo(() => {
    if (tokenId === undefined) return { wins: 0, losses: 0, ties: 0 };
    let wins = 0;
    let losses = 0;
    let ties = 0;
    for (const r of rows) {
      if (r.winnerId === 0) {
        ties++;
      } else if (r.winnerId === tokenId) {
        wins++;
      } else {
        losses++;
      }
    }
    return { wins, losses, ties };
  }, [rows, tokenId]);

  if (tokenId === undefined) {
    return (
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8">
        <h1 className="brawl-header text-2xl text-brawl-red">Invalid brawler id</h1>
        <Link href="/browse" className="brawl-btn brawl-btn-secondary mt-4 inline-block">
          &larr; Back to Browse
        </Link>
      </div>
    );
  }

  const title = brawler ? brawler.name : `Brawler #${tokenId}`;

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 space-y-6">
      <div className="space-y-2 border-b border-brawl-border pb-4">
        <Link
          href={`/brawler/${tokenId}`}
          className="text-sm text-brawl-text-dim hover:text-brawl-orange font-mono"
        >
          &larr; Back to {brawler?.name ?? `#${tokenId}`}
        </Link>
        <h1 className="brawl-header text-2xl md:text-3xl text-brawl-text">
          {title} — Fight History
        </h1>
        <p className="text-sm text-brawl-text-dim">
          Every duel this brawler has fought, newest first.
        </p>
      </div>

      <div className="brawl-card p-4 grid grid-cols-3 gap-4 text-center font-mono">
        <StatCell label="Wins" value={record.wins} color="text-brawl-green" />
        <StatCell label="Losses" value={record.losses} color="text-brawl-red" />
        <StatCell label="Ties" value={record.ties} color="text-brawl-yellow" />
      </div>

      {error && (
        <div className="brawl-card p-6 border-brawl-red">
          <h2 className="brawl-header text-sm text-brawl-red mb-2">Failed to load history</h2>
          <p className="text-sm text-brawl-text-dim mb-4">{error.message}</p>
          <button type="button" className="brawl-btn brawl-btn-secondary" onClick={refetch}>
            Retry
          </button>
        </div>
      )}

      {isLoading && !error && (
        <div className="text-center py-12 text-brawl-text-dim">
          <div className="brawl-header text-sm">Scanning blocks…</div>
        </div>
      )}

      {!isLoading && !error && rows.length === 0 && (
        <div className="brawl-card p-8 text-center">
          <div className="brawl-header text-sm text-brawl-text-dim">
            No fights on record for this brawler.
          </div>
        </div>
      )}

      {!isLoading && !error && rows.length > 0 && (
        <DuelHistoryTable rows={rows} nameOf={nameOf} highlightTokenId={tokenId} />
      )}
    </div>
  );
}

function StatCell({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="text-xs brawl-header text-brawl-text-faint">{label}</div>
      <div className={`${color} text-2xl`}>{value}</div>
    </div>
  );
}
