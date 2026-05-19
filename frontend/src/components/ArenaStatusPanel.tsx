'use client';

/**
 * ArenaStatusPanel — owner-level "are you in the arena" status with explicit
 * entry, top-up, and exit controls.
 *
 * Why: prior to this, the duel page approved MAX_UINT256 BRAWL on first
 * approval, so a single approval put the user in the arena permanently
 * until death or 0 balance. Players reported feeling stuck — and could lose
 * stacks of $BRAWL or get their brawler graveyarded while AFK.
 *
 * Model: "in arena" == allowance(owner, router/duel) >= fightCost AND
 * balance(owner) >= fightCost AND owner has at least one alive brawler.
 * Approving fightCost * N means "queue N fights, then auto-exit". Approving
 * 0 means "leave arena now". MAX is preserved as an opt-in for power users.
 *
 * House brawlers belong to the keeper wallet which keeps unlimited allowance
 * forever — this panel only shows for the connected user, so house behaviour
 * is unchanged.
 */
import { useEffect, useState } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatUnits } from 'viem';
import { BRAWL_ABI } from '@/lib/abi';

type FightsChoice = 1 | 5 | 10 | 'max';
const MAX_UINT256 = (1n << 256n) - 1n;

function fmtBrawl(wei: bigint): string {
  return Number(formatUnits(wei, 18)).toFixed(2);
}

interface ArenaStatusPanelProps {
  brawlAddress: `0x${string}`;
  approveTarget: `0x${string}`;
  chainId: number;
  fightCost: bigint | undefined;
  myAllowance: bigint | undefined;
  myBalance: bigint | undefined;
  myAliveBrawlerNames: string[];
  myAliveBrawlerInArenaNames: string[];
  onApproveMined: () => void;
}

export function ArenaStatusPanel({
  brawlAddress,
  approveTarget,
  chainId,
  fightCost,
  myAllowance,
  myBalance,
  myAliveBrawlerNames,
  myAliveBrawlerInArenaNames,
  onApproveMined,
}: ArenaStatusPanelProps) {
  const [choice, setChoice] = useState<FightsChoice>(1);
  const [lastAction, setLastAction] = useState<'enter' | 'leave' | null>(null);

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

  // When the approve tx mines, refresh parent reads so the panel re-renders
  // with the new allowance value, then clear our local "last action" flag.
  useEffect(() => {
    if (isSuccess) {
      onApproveMined();
      setLastAction(null);
      reset();
    }
  }, [isSuccess, onApproveMined, reset]);

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
  const inArena = allowanceOk && balanceOk && myAliveBrawlerInArenaNames.length > 0;
  const noBrawlersAlive = myAliveBrawlerNames.length === 0;
  const busy = isPending || isMining;

  const enter = async () => {
    if (!fightCost || fightCost === 0n) return;
    const amount =
      choice === 'max' ? MAX_UINT256 : fightCost * BigInt(choice);
    setLastAction('enter');
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

  const leave = async () => {
    setLastAction('leave');
    try {
      await writeContractAsync({
        abi: BRAWL_ABI,
        address: brawlAddress,
        chainId,
        functionName: 'approve',
        args: [approveTarget, 0n],
      });
    } catch {
      setLastAction(null);
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

  // Render
  return (
    <div className="brawl-card p-4 space-y-3">
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

      {/* In-arena: show details + leave button */}
      {inArena && (
        <div className="text-sm text-brawl-text-dim space-y-1">
          <div>
            brawlers in arena:{' '}
            <span className="text-brawl-text">
              {myAliveBrawlerInArenaNames.join(', ')}
            </span>
          </div>
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

      {/* Allowance > balance warning */}
      {inArena && fightsAffordable < fightsRemaining && fightsRemaining !== Infinity && (
        <div className="text-sm text-brawl-orange">
          ⚠ approval covers {fightsRemaining} fights but you only have $BRAWL for{' '}
          {fightsAffordable}. you'll auto-exit when balance runs out.
        </div>
      )}

      {/* Allowance ok but balance too low */}
      {allowanceOk && !balanceOk && (
        <div className="text-sm text-brawl-orange">
          ⚠ approved to fight but $BRAWL balance is below the fight cost ({fmtBrawl(fightCost)}).
          top up $BRAWL to enter the arena.
        </div>
      )}

      {/* Action row */}
      <div className="flex flex-wrap gap-2 items-center">
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
              ? isMining
                ? 'confirming…'
                : 'sign…'
              : inArena
                ? 'top up'
                : 'enter arena'}
          </button>
        </div>

        {inArena && (
          <button
            type="button"
            onClick={leave}
            disabled={busy}
            className="text-sm text-brawl-text-faint hover:text-brawl-orange font-mono px-2 py-1 border border-brawl-border disabled:opacity-50"
            title="revoke $BRAWL approval, exit the arena"
          >
            {busy && lastAction === 'leave'
              ? isMining
                ? 'confirming…'
                : 'sign…'
              : 'leave arena'}
          </button>
        )}
      </div>

      {/* Help line — default behaviour transparency */}
      <div className="text-xs text-brawl-text-faint font-mono">
        each duel consumes one fight worth of $BRAWL allowance. you auto-exit when
        allowance hits 0, or when $BRAWL balance drops below the fight cost, or
        when your brawler dies. choose ∞ to stay until you leave manually.
      </div>

      {/* Error surfacing */}
      {error && (
        <div className="text-xs text-brawl-red font-mono">
          {error instanceof Error ? error.message : String(error)}
        </div>
      )}
    </div>
  );
}
