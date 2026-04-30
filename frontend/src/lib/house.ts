/**
 * Client-side helpers for the "house fighters" label.
 *
 * The source of truth is the DB-backed whitelist served by
 * `/api/house/whitelist` (fetched via the `useHouseWhitelist` hook).
 * This module just packages the predicate used by card/lineup components.
 *
 * A brawler is HOUSE when BOTH:
 *   - Its owner == NEXT_PUBLIC_HOUSE_KEEPER_ADDRESS
 *   - Its tokenId appears in the whitelist Set
 */

export function isHouseBrawler(
  tokenId: number,
  ownerAddress: string,
  keeperAddress: `0x${string}` | null,
  whitelist: ReadonlySet<number> | null | undefined,
): boolean {
  if (!keeperAddress) return false;
  if (!whitelist || !whitelist.has(tokenId)) return false;
  return ownerAddress.toLowerCase() === keeperAddress.toLowerCase();
}
