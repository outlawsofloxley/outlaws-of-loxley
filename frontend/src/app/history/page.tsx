'use client';

/**
 * Duel history — every DuelCompleted event emitted by the Duel contract,
 * filterable by "All", "Mine" (duels your wallet owns either side of),
 * and by specific brawler.
 *
 * Data source: viem getLogs via useDuelHistory. Names resolved from the
 * loaded roster via useAllBrawlers — if a brawler has been transferred
 * since the duel, we still show the current owner/name (the event only
 * carries token IDs, not names or owners at the time).
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { useAllBrawlers } from '@/hooks/useAllBrawlers';
import { useDuelHistory, type DuelHistoryRow } from '@/hooks/useDuelHistory';
import { DuelHistoryTable } from '@/components/DuelHistoryTable';

type Filter = 'all' | 'mine';

export default function HistoryPage() {
  const { rows, isLoading, error, refetch, source } = useDuelHistory();
  const { brawlers } = useAllBrawlers();
  const { address, isConnected } = useAccount();
  const [filter, setFilter] = useState<Filter>('all');

  const nameOf = useMemo(() => {
    const m = new Map<number, string>();
    for (const b of brawlers) m.set(b.tokenId, b.name);
    return m;
  }, [brawlers]);

  const mineTokenIds = useMemo(() => {
    if (!address) return new Set<number>();
    const lower = address.toLowerCase();
    return new Set(
      brawlers
        .filter((b) => b.owner.toLowerCase() === lower)
        .map((b) => b.tokenId),
    );
  }, [brawlers, address]);

  const filtered = useMemo<readonly DuelHistoryRow[]>(() => {
    if (filter === 'all') return rows;
    return rows.filter((r) => mineTokenIds.has(r.tokenA) || mineTokenIds.has(r.tokenB));
  }, [rows, filter, mineTokenIds]);

  const myFights = useMemo(() => {
    return rows.filter((r) => mineTokenIds.has(r.tokenA) || mineTokenIds.has(r.tokenB)).length;
  }, [rows, mineTokenIds]);

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-6 border-b border-brawl-border pb-4">
        <div>
          <h1 className="brawl-header text-2xl md:text-3xl text-brawl-text mb-2">Duel History</h1>
          <p className="text-sm text-brawl-text-dim">
            Every DuelCompleted event read from chain. Click a brawler to jump to their page,
            or a tx hash to open it in an explorer.
          </p>
        </div>
        <div className="text-left md:text-right text-sm font-mono text-brawl-text-dim">
          {!isLoading && !error && (
            <>
              <div>
                <span className="text-brawl-cyan">{rows.length}</span> total fights
              </div>
              {isConnected && (
                <div>
                  <span className="text-brawl-orange">{myFights}</span> involve you
                </div>
              )}
              {source && (
                <div className="text-sm text-brawl-text-faint">
                  source:{' '}
                  <span className={source === 'db' ? 'text-brawl-green' : 'text-brawl-yellow'}>
                    {source === 'db' ? 'cached db' : 'live chain (db not configured)'}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterTab
          label={`All (${rows.length})`}
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <FilterTab
          label={isConnected ? `Mine (${myFights})` : 'Mine'}
          active={filter === 'mine'}
          disabled={!isConnected}
          disabledTitle="Connect wallet to filter"
          onClick={() => setFilter('mine')}
        />
        <div className="grow" />
        <Link href="/leaderboard" className="brawl-btn brawl-btn-secondary text-xs">
          Leaderboard
        </Link>
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
          <div className="brawl-header text-sm">Loading history…</div>
          <div className="text-xs mt-2">
            Reads from the Postgres cache (if configured). Falls back to live
            chain scan when the DB isn&rsquo;t wired up yet.
          </div>
        </div>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <div className="brawl-card p-8 text-center space-y-3">
          <div className="brawl-header text-sm text-brawl-text-dim">
            {filter === 'mine' ? 'You haven’t been in any duels yet' : 'No duels on record'}
          </div>
          <p className="text-sm text-brawl-text-dim">
            Pick two brawlers at{' '}
            <Link href="/duel" className="text-brawl-orange hover:underline">
              /duel
            </Link>{' '}
            to kick one off.
          </p>
        </div>
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <DuelHistoryTable rows={filtered} nameOf={nameOf} mineTokenIds={mineTokenIds} />
      )}
    </div>
  );
}

interface FilterTabProps {
  label: string;
  active: boolean;
  disabled?: boolean;
  disabledTitle?: string;
  onClick: () => void;
}

function FilterTab({ label, active, disabled, disabledTitle, onClick }: FilterTabProps) {
  const base = 'brawl-header text-xs md:text-xs px-2 md:px-3 py-2 md:py-1.5 border-2 transition-colors min-h-[2.5rem]';
  let cls: string;
  if (disabled) {
    cls = `${base} text-brawl-text-faint border-brawl-border cursor-not-allowed`;
  } else if (active) {
    cls = `${base} text-brawl-orange border-brawl-orange`;
  } else {
    cls = `${base} text-brawl-text-dim border-brawl-border hover:text-brawl-text hover:border-brawl-orange`;
  }
  return (
    <button
      type="button"
      className={cls}
      disabled={disabled}
      title={disabled ? disabledTitle : undefined}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
