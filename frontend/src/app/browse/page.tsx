'use client';

import { useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { useAllBrawlers } from '@/hooks/useAllBrawlers';
import type { Brawler } from '@/hooks/useBrawler';
import { BrawlerCard } from '@/components/BrawlerCard';
import { BrawlerCardSkeletonGrid } from '@/components/BrawlerCardSkeleton';

type OwnerFilter = 'all' | 'mine';
type LifeFilter = 'alive' | 'dead' | 'both';
type SortKey = 'id-asc' | 'id-desc' | 'elo-desc' | 'elo-asc' | 'wins-desc' | 'losses-desc';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'id-asc', label: 'Oldest first' },
  { value: 'id-desc', label: 'Newest first' },
  { value: 'elo-desc', label: 'Highest Rating' },
  { value: 'elo-asc', label: 'Lowest Rating' },
  { value: 'wins-desc', label: 'Most wins' },
  { value: 'losses-desc', label: 'Most losses' },
];

function sortBrawlers(list: readonly Brawler[], key: SortKey): Brawler[] {
  // Shallow copy first, the input array is readonly.
  const arr = [...list];
  switch (key) {
    case 'id-asc':
      return arr.sort((a, b) => a.tokenId - b.tokenId);
    case 'id-desc':
      return arr.sort((a, b) => b.tokenId - a.tokenId);
    case 'elo-desc':
      return arr.sort((a, b) => b.elo - a.elo || a.tokenId - b.tokenId);
    case 'elo-asc':
      return arr.sort((a, b) => a.elo - b.elo || a.tokenId - b.tokenId);
    case 'wins-desc':
      return arr.sort((a, b) => b.wins - a.wins || b.elo - a.elo);
    case 'losses-desc':
      return arr.sort((a, b) => b.losses - a.losses || a.elo - b.elo);
  }
}

export default function BrowsePage() {
  const { brawlers, isLoading, error, refetch } = useAllBrawlers();
  const { address, isConnected } = useAccount();
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all');
  const [lifeFilter, setLifeFilter] = useState<LifeFilter>('alive');
  const [sortKey, setSortKey] = useState<SortKey>('id-asc');

  const lowerAddr = address?.toLowerCase() ?? null;

  const filtered = useMemo(() => {
    let out: readonly Brawler[] = brawlers;
    if (ownerFilter === 'mine') {
      if (!lowerAddr) return [];
      out = out.filter((b) => b.owner.toLowerCase() === lowerAddr);
    }
    if (lifeFilter === 'alive') out = out.filter((b) => !b.isDead);
    else if (lifeFilter === 'dead') out = out.filter((b) => b.isDead);
    return sortBrawlers(out, sortKey);
  }, [brawlers, ownerFilter, lifeFilter, lowerAddr, sortKey]);

  const mineCount = useMemo(() => {
    if (!lowerAddr) return 0;
    return brawlers.filter((b) => b.owner.toLowerCase() === lowerAddr).length;
  }, [brawlers, lowerAddr]);

  const aliveCount = filtered.filter((b) => !b.isDead).length;
  const deadCount = filtered.length - aliveCount;

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-6 border-b border-brawl-border pb-4">
        <div>
          <h1 className="brawl-header text-2xl md:text-3xl text-brawl-text mb-2">Browse</h1>
          <p className="text-sm text-brawl-text-dim">
            {ownerFilter === 'mine' ? 'Brawlers you own.' : 'Every brawler minted to the arena.'}
          </p>
        </div>
        <div className="text-left md:text-right text-sm font-mono text-brawl-text-dim">
          {!isLoading && !error && (
            <>
              <div>
                <span className="text-brawl-green">{aliveCount}</span> alive
              </div>
              {deadCount > 0 && (
                <div>
                  <span className="text-brawl-red">{deadCount}</span> dead
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Control row */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <FilterTab
          label={`All (${brawlers.length})`}
          active={ownerFilter === 'all'}
          onClick={() => setOwnerFilter('all')}
        />
        <FilterTab
          label={isConnected ? `Mine (${mineCount})` : 'Mine'}
          active={ownerFilter === 'mine'}
          disabled={!isConnected}
          disabledTitle="Connect wallet to see your brawlers"
          onClick={() => setOwnerFilter('mine')}
        />

        <div className="w-px h-6 bg-brawl-border mx-1 hidden md:block" />

        <FilterTab
          label="Alive"
          active={lifeFilter === 'alive'}
          onClick={() => setLifeFilter('alive')}
        />
        <FilterTab
          label="Dead"
          active={lifeFilter === 'dead'}
          onClick={() => setLifeFilter('dead')}
        />
        <FilterTab
          label="Both"
          active={lifeFilter === 'both'}
          onClick={() => setLifeFilter('both')}
        />

        <div className="grow" />

        <label className="flex items-center gap-2 text-xs brawl-header text-brawl-text-faint">
          Sort
          <select
            className="px-2 py-2 bg-brawl-bg border-2 border-brawl-border text-brawl-text font-mono text-sm focus:border-brawl-orange focus:outline-none min-h-[2.5rem]"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Error state */}
      {error && (
        <div className="brawl-card p-6 border-brawl-red">
          <h2 className="brawl-header text-sm text-brawl-red mb-2">Failed to load brawlers</h2>
          <p className="text-sm text-brawl-text-dim mb-4">{error.message}</p>
          <div className="flex gap-2 text-sm text-brawl-text-faint">
            <p>Common causes:</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Anvil not running, start it in a terminal with <code>anvil</code></li>
              <li>Contracts not deployed, run the deploy script</li>
              <li>
                Address mismatch, check your <code>.env.local</code> against the deployer&rsquo;s
                output
              </li>
            </ul>
          </div>
          <button type="button" className="brawl-btn brawl-btn-secondary mt-4" onClick={refetch}>
            Retry
          </button>
        </div>
      )}

      {/* Loading state, skeleton grid */}
      {isLoading && !error && <BrawlerCardSkeletonGrid count={12} />}

      {/* Empty state */}
      {!isLoading && !error && filtered.length === 0 && (
        <div className="brawl-card p-8 text-center space-y-4">
          <div className="brawl-header text-sm text-brawl-text-dim">
            {ownerFilter === 'mine'
              ? 'You don’t own any matching brawlers'
              : 'No matching brawlers'}
          </div>
          <p className="text-sm text-brawl-text-dim max-w-md mx-auto">
            Try a different filter, or mint one from{' '}
            <a href="/mint" className="text-brawl-orange hover:underline">
              /mint
            </a>
            .
          </p>
        </div>
      )}

      {/* Grid */}
      {!isLoading && !error && filtered.length > 0 && (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {filtered.map((b) => (
            <BrawlerCard key={b.tokenId} brawler={b} />
          ))}
        </div>
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
