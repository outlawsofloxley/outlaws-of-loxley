'use client';

/**
 * Turn 5 — Graveyard page + resurrect flow.
 *
 * Dead brawlers (3 consecutive losses) are filtered out of /browse's "alive"
 * view and land here. The Graveyard contract accepts a `resurrect(tokenId)`
 * call with msg.value == resurrectionCost (currently 0.01 ETH) to bring one
 * back. Only the owner can resurrect their own.
 */
import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { formatEther } from 'viem';
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { useAllBrawlers } from '@/hooks/useAllBrawlers';
import type { Brawler } from '@/hooks/useBrawler';
import { GRAVEYARD_ABI } from '@/lib/abi';
import { requireEnv } from '@/lib/env';
import { nativeSymbol } from '@/lib/wagmi';
import { PixelAvatar } from '@/components/PixelAvatar';
import { BrawlerCardSkeleton } from '@/components/BrawlerCardSkeleton';
import { rarityFromWeight } from '@/lib/rarity';

export default function GraveyardPage() {
  const { env } = requireEnv();
  const { brawlers, isLoading, error, refetch } = useAllBrawlers();
  const { address, isConnected } = useAccount();

  const dead = useMemo(() => brawlers.filter((b) => b.isDead), [brawlers]);

  const { data: resurrectionCost } = useReadContract({
    abi: GRAVEYARD_ABI,
    address: env.graveyardAddress,
    functionName: 'resurrectionCost',
    chainId: env.chainId,
  });

  const symbol = nativeSymbol(env.chainId);
  const costEth = resurrectionCost ? formatEther(resurrectionCost) : '0.01';

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
      <div className="flex items-end justify-between mb-6 border-b border-brawl-border pb-4">
        <div>
          <h1 className="brawl-header text-2xl md:text-3xl text-brawl-text mb-2">Graveyard</h1>
          <p className="text-sm text-brawl-text-dim">
            Brawlers who lost three in a row. Resurrect your own for{' '}
            <span className="text-brawl-orange">{costEth} {symbol}</span>.
          </p>
        </div>
        <div className="text-right text-sm font-mono text-brawl-text-dim">
          {!isLoading && !error && (
            <div>
              <span className="text-brawl-red">{dead.length}</span> entombed
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="brawl-card p-6 border-brawl-red">
          <h2 className="brawl-header text-sm text-brawl-red mb-2">Failed to load graveyard</h2>
          <p className="text-sm text-brawl-text-dim mb-4">{error.message}</p>
          <button type="button" className="brawl-btn brawl-btn-secondary" onClick={refetch}>
            Retry
          </button>
        </div>
      )}

      {isLoading && !error && (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <BrawlerCardSkeleton key={i} />
          ))}
        </div>
      )}

      {!isLoading && !error && dead.length === 0 && (
        <div className="brawl-card p-8 text-center space-y-3">
          <div className="brawl-header text-sm text-brawl-text-dim">The graveyard is empty</div>
          <p className="text-sm text-brawl-text-dim">
            No brawlers have died yet. Lose three duels in a row and you&rsquo;ll end up here.
          </p>
        </div>
      )}

      {!isLoading && !error && dead.length > 0 && (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {dead.map((b) => (
            <GraveyardCard
              key={b.tokenId}
              brawler={b}
              resurrectionCost={resurrectionCost}
              costEth={costEth}
              symbol={symbol}
              connectedAddress={address}
              isConnected={isConnected}
              onResurrected={refetch}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface GraveyardCardProps {
  brawler: Brawler;
  resurrectionCost: bigint | undefined;
  costEth: string;
  symbol: string;
  connectedAddress: `0x${string}` | undefined;
  isConnected: boolean;
  onResurrected: () => void;
}

function GraveyardCard({
  brawler,
  resurrectionCost: _unusedBase,
  costEth: _unusedCost,
  symbol,
  connectedAddress,
  isConnected,
  onResurrected,
}: GraveyardCardProps) {
  const { env } = requireEnv();
  const isOwner =
    isConnected &&
    !!connectedAddress &&
    brawler.owner.toLowerCase() === connectedAddress.toLowerCase();

  // Per-brawler cost — scaled by rarity tier + wins via Graveyard.costFor.
  const { data: perBrawlerCost } = useReadContract({
    abi: GRAVEYARD_ABI,
    address: env.graveyardAddress,
    functionName: 'costFor',
    args: [BigInt(brawler.tokenId)],
    chainId: env.chainId,
  });

  const {
    writeContract,
    data: txHash,
    isPending: isSigning,
    error: writeError,
    reset,
  } = useWriteContract();
  const {
    isLoading: isMining,
    isSuccess,
    error: mineError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (isSuccess) {
      onResurrected();
      // Don't reset immediately — give the user a moment to see the success state
      const t = setTimeout(() => reset(), 1500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [isSuccess, onResurrected, reset]);

  const canResurrect =
    isOwner && perBrawlerCost !== undefined && !isSigning && !isMining && !isSuccess;

  const doResurrect = () => {
    if (perBrawlerCost === undefined) return;
    writeContract({
      abi: GRAVEYARD_ABI,
      address: env.graveyardAddress,
      chainId: env.chainId,
      functionName: 'resurrect',
      args: [BigInt(brawler.tokenId)],
      value: perBrawlerCost,
    });
  };

  const perBrawlerCostLabel =
    perBrawlerCost !== undefined ? `${formatEther(perBrawlerCost)} ${symbol}` : '…';

  const record = `${brawler.wins}W / ${brawler.losses}L / ${brawler.ties}T`;

  return (
    <div className="brawl-card p-4 space-y-3 opacity-90 hover:opacity-100 transition-opacity">
      <div className="flex items-start gap-3">
        <Link href={`/brawler/${brawler.tokenId}`} className="shrink-0">
          <div className="w-24 h-24 bg-brawl-bg">
            <PixelAvatar
              tokenId={brawler.tokenId}
              weaponName={brawler.weapon.name}
              rarity={rarityFromWeight(brawler.weapon.weight)}
              isDead
              className="w-full h-full pixel"
            />
          </div>
        </Link>
        <div className="min-w-0 flex-1 space-y-1">
          <Link
            href={`/brawler/${brawler.tokenId}`}
            className="block brawl-header text-sm text-brawl-text-faint line-through truncate hover:text-brawl-orange"
            title={brawler.name}
          >
            {brawler.name}
          </Link>
          <div className="text-sm font-mono text-brawl-text-faint">
            #{brawler.tokenId} &dagger; In Graveyard
          </div>
          <div className="text-sm font-mono">
            <span className="text-brawl-text-dim">RATING </span>
            <span className="text-brawl-cyan">{brawler.elo}</span>
          </div>
          <div className="text-sm font-mono text-brawl-text-dim">{record}</div>
          <div className="text-xs text-brawl-yellow truncate">{brawler.weapon.name}</div>
        </div>
      </div>

      {isSuccess && (
        <div className="text-xs text-brawl-green font-mono">
          ✓ Resurrected. The graveyard will update shortly.
        </div>
      )}

      {!isSuccess && isOwner && (
        <>
          <button
            type="button"
            className="brawl-btn w-full"
            disabled={!canResurrect}
            onClick={doResurrect}
          >
            {isSigning
              ? 'Sign in wallet…'
              : isMining
                ? 'Mining…'
                : `Resurrect (${perBrawlerCostLabel})`}
          </button>
          {(writeError ?? mineError) && (
            <div className="text-xs text-brawl-red break-words font-mono">
              {(writeError ?? mineError)?.message}
            </div>
          )}
        </>
      )}
      {!isSuccess && !isOwner && (
        <div className="text-sm font-mono text-brawl-text-faint">
          {isConnected ? 'Owner only' : 'Connect wallet to resurrect your own'}
        </div>
      )}
    </div>
  );
}
