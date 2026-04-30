'use client';

/**
 * ArenaLineup — shows every duel-ready brawler (approved + alive) sitting
 * in the arena waiting to be matched. HOUSE fighters are tagged.
 *
 * Used on /duel so players can eyeball the live pool before hitting Fight.
 */
import Link from 'next/link';
import type { Brawler } from '@/hooks/useBrawler';
import { PixelAvatar } from '@/components/PixelAvatar';
import {
  rarityFromWeight,
  rarityLabel,
  rarityTextClass,
  type RarityTier,
} from '@/lib/rarity';
import { isHouseBrawler } from '@/lib/house';
import { requireEnv } from '@/lib/env';
import { useHouseWhitelist } from '@/hooks/useHouseWhitelist';

interface ArenaLineupProps {
  candidates: readonly Brawler[];
  myAddress: `0x${string}` | null;
  selectedId: number | null;
}

export function ArenaLineup({ candidates, myAddress, selectedId }: ArenaLineupProps) {
  const { env } = requireEnv();
  const { whitelist } = useHouseWhitelist();

  const sorted = [...candidates].sort((a, b) => b.elo - a.elo);
  const houseCount = sorted.filter((b) =>
    isHouseBrawler(b.tokenId, b.owner, env.houseKeeperAddress, whitelist),
  ).length;
  const humanCount = sorted.length - houseCount;

  return (
    <div className="brawl-card p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="brawl-header text-sm text-brawl-orange">
          Waiting in the arena
        </div>
        <div className="text-sm font-mono text-brawl-text-faint">
          <span className="text-brawl-cyan">{sorted.length}</span> paid &amp; ready
          {houseCount > 0 && (
            <>
              {' · '}
              <span className="text-brawl-orange">{houseCount}</span> house
            </>
          )}
          {humanCount > 0 && (
            <>
              {' · '}
              <span className="text-brawl-green">{humanCount}</span> players
            </>
          )}
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="text-sm text-brawl-text-dim">
          Nobody&rsquo;s paid up yet. Pick your fighter and start a duel — others
          will join as they go.
        </div>
      ) : (
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((b) => (
            <LineupCard
              key={b.tokenId}
              brawler={b}
              isHouse={isHouseBrawler(b.tokenId, b.owner, env.houseKeeperAddress, whitelist)}
              isMine={!!myAddress && b.owner.toLowerCase() === myAddress.toLowerCase()}
              isSelected={selectedId === b.tokenId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LineupCard({
  brawler,
  isHouse,
  isMine,
  isSelected,
}: {
  brawler: Brawler;
  isHouse: boolean;
  isMine: boolean;
  isSelected: boolean;
}) {
  const tier: RarityTier = rarityFromWeight(brawler.weapon.weight);
  const record = `${brawler.wins}W/${brawler.losses}L/${brawler.ties}T`;

  const borderClass = isSelected
    ? 'border-brawl-orange'
    : isHouse
      ? 'border-brawl-orange/40'
      : 'border-brawl-border';

  return (
    <Link
      href={`/brawler/${brawler.tokenId}`}
      className={`flex items-center gap-3 p-2 border-2 ${borderClass} bg-brawl-bg hover:bg-brawl-panel transition-colors`}
    >
      <div className="w-10 h-10 bg-brawl-bg shrink-0">
        <PixelAvatar
          tokenId={brawler.tokenId}
          weaponName={brawler.weapon.name}
          rarity={tier}
          isDead={false}
          className="w-full h-full pixel"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className="brawl-header text-xs text-brawl-text truncate"
            title={brawler.name}
          >
            {brawler.name}
          </span>
          {isHouse && (
            <span className="text-xs brawl-header text-brawl-bg bg-brawl-orange px-1 py-0.5">
              HOUSE
            </span>
          )}
          {isMine && !isHouse && (
            <span className="text-xs brawl-header text-brawl-orange border border-brawl-orange/50 px-1">
              YOU
            </span>
          )}
        </div>
        <div className="text-sm font-mono text-brawl-text-dim flex items-center gap-2 flex-wrap">
          <span className={rarityTextClass(tier)}>{rarityLabel(tier)}</span>
          <span>·</span>
          <span>
            <span className="text-brawl-text-faint">R </span>
            <span className="text-brawl-cyan">{brawler.elo}</span>
          </span>
          <span>· {record}</span>
        </div>
      </div>
    </Link>
  );
}
