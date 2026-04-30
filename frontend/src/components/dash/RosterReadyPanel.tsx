'use client';

/**
 * RosterReadyPanel — one-click "make every brawler I own duel-ready" tool.
 *
 * The matchmaker on /duel filters every brawler by whether its owner has
 * approved BRAWL → Duel for spending. Until dev approves, the entire
 * roster shows as "0 duel-ready" and matchmaking returns nothing — even
 * though all the brawlers exist on chain.
 *
 * One unlimited approve (max uint256) makes ALL brawlers owned by this
 * wallet immediately duel-ready. This panel does that approve in a single
 * tx, plus auto-triggers a house-keeper sync afterward (in case the
 * connected wallet IS the keeper, the keeper's auto-resurrect / re-approve
 * cycle wakes up at the same time).
 */
import { useEffect, useState } from 'react';
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { erc20Abi } from 'viem';
import { requireEnv } from '@/lib/env';
import { DUEL_ABI } from '@/lib/abi';

const MAX_UINT256 = (1n << 256n) - 1n;

export function RosterReadyPanel() {
  const { env } = requireEnv();
  const { address, isConnected } = useAccount();
  const { writeContract, data: hash, isPending, error: writeErr, reset } = useWriteContract();
  const { isLoading: isMining, isSuccess } = useWaitForTransactionReceipt({ hash });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    abi: erc20Abi,
    address: env.brawlAddress,
    functionName: 'allowance',
    args: address ? [address, env.duelAddress] : undefined,
    query: { enabled: !!address },
  });

  const { data: fightCost } = useReadContract({
    abi: DUEL_ABI,
    address: env.duelAddress,
    functionName: 'fightCost',
  });

  const [keeperResult, setKeeperResult] = useState<string | null>(null);

  // After approve mines, refetch allowance and tickle the keeper.
  useEffect(() => {
    if (!isSuccess) return;
    void refetchAllowance();
    fetch('/api/house/sync', { method: 'POST' })
      .then((r) => r.json())
      .then((j) => {
        if (j?.actions) setKeeperResult(`keeper actions: ${j.actions.length}`);
      })
      .catch(() => {});
  }, [isSuccess, refetchAllowance]);

  const isApproved =
    allowance !== undefined && fightCost !== undefined && allowance >= fightCost * 100n;

  const handle = () => {
    writeContract({
      abi: erc20Abi,
      address: env.brawlAddress,
      functionName: 'approve',
      args: [env.duelAddress, MAX_UINT256],
    });
  };

  return (
    <div className="brawl-card p-4 space-y-3">
      <div className="brawl-header text-sm text-brawl-orange">Make my roster duel-ready</div>
      <p className="text-sm text-brawl-text-dim leading-relaxed">
        Matchmaking filters out any brawler whose owner hasn&rsquo;t approved
        BRAWL → Duel. One unlimited approve from this wallet makes every
        brawler you own immediately duel-ready (no further txs per fight).
      </p>

      {!isConnected ? (
        <div className="text-sm text-brawl-text-faint">
          Connect a wallet to use this.
        </div>
      ) : isApproved ? (
        <div className="text-sm font-mono text-brawl-green">
          ✓ Already approved — every brawler you own is duel-ready.
        </div>
      ) : (
        <button
          type="button"
          className="brawl-btn"
          onClick={handle}
          disabled={isPending || isMining}
        >
          {isPending
            ? 'Confirm in wallet…'
            : isMining
              ? 'Mining…'
              : 'Approve BRAWL → Duel (one tx, unlimited)'}
        </button>
      )}

      {isSuccess && (
        <div className="text-sm font-mono text-brawl-green">
          ✓ Approved. {keeperResult ?? ''}
        </div>
      )}
      {writeErr && (
        <div className="text-xs text-brawl-red break-words">
          {writeErr.message}
          <button type="button" className="ml-2 underline" onClick={reset}>
            dismiss
          </button>
        </div>
      )}
    </div>
  );
}
