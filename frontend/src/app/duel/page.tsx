'use client';

/**
 * Turn 4B, full duel flow: pick → run → animate → submit → success.
 *
 * 1. Pick two alive brawlers (A filters to yours if connected)
 * 2. POST /api/run-duel  (server fetches state, simulates, signs)
 * 3. Animate the returned CombatEvents round-by-round
 * 4. User clicks Submit → wallet signs + broadcasts submitDuel(result, sig)
 * 5. Wait for mining; on success show deltas and a Run Another button
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import { formatUnits } from 'viem';
import { useAllBrawlers } from '@/hooks/useAllBrawlers';
import { useHouseWhitelist } from '@/hooks/useHouseWhitelist';
import type { Brawler as UIBrawler } from '@/hooks/useBrawler';
import { PixelAvatar } from '@/components/PixelAvatar';
import { BRAWL_ABI, DUEL_ABI } from '@/lib/abi';
import { requireEnv } from '@/lib/env';
import { WrongChainPrompt } from '@/components/WrongChainPrompt';
import type { CombatEvent } from '@/core/types';
import { DuelAnimation } from '@/components/DuelAnimation';
import { ArenaLineup } from '@/components/ArenaLineup';
import { rarityFromWeight } from '@/lib/rarity';
import { isHouseBrawler } from '@/lib/house';
import { TxLink } from '@/components/TxLink';

interface SerializedResult {
  tokenA: string;
  tokenB: string;
  winnerId: number;
  rounds: number;
  seed: string;
  newEloA: number;
  newEloB: number;
  nonce: string;
  expiry: string;
}

interface ApiResponse {
  result: SerializedResult;
  signature: `0x${string}`;
  events: CombatEvent[];
  winnerId: number | null;
  rounds: number;
  newEloA: number;
  newEloB: number;
  deltaA: number;
  deltaB: number;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'review'; response: ApiResponse }
  | { kind: 'error'; message: string };

export default function DuelPage() {
  const { env } = requireEnv();
  const { brawlers, isLoading, error: rosterError, refetch } = useAllBrawlers();
  const { whitelist: houseWhitelist } = useHouseWhitelist();
  const { address, isConnected, chainId: activeChainId } = useAccount();
  const rightChain = activeChainId === env.chainId;

  // Helper, is this brawler tagged as part of the house roster?
  const houseIds = useMemo(() => new Set(houseWhitelist), [houseWhitelist]);
  const isHouse = (br: UIBrawler): boolean =>
    isHouseBrawler(br.tokenId, br.owner, env.houseKeeperAddress, houseIds);

  const [aId, setAId] = useState<number | null>(null);
  const [bId, setBId] = useState<number | null>(null);
  const [rerollTick, setRerollTick] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  // Kick the house keeper on mount. Fire-and-forget, any dead dev-owned
  // brawlers get auto-resurrected within seconds so the matchmaking pool
  // stays full. Silent no-op if the env isn't configured on the server.
  useEffect(() => {
    void fetch('/api/house/sync', { method: 'POST' }).catch(() => {});
  }, []);

  const aliveBrawlers = useMemo(() => brawlers.filter((br) => !br.isDead), [brawlers]);
  const mine = useMemo(() => {
    if (!address) return [] as UIBrawler[];
    const lower = address.toLowerCase();
    return aliveBrawlers.filter((br) => br.owner.toLowerCase() === lower);
  }, [aliveBrawlers, address]);

  // Read the fight cost + the BRAWL allowance for every unique owner of an
  // alive brawler. A "duel-ready" owner is one with allowance ≥ fightCost, 
  // only their brawlers can actually be submitted without reverting. The
  // matchmaker filters to duel-ready candidates so friends who haven't
  // approved yet don't get paired into a guaranteed revert.
  const { data: fightCostData } = useReadContract({
    abi: DUEL_ABI,
    address: env.duelAddress,
    functionName: 'fightCost',
    chainId: env.chainId,
  });
  const fightCost = fightCostData as bigint | undefined;
  const { data: devShareData } = useReadContract({
    abi: DUEL_ABI,
    address: env.duelAddress,
    functionName: 'devShareBps',
    chainId: env.chainId,
  });
  const devShareBpsCfg = devShareData as number | undefined;

  const uniqueOwners = useMemo(() => {
    const set = new Set<string>();
    for (const br of aliveBrawlers) set.add(br.owner.toLowerCase());
    return [...set];
  }, [aliveBrawlers]);

  const { data: allowanceReads } = useReadContracts({
    contracts: uniqueOwners.map((owner) => ({
      abi: BRAWL_ABI,
      address: env.brawlAddress,
      functionName: 'allowance' as const,
      args: [owner as `0x${string}`, env.duelAddress] as const,
      chainId: env.chainId,
    })),
    query: { enabled: uniqueOwners.length > 0 },
  });

  const duelReadyOwners = useMemo<Set<string>>(() => {
    const ready = new Set<string>();
    if (!allowanceReads || fightCost === undefined) return ready;
    for (let i = 0; i < uniqueOwners.length; i++) {
      const owner = uniqueOwners[i]!;
      const row = allowanceReads[i];
      if (!row || row.status !== 'success') continue;
      const allowance = row.result as bigint;
      if (allowance >= fightCost) ready.add(owner);
    }
    return ready;
  }, [allowanceReads, uniqueOwners, fightCost]);

  const duelReadyCandidates = useMemo(() => {
    return aliveBrawlers.filter((br) => duelReadyOwners.has(br.owner.toLowerCase()));
  }, [aliveBrawlers, duelReadyOwners]);

  const a = aId !== null ? aliveBrawlers.find((br) => br.tokenId === aId) ?? null : null;
  const b = bId !== null ? aliveBrawlers.find((br) => br.tokenId === bId) ?? null : null;
  const sameSelected = a !== null && b !== null && a.tokenId === b.tokenId;

  // Auto-select your brawler: if you own exactly one alive brawler, lock
  // it in. If you own multiple, default to the highest-rating one so the
  // dropdown isn't empty on first visit.
  useEffect(() => {
    if (aId !== null) return;
    if (mine.length === 0) return;
    const best = [...mine].sort((x, y) => y.elo - x.elo)[0]!;
    setAId(best.tokenId);
  }, [mine, aId]);

  // Auto-match opponent by rating proximity. Widens ±75 → ±150 → ±300 →
  // ±500 in that order. HARD CAP at ±500, the King (Rating 2000) is NOT
  // matched against a newbie at 900. If nobody's in range, bId stays null
  // and the UI shows a "no match in your rating band" message.
  useEffect(() => {
    if (a === null) return;
    const notSelf = (br: UIBrawler) => br.tokenId !== a.tokenId;
    const notSelfOwner = (br: UIBrawler) =>
      br.owner.toLowerCase() !== (address?.toLowerCase() ?? '');
    // House-vs-house is BANNED. House brawlers exist as opponents for
    // humans, they shouldn't grind ELO against each other while real
    // players wait. If MY fighter is house, only non-house candidates
    // are eligible. If MY fighter is human, anything goes (house OR
    // human opponents are fair game).
    const aIsHouse = isHouse(a);
    const houseFilter = (br: UIBrawler) => (aIsHouse ? !isHouse(br) : true);

    const primary = duelReadyCandidates.filter(
      (br) => notSelf(br) && notSelfOwner(br) && houseFilter(br),
    );
    const secondary = duelReadyCandidates.filter(
      (br) => notSelf(br) && houseFilter(br),
    );

    const pickFromPool = (pool: UIBrawler[]): UIBrawler | null => {
      if (pool.length === 0) return null;
      const windows = [75, 150, 300, 500];
      for (const w of windows) {
        const near = pool.filter((br) => Math.abs(br.elo - a.elo) <= w);
        if (near.length > 0) {
          return near[Math.floor(Math.random() * near.length)]!;
        }
      }
      return null;
    };

    const picked = pickFromPool(primary) ?? pickFromPool(secondary);
    if (picked) {
      setBId(picked.tokenId);
    } else {
      setBId(null);
    }
    // isHouse changes only when the whitelist set changes, listed below
    // via houseIds.
  }, [a, duelReadyCandidates, address, rerollTick, houseIds]);

  const canRun =
    a !== null &&
    b !== null &&
    !sameSelected &&
    isConnected &&
    rightChain &&
    phase.kind === 'idle';

  const runDuel = async () => {
    if (a === null || b === null) return;
    setPhase({ kind: 'running' });
    try {
      const res = await fetch('/api/run-duel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tokenA: a.tokenId, tokenB: b.tokenId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setPhase({ kind: 'error', message: json.error ?? `HTTP ${res.status}` });
        return;
      }
      setPhase({ kind: 'review', response: json as ApiResponse });
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const reset = () => {
    setPhase({ kind: 'idle' });
  };

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-8 py-8 space-y-6">
      <div className="border-b border-brawl-border pb-4">
        <h1 className="brawl-header text-2xl md:text-3xl text-brawl-text mb-2">Duel</h1>
        <p className="text-sm text-brawl-text-dim">
          Pick your fighter. We auto-match you against an alive brawler near your
          Rating (±75 first, widening if nobody&rsquo;s close). Don&rsquo;t like the match?
          Reroll for another.{' '}
          {fightCost !== undefined && devShareBpsCfg !== undefined ? (
            <>
              <strong>{formatUnits(fightCost, 18)} BRAWL</strong> per fighter
              ({formatUnits(fightCost * 2n, 18)} pot){' '}
              · winner takes{' '}
              <strong>
                {formatUnits(
                  (fightCost * 2n * BigInt(10000 - devShareBpsCfg)) / 10000n,
                  18,
                )}{' '}
                BRAWL
              </strong>{' '}
              · dev share{' '}
              {formatUnits(
                (fightCost * 2n * BigInt(devShareBpsCfg)) / 10000n,
                18,
              )}{' '}
              BRAWL.
            </>
          ) : (
            <>Stake + payout reads from chain, loading…</>
          )}
        </p>
      </div>

      {rosterError && (
        <div className="brawl-card p-6 border-brawl-red">
          <h2 className="brawl-header text-sm text-brawl-red mb-2">Failed to load roster</h2>
          <p className="text-sm text-brawl-text-dim mb-4">{rosterError.message}</p>
          <button type="button" className="brawl-btn brawl-btn-secondary" onClick={refetch}>
            Retry
          </button>
        </div>
      )}

      {isLoading && !rosterError && (
        <div className="text-center py-12 text-brawl-text-dim">
          <div className="brawl-header text-sm">Loading roster…</div>
        </div>
      )}

      {!isLoading && !rosterError && aliveBrawlers.length < 2 && (
        <div className="brawl-card p-8 text-center space-y-3">
          <div className="brawl-header text-sm text-brawl-text-dim">Not enough alive brawlers</div>
          <p className="text-sm text-brawl-text-dim">
            Need at least two alive brawlers to duel. Mint some from{' '}
            <Link href="/mint" className="text-brawl-orange hover:underline">
              /mint
            </Link>
            .
          </p>
        </div>
      )}

      {!isLoading && !rosterError && aliveBrawlers.length >= 2 && (
        <>
          {/* Your-brawler picker + auto-matched opponent (hidden during duel) */}
          {phase.kind === 'idle' && (
            <>
              {mine.length === 0 && isConnected && (
                <div className="brawl-card p-4 text-sm text-brawl-text-dim">
                  You don&rsquo;t own any alive brawlers, switching to spectator mode. Pick
                  any fighter below. Mint some from{' '}
                  <Link href="/mint" className="text-brawl-orange hover:underline">
                    /mint
                  </Link>{' '}
                  to join for real.
                </div>
              )}

              <PickerColumn
                label={mine.length > 0 ? 'Your fighter' : 'Pick a fighter'}
                brawlers={mine.length > 0 ? mine : aliveBrawlers}
                altBrawlers={mine.length > 0 ? aliveBrawlers : undefined}
                selectedId={aId}
                onChange={(id) => {
                  setAId(id);
                  // Picking a new fighter triggers a fresh opponent roll via the effect.
                }}
                hint={
                  mine.length > 0
                    ? mine.length === 1
                      ? 'Your only alive brawler'
                      : `You have ${mine.length} alive brawlers`
                    : undefined
                }
              />

              {a !== null && (
                <div className="brawl-card p-4 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="brawl-header text-sm text-brawl-orange">Matchmaking</div>
                    <button
                      type="button"
                      className="text-sm text-brawl-text-dim hover:text-brawl-orange font-mono"
                      onClick={() => setRerollTick((t) => t + 1)}
                      disabled={duelReadyCandidates.length <= 1}
                    >
                      ↻ Reroll opponent
                    </button>
                  </div>
                  <div className="text-sm font-mono text-brawl-text-faint">
                    {duelReadyCandidates.length} duel-ready brawler
                    {duelReadyCandidates.length === 1 ? '' : 's'} in the arena
                    {(() => {
                      const notReadyOwners = uniqueOwners.filter(
                        (o) => !duelReadyOwners.has(o),
                      ).length;
                      if (notReadyOwners === 0) return null;
                      return (
                        <>
                          {' '}({notReadyOwners} wallet
                          {notReadyOwners === 1 ? '' : 's'} hasn&rsquo;t approved
                          BRAWL yet)
                        </>
                      );
                    })()}
                  </div>
                  {b === null ? (
                    <div className="text-xs text-brawl-red space-y-1">
                      {a && isHouse(a) ? (
                        <>
                          <div>
                            No <strong>human</strong> opponent available right now.
                          </div>
                          <div className="text-brawl-text-dim">
                            Your <span className="text-brawl-orange">HOUSE</span>{' '}
                            fighters wait for human challengers, house brawlers
                            never fight each other. Pop into Discord or wait for
                            someone to mint and approve.
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            No opponent within ±500 Rating of you (you&rsquo;re{' '}
                            {a?.elo ?? ', '}).
                          </div>
                          <div className="text-brawl-text-dim">
                            You can wait for someone in your band to show up, or
                            reroll in case of a near miss. We won&rsquo;t match you
                            against fighters far above or below your Rating.
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm font-mono text-brawl-text-dim">
                      Matched with{' '}
                      <Link
                        href={`/brawler/${b.tokenId}`}
                        className="text-brawl-text hover:text-brawl-orange"
                      >
                        {b.name}
                      </Link>{' '}
                      (Rating <span className="text-brawl-cyan">{b.elo}</span>,{' '}
                      {Math.abs(b.elo - a.elo)} away from you).
                    </div>
                  )}
                </div>
              )}

              {a !== null && b !== null && !sameSelected && <Matchup a={a} b={b} />}

              {/* Who's paid their entry and is sitting in the arena right now. */}
              <ArenaLineup
                candidates={duelReadyCandidates}
                myAddress={address ?? null}
                selectedId={aId}
              />

              {/* Run CTA */}
              {a !== null && b !== null && !sameSelected && (
                <>
                  {isConnected && !rightChain && (
                    <WrongChainPrompt
                      currentChainId={activeChainId}
                      expectedChainId={env.chainId}
                    />
                  )}
                  <div className="brawl-card p-5 space-y-3">
                    {!isConnected && (
                      <p className="text-xs text-brawl-red">Connect your wallet to run the duel.</p>
                    )}
                    <button
                      type="button"
                      className="brawl-btn w-full"
                      disabled={!canRun}
                      onClick={runDuel}
                    >
                      Fight
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {phase.kind === 'running' && (
            <div className="brawl-card p-8 text-center space-y-2">
              <div className="brawl-header text-sm text-brawl-orange">Running combat sim</div>
              <div className="text-sm text-brawl-text-dim">
                Server is fetching chain state, rolling the fight, and signing the result.
              </div>
            </div>
          )}

          {phase.kind === 'error' && (
            <div className="brawl-card p-6 border-brawl-red space-y-3">
              <h2 className="brawl-header text-sm text-brawl-red">Duel failed</h2>
              <p className="text-sm text-brawl-text-dim break-words font-mono">{phase.message}</p>
              <button type="button" className="brawl-btn brawl-btn-secondary" onClick={reset}>
                Try Again
              </button>
            </div>
          )}

          {phase.kind === 'review' && a !== null && b !== null && (
            <ReviewPanel
              a={a}
              b={b}
              response={phase.response}
              env={env}
              connectedAddress={address}
              // ReviewPanel now owns the entire arc: animation → tx → overlay.
              // The old SuccessPanel unmounted the arena, which we don't want
              // anymore, the frozen fight image stays visible behind the
              // outcome overlay. `onSubmitted` just triggers a roster refresh.
              onSubmitted={() => refetch()}
              onCancel={reset}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Pickers ────────────────────────────────────────────────────────────

interface PickerColumnProps {
  label: string;
  brawlers: readonly UIBrawler[];
  altBrawlers?: readonly UIBrawler[] | undefined;
  selectedId: number | null;
  onChange: (id: number | null) => void;
  disabledId?: number | null | undefined;
  hint?: string | undefined;
}

function PickerColumn({
  label,
  brawlers,
  altBrawlers,
  selectedId,
  onChange,
  disabledId,
  hint,
}: PickerColumnProps) {
  return (
    <div className="brawl-card p-4 space-y-2">
      <label className="text-xs brawl-header text-brawl-text-faint block">{label}</label>
      <select
        className="w-full px-3 py-3 md:py-2 bg-brawl-bg border-2 border-brawl-border text-brawl-text font-mono text-sm focus:border-brawl-orange focus:outline-none min-h-[2.75rem]"
        value={selectedId ?? ''}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === '' ? null : Number.parseInt(v, 10));
        }}
      >
        <option value="">, pick, </option>
        {brawlers.map((br) => (
          <option key={br.tokenId} value={br.tokenId} disabled={disabledId === br.tokenId}>
            #{br.tokenId} {br.name} (Rating {br.elo})
          </option>
        ))}
      </select>
      {hint && <div className="text-sm font-mono text-brawl-text-faint">{hint}</div>}
      {altBrawlers && altBrawlers.length > brawlers.length && (
        <div className="text-sm font-mono text-brawl-text-faint">
          {altBrawlers.length - brawlers.length} more in the full roster (showing yours above)
        </div>
      )}
    </div>
  );
}

// ─── Matchup ────────────────────────────────────────────────────────────

function Matchup({ a, b }: { a: UIBrawler; b: UIBrawler }) {
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] items-stretch">
      <FighterPanel brawler={a} side="left" />
      <div className="brawl-header text-xl md:text-2xl text-brawl-orange flex items-center justify-center md:px-4">
        VS
      </div>
      <FighterPanel brawler={b} side="right" />
    </div>
  );
}

function FighterPanel({ brawler, side }: { brawler: UIBrawler; side: 'left' | 'right' }) {
  return (
    <div
      className={
        'brawl-card p-4 space-y-3 ' + (side === 'left' ? 'md:text-left' : 'md:text-right')
      }
    >
      <div
        className={
          'flex items-center gap-3 ' +
          (side === 'right' ? 'md:flex-row-reverse md:text-right' : '')
        }
      >
        <div className="w-20 h-20 bg-brawl-bg shrink-0">
          <PixelAvatar
            tokenId={brawler.tokenId}
            weaponName={brawler.weapon.name}
            rarity={rarityFromWeight(brawler.weapon.weight)}
            className="w-full h-full pixel"
          />
        </div>
        <div className="min-w-0">
          <div className="brawl-header text-sm text-brawl-text truncate" title={brawler.name}>
            {brawler.name}
          </div>
          <div className="text-sm font-mono text-brawl-text-faint">#{brawler.tokenId}</div>
          <div className="text-sm font-mono">
            <span className="text-brawl-text-dim">RATING </span>
            <span className="text-brawl-cyan font-bold">{brawler.elo}</span>
          </div>
        </div>
      </div>
      <div className="text-sm font-mono">
        <div className="text-brawl-yellow">{brawler.weapon.name}</div>
        <div className="text-brawl-text-dim">
          DMG {brawler.weapon.damageMin}–{brawler.weapon.damageMax}
          {' · '}SPD {brawler.weapon.speed}
        </div>
      </div>
    </div>
  );
}

// ─── Review (animation + submit) ───────────────────────────────────────

interface ReviewPanelProps {
  a: UIBrawler;
  b: UIBrawler;
  response: ApiResponse;
  env: {
    brawlersAddress: `0x${string}`;
    duelAddress: `0x${string}`;
    brawlAddress: `0x${string}`;
    chainId: number;
  };
  connectedAddress: `0x${string}` | undefined;
  onSubmitted: (txHash: `0x${string}`) => void;
  onCancel: () => void;
}

function ReviewPanel({
  a,
  b,
  response,
  env,
  connectedAddress,
  onSubmitted,
  onCancel,
}: ReviewPanelProps) {
  const [animationDone, setAnimationDone] = useState(false);
  const [skipAnimation, setSkipAnimation] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const animating = !animationDone;

  // ─── BRAWL preflight: both owners must have balance + allowance ≥ fightCost ──
  const { data: fightCost } = useReadContract({
    abi: DUEL_ABI,
    address: env.duelAddress,
    functionName: 'fightCost',
    chainId: env.chainId,
  });

  const { data: balanceA, refetch: refetchBalanceA } = useReadContract({
    abi: BRAWL_ABI,
    address: env.brawlAddress,
    functionName: 'balanceOf',
    args: [a.owner],
    chainId: env.chainId,
  });
  const { data: balanceB, refetch: refetchBalanceB } = useReadContract({
    abi: BRAWL_ABI,
    address: env.brawlAddress,
    functionName: 'balanceOf',
    args: [b.owner],
    chainId: env.chainId,
  });
  const { data: allowanceA, refetch: refetchAllowanceA } = useReadContract({
    abi: BRAWL_ABI,
    address: env.brawlAddress,
    functionName: 'allowance',
    args: [a.owner, env.duelAddress],
    chainId: env.chainId,
  });
  const { data: allowanceB, refetch: refetchAllowanceB } = useReadContract({
    abi: BRAWL_ABI,
    address: env.brawlAddress,
    functionName: 'allowance',
    args: [b.owner, env.duelAddress],
    chainId: env.chainId,
  });

  // Pre-fight consecutive-loss streaks. Used to predict whether the loser
  // of THIS duel will die (streak 2 + a loss = 3 in a row = death).
  const { data: streakA } = useReadContract({
    abi: DUEL_ABI,
    address: env.duelAddress,
    functionName: 'consecutiveLosses',
    args: [BigInt(a.tokenId)],
    chainId: env.chainId,
  });
  const { data: streakB } = useReadContract({
    abi: DUEL_ABI,
    address: env.duelAddress,
    functionName: 'consecutiveLosses',
    args: [BigInt(b.tokenId)],
    chainId: env.chainId,
  });

  // Approve flow (only the caller can approve their own BRAWL)
  const {
    writeContractAsync: approveWriteAsync,
    data: approveTxHash,
    isPending: isApproving,
    error: approveError,
    reset: resetApprove,
  } = useWriteContract();
  const { isLoading: isApproveMining, isSuccess: approveMined } =
    useWaitForTransactionReceipt({ hash: approveTxHash });

  const {
    writeContractAsync,
    data: txHash,
    isPending: isSigning,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  // Surfaced to the debug panel below, any exception during a
  // writeContract call lands here (usually chain mismatch / reject /
  // permission denied from the wallet).
  const [lastThrow, setLastThrow] = useState<string | null>(null);
  const {
    isLoading: isMining,
    isSuccess,
    error: mineError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  // Flag set when the user clicks the single "Approve & Submit" CTA so that
  // after the approve mines we auto-fire submit without a second click.
  const [autoSubmitQueued, setAutoSubmitQueued] = useState(false);

  const doSubmit = async () => {
    setLastThrow(null);
    const r = response.result;
    try {
      await writeContractAsync({
        abi: DUEL_ABI,
        address: env.duelAddress,
        chainId: env.chainId,
        functionName: 'submitDuel',
        args: [
          {
            tokenA: BigInt(r.tokenA),
            tokenB: BigInt(r.tokenB),
            winnerId: r.winnerId,
            rounds: r.rounds,
            seed: BigInt(r.seed),
            newEloA: r.newEloA,
            newEloB: r.newEloB,
            nonce: BigInt(r.nonce),
            expiry: BigInt(r.expiry),
          },
          response.signature,
        ],
      });
    } catch (e) {
      setLastThrow(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    }
  };

  // After approve mines: refetch allowances, then fire submit immediately
  // if the user queued it (single-click flow). Gate on !txHash so we only
  // fire once even if the effect re-runs.
  useEffect(() => {
    if (!approveMined) return;
    void refetchAllowanceA();
    void refetchAllowanceB();
    if (autoSubmitQueued && !txHash && !isSigning) {
      setAutoSubmitQueued(false);
      doSubmit();
    }
    // doSubmit is stable-enough for this single-fire pattern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveMined, autoSubmitQueued, txHash, isSigning]);

  useEffect(() => {
    // When BOTH the tx mined AND the animation finished, refresh the
    // roster so balance/ELO reads are fresh. We deliberately do NOT call
    // resetWrite() here, that would clear `txHash` and flip the gated
    // overlay back on top of the arena. The write state is reset naturally
    // when the user hits "Fight Again" (component unmounts).
    if (isSuccess && txHash && animationDone) {
      onSubmitted(txHash);
      void refetchBalanceA();
      void refetchBalanceB();
    }
  }, [isSuccess, txHash, animationDone, onSubmitted, refetchBalanceA, refetchBalanceB]);

  const doApprove = async () => {
    setLastThrow(null);
    try {
      await approveWriteAsync({
        abi: BRAWL_ABI,
        address: env.brawlAddress,
        chainId: env.chainId,
        functionName: 'approve',
        args: [env.duelAddress, (1n << 256n) - 1n],
      });
    } catch (e) {
      setLastThrow(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    }
  };

  // Single-click path: queue the submit, then trigger approve.
  const doApproveAndSubmit = async () => {
    setAutoSubmitQueued(true);
    await doApprove();
  };

  const winnerName =
    response.winnerId === null
      ? 'Tie'
      : response.winnerId === a.tokenId
        ? a.name
        : b.name;

  // Preflight status, undefined while loading, true/false once reads complete.
  const balanceAok = fightCost !== undefined && balanceA !== undefined && balanceA >= fightCost;
  const balanceBok = fightCost !== undefined && balanceB !== undefined && balanceB >= fightCost;
  const allowanceAok = fightCost !== undefined && allowanceA !== undefined && allowanceA >= fightCost;
  const allowanceBok = fightCost !== undefined && allowanceB !== undefined && allowanceB >= fightCost;

  const isMeA = !!connectedAddress && a.owner.toLowerCase() === connectedAddress.toLowerCase();
  const isMeB = !!connectedAddress && b.owner.toLowerCase() === connectedAddress.toLowerCase();
  const myNeedsApproval = (isMeA && !allowanceAok) || (isMeB && !allowanceBok);

  // Split the old monolithic `preflightGreen` into two parts:
  //   - opponentReady: the OTHER side must have balance + allowance BEFORE
  //     we try anything. The matchmaker already filters to ready opponents,
  //     but we double-check on chain data here.
  //   - mySideReady: MY balance must be sufficient. My allowance is NOT
  //     required, if missing, the approve-then-submit flow handles it.
  const opponentReady = isMeA
    ? balanceBok && allowanceBok
    : isMeB
      ? balanceAok && allowanceAok
      : balanceAok && balanceBok && allowanceAok && allowanceBok;
  const mySideReady = isMeA ? balanceAok : isMeB ? balanceBok : true;
  const readyToStart =
    fightCost !== undefined && opponentReady && mySideReady && !!connectedAddress;

  // Legacy flag kept for any UI that expected "everyone's pre-approved".
  const preflightGreen =
    fightCost !== undefined && balanceAok && balanceBok && allowanceAok && allowanceBok;

  // Auto-fire when we have everything we need. Fresh wallet case: opponent
  // is approved, my balance is fine, my allowance is not → doApproveAndSubmit
  // runs the approval tx first, then auto-submits.
  const hasKickedOff = useRef(false);
  useEffect(() => {
    if (hasKickedOff.current) return;
    if (!readyToStart) return;
    if (txHash || approveTxHash) return;
    if (!isMeA && !isMeB) return;
    hasKickedOff.current = true;
    if (myNeedsApproval) {
      doApproveAndSubmit();
    } else {
      doSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyToStart, myNeedsApproval, isMeA, isMeB]);

  // Manual trigger, user tap inside the gated overlay. Bypasses the
  // `hasKickedOff` guard so retries work even after a dismissed popup.
  const manualOpenWallet = () => {
    if (isApproving || isApproveMining || isSigning || isMining) return;
    if (!readyToStart) return;
    if (!isMeA && !isMeB) return;
    hasKickedOff.current = true;
    if (myNeedsApproval) {
      doApproveAndSubmit();
    } else {
      doSubmit();
    }
  };
  const gatedActionLabel = isApproving
    ? 'Check your wallet…'
    : isApproveMining
      ? 'Approval mining…'
      : isSigning
        ? 'Check your wallet…'
        : myNeedsApproval
          ? 'Approve BRAWL & Fight'
          : 'Open Wallet & Fight';
  const gatedActionDisabled =
    isApproving || isApproveMining || isSigning || isMining || !readyToStart;

  const tie = response.winnerId === null;

  // Who's going to die from this fight. 3 consecutive losses → death.
  // Ties reset both streaks so nobody dies on a tie.
  const streakABefore = streakA === undefined ? 0 : Number(streakA);
  const streakBBefore = streakB === undefined ? 0 : Number(streakB);
  const aWillDie =
    !tie &&
    response.winnerId !== a.tokenId &&
    streakABefore + 1 >= 3;
  const bWillDie =
    !tie &&
    response.winnerId !== b.tokenId &&
    streakBBefore + 1 >= 3;

  // The outcome overlay, rendered on top of the frozen arena once the
  // fight ends. Stays on screen indefinitely; the parent phase transition
  // to 'success' fires when both (a) tx mines and (b) animation finishes.
  const finishedOverlay = (
    <>
      <div className="text-center">
        <div className="brawl-header text-sm text-brawl-text-faint mb-1">
          {tie ? 'Draw' : 'Victory'}
        </div>
        <div
          className={`brawl-header text-xl md:text-2xl break-words ${
            tie ? 'text-brawl-yellow' : 'text-brawl-green'
          }`}
        >
          {tie ? 'Double KO' : `${winnerName} wins`}
        </div>
        <div className="text-sm font-mono text-brawl-text-dim mt-1">
          {response.rounds} round{response.rounds === 1 ? '' : 's'}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <EloDeltaRow brawler={a} newElo={response.newEloA} delta={response.deltaA} />
        <span className="brawl-header text-brawl-orange">VS</span>
        <EloDeltaRow brawler={b} newElo={response.newEloB} delta={response.deltaB} align="right" />
      </div>

      <BrawlPreflight
        fightCost={fightCost}
        myBalance={isMeA ? balanceA : isMeB ? balanceB : undefined}
        bothReady={preflightGreen}
        balanceAok={balanceAok}
        balanceBok={balanceBok}
        allowanceAok={allowanceAok}
        allowanceBok={allowanceBok}
      />

      {!txHash && (approveError ?? writeError ?? mineError) ? (
        <div className="space-y-2">
          <div className="text-xs text-brawl-red break-words font-mono">
            {(approveError ?? writeError ?? mineError)?.message}
          </div>
          <button
            type="button"
            className="brawl-btn brawl-btn-secondary w-full"
            onClick={() => {
              hasKickedOff.current = false;
              setAutoSubmitQueued(false);
              resetApprove();
              resetWrite();
            }}
          >
            Retry submit
          </button>
        </div>
      ) : (
        <div className="text-sm font-mono text-brawl-text-dim text-center">
          {isMining
            ? '⛏ Mining transaction…'
            : txHash
              ? '✓ Payment confirmed on chain'
              : 'Waiting for wallet signature…'}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 pt-2 sm:justify-center">
        <button
          type="button"
          className="brawl-btn w-full sm:w-auto"
          onClick={onCancel}
        >
          Fight Again
        </button>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
          <Link
            href={`/brawler/${a.tokenId}`}
            className="brawl-btn brawl-btn-secondary"
          >
            View {a.name.split(' ')[0]}
          </Link>
          <Link
            href={`/brawler/${b.tokenId}`}
            className="brawl-btn brawl-btn-secondary"
          >
            View {b.name.split(' ')[0]}
          </Link>
          <Link
            href="/leaderboard"
            className="brawl-btn brawl-btn-secondary"
          >
            Leaderboard
          </Link>
          <button
            type="button"
            className="brawl-btn brawl-btn-secondary"
            onClick={() => setShowLog((v) => !v)}
          >
            {showLog ? 'Hide log' : 'Combat log'}
          </button>
        </div>
      </div>

      {txHash && (
        <div className="text-sm font-mono text-brawl-text-faint break-all text-center pt-1">
          <TxLink txHash={txHash} />
        </div>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      <DuelAnimation
        a={a}
        b={b}
        events={response.events}
        willDie={{ a: aWillDie, b: bWillDie }}
        skipAnimation={skipAnimation}
        gated={!txHash}
        gatedMessage={
          isApproving
            ? 'Sign the BRAWL approval in your wallet'
            : isApproveMining
              ? 'Approval confirming, wallet will pop again for the stake'
              : isSigning
                ? `Sign the ${fightCost !== undefined ? formatUnits(fightCost, 18) : ''} BRAWL stake in your wallet`
                : 'Ready, open your wallet to pay and start the fight'
        }
        gatedAction={{
          label: gatedActionLabel,
          onTap: manualOpenWallet,
          disabled: gatedActionDisabled,
        }}
        finishedOverlay={animationDone ? finishedOverlay : null}
        onFinished={() => setAnimationDone(true)}
      />

      {/* Surface a friendlier message when an opponent's BRAWL allowance
          is the real root cause (viem reports it as a gas-limit error). */}
      {!txHash && (writeError || lastThrow) && (
        <div className="brawl-card p-3 text-xs text-brawl-red space-y-2 border-brawl-red">
          {(() => {
            const msg = writeError?.message ?? lastThrow ?? '';
            if (/gas limit too high/i.test(msg)) {
              return (
                <>
                  <div className="brawl-header text-xs">Opponent not duel-ready</div>
                  <div className="text-brawl-text-dim">
                    The opponent&rsquo;s wallet hasn&rsquo;t approved BRAWL for the Duel
                    contract. Tap Cancel and reroll for a ready opponent.
                  </div>
                </>
              );
            }
            return (
              <>
                <div className="brawl-header text-xs">Submit failed</div>
                <div className="break-all font-mono">{msg}</div>
              </>
            );
          })()}
          <button
            type="button"
            className="brawl-btn brawl-btn-secondary"
            onClick={() => {
              hasKickedOff.current = false;
              setAutoSubmitQueued(false);
              resetApprove();
              resetWrite();
              setLastThrow(null);
              onCancel();
            }}
          >
            Back to matchmaking
          </button>
        </div>
      )}

      {/* Skip / Cancel row, only while the fight is actively playing. */}
      {animating && txHash && (
        <div className="flex items-center justify-end gap-3 text-xs">
          <button
            type="button"
            className="text-brawl-text-dim hover:text-brawl-orange font-mono"
            onClick={() => setSkipAnimation(true)}
          >
            Skip to result
          </button>
          <button
            type="button"
            className="text-brawl-text-dim hover:text-brawl-orange font-mono"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      )}

      {showLog && (
        <div className="brawl-card p-3 bg-brawl-bg border border-brawl-border max-h-72 overflow-y-auto font-mono text-sm space-y-1">
          {response.events.map((ev, i) => (
            <EventLine key={i} event={ev} a={a} b={b} />
          ))}
        </div>
      )}
    </div>
  );
}

interface BrawlPreflightProps {
  fightCost: bigint | undefined;
  myBalance: bigint | undefined;
  bothReady: boolean;
  balanceAok: boolean;
  balanceBok: boolean;
  allowanceAok: boolean;
  allowanceBok: boolean;
}

/**
 * Minimal economics panel, shows pot size + connected user's BRAWL
 * balance. Behind the scenes we still check both sides' balance + allowance
 * to avoid a wasted submit, but the user doesn't need to read the details
 * unless something is wrong.
 */
function BrawlPreflight(props: BrawlPreflightProps) {
  const {
    fightCost,
    myBalance,
    bothReady,
    balanceAok,
    balanceBok,
    allowanceAok,
    allowanceBok,
  } = props;

  if (fightCost === undefined) {
    return (
      <div className="brawl-card p-3 text-sm font-mono text-brawl-text-faint">
        Checking preflight…
      </div>
    );
  }

  const pot = fightCost * 2n;
  const stakeLabel = formatUnits(fightCost, 18);
  const potLabel = formatUnits(pot, 18);
  const balanceLabel = myBalance !== undefined ? `${formatUnits(myBalance, 18)} BRAWL` : '…';

  return (
    <div className="brawl-card p-3 space-y-2 text-sm font-mono">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="text-brawl-text-faint brawl-header text-xs mr-2">POT</span>
          <span className="text-brawl-orange text-base font-bold">{potLabel} BRAWL</span>
          <span className="text-brawl-text-faint text-sm ml-2">
            ({stakeLabel} each, winner takes 90%)
          </span>
        </div>
        {myBalance !== undefined && (
          <div>
            <span className="text-brawl-text-faint brawl-header text-xs mr-2">
              YOUR BAL
            </span>
            <span className="text-brawl-cyan">{balanceLabel}</span>
          </div>
        )}
      </div>

      {!bothReady && (
        <div className="text-xs text-brawl-red">
          {!balanceAok || !balanceBok
            ? '⚠ A fighter is short BRAWL, the submit will revert.'
            : !allowanceAok || !allowanceBok
              ? '⚠ A fighter hasn’t approved Duel to spend BRAWL. If it’s you, the Approve & Submit button below handles it in one flow.'
              : null}
        </div>
      )}
    </div>
  );
}

function EventLine({
  event,
  a,
  b,
}: {
  event: CombatEvent;
  a: UIBrawler;
  b: UIBrawler;
}) {
  const nameFor = (id: number) =>
    id === a.tokenId ? a.name : id === b.tokenId ? b.name : `#${id}`;

  switch (event.type) {
    case 'round_start':
      return (
        <div className="text-brawl-text-faint border-t border-brawl-border pt-1 mt-1 first:border-0 first:pt-0 first:mt-0">
          Round {event.round}: {nameFor(event.attackerId)} has initiative
        </div>
      );
    case 'attack_hit': {
      const critTag = event.isCritical ? (
        <span className="text-brawl-yellow"> CRIT!</span>
      ) : null;
      const typeTag = event.typeAdvantage ? (
        <span className="text-brawl-green"> (type advantage)</span>
      ) : null;
      return (
        <div>
          <span className="text-brawl-text">{nameFor(event.attackerId)}</span>{' '}
          <span className="text-brawl-text-dim">hits</span>{' '}
          <span className="text-brawl-text">{nameFor(event.defenderId)}</span>{' '}
          <span className="text-brawl-red">for {event.damage}</span>
          {critTag}
          {typeTag}
          <span className="text-brawl-text-dim">
            {' '}
            (HP {event.defenderHpAfter})
          </span>
        </div>
      );
    }
    case 'attack_miss':
      return (
        <div className="text-brawl-text-dim">
          <span className="text-brawl-text">{nameFor(event.attackerId)}</span>{' '}
          misses <span className="text-brawl-text">{nameFor(event.defenderId)}</span>
        </div>
      );
    case 'fight_end':
      if (event.winnerId === null) {
        return (
          <div className="text-brawl-yellow font-bold pt-1">
            ✦ Double KO, tie after {event.rounds} round{event.rounds === 1 ? '' : 's'}
          </div>
        );
      }
      return (
        <div className="text-brawl-green font-bold pt-1">
          ✦ {nameFor(event.winnerId)} wins after {event.rounds} round
          {event.rounds === 1 ? '' : 's'}
        </div>
      );
  }
}

function OutcomeSummary({
  winnerName,
  rounds,
  a,
  b,
  response,
}: {
  winnerName: string;
  rounds: number;
  a: UIBrawler;
  b: UIBrawler;
  response: ApiResponse;
}) {
  return (
    <div className="border-t border-brawl-border pt-3 grid gap-2 md:grid-cols-[1fr_auto_1fr] items-center">
      <EloDeltaRow brawler={a} newElo={response.newEloA} delta={response.deltaA} />
      <div className="text-center">
        <div className="brawl-header text-xs text-brawl-orange">{winnerName}</div>
        <div className="text-sm font-mono text-brawl-text-faint">
          {rounds} round{rounds === 1 ? '' : 's'}
        </div>
      </div>
      <EloDeltaRow brawler={b} newElo={response.newEloB} delta={response.deltaB} align="right" />
    </div>
  );
}

function EloDeltaRow({
  brawler,
  newElo,
  delta,
  align = 'left',
}: {
  brawler: UIBrawler;
  newElo: number;
  delta: number;
  align?: 'left' | 'right';
}) {
  const deltaStr = delta > 0 ? `+${delta}` : String(delta);
  const deltaColor =
    delta > 0 ? 'text-brawl-green' : delta < 0 ? 'text-brawl-red' : 'text-brawl-text-dim';
  return (
    <div
      className={
        'text-sm font-mono ' + (align === 'right' ? 'text-right' : 'text-left')
      }
    >
      <div className="text-brawl-text-dim truncate" title={brawler.name}>
        {brawler.name}
      </div>
      <div>
        <span className="text-brawl-text-dim">RATING </span>
        <span className="text-brawl-cyan font-bold">{brawler.elo}</span>
        <span className="text-brawl-text-dim"> → </span>
        <span className="text-brawl-cyan font-bold">{newElo}</span>
        <span className={`${deltaColor} ml-2`}>({deltaStr})</span>
      </div>
    </div>
  );
}

