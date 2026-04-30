'use client';

/**
 * useAllBrawlers, fetch every brawler from chain.
 *
 * Strategy:
 *   1. Read `nextTokenId()` from the Brawlers contract.
 *   2. For each id from 1 to nextTokenId-1, fire off three reads:
 *      - getBrawler(id)        → stats + name + ELO + record + isDead
 *      - getBrawlerWeapon(id)  → weapon details
 *      - ownerOf(id)           → owner address (needed for "My Brawlers" filter)
 *   3. wagmi's `useReadContracts` batches these into a multicall (OZ 5 + Anvil
 *      both support Multicall3). N brawlers → 1 RPC for nextTokenId + 1 batched
 *      multicall with 3N sub-calls.
 */
import { useReadContract, useReadContracts } from 'wagmi';
import { useMemo } from 'react';
import { BRAWLERS_ABI } from '@/lib/abi';
import { requireEnv } from '@/lib/env';
import {
  stitchBrawler,
  type Brawler,
  type OnchainBrawlerView,
  type OnchainWeaponView,
} from './useBrawler';

export type { Brawler } from './useBrawler';

interface UseAllBrawlersResult {
  readonly brawlers: readonly Brawler[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
}

export function useAllBrawlers(): UseAllBrawlersResult {
  const { env } = requireEnv();

  // Step 1: get nextTokenId
  const {
    data: nextTokenIdRaw,
    isLoading: isLoadingCount,
    error: countError,
    refetch: refetchCount,
  } = useReadContract({
    abi: BRAWLERS_ABI,
    address: env.brawlersAddress,
    functionName: 'nextTokenId',
    chainId: env.chainId,
  });

  // Is the 1-of-1 King (tokenId 501) minted? Separate from nextTokenId because
  // the King sits outside MAX_SUPPLY.
  const { data: kingMintedData } = useReadContract({
    abi: BRAWLERS_ABI,
    address: env.brawlersAddress,
    functionName: 'kingMinted',
    chainId: env.chainId,
  });

  // Convert nextTokenId -> list of token IDs [1, 2, ..., nextTokenId-1], plus
  // tokenId 501 (KING) when minted. Solidity uses nextTokenId = 1 when empty;
  // the first mint creates tokenId 1 and sets nextTokenId = 2.
  const tokenIds = useMemo(() => {
    if (nextTokenIdRaw === undefined) {
      return [];
    }
    const n = Number(nextTokenIdRaw);
    const ids: number[] = [];
    for (let i = 1; i < n; i++) {
      ids.push(i);
    }
    if (kingMintedData === true) {
      ids.push(501);
    }
    return ids;
  }, [nextTokenIdRaw, kingMintedData]);

  // Step 2: build multicall list, 3 reads per token (brawler, weapon, owner).
  const contracts = useMemo(() => {
    return tokenIds.flatMap((id) => {
      const args = [BigInt(id)] as const;
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
    });
  }, [tokenIds, env.brawlersAddress, env.chainId]);

  const {
    data: multicallData,
    isLoading: isLoadingData,
    error: dataError,
    refetch: refetchData,
  } = useReadContracts({
    contracts,
    query: {
      enabled: contracts.length > 0,
    },
  });

  // Step 3: stitch results back together into typed Brawler objects.
  const brawlers = useMemo<readonly Brawler[]>(() => {
    if (!multicallData || tokenIds.length === 0) {
      return [];
    }
    const result: Brawler[] = [];
    for (let i = 0; i < tokenIds.length; i++) {
      const tokenId = tokenIds[i]!;
      const brawlerRes = multicallData[i * 3];
      const weaponRes = multicallData[i * 3 + 1];
      const ownerRes = multicallData[i * 3 + 2];
      // If any sub-call failed, skip this brawler rather than tanking the whole list
      if (
        !brawlerRes ||
        brawlerRes.status !== 'success' ||
        !weaponRes ||
        weaponRes.status !== 'success' ||
        !ownerRes ||
        ownerRes.status !== 'success'
      ) {
        continue;
      }
      const b = brawlerRes.result as unknown as OnchainBrawlerView;
      const w = weaponRes.result as unknown as OnchainWeaponView;
      const owner = ownerRes.result as `0x${string}`;
      result.push(stitchBrawler(tokenId, b, w, owner));
    }
    return result;
  }, [multicallData, tokenIds]);

  return {
    brawlers,
    isLoading: isLoadingCount || isLoadingData,
    error: countError ?? dataError ?? null,
    refetch: () => {
      void refetchCount();
      void refetchData();
    },
  };
}
