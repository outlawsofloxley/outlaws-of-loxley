'use client';

/**
 * /sample10, focused art-review page. Renders 20 brawlers spanning every
 * archetype × multiple rarities at large size. No dead row, dead is just
 * the same brawler with a red X overlay.
 *
 * For each (archetype, rarity) target, scans tokenIds 1..2500 looking for
 * the first that rolls to that archetype. The LCG is deterministic so the
 * same tokenId produces the same character every render.
 */
import { useMemo } from 'react';
import {
  archetypeFor,
  renderBrawlerArt,
  type Archetype,
  type RarityTier,
} from '@/lib/brawlerArt';

interface Target {
  archetype: Archetype;
  rarity: RarityTier;
  weapon: string;
}

const TARGETS: readonly Target[] = [
  // Common (3), plain street fighters
  { archetype: 'brawler', rarity: 'common', weapon: 'baseball bat' },
  { archetype: 'thug', rarity: 'common', weapon: 'crowbar' },
  { archetype: 'mongol', rarity: 'common', weapon: 'knife' },

  // Uncommon (4), early variety, NEW: viking + mongol
  { archetype: 'pirate', rarity: 'uncommon', weapon: 'machete' },
  { archetype: 'viking', rarity: 'uncommon', weapon: 'sledgehammer' },
  { archetype: 'punjab', rarity: 'uncommon', weapon: 'flaming sword' },
  { archetype: 'boxer', rarity: 'uncommon', weapon: 'knife' },

  // Rare (6), NEW: mafia + spartan + berserker
  { archetype: 'mafia', rarity: 'rare', weapon: 'pistol' },
  { archetype: 'ninja', rarity: 'rare', weapon: 'shotgun' },
  { archetype: 'spartan', rarity: 'rare', weapon: 'machete' },
  { archetype: 'samurai', rarity: 'rare', weapon: 'flaming sword' },
  { archetype: 'berserker', rarity: 'rare', weapon: 'electric axe' },
  { archetype: 'cowboy', rarity: 'rare', weapon: 'pistol' },

  // Legendary (4), fully kitted, NEW: viking + mafia
  { archetype: 'knight', rarity: 'legendary', weapon: 'electric axe' },
  { archetype: 'wrestler', rarity: 'legendary', weapon: 'sledgehammer' },
  { archetype: 'viking', rarity: 'legendary', weapon: 'sledgehammer' },
  { archetype: 'mafia', rarity: 'legendary', weapon: 'shotgun' },

  // Epic (2), top tier, NEW: berserker + spartan
  { archetype: 'berserker', rarity: 'epic', weapon: 'sledgehammer' },
  { archetype: 'spartan', rarity: 'epic', weapon: 'flaming sword' },

  // King (1), the 1/1
  { archetype: 'royal', rarity: 'king', weapon: 'kingsblade' },
];

function findTokenIdFor(target: Target, used: Set<number>): number {
  if (target.archetype === 'royal') return 2001;
  for (let id = 1; id < 2500; id++) {
    if (used.has(id)) continue;
    if (archetypeFor(id, target.rarity) === target.archetype) {
      used.add(id);
      return id;
    }
  }
  return 1;
}

export default function Sample10Page() {
  const cards = useMemo(() => {
    const used = new Set<number>();
    const built = TARGETS.map((t) => {
      const tokenId = findTokenIdFor(t, used);
      return {
        ...t,
        tokenId,
        svg: renderBrawlerArt({ tokenId, weaponName: t.weapon, rarity: t.rarity }),
      };
    });
    // Force epic chief to render with rare chief's brawler features (so
    // the FACE is byte-identical) BUT keep the epic-tier background so the
    // 6 corner+mid crosses show up. D's 2026-04-26/27 asks: face same as
    // rare chief, bg same as epic tier.
    const rareChief = built.find((c) => c.archetype === 'spartan' && c.rarity === 'rare');
    if (rareChief) {
      const epicIdx = built.findIndex((c) => c.archetype === 'spartan' && c.rarity === 'epic');
      if (epicIdx >= 0) {
        built[epicIdx] = {
          ...built[epicIdx]!,
          tokenId: rareChief.tokenId,
          svg: renderBrawlerArt({
            tokenId: rareChief.tokenId,
            weaponName: built[epicIdx]!.weapon,
            rarity: 'rare', // rare → identical face roll to rare chief
            bgRarity: 'epic', // epic → bg with all 6 yellow crosses
          }),
        };
      }
    }
    return built;
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 space-y-6">
      <div className="space-y-1">
        <h1 className="brawl-header text-2xl text-brawl-orange">Sample 20, art review</h1>
        <p className="text-sm text-brawl-text-dim font-mono">
          One brawler per archetype × rarity slot. Dead state is the same
          sprite with a red X overlay, not shown here for brevity.
        </p>
      </div>

      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {cards.map((c, i) => (
          <div key={`${c.tokenId}-${i}`} className="brawl-card p-3 space-y-2">
            <div className="text-xs brawl-header text-brawl-orange capitalize">
              {c.archetype === 'royal'
                ? 'King Brawler'
                : c.archetype === 'spartan'
                  ? `${c.rarity} · Chief`
                  : `${c.rarity} · ${c.archetype}`}
            </div>
            <div
              className="aspect-square w-full bg-brawl-bg pixel"
              style={{ imageRendering: 'pixelated' }}
              dangerouslySetInnerHTML={{ __html: c.svg }}
            />
            <div className="text-sm font-mono text-brawl-text-faint">
              #{c.tokenId} · {c.weapon}
            </div>
          </div>
        ))}
      </div>

      <div className="text-sm text-brawl-text-faint">
        Refresh after redeploys. Same tokenId → same character (deterministic LCG).
      </div>
    </div>
  );
}
