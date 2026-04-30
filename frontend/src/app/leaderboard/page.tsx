'use client';

/**
 * Leaderboard — every alive brawler ranked by Rating (Elo). Dead brawlers are
 * hidden by default but available via the filter. The King (tokenId 501)
 * is called out with a crown if present.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { useAllBrawlers } from '@/hooks/useAllBrawlers';
import type { Brawler } from '@/hooks/useBrawler';
import { PixelAvatar } from '@/components/PixelAvatar';
import { rarityFromWeight, rarityLabel, rarityTextClass } from '@/lib/rarity';

type Filter = 'alive' | 'all';

const KING_TOKEN_ID = 501;

export default function LeaderboardPage() {
  const { brawlers, isLoading, error, refetch } = useAllBrawlers();
  const { address } = useAccount();
  const [filter, setFilter] = useState<Filter>('alive');

  const lowerAddr = address?.toLowerCase() ?? null;

  // Only brawlers that have actually dueled make the leaderboard. Browse
  // is the place to see the full roster; the King is a 1/1 and doesn't
  // compete in the rankings.
  const fighters = useMemo<readonly Brawler[]>(() => {
    return brawlers.filter((b) => {
      if (b.tokenId === KING_TOKEN_ID) return false;
      return b.wins > 0 || b.losses > 0 || b.ties > 0;
    });
  }, [brawlers]);

  const ranked = useMemo<readonly Brawler[]>(() => {
    const list = filter === 'alive' ? fighters.filter((b) => !b.isDead) : fighters;
    return [...list].sort((a, b) => b.elo - a.elo || a.tokenId - b.tokenId);
  }, [fighters, filter]);

  const aliveCount = fighters.filter((b) => !b.isDead).length;

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-6 border-b border-brawl-border pb-4">
        <div>
          <h1 className="brawl-header text-2xl md:text-3xl text-brawl-text mb-2">Leaderboard</h1>
          <p className="text-sm text-brawl-text-dim">
            Only brawlers who&rsquo;ve stepped into the arena. Ranked by Rating — win against
            higher-rated opponents to climb faster. (The full roster with filters lives on{' '}
            <Link href="/browse" className="text-brawl-orange hover:underline">
              /browse
            </Link>
            .)
          </p>
        </div>
        <div className="text-left md:text-right text-sm font-mono text-brawl-text-dim">
          {!isLoading && !error && (
            <div>
              <span className="text-brawl-cyan">{ranked.length}</span> fighters ranked
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterTab
          label={`Alive (${aliveCount})`}
          active={filter === 'alive'}
          onClick={() => setFilter('alive')}
        />
        <FilterTab
          label={`All fighters (${fighters.length})`}
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <div className="grow" />
        <Link href="/history" className="brawl-btn brawl-btn-secondary text-xs">
          Duel History
        </Link>
      </div>

      {error && (
        <div className="brawl-card p-6 border-brawl-red">
          <h2 className="brawl-header text-sm text-brawl-red mb-2">Failed to load roster</h2>
          <p className="text-sm text-brawl-text-dim mb-4">{error.message}</p>
          <button type="button" className="brawl-btn brawl-btn-secondary" onClick={refetch}>
            Retry
          </button>
        </div>
      )}

      {isLoading && !error && (
        <div className="text-center py-12 text-brawl-text-dim">
          <div className="brawl-header text-sm">Loading roster…</div>
        </div>
      )}

      {!isLoading && !error && ranked.length === 0 && (
        <div className="brawl-card p-8 text-center space-y-2">
          <div className="brawl-header text-sm text-brawl-text-dim">
            No duels on record yet.
          </div>
          <p className="text-sm text-brawl-text-dim">
            Pick two brawlers and run a fight on{' '}
            <Link href="/duel" className="text-brawl-orange hover:underline">
              /duel
            </Link>
            . Fighters show up here the moment their first fight lands on chain.
          </p>
        </div>
      )}

      {!isLoading && !error && ranked.length > 0 && (
        <div className="brawl-card overflow-hidden">
          {/* Desktop */}
          <table className="hidden md:table w-full text-sm font-mono">
            <thead>
              <tr className="text-brawl-text-faint brawl-header text-xs border-b border-brawl-border">
                <th className="text-right px-3 py-2 w-16">Rank</th>
                <th className="text-left px-3 py-2">Brawler</th>
                <th className="text-left px-3 py-2">Rarity</th>
                <th className="text-left px-3 py-2">Weapon</th>
                <th className="text-right px-3 py-2">Record</th>
                <th className="text-right px-3 py-2">Rating</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((b, i) => (
                <LeaderboardRow
                  key={b.tokenId}
                  brawler={b}
                  rank={i + 1}
                  mine={!!lowerAddr && b.owner.toLowerCase() === lowerAddr}
                />
              ))}
            </tbody>
          </table>

          {/* Mobile */}
          <div className="md:hidden divide-y divide-brawl-border">
            {ranked.map((b, i) => (
              <LeaderboardCardMobile
                key={b.tokenId}
                brawler={b}
                rank={i + 1}
                mine={!!lowerAddr && b.owner.toLowerCase() === lowerAddr}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LeaderboardRow({
  brawler,
  rank,
  mine,
}: {
  brawler: Brawler;
  rank: number;
  mine: boolean;
}) {
  const tier = rarityFromWeight(brawler.weapon.weight);
  const record = `${brawler.wins}W / ${brawler.losses}L / ${brawler.ties}T`;
  const topClass =
    rank === 1
      ? 'text-brawl-yellow'
      : rank === 2
        ? 'text-brawl-cyan'
        : rank === 3
          ? 'text-brawl-orange'
          : 'text-brawl-text-dim';

  return (
    <tr
      className={
        'border-b border-brawl-border/40 hover:bg-brawl-bg/40 transition-colors ' +
        (mine ? 'bg-brawl-orange/5' : '')
      }
    >
      <td className={`text-right px-3 py-2 brawl-header ${topClass}`}>
        {rank === 1 ? '★ ' : ''}
        {rank}
      </td>
      <td className="px-3 py-2">
        <Link href={`/brawler/${brawler.tokenId}`} className="flex items-center gap-3 group">
          <div className="w-10 h-10 bg-brawl-bg shrink-0">
            <PixelAvatar
              tokenId={brawler.tokenId}
              weaponName={brawler.weapon.name}
              rarity={tier}
              isDead={brawler.isDead}
              className="w-full h-full pixel"
            />
          </div>
          <div className="min-w-0">
            <div
              className={
                'brawl-header text-xs truncate group-hover:text-brawl-orange ' +
                (brawler.isDead ? 'text-brawl-text-faint line-through' : 'text-brawl-text')
              }
              title={brawler.name}
            >
              {brawler.name}
            </div>
            <div className="text-sm font-mono text-brawl-text-faint">
              #{brawler.tokenId}
              {mine && <span className="ml-2 text-brawl-orange">· YOU</span>}
            </div>
          </div>
        </Link>
      </td>
      <td className={`px-3 py-2 text-xs brawl-header tracking-wider ${rarityTextClass(tier)}`}>
        {rarityLabel(tier)}
      </td>
      <td className="px-3 py-2 text-brawl-yellow truncate max-w-[10rem]" title={brawler.weapon.name}>
        {brawler.weapon.name}
      </td>
      <td className="text-right px-3 py-2 text-brawl-text-dim">{record}</td>
      <td className="text-right px-3 py-2">
        <span className="text-brawl-cyan font-bold">{brawler.elo}</span>
      </td>
    </tr>
  );
}

function LeaderboardCardMobile({
  brawler,
  rank,
  mine,
}: {
  brawler: Brawler;
  rank: number;
  mine: boolean;
}) {
  const tier = rarityFromWeight(brawler.weapon.weight);
  const record = `${brawler.wins}W / ${brawler.losses}L / ${brawler.ties}T`;
  const topClass =
    rank === 1
      ? 'text-brawl-yellow'
      : rank === 2
        ? 'text-brawl-cyan'
        : rank === 3
          ? 'text-brawl-orange'
          : 'text-brawl-text-dim';

  return (
    <Link
      href={`/brawler/${brawler.tokenId}`}
      className={
        'flex items-center gap-3 p-3 hover:bg-brawl-bg/40 transition-colors ' +
        (mine ? 'bg-brawl-orange/5' : '')
      }
    >
      <div className={`brawl-header text-lg ${topClass} w-10 text-right`}>
        {rank}
      </div>
      <div className="w-12 h-12 bg-brawl-bg shrink-0">
        <PixelAvatar
          tokenId={brawler.tokenId}
          weaponName={brawler.weapon.name}
          rarity={tier}
          isDead={brawler.isDead}
          className="w-full h-full pixel"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={
            'brawl-header text-xs truncate ' +
            (brawler.isDead ? 'text-brawl-text-faint line-through' : 'text-brawl-text')
          }
          title={brawler.name}
        >
          {brawler.name}
        </div>
        <div className="text-sm font-mono">
          <span className={rarityTextClass(tier)}>{rarityLabel(tier)}</span>{' '}
          <span className="text-brawl-text-dim">· {record}</span>
        </div>
      </div>
      <div className="text-right font-mono">
        <div className="text-brawl-cyan font-bold text-lg">{brawler.elo}</div>
        <div className="text-sm text-brawl-text-faint">RATING</div>
      </div>
    </Link>
  );
}

interface FilterTabProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function FilterTab({ label, active, onClick }: FilterTabProps) {
  const base = 'brawl-header text-xs md:text-xs px-2 md:px-3 py-2 md:py-1.5 border-2 transition-colors min-h-[2.5rem]';
  const cls = active
    ? `${base} text-brawl-orange border-brawl-orange`
    : `${base} text-brawl-text-dim border-brawl-border hover:text-brawl-text hover:border-brawl-orange`;
  return (
    <button type="button" className={cls} onClick={onClick}>
      {label}
    </button>
  );
}
