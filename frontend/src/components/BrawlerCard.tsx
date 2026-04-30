'use client';

import Link from 'next/link';
import { PixelAvatar } from './PixelAvatar';
import type { Brawler } from '@/hooks/useAllBrawlers';
import { rarityFromWeight, rarityLabel, rarityTextClass } from '@/lib/rarity';

interface BrawlerCardProps {
  brawler: Brawler;
}

export function BrawlerCard({ brawler }: BrawlerCardProps) {
  const isDead = brawler.isDead;
  const record = `${brawler.wins}W / ${brawler.losses}L / ${brawler.ties}T`;
  const tier = rarityFromWeight(brawler.weapon.weight);
  // Founder badges — purely cosmetic flex for the early minters. Token IDs
  // 1..50 = "FOUNDER 50" gold badge; 51..100 = "FOUNDER 100" silver.
  // No stat / weapon / ELO impact — earned by being early.
  const isFounder50 = brawler.tokenId >= 1 && brawler.tokenId <= 50;
  const isFounder100 = brawler.tokenId > 50 && brawler.tokenId <= 100;

  return (
    <Link
      href={`/brawler/${brawler.tokenId}`}
      className="brawl-card brawl-card-hover block p-3 group"
    >
      {/* Top row: token id + rarity badge. HOUSE label hidden in browse view
          per D's 2026-04-27 callout — looked cluttered. The arena-roster
          status is still tracked under the hood for matchmaking, just not
          surfaced visually here. */}
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-mono text-brawl-text-faint">
          #{brawler.tokenId}
        </div>
        <div className={`text-xs brawl-header tracking-wider ${rarityTextClass(tier)}`}>
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
                ? 'Founder 50 — first 50 brawlers ever minted'
                : 'Founder 100 — first 100 brawlers ever minted'
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
          'brawl-header text-xs leading-tight mb-1 truncate ' +
          (isDead ? 'text-brawl-text-faint line-through' : 'text-brawl-text')
        }
        title={brawler.name}
      >
        {brawler.name}
      </div>

      {/* Weapon */}
      <div className="text-xs text-brawl-yellow truncate mb-2" title={brawler.weapon.name}>
        {brawler.weapon.name}
      </div>

      {/* Stats row: rating + record */}
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-mono">
          <span className="text-brawl-text-dim">RATING </span>
          <span className="text-brawl-cyan font-bold">{brawler.elo}</span>
        </span>
        <span className="font-mono text-brawl-text-dim">{record}</span>
      </div>

      {/* Status badge */}
      {isDead && (
        <div className="mt-2 text-xs uppercase tracking-wider text-brawl-red">
          ✝ In Graveyard
        </div>
      )}
    </Link>
  );
}
