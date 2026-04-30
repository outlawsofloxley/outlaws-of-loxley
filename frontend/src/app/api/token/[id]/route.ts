/**
 * GET /api/token/:id — ERC-721 metadata JSON for brawler `id`.
 *
 * Conforms to the OpenSea metadata standard so the art shows up correctly in
 * wallets and marketplaces. Fields:
 *   - name, description, external_url, image (absolute URL)
 *   - attributes[] with trait_type / value pairs for every relevant on-chain
 *     field (weapon, rarity, level, ELO, record, stats, alive/dead)
 *
 * Chain state is read live; when a duel updates ELO/wins, a refetch of this
 * endpoint reflects it. Cache-Control is tight (60s) so OpenSea refreshes.
 *
 * Contract hybrid model (Phase 7a option C): Brawlers.sol stores a baseURI;
 * `tokenURI(id)` returns `baseURI + id`. baseURI is set to the deployed
 * frontend's origin via setBaseURI(owner).
 */
import { NextResponse } from 'next/server';
import { createPublicClient, defineChain, http } from 'viem';
import { BRAWLERS_ABI } from '@/lib/abi';

export const runtime = 'nodejs';

const WEAPON_TYPE_LABEL = ['Blade', 'Blunt', 'Ranged'] as const;

interface OnchainBrawlerView {
  readonly strength: number;
  readonly dexterity: number;
  readonly constitution: number;
  readonly intelligence: number;
  readonly wisdom: number;
  readonly charisma: number;
  readonly weaponId: number;
  readonly level: number;
  readonly xp: number;
  readonly elo: number;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly isDead: boolean;
  readonly name: string;
}

interface OnchainWeaponView {
  readonly name: string;
  readonly damageMin: number;
  readonly damageMax: number;
  readonly speed: number;
  readonly weaponType: number;
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

function rarityFor(
  weight: number,
): 'Common' | 'Uncommon' | 'Rare' | 'Legendary' | 'Epic' | 'King' {
  // Phase 7+ swap: Epic is the rarest normal tier (weights 1-2), Legendary
  // sits just below it (weights 3-5). King is the 1-of-1 at weight 0.
  if (weight === 0) return 'King';
  if (weight >= 15) return 'Common';
  if (weight >= 11) return 'Uncommon';
  if (weight >= 7) return 'Rare';
  if (weight >= 3) return 'Legendary';
  return 'Epic';
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const tokenId = Number.parseInt(rawId, 10);
  if (!Number.isInteger(tokenId) || tokenId < 1 || String(tokenId) !== rawId) {
    return NextResponse.json(
      { error: 'tokenId must be a positive integer' },
      { status: 400 },
    );
  }

  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
  const chainIdStr = process.env.NEXT_PUBLIC_CHAIN_ID;
  const brawlersAddr = process.env.NEXT_PUBLIC_BRAWLERS_ADDRESS;
  if (!rpcUrl || !chainIdStr || !brawlersAddr) {
    return NextResponse.json(
      { error: 'Server env missing RPC / chain / brawlers address' },
      { status: 500 },
    );
  }
  const chainId = Number.parseInt(chainIdStr, 10);
  const chain = buildChain(chainId, rpcUrl);
  const client = createPublicClient({ chain, transport: http(rpcUrl) });

  let onchainBrawler: OnchainBrawlerView;
  let onchainWeapon: OnchainWeaponView;
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
    onchainBrawler = rawBrawler as unknown as OnchainBrawlerView;
    onchainWeapon = rawWeapon as unknown as OnchainWeaponView;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // If the contract reverts with BrawlerDoesNotExist, treat as 404.
    const status = /BrawlerDoesNotExist|nonexistent|does not exist/i.test(msg) ? 404 : 500;
    return NextResponse.json(
      { error: `Failed to read brawler #${tokenId}: ${msg}` },
      { status },
    );
  }

  const origin = new URL(request.url).origin;
  const imageUrl = `${origin}/api/token/${tokenId}/image`;
  const externalUrl = `${origin}/brawler/${tokenId}`;
  const weaponTypeLabel = WEAPON_TYPE_LABEL[onchainWeapon.weaponType] ?? 'Unknown';
  const rarity = rarityFor(onchainWeapon.weight);
  const record = `${onchainBrawler.wins}W/${onchainBrawler.losses}L/${onchainBrawler.ties}T`;

  const body = {
    name: `Brawler #${tokenId} — ${onchainBrawler.name}`,
    description:
      `${onchainBrawler.name} wields a ${onchainWeapon.name} (${weaponTypeLabel}, ${rarity}). ` +
      `Record ${record}, Rating ${onchainBrawler.elo}, level ${onchainBrawler.level}. ` +
      (onchainBrawler.isDead ? 'Currently in the graveyard.' : 'Alive and fighting.'),
    external_url: externalUrl,
    image: imageUrl,
    attributes: [
      { trait_type: 'Weapon', value: onchainWeapon.name },
      { trait_type: 'Weapon Type', value: weaponTypeLabel },
      { trait_type: 'Rarity', value: rarity },
      { trait_type: 'Status', value: onchainBrawler.isDead ? 'Dead' : 'Alive' },
      { trait_type: 'Level', value: onchainBrawler.level, display_type: 'number' },
      { trait_type: 'Rating', value: onchainBrawler.elo, display_type: 'number' },
      { trait_type: 'Wins', value: onchainBrawler.wins, display_type: 'number' },
      { trait_type: 'Losses', value: onchainBrawler.losses, display_type: 'number' },
      { trait_type: 'Ties', value: onchainBrawler.ties, display_type: 'number' },
      { trait_type: 'Strength', value: onchainBrawler.strength, display_type: 'number' },
      { trait_type: 'Dexterity', value: onchainBrawler.dexterity, display_type: 'number' },
      { trait_type: 'Constitution', value: onchainBrawler.constitution, display_type: 'number' },
      { trait_type: 'Intelligence', value: onchainBrawler.intelligence, display_type: 'number' },
      { trait_type: 'Wisdom', value: onchainBrawler.wisdom, display_type: 'number' },
      { trait_type: 'Charisma', value: onchainBrawler.charisma, display_type: 'number' },
    ],
  };

  return NextResponse.json(body, {
    headers: {
      // Short cache — lets OpenSea pick up Rating/record changes after duels.
      'Cache-Control': 'public, max-age=60, s-maxage=60',
    },
  });
}
