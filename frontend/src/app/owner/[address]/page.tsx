'use client';

/**
 * /owner/[address], list all brawlers owned by an arbitrary wallet.
 * Linked from the detail page's owner field. Read-only.
 */
import { use, useMemo } from 'react';
import Link from 'next/link';
import { isAddress } from 'viem';
import { useAccount } from 'wagmi';
import { useAllBrawlers } from '@/hooks/useAllBrawlers';
import { BrawlerCard } from '@/components/BrawlerCard';
import { BrawlerCardSkeletonGrid } from '@/components/BrawlerCardSkeleton';

function shortAddr(a: string): string {
  return a.length >= 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export default function OwnerPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address: rawAddr } = use(params);
  const { brawlers, isLoading, error, refetch } = useAllBrawlers();
  const { address: connectedAddress } = useAccount();

  const valid = isAddress(rawAddr);
  const target = valid ? (rawAddr.toLowerCase() as `0x${string}`) : null;
  const isMe =
    target !== null &&
    !!connectedAddress &&
    connectedAddress.toLowerCase() === target;

  const owned = useMemo(() => {
    if (target === null) return [];
    return brawlers.filter((b) => b.owner.toLowerCase() === target);
  }, [brawlers, target]);

  const alive = owned.filter((b) => !b.isDead).length;
  const dead = owned.length - alive;

  if (!valid) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-16 text-center space-y-6">
        <h1 className="brawl-header text-2xl text-brawl-red">Invalid Address</h1>
        <p className="text-brawl-text-dim">
          &ldquo;{rawAddr}&rdquo; isn&rsquo;t a valid 0x-prefixed 40-char EVM address.
        </p>
        <Link href="/browse" className="brawl-btn brawl-btn-secondary inline-block">
          &larr; Back to Browse
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-6 border-b border-brawl-border pb-4">
        <div className="min-w-0">
          <div className="text-xs brawl-header text-brawl-text-faint mb-1">
            {isMe ? 'Your Roster' : 'Roster'}
          </div>
          <h1
            className="brawl-header text-lg md:text-xl text-brawl-text break-all"
            title={rawAddr}
          >
            {shortAddr(rawAddr)}
          </h1>
          <p className="text-sm text-brawl-text-dim mt-2 font-mono break-all">{rawAddr}</p>
        </div>
        <div className="text-left md:text-right text-sm font-mono text-brawl-text-dim">
          {!isLoading && !error && (
            <>
              <div>
                <span className="text-brawl-cyan">{owned.length}</span> total
              </div>
              <div>
                <span className="text-brawl-green">{alive}</span> alive
              </div>
              {dead > 0 && (
                <div>
                  <span className="text-brawl-red">{dead}</span> dead
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="brawl-card p-6 border-brawl-red">
          <h2 className="brawl-header text-sm text-brawl-red mb-2">Failed to load roster</h2>
          <p className="text-sm text-brawl-text-dim mb-4">{error.message}</p>
          <button type="button" className="brawl-btn brawl-btn-secondary" onClick={refetch}>
            Retry
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading && !error && <BrawlerCardSkeletonGrid count={6} />}

      {/* Empty */}
      {!isLoading && !error && owned.length === 0 && (
        <div className="brawl-card p-8 text-center space-y-3">
          <div className="brawl-header text-sm text-brawl-text-dim">
            {isMe ? 'You don’t own any brawlers yet' : 'No brawlers owned by this address'}
          </div>
          <p className="text-sm text-brawl-text-dim">
            {isMe ? (
              <>
                Mint one from{' '}
                <Link href="/mint" className="text-brawl-orange hover:underline">
                  /mint
                </Link>
                .
              </>
            ) : (
              'This wallet hasn’t been minted to or hasn’t been transferred a brawler.'
            )}
          </p>
        </div>
      )}

      {/* Grid */}
      {!isLoading && !error && owned.length > 0 && (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {owned.map((b) => (
            <BrawlerCard key={b.tokenId} brawler={b} />
          ))}
        </div>
      )}

      <div className="mt-8 text-xs">
        <Link href="/browse" className="text-brawl-text-dim hover:text-brawl-orange font-mono">
          &larr; Back to full roster
        </Link>
      </div>
    </div>
  );
}
