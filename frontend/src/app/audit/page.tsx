'use client';

/**
 * /audit, internal art + rarity audit page.
 *
 * Two modes:
 *  1. "Live": renders every minted brawler on chain, grouped by rarity,
 *     so D can eyeball art + rarity distribution vs the expected 310 /
 *     125 / 50 / 10 / 5 + 1 split. Uses useAllBrawlers.
 *
 *  2. "Preview": synthetically renders all 12 weapons × 6 rarities (72
 *     cards) so the art can be verified without waiting for a full mint.
 *     This doesn't touch the chain at all.
 *
 * Accessible at /audit. Not linked in the nav on purpose, internal tool.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAllBrawlers } from '@/hooks/useAllBrawlers';
import type { Brawler } from '@/hooks/useBrawler';
import { PixelAvatar } from '@/components/PixelAvatar';
import { rarityFromWeight, rarityLabel, rarityTextClass, type RarityTier } from '@/lib/rarity';

type Mode = 'live' | 'preview';

const RARITY_ORDER: RarityTier[] = ['king', 'epic', 'legendary', 'rare', 'uncommon', 'common'];

const EXPECTED: Record<RarityTier, number> = {
  king: 1,
  epic: 5,
  legendary: 10,
  rare: 50,
  uncommon: 125,
  common: 310,
};

const WEAPONS = [
  { name: 'Knife', weight: 18, rarity: 'common' as RarityTier },
  { name: 'Baseball Bat', weight: 17, rarity: 'common' as RarityTier },
  { name: 'Crowbar', weight: 15, rarity: 'common' as RarityTier },
  { name: 'Machete', weight: 12, rarity: 'uncommon' as RarityTier },
  { name: 'Pistol', weight: 11, rarity: 'uncommon' as RarityTier },
  { name: 'Shotgun', weight: 9, rarity: 'rare' as RarityTier },
  { name: 'Sledgehammer', weight: 7, rarity: 'rare' as RarityTier },
  { name: 'Flaming Sword', weight: 5, rarity: 'legendary' as RarityTier },
  { name: 'Electric Axe', weight: 3, rarity: 'legendary' as RarityTier },
  { name: 'Bazooka', weight: 2, rarity: 'epic' as RarityTier },
  { name: 'Rail Gun', weight: 1, rarity: 'epic' as RarityTier },
  { name: 'Kingsblade', weight: 0, rarity: 'king' as RarityTier },
];

export default function AuditPage() {
  const [mode, setMode] = useState<Mode>('preview');
  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 space-y-6">
      <div className="border-b border-brawl-border pb-4">
        <h1 className="brawl-header text-2xl md:text-3xl text-brawl-text mb-2">Art Audit</h1>
        <p className="text-sm text-brawl-text-dim">
          Internal tool. Preview renders synthetic art for every weapon × rarity
          combination; Live shows the actual on-chain roster grouped by rarity,
          so you can confirm the Fisher-Yates shuffle gave us the expected 310
          / 125 / 50 / 10 / 5 + 1 King split.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Tab active={mode === 'preview'} onClick={() => setMode('preview')}>
          Preview (synthetic)
        </Tab>
        <Tab active={mode === 'live'} onClick={() => setMode('live')}>
          Live (on-chain)
        </Tab>
        <div className="grow" />
        <Link href="/browse" className="brawl-btn brawl-btn-secondary text-xs">
          Browse
        </Link>
        <Link href="/leaderboard" className="brawl-btn brawl-btn-secondary text-xs">
          Leaderboard
        </Link>
      </div>

      {mode === 'preview' ? <PreviewGrid /> : <LiveGrid />}
    </div>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const base = 'brawl-header text-xs px-3 py-1.5 border-2 transition-colors';
  const cls = active
    ? `${base} text-brawl-orange border-brawl-orange`
    : `${base} text-brawl-text-dim border-brawl-border hover:text-brawl-text hover:border-brawl-orange`;
  return (
    <button type="button" className={cls} onClick={onClick}>
      {children}
    </button>
  );
}

// ─── Preview (synthetic) ──────────────────────────────────────────────

function PreviewGrid() {
  // 20 variants per weapon so you can see the variety (hair / mouth / hat
  // color / clothing / gender / pet / eyes all vary independently). 10 alive
  // then 10 dead.
  const variants = 10;

  return (
    <div className="space-y-6">
      {WEAPONS.map((w, wi) => (
        <div key={w.name} className="brawl-card p-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="brawl-header text-sm text-brawl-text">
              {w.name}{' '}
              <span className={`text-xs ${rarityTextClass(w.rarity)}`}>
                {rarityLabel(w.rarity)}
              </span>
            </h2>
            <span className="text-sm font-mono text-brawl-text-faint">
              weight {w.weight}
            </span>
          </div>
          <div className="grid grid-cols-5 md:grid-cols-10 gap-2">
            {Array.from({ length: variants }).map((_, i) => {
              const id = i + 1 + wi * 523; // spread token ids
              return <PreviewCell key={`alive-${id}`} tokenId={id} weapon={w} isDead={false} />;
            })}
            {Array.from({ length: variants }).map((_, i) => {
              const id = i + 1 + wi * 523 + 7;
              return <PreviewCell key={`dead-${id}`} tokenId={id} weapon={w} isDead={true} />;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function PreviewCell({
  tokenId,
  weapon,
  isDead,
}: {
  tokenId: number;
  weapon: { name: string; rarity: RarityTier };
  isDead: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="w-full aspect-square bg-brawl-bg">
        <PixelAvatar
          tokenId={tokenId}
          weaponName={weapon.name}
          rarity={weapon.rarity}
          isDead={isDead}
          className="w-full h-full pixel"
        />
      </div>
      <div className="text-sm font-mono text-brawl-text-faint">
        #{tokenId}
        {isDead ? ' ✝' : ''}
      </div>
    </div>
  );
}

// ─── Live (on-chain) ──────────────────────────────────────────────────

function LiveGrid() {
  const { brawlers, isLoading, error, refetch } = useAllBrawlers();

  const byRarity = useMemo(() => {
    const groups: Record<RarityTier, Brawler[]> = {
      king: [],
      epic: [],
      legendary: [],
      rare: [],
      uncommon: [],
      common: [],
    };
    for (const b of brawlers) {
      const r = rarityFromWeight(b.weapon.weight);
      groups[r].push(b);
    }
    return groups;
  }, [brawlers]);

  if (error) {
    return (
      <div className="brawl-card p-6 border-brawl-red">
        <h2 className="brawl-header text-sm text-brawl-red mb-2">Failed to load roster</h2>
        <p className="text-sm text-brawl-text-dim mb-4">{error.message}</p>
        <button type="button" className="brawl-btn brawl-btn-secondary" onClick={refetch}>
          Retry
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="text-center py-12 text-brawl-text-dim brawl-header text-sm">
        Loading roster…
      </div>
    );
  }

  if (brawlers.length === 0) {
    return (
      <div className="brawl-card p-8 text-center text-brawl-text-dim">
        <div className="brawl-header text-sm">No brawlers minted yet.</div>
        <p className="text-xs mt-2">
          Run the full-mint smoke test (25 batches × 20) to populate this view.
        </p>
      </div>
    );
  }

  const total = brawlers.length;

  return (
    <div className="space-y-6">
      <div className="brawl-card p-4 grid grid-cols-2 md:grid-cols-6 gap-2 font-mono text-center">
        {RARITY_ORDER.map((r) => {
          const got = byRarity[r].length;
          const exp = EXPECTED[r];
          const color = got === exp ? 'text-brawl-green' : got === 0 ? 'text-brawl-text-dim' : 'text-brawl-yellow';
          return (
            <div key={r}>
              <div className={`text-xs brawl-header ${rarityTextClass(r)}`}>
                {rarityLabel(r)}
              </div>
              <div className={`text-2xl ${color}`}>{got}</div>
              <div className="text-sm text-brawl-text-faint">expected {exp}</div>
            </div>
          );
        })}
      </div>

      <div className="text-sm font-mono text-brawl-text-dim">
        Total minted: <span className="text-brawl-cyan">{total}</span> / 501
      </div>

      {RARITY_ORDER.map((r) => {
        const list = byRarity[r];
        if (list.length === 0) return null;
        return (
          <div key={r} className="brawl-card p-4 space-y-3">
            <div className="flex items-baseline justify-between border-b border-brawl-border pb-2">
              <h2 className={`brawl-header text-sm ${rarityTextClass(r)}`}>
                {rarityLabel(r)}
              </h2>
              <span className="text-sm font-mono text-brawl-text-faint">
                {list.length} of {EXPECTED[r]}
              </span>
            </div>
            <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-1.5">
              {list.map((b) => (
                <Link
                  key={b.tokenId}
                  href={`/brawler/${b.tokenId}`}
                  title={`#${b.tokenId}, ${b.name}, ${b.weapon.name}`}
                  className="block"
                >
                  <div className="w-full aspect-square bg-brawl-bg hover:ring-2 hover:ring-brawl-orange transition-all">
                    <PixelAvatar
                      tokenId={b.tokenId}
                      weaponName={b.weapon.name}
                      rarity={r}
                      isDead={b.isDead}
                      className="w-full h-full pixel"
                    />
                  </div>
                  <div className="text-sm font-mono text-brawl-text-faint text-center mt-0.5">
                    #{b.tokenId}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
