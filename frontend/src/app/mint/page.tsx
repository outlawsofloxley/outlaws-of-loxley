'use client';

/**
 * Mint flow (Phase 7) — pick count + payment → (approve USDT) → sign mint →
 * mine → reveal → success.
 *
 * The mint goes through MintDrop.sol (not Brawlers.mint directly — that's
 * gated to MintDrop/owner). Four call paths:
 *   - single ETH:   `mintWithETH{value: ethPrice}(to)`
 *   - batch ETH:    `mintMultipleWithETH{value: ethPrice*n}(to, n)`
 *   - single USDT:  `approve(usdt, drop, price)` + `mintWithUSDT(to)`
 *   - batch USDT:   `approve(usdt, drop, price*n)` + `mintMultipleWithUSDT(to, n)`
 *
 * The receipt carries one BrawlerMinted event per mint (from Brawlers.sol)
 * and one BrawlerSold per mint (from MintDrop.sol). The success panel
 * decodes ALL of them so a batch of 5 shows all 5 brawlers, not just the
 * first.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import { formatEther, formatUnits, parseEventLogs } from 'viem';
import { BRAWLERS_ABI, ERC20_ABI, MINTDROP_ABI } from '@/lib/abi';
import { requireEnv } from '@/lib/env';
import { nativeSymbol } from '@/lib/wagmi';
import {
  stitchBrawler,
  type Brawler,
  type OnchainBrawlerView,
  type OnchainWeaponView,
} from '@/hooks/useBrawler';
import { PixelAvatar } from '@/components/PixelAvatar';
import { WrongChainPrompt } from '@/components/WrongChainPrompt';
import { rarityFromWeight, rarityLabel, rarityTextClass } from '@/lib/rarity';
import { TxLink } from '@/components/TxLink';

type PaymentType = 'eth' | 'usdt';

type Phase =
  | { kind: 'idle' }
  | { kind: 'approving' }
  | { kind: 'approveMining'; txHash: `0x${string}` }
  | { kind: 'signing' }
  | { kind: 'mining'; txHash: `0x${string}` }
  | { kind: 'reverted'; txHash: `0x${string}` }
  | { kind: 'revealing'; tokenIds: number[]; txHash: `0x${string}` }
  | { kind: 'success'; tokenIds: number[]; txHash: `0x${string}`; airdropped: bigint }
  | { kind: 'error'; message: string };

export default function MintPage() {
  const { env } = requireEnv();
  const { address, isConnected, chainId: activeChainId } = useAccount();
  const rightChain = activeChainId === env.chainId;

  const [paymentType, setPaymentType] = useState<PaymentType>('eth');
  const [count, setCount] = useState<number>(1);

  // --- MintDrop reads ---
  const { data: ethPrice } = useReadContract({
    abi: MINTDROP_ABI,
    address: env.mintDropAddress,
    functionName: 'ethPrice',
    chainId: env.chainId,
  });
  const { data: usdtPrice } = useReadContract({
    abi: MINTDROP_ABI,
    address: env.mintDropAddress,
    functionName: 'usdtPrice',
    chainId: env.chainId,
  });
  const { data: airdropPerMint } = useReadContract({
    abi: MINTDROP_ABI,
    address: env.mintDropAddress,
    functionName: 'airdropPerMint',
    chainId: env.chainId,
  });
  const { data: totalSoldRaw, refetch: refetchSold } = useReadContract({
    abi: MINTDROP_ABI,
    address: env.mintDropAddress,
    functionName: 'totalSold',
    chainId: env.chainId,
  });
  const { data: maxMintRaw } = useReadContract({
    abi: MINTDROP_ABI,
    address: env.mintDropAddress,
    functionName: 'MAX_MINT',
    chainId: env.chainId,
  });
  const totalSold = totalSoldRaw !== undefined ? Number(totalSoldRaw) : null;
  const maxMint = maxMintRaw !== undefined ? Number(maxMintRaw) : null;
  const supplyExhausted = totalSold !== null && maxMint !== null && totalSold >= maxMint;

  // --- USDT allowance check (only when USDT path is active) ---
  const { data: usdtAllowance, refetch: refetchAllowance } = useReadContract({
    abi: ERC20_ABI,
    address: env.usdtAddress,
    functionName: 'allowance',
    args: address ? [address, env.mintDropAddress] : undefined,
    chainId: env.chainId,
    query: { enabled: !!address && paymentType === 'usdt' },
  });
  // ── v5+ tiered pricing: read batchCost(count) — straddles tiers correctly.
  // On v4 this read errors; we fall back to flat ethPrice/usdtPrice/usdcPrice.
  const batchCount = BigInt(Math.max(1, count));
  const batchCostRead = useReadContract({
    abi: MINTDROP_ABI,
    address: env.mintDropAddress,
    functionName: 'batchCost',
    args: [batchCount],
    chainId: env.chainId,
  });
  const tieredAvailable = batchCostRead.error == null && batchCostRead.data !== undefined;
  const batchEthTotal = tieredAvailable
    ? (batchCostRead.data![0] as bigint)
    : ethPrice !== undefined ? ethPrice * batchCount : undefined;
  const batchUsdtTotal = tieredAvailable
    ? (batchCostRead.data![2] as bigint)
    : usdtPrice !== undefined ? usdtPrice * batchCount : undefined;

  const usdtTotalForBatch = batchUsdtTotal;
  const needsApproval =
    paymentType === 'usdt' &&
    usdtTotalForBatch !== undefined &&
    (usdtAllowance === undefined || usdtAllowance < usdtTotalForBatch);

  const { data: usdtBalance } = useReadContract({
    abi: ERC20_ABI,
    address: env.usdtAddress,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: env.chainId,
    query: { enabled: !!address && paymentType === 'usdt' },
  });

  // --- Write hooks: separate for approve and mint ---
  const {
    writeContract: approveWrite,
    data: approveTxHash,
    isPending: isApproving,
    error: approveError,
    reset: resetApprove,
  } = useWriteContract();
  const { isLoading: isApproveMining, isSuccess: approveMined } =
    useWaitForTransactionReceipt({ hash: approveTxHash });

  const {
    writeContract: mintWrite,
    data: mintTxHash,
    isPending: isSigning,
    error: mintError,
    reset: resetMint,
  } = useWriteContract();
  const { data: receipt, isLoading: isMining, error: mineError } =
    useWaitForTransactionReceipt({ hash: mintTxHash });

  // --- Post-approve: refetch allowance ---
  useEffect(() => {
    if (approveMined) {
      void refetchAllowance();
    }
  }, [approveMined, refetchAllowance]);

  // --- Receipt -> decode ALL BrawlerMinted events (one per minted brawler) ---
  const [mintedTokenIds, setMintedTokenIds] = useState<number[] | null>(null);
  const [airdropped, setAirdropped] = useState<bigint>(0n);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    if (!receipt || mintedTokenIds !== null) return;
    if (receipt.status !== 'success') return;
    try {
      const mintedEvents = parseEventLogs({
        abi: BRAWLERS_ABI,
        eventName: 'BrawlerMinted',
        logs: receipt.logs,
      });
      if (mintedEvents.length === 0) {
        setParseError('Mint mined but no BrawlerMinted event in receipt.');
        return;
      }
      const ids = mintedEvents.map((ev) => Number(ev.args.tokenId));
      setMintedTokenIds(ids);

      // Sum airdrops across all BrawlerSold events from MintDrop.
      const soldEvents = parseEventLogs({
        abi: MINTDROP_ABI,
        eventName: 'BrawlerSold',
        logs: receipt.logs,
      });
      const totalAirdrop = soldEvents.reduce((sum, ev) => sum + ev.args.airdropped, 0n);
      setAirdropped(totalAirdrop);

      void refetchSold();
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
    }
  }, [receipt, mintedTokenIds, refetchSold]);

  const { brawlers: mintedBrawlers, isLoading: isRevealing, error: revealError } =
    useBatchBrawlers(mintedTokenIds ?? undefined);

  // --- Phase derivation ---
  const phase: Phase = (() => {
    if (approveError) return { kind: 'error', message: approveError.message };
    if (mintError) return { kind: 'error', message: mintError.message };
    if (mineError) return { kind: 'error', message: mineError.message };
    if (parseError) return { kind: 'error', message: parseError };
    if (revealError) return { kind: 'error', message: revealError.message };

    if (isApproving) return { kind: 'approving' };
    if (approveTxHash && isApproveMining) {
      return { kind: 'approveMining', txHash: approveTxHash };
    }

    if (isSigning) return { kind: 'signing' };
    if (mintTxHash && receipt && receipt.status !== 'success') {
      return { kind: 'reverted', txHash: mintTxHash };
    }
    if (mintTxHash && isMining) return { kind: 'mining', txHash: mintTxHash };

    if (mintedTokenIds !== null && mintTxHash) {
      if (mintedBrawlers && mintedBrawlers.length === mintedTokenIds.length) {
        return {
          kind: 'success',
          tokenIds: mintedTokenIds,
          txHash: mintTxHash,
          airdropped,
        };
      }
      if (isRevealing || !mintedBrawlers) {
        return { kind: 'revealing', tokenIds: mintedTokenIds, txHash: mintTxHash };
      }
    }

    return { kind: 'idle' };
  })();

  const startFresh = () => {
    resetApprove();
    resetMint();
    setMintedTokenIds(null);
    setAirdropped(0n);
    setParseError(null);
  };

  const doApprove = () => {
    if (!usdtPrice) return;
    // Approve max (2^256 - 1) so the user never has to re-approve for later
    // mints. This contract is trustworthy; unbounded approval is fine.
    approveWrite({
      abi: ERC20_ABI,
      address: env.usdtAddress,
      chainId: env.chainId,
      functionName: 'approve',
      args: [env.mintDropAddress, (1n << 256n) - 1n],
    });
  };

  const doMint = () => {
    if (!address) return;
    const n = Math.max(1, Math.min(20, count));
    if (paymentType === 'eth') {
      // Use tiered batch cost when available, flat fallback otherwise.
      const ethValue = batchEthTotal;
      if (ethValue === undefined) return;
      if (n === 1) {
        mintWrite({
          abi: MINTDROP_ABI,
          address: env.mintDropAddress,
          chainId: env.chainId,
          functionName: 'mintWithETH',
          args: [address],
          value: ethValue,
        });
      } else {
        mintWrite({
          abi: MINTDROP_ABI,
          address: env.mintDropAddress,
          chainId: env.chainId,
          functionName: 'mintMultipleWithETH',
          args: [address, BigInt(n)],
          value: ethValue,
        });
      }
    } else {
      if (n === 1) {
        mintWrite({
          abi: MINTDROP_ABI,
          address: env.mintDropAddress,
          chainId: env.chainId,
          functionName: 'mintWithUSDT',
          args: [address],
        });
      } else {
        mintWrite({
          abi: MINTDROP_ABI,
          address: env.mintDropAddress,
          chainId: env.chainId,
          functionName: 'mintMultipleWithUSDT',
          args: [address, BigInt(n)],
        });
      }
    }
  };

  const symbol = nativeSymbol(env.chainId);
  // Per-unit label = total / count (cleaner than reading priceForMint(start)
  // separately). When tiered + batch straddles tiers, this averages, which is
  // fine for the at-a-glance label; the total is what's authoritative.
  const ethPriceLabel = batchEthTotal !== undefined && batchCount > 0n
    ? `${formatEther(batchEthTotal / batchCount)} ${symbol}`
    : ethPrice !== undefined ? `${formatEther(ethPrice)} ${symbol}` : '…';
  const usdtPriceLabel = batchUsdtTotal !== undefined && batchCount > 0n
    ? `${formatUnits(batchUsdtTotal / batchCount, 6)} USDT`
    : usdtPrice !== undefined ? `${formatUnits(usdtPrice, 6)} USDT` : '…';
  const ethTotalLabel = batchEthTotal !== undefined
    ? `${formatEther(batchEthTotal)} ${symbol}`
    : '…';
  const usdtTotalLabel = batchUsdtTotal !== undefined
    ? `${formatUnits(batchUsdtTotal, 6)} USDT`
    : '…';
  const airdropLabel =
    airdropPerMint !== undefined ? `${formatUnits(airdropPerMint, 18)} BRAWL` : '…';
  const supplyLabel =
    totalSold !== null && maxMint !== null ? `${totalSold} / ${maxMint}` : '…';

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-8 py-8 space-y-6">
      <div className="border-b border-brawl-border pb-4">
        <h1 className="brawl-header text-2xl md:text-3xl text-brawl-text mb-2">Mint a Brawler</h1>
        <p className="text-sm text-brawl-text-dim">
          2000 brawlers in the curated initial drop. Stats rolled on-chain from
          a pre-shuffled rarity table — 20 Epic, 40 Legendary, 200 Rare, 500
          Uncommon, 1240 Common, plus the 1-of-1 King.
          {airdropPerMint !== undefined && airdropPerMint > 0n && (
            <> Every mint airdrops <span className="text-brawl-orange">{airdropLabel}</span> to your wallet for dueling.</>
          )}
        </p>
        <div className="mt-3 text-sm font-mono text-brawl-text-dim">
          Minted so far: <span className="text-brawl-cyan">{supplyLabel}</span>
        </div>

        {/* Founder enticements — visible above the fold */}
        <div className="mt-4 grid gap-2 md:grid-cols-3 text-xs">
          <div className="brawl-card p-3 border-2 border-brawl-yellow">
            <div className="brawl-header text-brawl-yellow mb-1">★ FOUNDER 50</div>
            <div className="text-brawl-text-dim">
              Token IDs <strong>1–50</strong> — gold founder badge on your card
              forever, plus all FOUNDER 100 perks.
            </div>
          </div>
          <div className="brawl-card p-3 border-2 border-brawl-cyan">
            <div className="brawl-header text-brawl-cyan mb-1">★ FOUNDER 100</div>
            <div className="text-brawl-text-dim">
              Token IDs <strong>1–100</strong> — silver founder badge, bonus
              <strong> 20 BRAWL</strong> airdrop (enough for 2 fights), and
              your <strong>first resurrect is free</strong>.
            </div>
          </div>
          <div className="brawl-card p-3 border-2 border-brawl-orange">
            <div className="brawl-header text-brawl-orange mb-1">⚔ FIGHTER PERK</div>
            <div className="text-brawl-text-dim">
              Founder 100 fighters pay <strong>25% less BRAWL</strong> per
              duel. Cheaper to play, just as profitable to win.
            </div>
          </div>
        </div>
      </div>

      {!isConnected && <ConnectPrompt />}
      {isConnected && !rightChain && (
        <WrongChainPrompt currentChainId={activeChainId} expectedChainId={env.chainId} />
      )}

      {isConnected && rightChain && (
        <div className="brawl-card p-6 space-y-5">
          <PhaseIndicator phase={phase} />

          {phase.kind === 'idle' && (
            <IdlePanel
              paymentType={paymentType}
              setPaymentType={setPaymentType}
              count={count}
              setCount={setCount}
              symbol={symbol}
              ethPriceLabel={ethPriceLabel}
              usdtPriceLabel={usdtPriceLabel}
              ethTotalLabel={ethTotalLabel}
              usdtTotalLabel={usdtTotalLabel}
              needsApproval={!!needsApproval}
              usdtPrice={usdtPrice}
              usdtBalance={usdtBalance}
              supplyExhausted={supplyExhausted}
              onApprove={doApprove}
              onMint={doMint}
            />
          )}

          {phase.kind === 'approving' && (
            <StatusBlock
              title="Waiting for wallet signature (approve USDT)"
              body="Unlimited approval — you only need to do this once."
            />
          )}
          {phase.kind === 'approveMining' && (
            <StatusBlock
              title="Approving USDT…"
              body="After this confirms, click Mint."
              txHash={phase.txHash}
            />
          )}

          {phase.kind === 'signing' && (
            <StatusBlock
              title="Waiting for wallet signature"
              body="Open your wallet and approve the mint transaction."
            />
          )}

          {phase.kind === 'mining' && (
            <StatusBlock
              title="Mining transaction"
              body="Waiting for the block to confirm."
              txHash={phase.txHash}
            />
          )}

          {phase.kind === 'revealing' && (
            <StatusBlock
              title={
                phase.tokenIds.length === 1
                  ? `Revealing brawler #${phase.tokenIds[0]}`
                  : `Revealing ${phase.tokenIds.length} brawlers`
              }
              body="Reading stats from chain."
              txHash={phase.txHash}
            />
          )}

          {phase.kind === 'reverted' && (
            <RevertedBlock txHash={phase.txHash} onReset={startFresh} />
          )}

          {phase.kind === 'error' && <ErrorBlock message={phase.message} onReset={startFresh} />}

          {phase.kind === 'success' && mintedBrawlers && (
            <SuccessBlock
              tokenIds={phase.tokenIds}
              brawlers={mintedBrawlers}
              txHash={phase.txHash}
              airdropped={phase.airdropped}
              onMintAnother={startFresh}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Batch brawler fetch ───────────────────────────────────────────────
//
// Used by the post-mint reveal to resolve all N minted token IDs in a
// single multicall. Returns brawlers in the same order as tokenIds.
function useBatchBrawlers(tokenIds: number[] | undefined): {
  brawlers: Brawler[] | null;
  isLoading: boolean;
  error: Error | null;
} {
  const { env } = requireEnv();

  const contracts = useMemo(() => {
    if (!tokenIds || tokenIds.length === 0) return [];
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

  const { data, isLoading, error } = useReadContracts({
    contracts,
    query: { enabled: contracts.length > 0 },
  });

  const brawlers = useMemo<Brawler[] | null>(() => {
    if (!data || !tokenIds || tokenIds.length === 0) return null;
    const out: Brawler[] = [];
    for (let i = 0; i < tokenIds.length; i++) {
      const tokenId = tokenIds[i]!;
      const brawlerRes = data[i * 3];
      const weaponRes = data[i * 3 + 1];
      const ownerRes = data[i * 3 + 2];
      if (
        !brawlerRes ||
        brawlerRes.status !== 'success' ||
        !weaponRes ||
        weaponRes.status !== 'success' ||
        !ownerRes ||
        ownerRes.status !== 'success'
      ) {
        return null; // Partial failure → wait for retry rather than showing holes.
      }
      const b = brawlerRes.result as unknown as OnchainBrawlerView;
      const w = weaponRes.result as unknown as OnchainWeaponView;
      const owner = ownerRes.result as `0x${string}`;
      out.push(stitchBrawler(tokenId, b, w, owner));
    }
    return out;
  }, [data, tokenIds]);

  return { brawlers, isLoading, error: error ?? null };
}

function ConnectPrompt() {
  return (
    <div className="brawl-card p-8 text-center space-y-3">
      <div className="brawl-header text-sm text-brawl-text-dim">Wallet not connected</div>
      <p className="text-sm text-brawl-text-dim">
        Connect your wallet from the top-right nav bar to mint.
      </p>
    </div>
  );
}

interface IdlePanelProps {
  paymentType: PaymentType;
  setPaymentType: (p: PaymentType) => void;
  count: number;
  setCount: (n: number) => void;
  symbol: string;
  ethPriceLabel: string;
  usdtPriceLabel: string;
  ethTotalLabel: string;
  usdtTotalLabel: string;
  needsApproval: boolean;
  usdtPrice: bigint | undefined;
  usdtBalance: bigint | undefined;
  supplyExhausted: boolean;
  onApprove: () => void;
  onMint: () => void;
}

function IdlePanel(props: IdlePanelProps) {
  const {
    paymentType,
    setPaymentType,
    count,
    setCount,
    symbol,
    ethPriceLabel,
    usdtPriceLabel,
    ethTotalLabel,
    usdtTotalLabel,
    needsApproval,
    usdtPrice,
    usdtBalance,
    supplyExhausted,
    onApprove,
    onMint,
  } = props;
  // USDT affordability check — batched cost vs balance.
  const totalUsdt = usdtPrice !== undefined ? usdtPrice * BigInt(count) : 0n;
  const hasEnoughUsdt =
    usdtPrice !== undefined && usdtBalance !== undefined && usdtBalance >= totalUsdt;

  if (supplyExhausted) {
    return (
      <div className="brawl-header text-sm text-brawl-red">
        ✦ Initial mint sold out — all 500 minted
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <CountPicker count={count} setCount={setCount} />

      <div>
        <div className="text-xs brawl-header text-brawl-text-faint mb-2">Payment</div>
        <div className="flex gap-2">
          <PaymentTab
            label={`${symbol} · ${ethPriceLabel}`}
            active={paymentType === 'eth'}
            onClick={() => setPaymentType('eth')}
          />
          <PaymentTab
            label={`USDT · ${usdtPriceLabel}`}
            active={paymentType === 'usdt'}
            onClick={() => setPaymentType('usdt')}
          />
        </div>
      </div>

      {paymentType === 'usdt' && usdtBalance !== undefined && (
        <div className="text-sm font-mono text-brawl-text-dim">
          Your USDT balance:{' '}
          <span className={hasEnoughUsdt ? 'text-brawl-cyan' : 'text-brawl-red'}>
            {formatUnits(usdtBalance, 6)} USDT
          </span>
        </div>
      )}

      {paymentType === 'usdt' && needsApproval && (
        <div className="space-y-2">
          <p className="text-sm text-brawl-text-dim">
            First time paying with USDT on this wallet (or batch exceeds your current
            approval) — one-time approval required.
          </p>
          <button
            type="button"
            className="brawl-btn brawl-btn-secondary w-full md:w-auto"
            onClick={onApprove}
            disabled={!hasEnoughUsdt}
          >
            Approve USDT
          </button>
        </div>
      )}

      {!(paymentType === 'usdt' && needsApproval) && (
        <button
          type="button"
          className="brawl-btn w-full md:w-auto"
          onClick={onMint}
          disabled={paymentType === 'usdt' && !hasEnoughUsdt}
        >
          {count === 1
            ? paymentType === 'eth'
              ? `Mint 1 for ${ethPriceLabel}`
              : `Mint 1 for ${usdtPriceLabel}`
            : paymentType === 'eth'
              ? `Mint ${count} for ${ethTotalLabel}`
              : `Mint ${count} for ${usdtTotalLabel}`}
        </button>
      )}
    </div>
  );
}

function CountPicker({
  count,
  setCount,
}: {
  count: number;
  setCount: (n: number) => void;
}) {
  const presets = [1, 2, 5, 10, 20];
  return (
    <div>
      <div className="text-xs brawl-header text-brawl-text-faint mb-2">
        How many (max 20/tx)
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        {presets.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setCount(n)}
            className={
              'brawl-header text-xs px-3 py-2 border-2 transition-colors min-h-[2.5rem] min-w-[2.5rem] ' +
              (count === n
                ? 'text-brawl-orange border-brawl-orange'
                : 'text-brawl-text-dim border-brawl-border hover:text-brawl-text hover:border-brawl-orange')
            }
          >
            {n}
          </button>
        ))}
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={20}
          value={count}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            if (Number.isInteger(n) && n >= 1 && n <= 20) setCount(n);
          }}
          className="w-20 px-2 py-2 bg-brawl-bg border-2 border-brawl-border text-brawl-text font-mono text-base focus:border-brawl-orange focus:outline-none min-h-[2.5rem]"
          aria-label="custom mint count"
        />
      </div>
    </div>
  );
}

function PaymentTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const base = 'brawl-header text-xs px-3 py-2 border-2 transition-colors';
  const cls = active
    ? `${base} text-brawl-orange border-brawl-orange`
    : `${base} text-brawl-text-dim border-brawl-border hover:text-brawl-text hover:border-brawl-orange`;
  return (
    <button type="button" className={cls} onClick={onClick}>
      {label}
    </button>
  );
}

function PhaseIndicator({ phase }: { phase: Phase }) {
  const steps = ['Sign', 'Mine', 'Reveal', 'Done'] as const;
  const activeIdx = (() => {
    switch (phase.kind) {
      case 'approving':
      case 'approveMining':
      case 'signing':
        return 0;
      case 'mining':
        return 1;
      case 'revealing':
        return 2;
      case 'success':
        return 3;
      default:
        return -1;
    }
  })();

  if (activeIdx < 0) return null;

  return (
    <div className="flex items-center gap-2 text-xs brawl-header text-brawl-text-faint flex-wrap">
      {steps.map((step, i) => {
        const done = i < activeIdx;
        const active = i === activeIdx;
        return (
          <div key={step} className="flex items-center gap-2">
            <span
              className={
                done
                  ? 'text-brawl-green'
                  : active
                    ? 'text-brawl-orange'
                    : 'text-brawl-text-faint'
              }
            >
              {done ? '✓' : active ? '●' : '○'} {step}
            </span>
            {i < steps.length - 1 && <span className="text-brawl-text-faint">—</span>}
          </div>
        );
      })}
    </div>
  );
}

function StatusBlock({
  title,
  body,
  txHash,
}: {
  title: string;
  body: string;
  txHash?: `0x${string}`;
}) {
  return (
    <div className="space-y-2 py-2">
      <div className="brawl-header text-sm text-brawl-orange">{title}</div>
      <div className="text-sm text-brawl-text-dim">{body}</div>
      {txHash && (
        <div className="text-sm font-mono text-brawl-text-faint break-all">
          <TxLink txHash={txHash} />
        </div>
      )}
    </div>
  );
}

function RevertedBlock({ txHash, onReset }: { txHash: `0x${string}`; onReset: () => void }) {
  return (
    <div className="space-y-3">
      <div className="brawl-header text-sm text-brawl-red">Transaction reverted</div>
      <div className="text-sm text-brawl-text-dim">
        Possible causes: mint supply exhausted (500 max), contract paused, or insufficient USDT/ETH.
      </div>
      <div className="text-sm font-mono text-brawl-text-faint break-all">
        <TxLink txHash={txHash} />
      </div>
      <button type="button" className="brawl-btn brawl-btn-secondary" onClick={onReset}>
        Try Again
      </button>
    </div>
  );
}

function ErrorBlock({ message, onReset }: { message: string; onReset: () => void }) {
  return (
    <div className="space-y-3">
      <div className="brawl-header text-sm text-brawl-red">Mint failed</div>
      <div className="text-sm text-brawl-text-dim break-words font-mono">{message}</div>
      <button type="button" className="brawl-btn brawl-btn-secondary" onClick={onReset}>
        Try Again
      </button>
    </div>
  );
}

function SuccessBlock({
  tokenIds,
  brawlers,
  txHash,
  airdropped,
  onMintAnother,
}: {
  tokenIds: number[];
  brawlers: Brawler[];
  txHash: `0x${string}`;
  airdropped: bigint;
  onMintAnother: () => void;
}) {
  const isBatch = brawlers.length > 1;
  const count = brawlers.length;
  const airdropLabel = `${formatUnits(airdropped, 18)} BRAWL`;

  return (
    <div className="space-y-5">
      <div className="brawl-header text-sm text-brawl-green">
        ✓ {isBatch ? `${count} brawlers minted` : `Brawler #${tokenIds[0]} minted`} · +
        {airdropLabel}
      </div>

      {isBatch ? (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {brawlers.map((b) => (
            <MintedCard key={b.tokenId} brawler={b} />
          ))}
        </div>
      ) : (
        <SingleMintPanel brawler={brawlers[0]!} />
      )}

      <div className="text-sm font-mono text-brawl-text-faint break-all">
        <TxLink txHash={txHash} />
      </div>

      <div className="flex gap-3 flex-wrap">
        {!isBatch && (
          <Link href={`/brawler/${tokenIds[0]}`} className="brawl-btn">
            View Detail
          </Link>
        )}
        <Link href="/browse?filter=mine" className="brawl-btn">
          My Brawlers
        </Link>
        <Link href="/browse" className="brawl-btn brawl-btn-secondary">
          Browse All
        </Link>
        <button type="button" className="brawl-btn brawl-btn-secondary" onClick={onMintAnother}>
          Mint Another
        </button>
      </div>
    </div>
  );
}

function MintedCard({ brawler }: { brawler: Brawler }) {
  const tier = rarityFromWeight(brawler.weapon.weight);
  const record = `${brawler.wins}W / ${brawler.losses}L / ${brawler.ties}T`;
  return (
    <Link
      href={`/brawler/${brawler.tokenId}`}
      className="brawl-card brawl-card-hover block p-3 space-y-2"
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-mono text-brawl-text-faint">#{brawler.tokenId}</div>
        <div className={`text-xs brawl-header tracking-wider ${rarityTextClass(tier)}`}>
          {rarityLabel(tier)}
        </div>
      </div>
      <div className="aspect-square w-full bg-brawl-bg">
        <PixelAvatar
          tokenId={brawler.tokenId}
          weaponName={brawler.weapon.name}
          rarity={tier}
          isDead={brawler.isDead}
          className="w-full h-full pixel"
        />
      </div>
      <div
        className="brawl-header text-xs leading-tight truncate text-brawl-text"
        title={brawler.name}
      >
        {brawler.name}
      </div>
      <div className="text-xs text-brawl-yellow truncate" title={brawler.weapon.name}>
        {brawler.weapon.name}
      </div>
      <div className="flex items-baseline justify-between text-sm font-mono">
        <span>
          <span className="text-brawl-text-dim">RATING </span>
          <span className="text-brawl-cyan font-bold">{brawler.elo}</span>
        </span>
        <span className="text-brawl-text-dim">{record}</span>
      </div>
    </Link>
  );
}

function SingleMintPanel({ brawler }: { brawler: Brawler }) {
  const record = `${brawler.wins}W / ${brawler.losses}L / ${brawler.ties}T`;
  const tier = rarityFromWeight(brawler.weapon.weight);
  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,12rem)_1fr] items-start">
      <div className="aspect-square w-full max-w-[12rem] bg-brawl-bg">
        <PixelAvatar
          tokenId={brawler.tokenId}
          weaponName={brawler.weapon.name}
          rarity={tier}
          isDead={brawler.isDead}
          className="w-full h-full pixel"
        />
      </div>
      <div className="space-y-3">
        <div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <div className="brawl-header text-xl text-brawl-text break-words">
              {brawler.name}
            </div>
            <span
              className={`text-xs brawl-header tracking-wider ${rarityTextClass(tier)}`}
            >
              {rarityLabel(tier)}
            </span>
          </div>
          <div className="flex items-baseline gap-4 font-mono text-sm">
            <span>
              <span className="text-brawl-text-dim">RATING </span>
              <span className="text-brawl-cyan font-bold">{brawler.elo}</span>
            </span>
            <span className="text-brawl-text-dim">{record}</span>
          </div>
        </div>
        <div className="font-mono text-sm">
          <div className="text-brawl-yellow">{brawler.weapon.name}</div>
          <div className="text-sm text-brawl-text-dim">
            DMG {brawler.weapon.damageMin}–{brawler.weapon.damageMax}
            {' · '}SPD {brawler.weapon.speed}
          </div>
        </div>
        <div className="grid grid-cols-6 gap-x-2 gap-y-1 text-sm font-mono">
          <StatChip label="STR" value={brawler.stats.strength} />
          <StatChip label="DEX" value={brawler.stats.dexterity} />
          <StatChip label="CON" value={brawler.stats.constitution} />
          <StatChip label="INT" value={brawler.stats.intelligence} />
          <StatChip label="WIS" value={brawler.stats.wisdom} />
          <StatChip label="CHA" value={brawler.stats.charisma} />
        </div>
      </div>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center border border-brawl-border py-1 px-0.5">
      <span className="text-brawl-text-faint brawl-header">{label}</span>
      <span className="text-brawl-cyan font-bold">{value}</span>
    </div>
  );
}
