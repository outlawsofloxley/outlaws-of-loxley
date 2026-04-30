'use client';

/**
 * useListing, on-chain listing state for a single tokenId.
 *
 * Reads `listingOf(tokenId)` and `isApprovedForMarketplace(tokenId, owner)`
 * from the Marketplace contract. Used on the brawler detail page to render
 * the right action button (List / Update / Cancel / Buy) based on live state.
 */
import { useMemo } from 'react';
import { useReadContracts } from 'wagmi';
import { MARKETPLACE_ABI } from '@/lib/abi';
import { requireEnv } from '@/lib/env';

export interface BrawlerListing {
  seller: `0x${string}`;
  price: bigint;
  listedAt: number;
}

interface OnchainListing {
  seller: `0x${string}`;
  price: bigint;
  listedAt: bigint;
}

export interface UseListingResult {
  readonly listing: BrawlerListing | null;
  readonly isListed: boolean;
  readonly isApprovedForMarket: boolean;
  readonly isLoading: boolean;
  readonly refetch: () => void;
}

export function useListing(tokenId: number | undefined, owner: `0x${string}` | undefined): UseListingResult {
  const { env } = requireEnv();

  const validId =
    tokenId !== undefined && Number.isInteger(tokenId) && tokenId >= 1 ? tokenId : undefined;

  const contracts = useMemo(() => {
    if (validId === undefined) return [];
    const idArgs = [BigInt(validId)] as const;
    const base = [
      {
        abi: MARKETPLACE_ABI,
        address: env.marketplaceAddress,
        functionName: 'listingOf' as const,
        args: idArgs,
        chainId: env.chainId,
      },
    ];
    if (owner) {
      return [
        ...base,
        {
          abi: MARKETPLACE_ABI,
          address: env.marketplaceAddress,
          functionName: 'isApprovedForMarketplace' as const,
          args: [BigInt(validId), owner] as const,
          chainId: env.chainId,
        },
      ];
    }
    return base;
  }, [validId, owner, env.marketplaceAddress, env.chainId]);

  const { data, isLoading, refetch } = useReadContracts({
    contracts,
    query: { enabled: contracts.length > 0 },
  });

  const listingRes = data?.[0];
  const approvedRes = data?.[1];

  const listing: BrawlerListing | null = useMemo(() => {
    if (!listingRes || listingRes.status !== 'success') return null;
    const raw = listingRes.result as unknown as OnchainListing;
    if (!raw || raw.seller === '0x0000000000000000000000000000000000000000') return null;
    return {
      seller: raw.seller,
      price: raw.price,
      listedAt: Number(raw.listedAt),
    };
  }, [listingRes]);

  const isApprovedForMarket = useMemo(() => {
    if (!approvedRes || approvedRes.status !== 'success') return false;
    return approvedRes.result === true;
  }, [approvedRes]);

  return {
    listing,
    isListed: listing !== null,
    isApprovedForMarket,
    isLoading,
    refetch: () => {
      void refetch();
    },
  };
}
