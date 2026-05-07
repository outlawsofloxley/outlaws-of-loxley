'use client';

import Link from 'next/link';
import { PixelAvatar } from './PixelAvatar';
import type { Brawler } from '@/hooks/useAllBrawlers';
import { rarityFromWeight, rarityLabel, rarityTextClass } from '@/lib/rarity';
import { useBrawlerRanks } from '@/hooks/useBrawlerRanks';

interface BrawlerCardProps {
  brawler: Brawler;
}

export function BrawlerCard({ brawler }: BrawlerCardProps) {
  const isDead = brawler.isDead;
  const record = `${brawler.wins}W / ${brawler.losses}L / ${brawler.ties}T`;
  const tier = rarityFromWeight(brawler.weapon.weight);
  const { rankFor } = useBrawlerRanks();
  const rank = rankFor(brawler.tokenId);
  // Founder badges, purely cosmetic flex for the early minters. Token IDs
  // 1..50 = "FOUNDER 50" gold badge; 51..100 = "FOUNDER 100" silver.
  // No stat / weapon / ELO impact, earned by being early.
  const isFounder50 = brawler.tokenId >= 1 && brawler.tokenId <= 50;
  const isFounder100 = brawler.tokenId > 50 && brawler.tokenId <= 100;

  return (
    <Link
      href={`/brawler/${brawler.tokenId}`}
      className="brawl-card brawl-card-hover block p-3 group"
    >
      {/* Top row: token id + rarity badge. */}
      <div className="flex items-center justify-between mb-1">
        <div className="text-base font-mono text-brawl-text-faint">
          #{brawler.tokenId}
        </div>
        <div className={`text-sm brawl-header tracking-wider ${rarityTextClass(tier)}`}>
          {rarityLabel(tier)}
        </div>
      </div>

      {/* Founder badge (small, centered, its own row) */}
      {(isFounder50 || isFounder100) && (
        <div className="flex justify-center mb-1">
          <span
            className={
              'text-xs brawl-header tracking-wider px-1.5 py-0.5 rounded-sm border ' +
              (isFounder50
                ? 'text-brawl-yellow border-brawl-yellow'
                : 'text-brawl-cyan border-brawl-cyan')
            }
            title={
              isFounder50
                ? 'Founder 50, first 50 brawlers ever minted'
                : 'Founder 100, first 100 brawlers ever minted'
            }
          >
            ★ {isFounder50 ? 'FOUNDER 50' : 'FOUNDER 100'}
          </span>
        </div>
      )}

      {/* Avatar */}
      <div className="aspect-square w-full mb-2 bg-brawl-bg">
        <PixelAvatar
          tokenId={brawler.tokenId}
          weaponName={brawler.weapon.name}
          rarity={tier}
          isDead={isDead}
          className="w-full h-full pixel"
        />
      </div>

      {/* Name */}
      <div
        className={
          'brawl-header text-sm leading-tight mb-1 truncate ' +
          (isDead ? 'text-brawl-text-faint line-through' : 'text-brawl-text')
        }
        title={brawler.name}
      >
        {brawler.name}
      </div>

      {/* Weapon */}
      <div className="text-sm text-brawl-yellow truncate mb-2" title={brawler.weapon.name}>
        {brawler.weapon.name}
      </div>

      {/* Stats row: rating + record */}
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-mono">
          <span className="text-brawl-text-dim">RATING </span>
          <span className="text-brawl-cyan font-bold">{brawler.elo}</span>
        </span>
        <span className="font-mono text-brawl-text-dim">{record}</span>
      </div>

      {/* Rarity rank — separate from duel rating. Lower = rarer. */}
      {rank && (
        <div className="mt-1 flex items-baseline justify-between text-sm">
          <span className="font-mono">
            <span className="text-brawl-text-dim">RANK </span>
            <span className="text-brawl-yellow font-bold">#{rank.rank}</span>
            <span className="text-brawl-text-dim"> / {rank.rankOf}</span>
          </span>
          <span className="font-mono text-brawl-text-dim text-xs">
            {rank.score.toFixed(0)} pts
          </span>
        </div>
      )}

      {/* Status badge */}
      {isDead && (
        <div className="mt-2 text-xs uppercase tracking-wider text-brawl-red">
          ✝ In Graveyard
        </div>
      )}
    </Link>
  );
}
