'use client';

/**
 * MarketplacePanel — handles list / update / cancel / buy interactions on
 * the brawler detail page. Reads live listing state from the Marketplace
 * contract and renders the right action for whoever's viewing.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import { formatEther, parseEther } from 'viem';
import { BRAWLERS_ABI, MARKETPLACE_ABI } from '@/lib/abi';
import { requireEnv } from '@/lib/env';
import { nativeSymbol } from '@/lib/wagmi';
import { useListing } from '@/hooks/useListing';

interface MarketplacePanelProps {
  tokenId: number;
  owner: `0x${string}`;
  onChange?: () => void;
}

export function MarketplacePanel({ tokenId, owner, onChange }: MarketplacePanelProps) {
  const { env } = requireEnv();
  const { address, isConnected, chainId: activeChainId } = useAccount();
  const rightChain = activeChainId === env.chainId;
  const symbol = nativeSymbol(env.chainId);

  const isOwner = isConnected && !!address && address.toLowerCase() === owner.toLowerCase();

  const { listing, isListed, isApprovedForMarket, refetch: refetchListing } = useListing(
    tokenId,
    owner,
  );

  const { data: feeBpsRaw } = useReadContract({
    abi: MARKETPLACE_ABI,
    address: env.marketplaceAddress,
    functionName: 'feeBps',
    chainId: env.chainId,
  });
  const feeBps = feeBpsRaw !== undefined ? Number(feeBpsRaw) : 500;

  return (
    <div className="brawl-card p-5 space-y-4">
      <h2 className="brawl-header text-sm text-brawl-orange">Marketplace</h2>

      {!isConnected && (
        <p className="text-sm text-brawl-text-dim">
          Connect your wallet to buy or list this brawler.
        </p>
      )}

      {isConnected && !rightChain && (
        <p className="text-xs text-brawl-red">
          Wrong chain — switch to the configured testnet to trade.
        </p>
      )}

      {isConnected && rightChain && isListed && listing && (
        <ListedView
          tokenId={tokenId}
          listing={listing}
          isOwner={isOwner}
          symbol={symbol}
          feeBps={feeBps}
          onChange={() => {
            refetchListing();
            onChange?.();
          }}
        />
      )}

      {isConnected && rightChain && !isListed && isOwner && (
        <UnlistedOwnerView
          tokenId={tokenId}
          owner={owner}
          isApprovedForMarket={isApprovedForMarket}
          symbol={symbol}
          feeBps={feeBps}
          onChange={() => {
            refetchListing();
            onChange?.();
          }}
        />
      )}

      {isConnected && rightChain && !isListed && !isOwner && (
        <p className="text-sm text-brawl-text-dim">
          Not for sale. If you own this brawler, connect that wallet to list it.
        </p>
      )}
    </div>
  );
}

// ─── Buy / seller-manage view ────────────────────────────────────────

function ListedView({
  tokenId,
  listing,
  isOwner,
  symbol,
  feeBps,
  onChange,
}: {
  tokenId: number;
  listing: { seller: `0x${string}`; price: bigint; listedAt: number };
  isOwner: boolean;
  symbol: string;
  feeBps: number;
  onChange: () => void;
}) {
  const { env } = requireEnv();

  const priceLabel = `${formatEther(listing.price)} ${symbol}`;
  const feePct = feeBps / 100;
  const feeAmount = (listing.price * BigInt(feeBps)) / 10_000n;
  const sellerGets = listing.price - feeAmount;

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
      onChange();
      const t = setTimeout(() => reset(), 1500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [isSuccess, onChange, reset]);

  const busy = isSigning || isMining;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-sm font-mono">
        <div>
          <div className="text-xs brawl-header text-brawl-text-faint">PRICE</div>
          <div className="text-brawl-orange text-base font-bold">{priceLabel}</div>
        </div>
        <div className="text-right">
          <div className="text-xs brawl-header text-brawl-text-faint">
            {isOwner ? 'YOU RECEIVE' : 'SELLER RECEIVES'}
          </div>
          <div className="text-brawl-green">{formatEther(sellerGets)} {symbol}</div>
          <div className="text-sm text-brawl-text-faint">
            ({formatEther(feeAmount)} {symbol} fee, {feePct}%)
          </div>
        </div>
      </div>

      {isSuccess && (
        <div className="text-xs text-brawl-green font-mono">
          ✓ Transaction confirmed
        </div>
      )}

      {isOwner ? (
        <SellerActions tokenId={tokenId} listing={listing} symbol={symbol} onChange={onChange} />
      ) : (
        <button
          type="button"
          className="brawl-btn w-full"
          disabled={busy}
          onClick={() =>
            writeContract({
              abi: MARKETPLACE_ABI,
              address: env.marketplaceAddress,
              chainId: env.chainId,
              functionName: 'buy',
              args: [BigInt(tokenId)],
              value: listing.price,
            })
          }
        >
          {isSigning
            ? 'Sign in wallet…'
            : isMining
              ? 'Mining…'
              : `Buy for ${priceLabel}`}
        </button>
      )}

      {(writeError ?? mineError) && (
        <div className="text-xs text-brawl-red break-words font-mono">
          {(writeError ?? mineError)?.message}
        </div>
      )}
    </div>
  );
}

function SellerActions({
  tokenId,
  listing,
  symbol,
  onChange,
}: {
  tokenId: number;
  listing: { price: bigint };
  symbol: string;
  onChange: () => void;
}) {
  const { env } = requireEnv();
  const [mode, setMode] = useState<'idle' | 'updating'>('idle');
  const [newPriceStr, setNewPriceStr] = useState(formatEther(listing.price));

  const {
    writeContract,
    data: txHash,
    isPending: isSigning,
    error: writeError,
    reset,
  } = useWriteContract();
  const { isLoading: isMining, isSuccess, error: mineError } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  useEffect(() => {
    if (isSuccess) {
      onChange();
      setMode('idle');
      const t = setTimeout(() => reset(), 1500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [isSuccess, onChange, reset]);

  const busy = isSigning || isMining;

  const parsedPrice = (() => {
    try {
      return parseEther(newPriceStr || '0');
    } catch {
      return 0n;
    }
  })();
  const canUpdate = parsedPrice > 0n && parsedPrice !== listing.price && !busy;

  if (mode === 'updating') {
    return (
      <div className="space-y-2">
        <label className="text-xs brawl-header text-brawl-text-faint block">
          New price ({symbol})
        </label>
        <input
          type="text"
          inputMode="decimal"
          value={newPriceStr}
          onChange={(e) => setNewPriceStr(e.target.value)}
          className="w-full px-3 py-3 bg-brawl-bg border-2 border-brawl-border text-brawl-text font-mono text-base focus:border-brawl-orange focus:outline-none min-h-[2.75rem]"
        />
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            className="brawl-btn"
            disabled={!canUpdate}
            onClick={() =>
              writeContract({
                abi: MARKETPLACE_ABI,
                address: env.marketplaceAddress,
                chainId: env.chainId,
                functionName: 'updatePrice',
                args: [BigInt(tokenId), parsedPrice],
              })
            }
          >
            {isSigning ? 'Sign…' : isMining ? 'Mining…' : 'Save'}
          </button>
          <button
            type="button"
            className="brawl-btn brawl-btn-secondary"
            onClick={() => setMode('idle')}
            disabled={busy}
          >
            Back
          </button>
        </div>
        {(writeError ?? mineError) && (
          <div className="text-xs text-brawl-red break-words font-mono">
            {(writeError ?? mineError)?.message}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          className="brawl-btn brawl-btn-secondary"
          onClick={() => setMode('updating')}
        >
          Update price
        </button>
        <button
          type="button"
          className="brawl-btn brawl-btn-danger"
          disabled={busy}
          onClick={() =>
            writeContract({
              abi: MARKETPLACE_ABI,
              address: env.marketplaceAddress,
              chainId: env.chainId,
              functionName: 'cancel',
              args: [BigInt(tokenId)],
            })
          }
        >
          {isSigning ? 'Sign…' : isMining ? 'Mining…' : 'Cancel listing'}
        </button>
      </div>
      {(writeError ?? mineError) && (
        <div className="text-xs text-brawl-red break-words font-mono">
          {(writeError ?? mineError)?.message}
        </div>
      )}
    </div>
  );
}

// ─── List-as-owner view (not yet listed) ─────────────────────────────

function UnlistedOwnerView({
  tokenId,
  owner,
  isApprovedForMarket,
  symbol,
  feeBps,
  onChange,
}: {
  tokenId: number;
  owner: `0x${string}`;
  isApprovedForMarket: boolean;
  symbol: string;
  feeBps: number;
  onChange: () => void;
}) {
  const { env } = requireEnv();
  const [priceStr, setPriceStr] = useState('1');

  const {
    writeContract: approveWrite,
    data: approveTxHash,
    isPending: isApproving,
    error: approveError,
    reset: resetApprove,
  } = useWriteContract();
  const { isLoading: isApproveMining, isSuccess: approveMined } = useWaitForTransactionReceipt({
    hash: approveTxHash,
  });

  const {
    writeContract: listWrite,
    data: listTxHash,
    isPending: isListSigning,
    error: listError,
    reset: resetList,
  } = useWriteContract();
  const { isLoading: isListMining, isSuccess: listMined } = useWaitForTransactionReceipt({
    hash: listTxHash,
  });

  // After approval mines, trigger the list call automatically if the user
  // intended a bundled approve+list.
  const [autoListQueued, setAutoListQueued] = useState(false);

  const parsedPrice = useMemo(() => {
    try {
      return parseEther(priceStr || '0');
    } catch {
      return 0n;
    }
  }, [priceStr]);

  const doList = () => {
    if (parsedPrice === 0n) return;
    listWrite({
      abi: MARKETPLACE_ABI,
      address: env.marketplaceAddress,
      chainId: env.chainId,
      functionName: 'list',
      args: [BigInt(tokenId), parsedPrice],
    });
  };

  const doApproveAndList = () => {
    setAutoListQueued(true);
    approveWrite({
      abi: BRAWLERS_ABI,
      address: env.brawlersAddress,
      chainId: env.chainId,
      functionName: 'approve',
      args: [env.marketplaceAddress, BigInt(tokenId)],
    });
  };

  useEffect(() => {
    if (approveMined && autoListQueued && !listTxHash && !isListSigning) {
      setAutoListQueued(false);
      doList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveMined, autoListQueued, listTxHash, isListSigning]);

  useEffect(() => {
    if (listMined) {
      onChange();
      const t = setTimeout(() => {
        resetApprove();
        resetList();
      }, 1500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [listMined, onChange, resetApprove, resetList]);

  const busy = isApproving || isApproveMining || isListSigning || isListMining;
  const feePct = feeBps / 100;
  const feeAmount = (parsedPrice * BigInt(feeBps)) / 10_000n;
  const sellerGets = parsedPrice - feeAmount;

  return (
    <div className="space-y-3">
      <p className="text-sm text-brawl-text-dim">
        List your brawler for sale. Price in {symbol}, not BRAWL. The marketplace
        takes a {feePct}% cut of each sale.
      </p>
      <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
        <input
          type="text"
          inputMode="decimal"
          value={priceStr}
          onChange={(e) => setPriceStr(e.target.value)}
          className="w-full px-3 py-3 bg-brawl-bg border-2 border-brawl-border text-brawl-text font-mono text-base focus:border-brawl-orange focus:outline-none min-h-[2.75rem]"
          placeholder="1.0"
        />
        <span className="text-sm font-mono text-brawl-text-dim">{symbol}</span>
      </div>
      {parsedPrice > 0n && (
        <div className="text-sm font-mono text-brawl-text-dim">
          At this price: you receive{' '}
          <span className="text-brawl-green">
            {formatEther(sellerGets)} {symbol}
          </span>
          , fee is{' '}
          <span className="text-brawl-text-dim">
            {formatEther(feeAmount)} {symbol}
          </span>
          .
        </div>
      )}
      {isApprovedForMarket ? (
        <button
          type="button"
          className="brawl-btn w-full"
          disabled={busy || parsedPrice === 0n}
          onClick={doList}
        >
          {isListSigning ? 'Sign list tx…' : isListMining ? 'Mining…' : 'List for sale'}
        </button>
      ) : (
        <button
          type="button"
          className="brawl-btn w-full"
          disabled={busy || parsedPrice === 0n}
          onClick={doApproveAndList}
        >
          {isApproving
            ? 'Sign approve…'
            : isApproveMining
              ? 'Approving…'
              : isListSigning
                ? 'Sign list…'
                : isListMining
                  ? 'Mining…'
                  : 'Approve & List'}
        </button>
      )}
      {(approveError ?? listError) && (
        <div className="text-xs text-brawl-red break-words font-mono">
          {(approveError ?? listError)?.message}
        </div>
      )}
      <div className="text-sm text-brawl-text-faint font-mono">
        Seller: <span className="text-brawl-text-dim">{owner}</span>
      </div>
    </div>
  );
}
