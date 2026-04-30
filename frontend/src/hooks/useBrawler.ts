'use client';

import { useMemo } from 'react';
import { useReadContracts } from 'wagmi';
import { BRAWLERS_ABI } from '@/lib/abi';
import { requireEnv } from '@/lib/env';

export interface OnchainBrawlerView {
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  weaponId: number;
  level: number;
  xp: number;
  elo: number;
  wins: number;
  losses: number;
  ties: number;
  isDead: boolean;
  name: string;
}

export interface OnchainWeaponView {
  name: string;
  damageMin: number;
  damageMax: number;
  speed: number;
  weaponType: number;
  weight: number;
}

export interface Brawler {
  readonly tokenId: number;
  readonly name: string;
  readonly level: number;
  readonly xp: number;
  readonly elo: number;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly isDead: boolean;
  readonly owner: `0x${string}`;
  readonly stats: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
  readonly weapon: {
    name: string;
    damageMin: number;
    damageMax: number;
    speed: number;
    weaponType: number;
    weight: number;
  };
}

export function stitchBrawler(
  tokenId: number,
  b: OnchainBrawlerView,
  w: OnchainWeaponView,
  owner: `0x${string}`,
): Brawler {
  return {
    tokenId,
    name: b.name,
    level: b.level,
    xp: b.xp,
    elo: b.elo,
    wins: b.wins,
    losses: b.losses,
    ties: b.ties,
    isDead: b.isDead,
    owner,
    stats: {
      strength: b.strength,
      dexterity: b.dexterity,
      constitution: b.constitution,
      intelligence: b.intelligence,
      wisdom: b.wisdom,
      charisma: b.charisma,
    },
    weapon: {
      name: w.name,
      damageMin: w.damageMin,
      damageMax: w.damageMax,
      speed: w.speed,
      weaponType: w.weaponType,
      weight: w.weight,
    },
  };
}

interface UseBrawlerResult {
  readonly brawler: Brawler | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
}

/**
 * Fetch a single brawler by tokenId. Batches getBrawler + getBrawlerWeapon +
 * ownerOf into one multicall so the detail page loads in a single RPC round-trip.
 *
 * Returns `brawler: null` when tokenId is missing/invalid OR when any sub-call
 * reverts (e.g. tokenId doesn't exist). Callers distinguish "loading" from
 * "not found" by checking `isLoading` first.
 */
export function useBrawler(tokenId: number | undefined): UseBrawlerResult {
  const { env } = requireEnv();

  const validId =
    tokenId !== undefined && Number.isInteger(tokenId) && tokenId >= 1 ? tokenId : undefined;

  const contracts = useMemo(() => {
    if (validId === undefined) {
      return [];
    }
    const args = [BigInt(validId)] as const;
    return [
      {
        abi: BRAWLERS_ABI,
        address: env.brawlersAddress,
        functionName: 'getBrawler' as const,
        args,
        chainId: env.chainId,
      },
      {
        abi: BRAWLERS_ABI,
        address: env.brawlersAddress,
        functionName: 'getBrawlerWeapon' as const,
        args,
        chainId: env.chainId,
      },
      {
        abi: BRAWLERS_ABI,
        address: env.brawlersAddress,
        functionName: 'ownerOf' as const,
        args,
        chainId: env.chainId,
      },
    ];
  }, [validId, env.brawlersAddress, env.chainId]);

  const { data, isLoading, error, refetch } = useReadContracts({
    contracts,
    query: { enabled: contracts.length > 0 },
  });

  const brawler = useMemo<Brawler | null>(() => {
    if (!data || validId === undefined) {
      return null;
    }
    const [brawlerRes, weaponRes, ownerRes] = data;
    if (
      !brawlerRes ||
      brawlerRes.status !== 'success' ||
      !weaponRes ||
      weaponRes.status !== 'success' ||
      !ownerRes ||
      ownerRes.status !== 'success'
    ) {
      return null;
    }
    const b = brawlerRes.result as unknown as OnchainBrawlerView;
    const w = weaponRes.result as unknown as OnchainWeaponView;
    const owner = ownerRes.result as `0x${string}`;
    return stitchBrawler(validId, b, w, owner);
  }, [data, validId]);

  return {
    brawler,
    isLoading,
    error: error ?? null,
    refetch: () => {
      void refetch();
    },
  };
}
