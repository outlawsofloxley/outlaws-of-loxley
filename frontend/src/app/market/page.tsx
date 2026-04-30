'use client';

/**
 * /market — browse every active brawler listing.
 *
 * Data: cached DB listings via useMarketListings + full roster via
 * useAllBrawlers. Join the two client-side so we can render rich cards
 * (art, rarity, weapon, record) alongside the listing price.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { formatEther } from 'viem';
import { useAccount } from 'wagmi';
import { useAllBrawlers } from '@/hooks/useAllBrawlers';
import type { Brawler } from '@/hooks/useBrawler';
import { useMarketListings, type MarketListingRow } from '@/hooks/useMarketListings';
import { PixelAvatar } from '@/components/PixelAvatar';
import { rarityFromWeight, rarityLabel, rarityTextClass, type RarityTier } from '@/lib/rarity';
import { nativeSymbol } from '@/lib/wagmi';
import { requireEnv } from '@/lib/env';

type RarityFilter = 'all' | RarityTier;
type SortKey = 'price-asc' | 'price-desc' | 'newest' | 'oldest';

interface JoinedListing {
  listing: MarketListingRow;
  brawler: Brawler | null;
}

export default function MarketPage() {
  const { env } = requireEnv();
  const { listings, isLoading: listingsLoading, error: listingsError, refetch } = useMarketListings();
  const { brawlers, isLoading: brawlersLoading } = useAllBrawlers();
  const { address } = useAccount();
  const [rarityFilter, setRarityFilter] = useState<RarityFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('newest');
  const [onlyMine, setOnlyMine] = useState(false);

  const symbol = nativeSymbol(env.chainId);
  const lowerAddr = address?.toLowerCase() ?? null;

  const joined: JoinedListing[] = useMemo(() => {
    const byId = new Map<number, Brawler>();
    for (const b of brawlers) byId.set(b.tokenId, b);
    return listings.map((l) => ({
      listing: l,
      brawler: byId.get(l.tokenId) ?? null,
    }));
  }, [listings, brawlers]);

  const filtered = useMemo(() => {
    let out = joined;
    if (rarityFilter !== 'all') {
      out = out.filter((j) => {
        if (!j.brawler) return false;
        return rarityFromWeight(j.brawler.weapon.weight) === rarityFilter;
      });
    }
    if (onlyMine && lowerAddr) {
      out = out.filter((j) => j.listing.seller.toLowerCase() === lowerAddr);
    }
    const sorted = [...out].sort((a, b) => {
      switch (sortKey) {
        case 'price-asc':
          return a.listing.price < b.listing.price ? -1 : 1;
        case 'price-desc':
          return a.listing.price > b.listing.price ? -1 : 1;
        case 'newest':
          return b.listing.listedAt - a.listing.listedAt;
        case 'oldest':
          return a.listing.listedAt - b.listing.listedAt;
      }
    });
    return sorted;
  }, [joined, rarityFilter, onlyMine, lowerAddr, sortKey]);

  const isLoading = listingsLoading || brawlersLoading;

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 border-b border-brawl-border pb-4">
        <div>
          <h1 className="brawl-header text-2xl md:text-3xl text-brawl-text mb-2">Marketplace</h1>
          <p className="text-sm text-brawl-text-dim">
            Buy and sell brawlers for {symbol}. <span className="text-brawl-orange">5%</span> fee
            to the dev treasury; the rest goes to the seller. Listings are
            approval-based — sellers keep custody until sold.
          </p>
        </div>
        <div className="text-left md:text-right text-sm font-mono text-brawl-text-dim">
          {!isLoading && !listingsError && (
            <div>
              <span className="text-brawl-cyan">{listings.length}</span> active listings
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterTab active={rarityFilter === 'all'} onClick={() => setRarityFilter('all')}>
          All
        </FilterTab>
        {(['common', 'uncommon', 'rare', 'legendary', 'epic', 'king'] as const).map((r) => (
          <FilterTab
            key={r}
            active={rarityFilter === r}
            onClick={() => setRarityFilter(r)}
          >
            <span className={rarityTextClass(r)}>{rarityLabel(r)}</span>
          </FilterTab>
        ))}
        <div className="w-px h-6 bg-brawl-border mx-1 hidden md:block" />
        <FilterTab active={onlyMine} onClick={() => setOnlyMine((v) => !v)} disabled={!address}>
          My listings
        </FilterTab>
        <div className="grow" />
        <label className="flex items-center gap-2 text-xs brawl-header text-brawl-text-faint">
          Sort
          <select
            className="px-2 py-2 bg-brawl-bg border-2 border-brawl-border text-brawl-text font-mono text-sm focus:border-brawl-orange focus:outline-none min-h-[2.5rem]"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="price-asc">Price (low→high)</option>
            <option value="price-desc">Price (high→low)</option>
          </select>
        </label>
      </div>

      {listingsError && (
        <div className="brawl-card p-6 border-brawl-red">
          <h2 className="brawl-header text-sm text-brawl-red mb-2">Failed to load listings</h2>
          <p className="text-sm text-brawl-text-dim mb-4">{listingsError.message}</p>
          <button type="button" className="brawl-btn brawl-btn-secondary" onClick={refetch}>
            Retry
          </button>
        </div>
      )}

      {isLoading && !listingsError && (
        <div className="text-center py-12 text-brawl-text-dim brawl-header text-sm">
          Loading marketplace…
        </div>
      )}

      {!isLoading && !listingsError && filtered.length === 0 && (
        <div className="brawl-card p-8 text-center space-y-3">
          <div className="brawl-header text-sm text-brawl-text-dim">
            No active listings match your filters.
          </div>
          <p className="text-sm text-brawl-text-dim">
            Own a brawler you want to sell? Go to its detail page and click{' '}
            <em>List for sale</em>.
          </p>
          <Link href="/browse" className="brawl-btn brawl-btn-secondary inline-block">
            Browse Roster
          </Link>
        </div>
      )}

      {!isLoading && !listingsError && filtered.length > 0 && (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {filtered.map((j) => (
            <ListingCard key={j.listing.tokenId} joined={j} symbol={symbol} />
          ))}
        </div>
      )}
    </div>
  );
}

function ListingCard({ joined, symbol }: { joined: JoinedListing; symbol: string }) {
  const { listing, brawler } = joined;
  const tier = brawler ? rarityFromWeight(brawler.weapon.weight) : 'common';
  const priceLabel = `${formatEther(listing.price)} ${symbol}`;

  return (
    <Link
      href={`/brawler/${listing.tokenId}`}
      className="brawl-card brawl-card-hover block p-3 group space-y-2"
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-mono text-brawl-text-faint">#{listing.tokenId}</div>
        <div className={`text-xs brawl-header tracking-wider ${rarityTextClass(tier)}`}>
          {rarityLabel(tier)}
        </div>
      </div>
      <div className="aspect-square w-full bg-brawl-bg">
        {brawler ? (
          <PixelAvatar
            tokenId={brawler.tokenId}
            weaponName={brawler.weapon.name}
            rarity={tier}
            isDead={brawler.isDead}
            className="w-full h-full pixel"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm text-brawl-text-faint font-mono">
            loading…
          </div>
        )}
      </div>
      <div
        className={
          'brawl-header text-xs leading-tight truncate ' +
          (brawler?.isDead ? 'text-brawl-text-faint line-through' : 'text-brawl-text')
        }
        title={brawler?.name ?? ''}
      >
        {brawler?.name ?? `Brawler #${listing.tokenId}`}
      </div>
      {brawler && (
        <div className="text-xs text-brawl-yellow truncate" title={brawler.weapon.name}>
          {brawler.weapon.name}
        </div>
      )}
      <div className="flex items-baseline justify-between text-sm font-mono pt-1 border-t border-brawl-border">
        <span className="text-brawl-text-faint">PRICE</span>
        <span className="text-brawl-orange font-bold text-xs">{priceLabel}</span>
      </div>
      {brawler && (
        <div className="flex items-baseline justify-between text-sm font-mono">
          <span className="text-brawl-text-dim">RATING {brawler.elo}</span>
          <span className="text-brawl-text-dim">
            {brawler.wins}W / {brawler.losses}L
          </span>
        </div>
      )}
    </Link>
  );
}

interface FilterTabProps {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}

function FilterTab({ active, onClick, disabled, children }: FilterTabProps) {
  const base =
    'brawl-header text-xs md:text-xs px-2 md:px-3 py-2 md:py-1.5 border-2 transition-colors min-h-[2.5rem]';
  let cls: string;
  if (disabled) {
    cls = `${base} text-brawl-text-faint border-brawl-border cursor-not-allowed`;
  } else if (active) {
    cls = `${base} text-brawl-orange border-brawl-orange`;
  } else {
    cls = `${base} text-brawl-text-dim border-brawl-border hover:text-brawl-text hover:border-brawl-orange`;
  }
  return (
    <button type="button" className={cls} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}
