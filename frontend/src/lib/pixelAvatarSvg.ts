/**
 * SVG string generator for brawler portraits. Thin wrapper around
 * renderBrawlerArt (Fantums-inspired 32×32 generator).
 *
 * Kept as a stable entry point so existing imports (`PixelAvatar`,
 * `/api/token/[id]/image`) don't need to change when the art pipeline
 * iterates. Deterministic per (tokenId, weaponName, rarity, isDead).
 */
import { renderBrawlerArt, type RarityTier } from './brawlerArt';

export interface PixelAvatarOpts {
  tokenId: number;
  weaponName: string;
  rarity?: RarityTier | undefined;
  isDead?: boolean | undefined;
  /** Ignored, kept for backwards compatibility with old call sites. */
  gridSize?: number | undefined;
}

export function renderPixelAvatarSvg(opts: PixelAvatarOpts): string {
  return renderBrawlerArt({
    tokenId: opts.tokenId,
    weaponName: opts.weaponName,
    rarity: opts.rarity,
    isDead: opts.isDead,
  });
}
