'use client';

/**
 * /lock — public-facing verification page for the BRAWL team-token timelock.
 *
 * Reads every relevant view fn from the on-chain BRAWLTimelock contract and
 * shows a countdown + progress bar so anyone can verify the lock is real
 * without trusting any indexer. Polls every 15s.
 *
 * Falls back to a "lock not deployed yet" notice when
 * NEXT_PUBLIC_BRAWL_TIMELOCK_ADDRESS is unset.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatUnits } from 'viem';
import { BRAWL_TIMELOCK_ABI } from '@/lib/timelockAbi';
import { requireEnv } from '@/lib/env';

function fmtBrawl(wei: bigint | undefined): string {
  if (wei === undefined) return '—';
  return Number(formatUnits(wei, 18)).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

function fmtCountdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return 'fully vested';
  const days = Math.floor(secondsLeft / 86400);
  const hours = Math.floor((secondsLeft % 86400) / 3600);
  const minutes = Math.floor((secondsLeft % 3600) / 60);
  const secs = secondsLeft % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m ${secs}s`;
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  return `${minutes}m ${secs}s`;
}

export default function LockPage() {
  const { env } = requireEnv();
  const lockAddr = env.brawlTimelockAddress;
  const refreshMs = 15_000;

  const [now, setNow] = useState<number>(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const i = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(i);
  }, []);

  const queryConfig = { enabled: !!lockAddr, refetchInterval: refreshMs } as const;
  const beneficiary = useReadContract({
    abi: BRAWL_TIMELOCK_ABI,
    address: lockAddr ?? undefined,
    functionName: 'beneficiary',
    query: queryConfig,
  });
  const tokenAddr = useReadContract({
    abi: BRAWL_TIMELOCK_ABI,
    address: lockAddr ?? undefined,
    functionName: 'token',
    query: queryConfig,
  });
  const startTs = useReadContract({
    abi: BRAWL_TIMELOCK_ABI,
    address: lockAddr ?? undefined,
    functionName: 'startTimestamp',
    query: queryConfig,
  });
  const cliffS = useReadContract({
    abi: BRAWL_TIMELOCK_ABI,
    address: lockAddr ?? undefined,
    functionName: 'cliffSeconds',
    query: queryConfig,
  });
  const durationS = useReadContract({
    abi: BRAWL_TIMELOCK_ABI,
    address: lockAddr ?? undefined,
    functionName: 'durationSeconds',
    query: queryConfig,
  });
  const endTs = useReadContract({
    abi: BRAWL_TIMELOCK_ABI,
    address: lockAddr ?? undefined,
    functionName: 'endTimestamp',
    query: queryConfig,
  });
  const alloc = useReadContract({
    abi: BRAWL_TIMELOCK_ABI,
    address: lockAddr ?? undefined,
    functionName: 'currentAllocation',
    query: queryConfig,
  });
  const released = useReadContract({
    abi: BRAWL_TIMELOCK_ABI,
    address: lockAddr ?? undefined,
    functionName: 'totalReleased',
    query: queryConfig,
  });
  const vested = useReadContract({
    abi: BRAWL_TIMELOCK_ABI,
    address: lockAddr ?? undefined,
    functionName: 'vestedAmount',
    query: queryConfig,
  });
  const releasable = useReadContract({
    abi: BRAWL_TIMELOCK_ABI,
    address: lockAddr ?? undefined,
    functionName: 'releasable',
    query: queryConfig,
  });

  // Local countdown using on-chain end vs. wall-clock; avoids a re-render
  // every poll while still being correct to the second.
  const endSec = endTs.data ? Number(endTs.data as bigint) : null;
  const startSec = startTs.data ? Number(startTs.data as bigint) : null;
  const durationSec = durationS.data ? Number(durationS.data as bigint) : null;

  const secondsLeft = endSec ? Math.max(0, endSec - now) : 0;
  const progressPct = useMemo(() => {
    if (!startSec || !durationSec) return 0;
    const elapsed = Math.max(0, now - startSec);
    return Math.min(100, (elapsed / durationSec) * 100);
  }, [startSec, durationSec, now]);

  const lockedNow = useMemo(() => {
    if (!alloc.data || !released.data) return undefined;
    return (alloc.data as bigint) - (released.data as bigint);
  }, [alloc.data, released.data]);

  const { writeContract, data: releaseHash, isPending: releasePending } = useWriteContract();
  const { isLoading: releaseMining, isSuccess: releaseSuccess } = useWaitForTransactionReceipt({
    hash: releaseHash,
  });
  useEffect(() => {
    if (releaseSuccess) {
      void released.refetch();
      void vested.refetch();
      void releasable.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releaseSuccess]);

  if (!lockAddr) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-12 space-y-6">
        <h1 className="brawl-header text-2xl md:text-3xl text-brawl-orange">
          BRAWL team token lock
        </h1>
        <div className="brawl-card p-6">
          <p className="text-brawl-text-dim text-sm font-mono">
            Lock contract not deployed yet. This page goes live once the
            timelock is on chain and the address is published.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-8 space-y-6">
      <div className="border-b border-brawl-border pb-4">
        <h1 className="brawl-header text-2xl md:text-3xl text-brawl-orange mb-2">
          BRAWL team token lock
        </h1>
        <p className="text-sm text-brawl-text-dim">
          Linear vesting. Beneficiary immutable. No admin function. Anyone can
          call release(). Verify on Basescan, then come back if you want.
        </p>
      </div>

      <div className="brawl-card p-6 space-y-4">
        <div className="text-xs brawl-header text-brawl-text-faint">Time until fully vested</div>
        <div className="brawl-header text-3xl md:text-5xl text-brawl-cyan font-mono">
          {fmtCountdown(secondsLeft)}
        </div>
        <div className="h-3 bg-brawl-bg border border-brawl-border overflow-hidden">
          <div
            className="h-full bg-brawl-orange transition-all duration-500"
            style={{ width: `${progressPct.toFixed(2)}%` }}
          />
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs font-mono text-brawl-text-faint">
          <span>start: {startSec ? new Date(startSec * 1000).toISOString().replace('T', ' ').slice(0, 19) : '—'} UTC</span>
          <span>end: {endSec ? new Date(endSec * 1000).toISOString().replace('T', ' ').slice(0, 19) : '—'} UTC</span>
          <span>{progressPct.toFixed(2)}% vested</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat label="Total allocation" value={fmtBrawl(alloc.data as bigint | undefined)} unit="BRAWL" />
        <Stat label="Locked right now" value={fmtBrawl(lockedNow)} unit="BRAWL" />
        <Stat label="Released to date" value={fmtBrawl(released.data as bigint | undefined)} unit="BRAWL" />
      </div>

      <div className="brawl-card p-4 space-y-2">
        <div className="text-xs brawl-header text-brawl-text-faint">Currently releasable</div>
        <div className="flex items-baseline gap-3">
          <span className="brawl-header text-2xl text-brawl-text">
            {fmtBrawl(releasable.data as bigint | undefined)}
          </span>
          <span className="text-sm text-brawl-text-faint">BRAWL</span>
        </div>
        <button
          type="button"
          disabled={
            !releasable.data ||
            (releasable.data as bigint) === 0n ||
            releasePending ||
            releaseMining
          }
          onClick={() => {
            if (!lockAddr) return;
            writeContract({
              abi: BRAWL_TIMELOCK_ABI,
              address: lockAddr,
              functionName: 'release',
            });
          }}
          className="brawl-btn brawl-btn-secondary text-xs px-3 py-2 disabled:opacity-40"
        >
          {releasePending
            ? 'sign in wallet…'
            : releaseMining
              ? 'mining…'
              : 'call release()'}
        </button>
        <div className="text-xs font-mono text-brawl-text-faint">
          Permissionless — anyone can poke this. Pushes the vested amount to
          the beneficiary; doesn&apos;t need the beneficiary&apos;s wallet.
        </div>
      </div>

      <div className="brawl-card p-4 space-y-2 text-xs font-mono">
        <div className="brawl-header text-xs text-brawl-orange">Verify on chain</div>
        <Row label="lock contract">
          <Mono addr={lockAddr} />
        </Row>
        <Row label="token (BRAWL)">
          <Mono addr={(tokenAddr.data as `0x${string}` | undefined) ?? env.brawlAddress} />
        </Row>
        <Row label="beneficiary">
          <Mono addr={beneficiary.data as `0x${string}` | undefined} />
        </Row>
        <Row label="start (unix)">
          <span className="text-brawl-text">{startSec ?? '—'}</span>
        </Row>
        <Row label="cliff (seconds)">
          <span className="text-brawl-text">{cliffS.data ? Number(cliffS.data as bigint) : 0}</span>
        </Row>
        <Row label="duration (seconds)">
          <span className="text-brawl-text">{durationSec ?? '—'}</span>
        </Row>
        <Row label="end (unix)">
          <span className="text-brawl-text">{endSec ?? '—'}</span>
        </Row>
      </div>

      <p className="text-xs text-brawl-text-faint font-mono">
        ALL fields above are immutable. There is no <code>owner()</code>,{' '}
        <code>transferOwnership()</code>, or <code>renounceOwnership()</code>{' '}
        function in this contract. The vesting schedule cannot be accelerated,
        paused, or revoked.{' '}
        <Link
          href={`https://basescan.org/address/${lockAddr}#code`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brawl-orange hover:underline"
        >
          Read the source on Basescan
        </Link>
        .
      </p>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="brawl-card p-4 space-y-1">
      <div className="text-xs brawl-header text-brawl-text-faint">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="brawl-header text-xl text-brawl-cyan">{value}</span>
        <span className="text-xs text-brawl-text-faint">{unit}</span>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-brawl-text-dim">{label}</span>
      <span className="text-right break-all">{children}</span>
    </div>
  );
}

function Mono({ addr }: { addr: `0x${string}` | undefined }) {
  if (!addr) return <span className="text-brawl-text-faint">—</span>;
  return (
    <Link
      href={`https://basescan.org/address/${addr}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brawl-text hover:text-brawl-orange"
    >
      {addr}
    </Link>
  );
}
