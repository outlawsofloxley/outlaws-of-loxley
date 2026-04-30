/**
 * Pixel-art brawler portrait. Thin React wrapper around renderPixelAvatarSvg —
 * the SVG string is produced by the same pure function that the
 * /api/token/[id]/image route uses, so the client card and external
 * marketplaces (OpenSea, wallets) show the same picture.
 */
import { renderPixelAvatarSvg } from '@/lib/pixelAvatarSvg';
import type { RarityTier } from '@/lib/brawlerArt';

interface PixelAvatarProps {
  tokenId: number;
  weaponName: string;
  rarity?: RarityTier;
  isDead?: boolean;
  /** Ignored — kept for backwards compat. */
  gridSize?: number;
  className?: string;
}

export function PixelAvatar({
  tokenId,
  weaponName,
  rarity,
  isDead = false,
  className,
}: PixelAvatarProps) {
  const svg = renderPixelAvatarSvg({ tokenId, weaponName, rarity, isDead });
  return (
    <div
      className={className}
      aria-label={`Brawler #${tokenId} portrait`}
      role="img"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
