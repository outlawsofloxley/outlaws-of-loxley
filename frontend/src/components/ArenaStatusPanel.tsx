'use client';

/**
 * ArenaStatusPanel — owner-level $BRAWL approval controls + per-brawler
 * arena opt-out toggles.
 *
 * Two layers of state determine "is this brawler in the arena":
 *   1. Owner-level: BRAWL allowance + balance >= fightCost (otherwise the
 *      duel reverts). This panel exposes 1 / 5 / 10 / ∞ "fights to approve"
 *      choices and a "leave arena (revoke allowance)" button.
 *   2. Per-brawler: ArenaOptOut.optedOut(tokenId) (on-chain, advisory). Each
 *      brawler card has a toggle that calls setOptOut on the contract.
 *
 * Both layers are necessary for the UX Darren asked for: he wants to
 * top-up allowance for multiple fights but exclude SPECIFIC brawlers
 * (e.g. one on a 2-loss streak that he doesn't want graveyarded).
 *
 * House brawlers are NEVER shown here — this panel is per-connected-user.
 * Keepers have their own infinite-allowance set-and-forget pattern.
 */
import { useEffect, useState } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatUnits } from 'viem';
import { BRAWL_ABI, ARENA_OPTOUT_ABI } from '@/lib/abi';

type FightsChoice = 1 | 5 | 10 | 'max';
const MAX_UINT256 = (1n << 256n) - 1n;

function fmtBrawl(wei: bigint): string {
  return Number(formatUnits(wei, 18)).toFixed(2);
}

interface BrawlerRow {
  tokenId: number;
  name: string;
  isOptedOut: boolean;
}

interface ArenaStatusPanelProps {
  brawlAddress: `0x${string}`;
  approveTarget: `0x${string}`;
  arenaOptOutAddress: `0x${string}` | null;
  chainId: number;
  fightCost: bigint | undefined;
  myAllowance: bigint | undefined;
  myBalance: bigint | undefined;
  /** Alive brawlers the connected wallet owns, with their current opt-out
   *  flag (read from chain via ArenaOptOut.optedOutMany). */
  myBrawlers: BrawlerRow[];
  onApproveMined: () => void;
  onOptOutMined: () => void;
}

