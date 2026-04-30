/**
 * GET /api/token/:id/image, SVG portrait for brawler `id`.
 *
 * Reads weaponName + isDead from the chain, hands them to the same
 * renderPixelAvatarSvg helper that the in-app PixelAvatar uses. Single source
 * of truth for art across client cards and external marketplaces.
 *
 * Phase 7a placeholder: procedural pixel silhouette. Real art lands here when
 * the art pipeline ships, either replace renderPixelAvatarSvg or fetch from
 * IPFS/storage in this route.
 */
import { createPublicClient, defineChain, http } from 'viem';
import { BRAWLERS_ABI } from '@/lib/abi';
import { validateEnv } from '@/lib/env';
import { renderPixelAvatarSvg } from '@/lib/pixelAvatarSvg';
import { rarityFromWeight } from '@/lib/rarity';

export const runtime = 'nodejs';

interface OnchainBrawlerView {
  readonly isDead: boolean;
}

interface OnchainWeaponView {
  readonly name: string;
  readonly weight: number;
}

function buildChain(chainId: number, rpcUrl: string) {
  return defineChain({
    id: chainId,
    name: chainId === 31337 ? 'Anvil Local' : `Chain ${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    testnet: chainId !== 1,
  });
}

function errorSvg(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="100%" height="100%">` +
    `<rect width="200" height="200" fill="#1a1417"/>` +
    `<text x="100" y="100" fill="#c13e3e" font-family="monospace" font-size="14" text-anchor="middle">${escaped}</text>` +
    `</svg>`
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const tokenId = Number.parseInt(rawId, 10);
  if (!Number.isInteger(tokenId) || tokenId < 1 || String(tokenId) !== rawId) {
    return new Response(errorSvg('Invalid token id'), {
      status: 400,
      headers: { 'content-type': 'image/svg+xml; charset=utf-8' },
    });
  }

  const v = validateEnv();
  if (!v.ok) {
    return new Response(errorSvg(`Server env: ${v.errors.join('; ')}`), {
      status: 500,
      headers: { 'content-type': 'image/svg+xml; charset=utf-8' },
    });
  }
  const { rpcUrl, chainId } = v.env;
  const brawlersAddr = v.env.brawlersAddress;
  const chain = buildChain(chainId, rpcUrl);
  const client = createPublicClient({ chain, transport: http(rpcUrl) });

  let isDead = false;
  let weaponName = '';
  let weaponWeight = 0;
  try {
    const [rawBrawler, rawWeapon] = await Promise.all([
      client.readContract({
        abi: BRAWLERS_ABI,
        address: brawlersAddr as `0x${string}`,
        functionName: 'getBrawler',
        args: [BigInt(tokenId)],
      }),
      client.readContract({
        abi: BRAWLERS_ABI,
        address: brawlersAddr as `0x${string}`,
        functionName: 'getBrawlerWeapon',
        args: [BigInt(tokenId)],
      }),
    ]);
    isDead = (rawBrawler as unknown as OnchainBrawlerView).isDead;
    const weaponView = rawWeapon as unknown as OnchainWeaponView;
    weaponName = weaponView.name;
    weaponWeight = weaponView.weight;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /BrawlerDoesNotExist|nonexistent|does not exist/i.test(msg) ? 404 : 500;
    return new Response(errorSvg(`#${tokenId} error`), {
      status,
      headers: { 'content-type': 'image/svg+xml; charset=utf-8' },
    });
  }

  const svg = renderPixelAvatarSvg({
    tokenId,
    weaponName,
    rarity: rarityFromWeight(weaponWeight),
    isDead,
  });
  return new Response(svg, {
    status: 200,
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      // Art can change (isDead flips). Short cache.
      'Cache-Control': 'public, max-age=60, s-maxage=60',
    },
  });
}