export function ArenaStatusPanel({
  brawlAddress,
  approveTarget,
  arenaOptOutAddress,
  chainId,
  fightCost,
  myAllowance,
  myBalance,
  myBrawlers,
  onApproveMined,
  onOptOutMined,
}: ArenaStatusPanelProps) {
  const [choice, setChoice] = useState<FightsChoice>(1);
  const [lastAction, setLastAction] = useState<'enter' | 'leave' | 'optout' | null>(null);
  const [pendingTokenId, setPendingTokenId] = useState<number | null>(null);

  // Single useWriteContract for both approve + setOptOut — they share the
  // same lifecycle pattern (write → wait → refetch parent reads).
  const {
    writeContractAsync,
    data: txHash,
    isPending,
    error,
    reset,
  } = useWriteContract();
  const { isLoading: isMining, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  useEffect(() => {
    if (isSuccess) {
      if (lastAction === 'optout') onOptOutMined();
      else onApproveMined();
      setLastAction(null);
      setPendingTokenId(null);
      reset();
    }
  }, [isSuccess, lastAction, onApproveMined, onOptOutMined, reset]);

  const fightsRemaining =
    fightCost && fightCost > 0n && myAllowance !== undefined
      ? myAllowance >= MAX_UINT256 / 2n
        ? Infinity
        : Number(myAllowance / fightCost)
      : 0;
  const fightsAffordable =
    fightCost && fightCost > 0n && myBalance !== undefined
      ? Number(myBalance / fightCost)
      : 0;
  const effectiveFights = Math.min(fightsRemaining, fightsAffordable);
  const allowanceOk = fightsRemaining >= 1;
  const balanceOk = fightsAffordable >= 1;
  const optedInBrawlers = myBrawlers.filter((b) => !b.isOptedOut);
  const inArena = allowanceOk && balanceOk && optedInBrawlers.length > 0;
  const noBrawlersAlive = myBrawlers.length === 0;
  const busy = isPending || isMining;

  const approveAmount = async (amount: bigint) => {
    setLastAction(amount === 0n ? 'leave' : 'enter');
    try {
      await writeContractAsync({
        abi: BRAWL_ABI,
        address: brawlAddress,
        chainId,
        functionName: 'approve',
        args: [approveTarget, amount],
      });
    } catch {
      setLastAction(null);
    }
  };

  const enter = async () => {
    if (!fightCost || fightCost === 0n) return;
    const amount = choice === 'max' ? MAX_UINT256 : fightCost * BigInt(choice);
    await approveAmount(amount);
  };

  const leave = () => approveAmount(0n);

  const toggleOptOut = async (tokenId: number, currentlyOut: boolean) => {
    if (!arenaOptOutAddress) return;
    setLastAction('optout');
    setPendingTokenId(tokenId);
    try {
      await writeContractAsync({
        abi: ARENA_OPTOUT_ABI,
        address: arenaOptOutAddress,
        chainId,
        functionName: 'setOptOut',
        args: [BigInt(tokenId), !currentlyOut],
      });
    } catch {
      setLastAction(null);
      setPendingTokenId(null);
    }
  };

  // Loading shell while parent reads are pending.
  if (fightCost === undefined || myAllowance === undefined || myBalance === undefined) {
    return (
      <div className="brawl-card p-4">
        <div className="brawl-header text-sm text-brawl-text-faint">
          Arena status — loading…
        </div>
      </div>
    );
  }

  if (noBrawlersAlive) {
    return (
      <div className="brawl-card p-4 space-y-2">
        <div className="brawl-header text-sm text-brawl-orange">
          Your arena status
        </div>
        <div className="text-sm text-brawl-text-dim">
          No alive brawlers in your wallet. Mint one or resurrect a dead one to enter the arena.
        </div>
      </div>
    );
  }

  return (
    <div className="brawl-card p-4 space-y-3">
      {/* Header line — owner-level status */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="brawl-header text-sm text-brawl-orange">
          Your arena status
        </div>
        {inArena ? (
          <div className="text-sm font-mono">
            <span className="text-brawl-green">⚔ in arena</span>
            <span className="text-brawl-text-faint">
              {' · '}
              {fightsRemaining === Infinity ? (
                <span className="text-brawl-orange">unlimited approval</span>
              ) : (
                <>
                  <span className="text-brawl-cyan">{effectiveFights}</span> fight
                  {effectiveFights === 1 ? '' : 's'} ready
                </>
              )}
            </span>
          </div>
        ) : (
          <div className="text-sm font-mono text-brawl-text-dim">
            not in arena
          </div>
        )}
      </div>

      {/* Allowance + balance breakdown when in arena */}
      {inArena && (
        <div className="text-sm text-brawl-text-dim space-y-1">
          {fightsRemaining !== Infinity && (
            <div>
              $BRAWL allowance: {fmtBrawl(myAllowance)} (covers {fightsRemaining} fight
              {fightsRemaining === 1 ? '' : 's'})
            </div>
          )}
          <div>
            $BRAWL balance: {fmtBrawl(myBalance)} (covers {fightsAffordable} fight
            {fightsAffordable === 1 ? '' : 's'})
          </div>
        </div>
      )}

      {/* Warnings */}
      {inArena && fightsAffordable < fightsRemaining && fightsRemaining !== Infinity && (
        <div className="text-sm text-brawl-orange">
          ⚠ approval covers {fightsRemaining} fights but you only have $BRAWL for{' '}
          {fightsAffordable}. you'll auto-exit when balance runs out.
        </div>
      )}
      {allowanceOk && !balanceOk && (
        <div className="text-sm text-brawl-orange">
          ⚠ approved to fight but $BRAWL balance is below the fight cost ({fmtBrawl(fightCost)}).
          top up $BRAWL to enter the arena.
        </div>
      )}

      {/* Owner-level action row */}
      <div className="flex flex-wrap gap-2 items-center pt-1 border-t border-brawl-border">
        <div className="flex items-center gap-2">
          <label
            htmlFor="fights-choice"
            className="text-sm font-mono text-brawl-text-dim"
          >
            {inArena ? 'top up:' : 'enter for:'}
          </label>
          <select
            id="fights-choice"
            value={String(choice)}
            onChange={(e) => {
              const v = e.target.value;
              setChoice(v === 'max' ? 'max' : (Number(v) as 1 | 5 | 10));
            }}
            className="font-mono text-sm bg-brawl-bg border border-brawl-border text-brawl-text px-2 py-1"
            disabled={busy}
          >
            <option value="1">1 fight</option>
            <option value="5">5 fights</option>
            <option value="10">10 fights</option>
            <option value="max">∞ (unlimited)</option>
          </select>
          <button
            type="button"
            onClick={enter}
            disabled={busy || !fightCost || fightCost === 0n}
            className="brawl-btn brawl-btn-primary text-sm px-3 py-1.5 disabled:opacity-50"
          >
            {busy && lastAction === 'enter'
              ? isMining ? 'confirming…' : 'sign…'
              : inArena ? 'top up' : 'enter arena'}
          </button>
        </div>

        {inArena && (
          <button
            type="button"
            onClick={leave}
            disabled={busy}
            className="text-sm text-brawl-text-faint hover:text-brawl-orange font-mono px-2 py-1 border border-brawl-border disabled:opacity-50"
            title="revoke $BRAWL approval, exit the arena (affects all your brawlers)"
          >
            {busy && lastAction === 'leave'
              ? isMining ? 'confirming…' : 'sign…'
              : 'revoke approval (all)'}
          </button>
        )}
      </div>

      {/* Per-brawler opt-out toggles */}
      {arenaOptOutAddress ? (
        <div className="pt-1 border-t border-brawl-border space-y-2">
          <div className="text-sm brawl-header text-brawl-text">
            per-brawler in/out
          </div>
          <div className="space-y-1.5">
            {myBrawlers.map((b) => {
              const isThisPending = pendingTokenId === b.tokenId && busy;
              return (
                <label
                  key={b.tokenId}
                  className={`flex items-center gap-2 text-sm font-mono cursor-pointer hover:bg-brawl-panel/60 px-1 py-0.5 ${
                    isThisPending ? 'opacity-60' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={!b.isOptedOut}
                    disabled={busy}
                    onChange={() => void toggleOptOut(b.tokenId, b.isOptedOut)}
                    className="accent-brawl-orange"
                  />
                  <span className="text-brawl-text">
                    {b.name}{' '}
                    <span className="text-brawl-text-faint">#{b.tokenId}</span>
                  </span>
                  {b.isOptedOut && (
                    <span className="text-xs text-brawl-text-faint">
                      [out of arena]
                    </span>
                  )}
                  {isThisPending && (
                    <span className="text-xs text-brawl-orange">
                      {isMining ? 'confirming…' : 'sign…'}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
          <div className="text-xs text-brawl-text-faint font-mono">
            untick to keep a brawler out of the arena. on-chain (advisory) —
            other players' clients honour the flag too.
          </div>
        </div>
      ) : null}

      {/* Default-behaviour explanation */}
      <div className="text-xs text-brawl-text-faint font-mono pt-1 border-t border-brawl-border">
        each duel consumes one fight worth of $BRAWL allowance. you auto-exit when
        allowance hits 0, when $BRAWL balance drops below the fight cost, or when
        a brawler dies. choose ∞ to stay until you leave manually.
      </div>

      {error && (
        <div className="text-xs text-brawl-red font-mono">
          {error instanceof Error ? error.message : String(error)}
        </div>
      )}
    </div>
  );
}
