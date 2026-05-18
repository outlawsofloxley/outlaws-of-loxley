'use client';

/**
 * SettingsEditors, each labeled card reads a current on-chain value and
 * has an input + Update button that pops the connected dev wallet for an
 * owner-only setter tx. All reads use useReadContract; writes use
 * writeContract from wagmi.
 *
 * No server-held keys involved. The owner wallet must be connected;
 * the tx will revert otherwise.
 */
import { useEffect, useMemo, useState } from 'react';
import { parseEther, parseUnits, formatEther, formatUnits } from 'viem';
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import {
  DUEL_ABI,
  DUEL_ROUTER_ABI,
  GRAVEYARD_ABI,
  MARKETPLACE_ABI,
  MINTDROP_ABI,
} from '@/lib/abi';
import { requireEnv } from '@/lib/env';
import { nativeSymbol } from '@/lib/wagmi';

type Wei = bigint | undefined;

export function SettingsEditors() {
  const { env } = requireEnv();
  const sym = nativeSymbol(env.chainId);

  // ── Reads ──
  const fightCost = useReadContract({
    abi: DUEL_ABI,
    address: env.duelAddress,
    functionName: 'fightCost',
  });
  const devShareBps = useReadContract({
    abi: DUEL_ABI,
    address: env.duelAddress,
    functionName: 'devShareBps',
  });
  // v5+, reverts on v4. Empty data → editor renders a "deploy v5 to use" hint.
  const founderDiscountBps = useReadContract({
    abi: DUEL_ABI,
    address: env.duelAddress,
    functionName: 'founderDiscountBps',
  });
  const devTreasury = useReadContract({
    abi: DUEL_ABI,
    address: env.duelAddress,
    functionName: 'devTreasury',
  });
  const graveyardCost = useReadContract({
    abi: GRAVEYARD_ABI,
    address: env.graveyardAddress,
    functionName: 'resurrectionCost',
  });
  const graveyardCap = useReadContract({
    abi: GRAVEYARD_ABI,
    address: env.graveyardAddress,
    functionName: 'resurrectionCap',
  });
  const resurrectCostCents = useReadContract({
    abi: GRAVEYARD_ABI,
    address: env.graveyardAddress,
    functionName: 'resurrectionCostUsdCents',
  });
  const resurrectCapCents = useReadContract({
    abi: GRAVEYARD_ABI,
    address: env.graveyardAddress,
    functionName: 'resurrectionCapUsdCents',
  });
  const fightCostUsdCents = useReadContract({
    abi: DUEL_ROUTER_ABI,
    address: env.duelRouterAddress ?? undefined,
    functionName: 'fightCostUsdCents',
    query: { enabled: !!env.duelRouterAddress },
  });
  const mintEth = useReadContract({
    abi: MINTDROP_ABI,
    address: env.mintDropAddress,
    functionName: 'ethPrice',
  });
  const mintUsdt = useReadContract({
    abi: MINTDROP_ABI,
    address: env.mintDropAddress,
    functionName: 'usdtPrice',
  });
  const mintUsdc = useReadContract({
    abi: MINTDROP_ABI,
    address: env.mintDropAddress,
    functionName: 'usdcPrice',
  });
  const mintAirdrop = useReadContract({
    abi: MINTDROP_ABI,
    address: env.mintDropAddress,
    functionName: 'airdropPerMint',
  });
  const mintTreasury = useReadContract({
    abi: MINTDROP_ABI,
    address: env.mintDropAddress,
    functionName: 'treasury',
  });
  // v5+ tier table, reverts on v4. Empty data → editor renders a hint.
  const priceTierCount = useReadContract({
    abi: MINTDROP_ABI,
    address: env.mintDropAddress,
    functionName: 'priceTierCount',
  });
  const marketFee = useReadContract({
    abi: MARKETPLACE_ABI,
    address: env.marketplaceAddress,
    functionName: 'feeBps',
  });
  const marketTreasury = useReadContract({
    abi: MARKETPLACE_ABI,
    address: env.marketplaceAddress,
    functionName: 'feeTreasury',
  });
  const marketPaused = useReadContract({
    abi: MARKETPLACE_ABI,
    address: env.marketplaceAddress,
    functionName: 'paused',
  });

  const refetchAll = () => {
    void fightCost.refetch();
    void devShareBps.refetch();
    void devTreasury.refetch();
    void graveyardCost.refetch();
    void graveyardCap.refetch();
    void resurrectCostCents.refetch();
    void resurrectCapCents.refetch();
    void fightCostUsdCents.refetch();
    void mintEth.refetch();
    void mintUsdt.refetch();
    void mintUsdc.refetch();
    void mintAirdrop.refetch();
    void mintTreasury.refetch();
    void marketFee.refetch();
    void marketTreasury.refetch();
    void marketPaused.refetch();
  };

  return (
    <div className="space-y-6">
      <div className="brawl-header text-lg text-brawl-orange">Game settings</div>

      <Section title="Duel economics">
        <FightEconomicsEditor
          current={{
            fightCost: fightCost.data as Wei,
            devShareBps: devShareBps.data as number | undefined,
            devTreasury: devTreasury.data as `0x${string}` | undefined,
          }}
          symbol={sym}
          onSuccess={refetchAll}
        />
        <FounderDiscountEditor
          current={founderDiscountBps.data as bigint | undefined}
          available={founderDiscountBps.error == null}
          onSuccess={refetchAll}
        />
      </Section>

      <Section title="Graveyard">
        <UsdCentsEditor
          label="resurrectionCost target (USD)"
          current={resurrectCostCents.data as bigint | undefined}
          contract={env.graveyardAddress}
          abi={GRAVEYARD_ABI}
          functionName="setResurrectionCostUsdCents"
          auditKey="graveyard:setResurrectionCostUsdCents"
          help="The base resurrection cost in USD. The resurrect-cost-keeper bot reads this and updates resurrectionCost (ETH wei) within 5 min. Default $100."
          onSuccess={refetchAll}
        />
        <UsdCentsEditor
          label="resurrectionCap target (USD)"
          current={resurrectCapCents.data as bigint | undefined}
          contract={env.graveyardAddress}
          abi={GRAVEYARD_ABI}
          functionName="setResurrectionCapUsdCents"
          auditKey="graveyard:setResurrectionCapUsdCents"
          help="The per-revive ceiling in USD. Clamps even max-mult King at this value. Keeper updates resurrectionCap (ETH wei) automatically. Default $500."
          onSuccess={refetchAll}
        />
        <GraveyardCostEditor
          current={graveyardCost.data as Wei}
          symbol={sym}
          onSuccess={refetchAll}
        />
        <GraveyardCapEditor
          current={graveyardCap.data as Wei}
          symbol={sym}
          onSuccess={refetchAll}
        />
      </Section>

      {env.duelRouterAddress && (
        <Section title="DuelRouter (USD targets)">
          <UsdCentsEditor
            label="fightCost target (USD)"
            current={fightCostUsdCents.data as bigint | undefined}
            contract={env.duelRouterAddress}
            abi={DUEL_ROUTER_ABI}
            functionName="setFightCostUsdCents"
            auditKey="router:setFightCostUsdCents"
            help="Per-fighter USD target. fight-cost-keeper bot reads this and updates fightCostBrawl + fightCostEth wei amounts within 5 min. Change once, both currencies follow. Default $1."
            onSuccess={refetchAll}
          />
        </Section>
      )}

      <Section title="MintDrop">
        <MintPriceEditor
          currentEth={mintEth.data as Wei}
          currentUsdt={mintUsdt.data as Wei}
          currentUsdc={mintUsdc.data as Wei}
          symbol={sym}
          onSuccess={refetchAll}
        />
        <MintAirdropEditor
          current={mintAirdrop.data as Wei}
          onSuccess={refetchAll}
        />
        <MintTreasuryEditor
          current={mintTreasury.data as `0x${string}` | undefined}
          onSuccess={refetchAll}
        />
        <TierPricingEditor
          tierCount={priceTierCount.data as bigint | undefined}
          available={priceTierCount.error == null}
          onSuccess={refetchAll}
        />
      </Section>

      <Section title="Marketplace">
        <MarketFeeEditor
          current={marketFee.data as number | undefined}
          onSuccess={refetchAll}
        />
        <MarketTreasuryEditor
          current={marketTreasury.data as `0x${string}` | undefined}
          onSuccess={refetchAll}
        />
        <MarketPauseToggle
          paused={marketPaused.data as boolean | undefined}
          onSuccess={refetchAll}
        />
      </Section>

      <Section title="Admin actions">
        <WipeEventsButton />
      </Section>
    </div>
  );
}

function WipeEventsButton() {
  const [phase, setPhase] = useState<
    | { kind: 'idle' }
    | { kind: 'confirming' }
    | { kind: 'running' }
    | { kind: 'done'; wiped: Record<string, number>; cursorReset: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const [fromBlock, setFromBlock] = useState<string>('46050000');

  const run = async () => {
    setPhase({ kind: 'running' });
    try {
      const res = await fetch('/api/dash/wipe-events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fromBlock: fromBlock.trim() || undefined }),
      });
      const json = (await res.json()) as
        | { ok: true; wiped: Record<string, number>; cursorReset: string }
        | { ok: false; error: string };
      if (!('ok' in json) || !json.ok) {
        setPhase({ kind: 'error', message: ('error' in json && json.error) || 'wipe failed' });
        return;
      }
      setPhase({ kind: 'done', wiped: json.wiped, cursorReset: json.cursorReset });
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="space-y-2">
      <div className="brawl-header text-sm text-brawl-text">Wipe stale event tables</div>
      <div className="text-xs text-brawl-text-faint font-mono">
        TRUNCATEs <code>mint_events</code>, <code>resurrect_events</code>,{' '}
        <code>market_sales</code> and resets the dash sync cursor to the block
        below minus 1. Use after a chain switch (e.g. Sepolia → mainnet) so the
        revenue widgets stop showing rows from the wrong deployment. The next
        /api/dash/sync poll walks forward from this block and rebuilds the
        tables with mainnet-only data.
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-mono text-brawl-text-dim">
          Resume from block
          <input
            type="text"
            inputMode="numeric"
            value={fromBlock}
            onChange={(e) => setFromBlock(e.target.value)}
            className="ml-2 w-32 px-2 py-1 bg-brawl-bg border-2 border-brawl-border text-brawl-text font-mono text-xs focus:border-brawl-orange focus:outline-none"
            aria-label="resume from block"
            disabled={phase.kind === 'running'}
          />
        </label>
        {phase.kind === 'idle' || phase.kind === 'error' ? (
          <button
            type="button"
            onClick={() => setPhase({ kind: 'confirming' })}
            className="brawl-btn brawl-btn-secondary text-xs px-3 py-2"
          >
            Wipe stale events…
          </button>
        ) : null}
        {phase.kind === 'confirming' && (
          <>
            <button
              type="button"
              onClick={run}
              className="brawl-btn text-xs px-3 py-2 bg-brawl-red border-brawl-red text-brawl-bg hover:bg-brawl-red"
            >
              Confirm wipe
            </button>
            <button
              type="button"
              onClick={() => setPhase({ kind: 'idle' })}
              className="brawl-btn brawl-btn-secondary text-xs px-3 py-2"
            >
              Cancel
            </button>
          </>
        )}
        {phase.kind === 'running' && (
          <span className="text-xs font-mono text-brawl-orange">wiping…</span>
        )}
      </div>
      {phase.kind === 'done' && (
        <div className="text-xs font-mono text-brawl-green space-y-1">
          <div>✓ wiped:</div>
          {Object.entries(phase.wiped).map(([table, n]) => (
            <div key={table} className="pl-3">
              <span className="text-brawl-text-dim">{table}:</span>{' '}
              <span className="text-brawl-text">{n} rows</span>
            </div>
          ))}
          <div className="text-brawl-text-faint pt-1">
            cursor: {phase.cursorReset}
          </div>
        </div>
      )}
      {phase.kind === 'error' && (
        <div className="text-xs font-mono text-brawl-red">
          ✗ {phase.message}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="brawl-card p-4 space-y-4">
      <div className="brawl-header text-sm text-brawl-orange">{title}</div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function useAuditPost() {
  return async (action: string, payload: unknown) => {
    try {
      await fetch('/api/dash/audit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, payload }),
      });
    } catch {
      /* best-effort */
    }
  };
}

/** Writer + wait hook packaged with error formatting, status, success callback. */
function useTxWrite(onSuccess?: () => void) {
  const { writeContract, data: hash, isPending, error: writeErr, reset } = useWriteContract();
  const { isLoading: isMining, isSuccess, error: mineErr } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess && onSuccess) onSuccess();
  }, [isSuccess, onSuccess]);

  const err = writeErr?.message ?? mineErr?.message ?? null;
  return { writeContract, hash, isPending, isMining, isSuccess, err, reset };
}

function FightEconomicsEditor({
  current,
  symbol,
  onSuccess,
}: {
  current: { fightCost: Wei; devShareBps: number | undefined; devTreasury: `0x${string}` | undefined };
  symbol: string;
  onSuccess: () => void;
}) {
  const { env } = requireEnv();
  const { address } = useAccount();
  const { writeContract, isPending, isMining, err, hash, isSuccess, reset } = useTxWrite(onSuccess);
  const postAudit = useAuditPost();

  const [cost, setCost] = useState('');
  const [bps, setBps] = useState('');
  const [treasury, setTreasury] = useState('');

  useEffect(() => {
    if (current.fightCost !== undefined) setCost(formatUnits(current.fightCost, 18));
    if (current.devShareBps !== undefined) setBps(String(current.devShareBps));
    if (current.devTreasury) setTreasury(current.devTreasury);
  }, [current.fightCost, current.devShareBps, current.devTreasury]);

  const handle = async () => {
    if (!address) return;
    try {
      const newCost = parseUnits(cost, 18);
      const newBps = Number(bps);
      if (!Number.isInteger(newBps) || newBps < 0 || newBps > 2000) {
        throw new Error('devShareBps must be 0..2000');
      }
      if (!/^0x[0-9a-fA-F]{40}$/.test(treasury)) {
        throw new Error('invalid treasury address');
      }
      writeContract({
        abi: DUEL_ABI,
        address: env.duelAddress,
        functionName: 'setFightEconomics',
        args: [newCost, newBps, treasury as `0x${string}`],
      });
      void postAudit('duel:setFightEconomics', {
        fightCost: newCost.toString(),
        devShareBps: newBps,
        devTreasury: treasury,
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'invalid input');
    }
  };

  return (
    <div className="space-y-2">
      <Row label="fightCost (BRAWL per fighter)">
        <input
          className="brawl-input"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          inputMode="decimal"
        />
      </Row>
      <Row label="devShareBps (0-2000)">
        <input
          className="brawl-input"
          value={bps}
          onChange={(e) => setBps(e.target.value)}
          inputMode="numeric"
        />
      </Row>
      <Row label="devTreasury">
        <input
          className="brawl-input"
          value={treasury}
          onChange={(e) => setTreasury(e.target.value)}
          spellCheck={false}
        />
      </Row>
      <TxFooter
        onClick={handle}
        busy={isPending || isMining}
        success={isSuccess}
        err={err}
        hash={hash}
        reset={reset}
        label="Update Duel economics"
        currentHint={`current: ${current.fightCost ? formatUnits(current.fightCost, 18) : ', '} BRAWL · ${current.devShareBps ?? ', '} bps · ${current.devTreasury?.slice(0, 10) ?? ', '}…`}
      />
      <div className="text-sm text-brawl-text-faint font-mono">
        {symbol ? '' : ''}
        Max dev share = 2000 bps (20%). 500 bps = 5% of pot.
      </div>
    </div>
  );
}

function GraveyardCostEditor({
  current,
  symbol,
  onSuccess,
}: {
  current: Wei;
  symbol: string;
  onSuccess: () => void;
}) {
  const { env } = requireEnv();
  const { writeContract, isPending, isMining, err, hash, isSuccess, reset } = useTxWrite(onSuccess);
  const postAudit = useAuditPost();
  const [val, setVal] = useState('');

  useEffect(() => {
    if (current !== undefined) setVal(formatEther(current));
  }, [current]);

  const handle = async () => {
    try {
      const wei = parseEther(val);
      writeContract({
        abi: GRAVEYARD_ABI,
        address: env.graveyardAddress,
        functionName: 'setResurrectionCost' as never,
        args: [wei] as never,
      });
      void postAudit('graveyard:setResurrectionCost', { wei: wei.toString() });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'invalid amount');
    }
  };

  return (
    <div className="space-y-2">
      <Row label={`resurrectionCost (base, in ${symbol})`}>
        <input
          className="brawl-input"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          inputMode="decimal"
        />
      </Row>
      <TxFooter
        onClick={handle}
        busy={isPending || isMining}
        success={isSuccess}
        err={err}
        hash={hash}
        reset={reset}
        label="Update base resurrection cost"
        currentHint={`current: ${current !== undefined ? formatEther(current) : ', '} ${symbol}`}
      />
      <div className="text-sm text-brawl-text-faint font-mono">
        Per-brawler cost = base × tierMult/10 × (10 + wins)/10, then capped
        at resurrectionCap (below). Set base via the resurrection-cost-keeper
        bot to peg to $100 USD as ETH price drifts.
      </div>
    </div>
  );
}

function GraveyardCapEditor({
  current,
  symbol,
  onSuccess,
}: {
  current: Wei;
  symbol: string;
  onSuccess: () => void;
}) {
  const { env } = requireEnv();
  const { writeContract, isPending, isMining, err, hash, isSuccess, reset } = useTxWrite(onSuccess);
  const postAudit = useAuditPost();
  const [val, setVal] = useState('');

  useEffect(() => {
    if (current !== undefined) setVal(formatEther(current));
  }, [current]);

  const handle = async () => {
    try {
      const wei = parseEther(val);
      writeContract({
        abi: GRAVEYARD_ABI,
        address: env.graveyardAddress,
        functionName: 'setResurrectionCap' as never,
        args: [wei] as never,
      });
      void postAudit('graveyard:setResurrectionCap', { wei: wei.toString() });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'invalid amount');
    }
  };

  return (
    <div className="space-y-2">
      <Row label={`resurrectionCap (per-revive max, in ${symbol})`}>
        <input
          className="brawl-input"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          inputMode="decimal"
        />
      </Row>
      <TxFooter
        onClick={handle}
        busy={isPending || isMining}
        success={isSuccess}
        err={err}
        hash={hash}
        reset={reset}
        label="Update per-revive cap"
        currentHint={`current: ${current !== undefined ? formatEther(current) : ', '} ${symbol} (≈ $${current !== undefined ? (Number(formatEther(current)) * 4000).toFixed(0) : '—'} @ $4k ETH)`}
      />
      <div className="text-sm text-brawl-text-faint font-mono">
        Hard ceiling per resurrect. Default 0.125 ETH (~$500). The formula
        cost = base × tierMult × (10+wins)/100 gets clamped to this value
        when it would otherwise exceed it. Set 0 to disable the cap and let
        the formula run uncapped (worst case ~$3k for King with many wins).
      </div>
    </div>
  );
}

function MintPriceEditor({
  currentEth,
  currentUsdt,
  currentUsdc,
  symbol,
  onSuccess,
}: {
  currentEth: Wei;
  currentUsdt: Wei;
  currentUsdc: Wei;
  symbol: string;
  onSuccess: () => void;
}) {
  const { env } = requireEnv();
  const { writeContract, isPending, isMining, err, hash, isSuccess, reset } = useTxWrite(onSuccess);
  const postAudit = useAuditPost();
  const [eth, setEth] = useState('');
  const [usdt, setUsdt] = useState('');
  const [usdc, setUsdc] = useState('');

  useEffect(() => {
    if (currentEth !== undefined) setEth(formatEther(currentEth));
    if (currentUsdt !== undefined) setUsdt(formatUnits(currentUsdt, 6));
    if (currentUsdc !== undefined) setUsdc(formatUnits(currentUsdc, 6));
  }, [currentEth, currentUsdt, currentUsdc]);

  const handle = async () => {
    try {
      const ethWei = parseEther(eth);
      const usdtRaw = parseUnits(usdt, 6);
      const usdcRaw = parseUnits(usdc, 6);
      writeContract({
        abi: MINTDROP_ABI,
        address: env.mintDropAddress,
        functionName: 'setPrices',
        args: [ethWei, usdtRaw, usdcRaw],
      });
      void postAudit('mintDrop:setPrices', {
        ethPrice: ethWei.toString(),
        usdtPrice: usdtRaw.toString(),
        usdcPrice: usdcRaw.toString(),
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'invalid amount');
    }
  };

  return (
    <div className="space-y-2">
      <Row label={`ethPrice (${symbol})`}>
        <input
          className="brawl-input"
          value={eth}
          onChange={(e) => setEth(e.target.value)}
          inputMode="decimal"
        />
      </Row>
      <Row label="usdtPrice (USDT)">
        <input
          className="brawl-input"
          value={usdt}
          onChange={(e) => setUsdt(e.target.value)}
          inputMode="decimal"
        />
      </Row>
      <Row label="usdcPrice (USDC)">
        <input
          className="brawl-input"
          value={usdc}
          onChange={(e) => setUsdc(e.target.value)}
          inputMode="decimal"
        />
      </Row>
      <TxFooter
        onClick={handle}
        busy={isPending || isMining}
        success={isSuccess}
        err={err}
        hash={hash}
        reset={reset}
        label="Update mint prices"
        currentHint={`current: ${currentEth !== undefined ? formatEther(currentEth) : ', '} ${symbol} · ${currentUsdt !== undefined ? formatUnits(currentUsdt, 6) : ', '} USDT · ${currentUsdc !== undefined ? formatUnits(currentUsdc, 6) : ', '} USDC`}
      />
    </div>
  );
}

function MintAirdropEditor({
  current,
  onSuccess,
}: {
  current: Wei;
  onSuccess: () => void;
}) {
  const { env } = requireEnv();
  const { writeContract, isPending, isMining, err, hash, isSuccess, reset } = useTxWrite(onSuccess);
  const postAudit = useAuditPost();
  const [val, setVal] = useState('');

  useEffect(() => {
    if (current !== undefined) setVal(formatUnits(current, 18));
  }, [current]);

  const handle = async () => {
    try {
      const amt = parseUnits(val, 18);
      writeContract({
        abi: MINTDROP_ABI,
        address: env.mintDropAddress,
        functionName: 'setAirdropPerMint',
        args: [amt],
      });
      void postAudit('mintDrop:setAirdropPerMint', { wei: amt.toString() });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'invalid amount');
    }
  };

  return (
    <div className="space-y-2">
      <Row label="airdropPerMint (BRAWL)">
        <input
          className="brawl-input"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          inputMode="decimal"
        />
      </Row>
      <TxFooter
        onClick={handle}
        busy={isPending || isMining}
        success={isSuccess}
        err={err}
        hash={hash}
        reset={reset}
        label="Update airdrop"
        currentHint={`current: ${current !== undefined ? formatUnits(current, 18) : ', '} BRAWL/mint`}
      />
    </div>
  );
}

function MintTreasuryEditor({
  current,
  onSuccess,
}: {
  current: `0x${string}` | undefined;
  onSuccess: () => void;
}) {
  const { env } = requireEnv();
  const { writeContract, isPending, isMining, err, hash, isSuccess, reset } = useTxWrite(onSuccess);
  const postAudit = useAuditPost();
  const [val, setVal] = useState('');

  useEffect(() => {
    if (current) setVal(current);
  }, [current]);

  const handle = async () => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(val)) {
      alert('invalid treasury address');
      return;
    }
    writeContract({
      abi: MINTDROP_ABI,
      address: env.mintDropAddress,
      functionName: 'setTreasury',
      args: [val as `0x${string}`],
    });
    void postAudit('mintDrop:setTreasury', { treasury: val });
  };

  return (
    <div className="space-y-2">
      <Row label="treasury">
        <input
          className="brawl-input"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          spellCheck={false}
        />
      </Row>
      <TxFooter
        onClick={handle}
        busy={isPending || isMining}
        success={isSuccess}
        err={err}
        hash={hash}
        reset={reset}
        label="Update mint treasury"
        currentHint={`current: ${current ?? ', '}`}
      />
    </div>
  );
}

function MarketFeeEditor({
  current,
  onSuccess,
}: {
  current: number | undefined;
  onSuccess: () => void;
}) {
  const { env } = requireEnv();
  const { writeContract, isPending, isMining, err, hash, isSuccess, reset } = useTxWrite(onSuccess);
  const postAudit = useAuditPost();
  const [val, setVal] = useState('');

  useEffect(() => {
    if (current !== undefined) setVal(String(current));
  }, [current]);

  const handle = async () => {
    const bps = Number(val);
    if (!Number.isInteger(bps) || bps < 0 || bps > 1000) {
      alert('feeBps must be 0..1000 (10% max)');
      return;
    }
    writeContract({
      abi: MARKETPLACE_ABI,
      address: env.marketplaceAddress,
      functionName: 'setFee',
      args: [bps],
    });
    void postAudit('market:setFee', { feeBps: bps });
  };

  return (
    <div className="space-y-2">
      <Row label="feeBps (0..1000 = 10%)">
        <input
          className="brawl-input"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          inputMode="numeric"
        />
      </Row>
      <TxFooter
        onClick={handle}
        busy={isPending || isMining}
        success={isSuccess}
        err={err}
        hash={hash}
        reset={reset}
        label="Update marketplace fee"
        currentHint={`current: ${current ?? ', '} bps (${current ? (current / 100).toFixed(2) : ', '}%)`}
      />
    </div>
  );
}

function MarketTreasuryEditor({
  current,
  onSuccess,
}: {
  current: `0x${string}` | undefined;
  onSuccess: () => void;
}) {
  const { env } = requireEnv();
  const { writeContract, isPending, isMining, err, hash, isSuccess, reset } = useTxWrite(onSuccess);
  const postAudit = useAuditPost();
  const [val, setVal] = useState('');

  useEffect(() => {
    if (current) setVal(current);
  }, [current]);

  const handle = async () => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(val)) {
      alert('invalid treasury address');
      return;
    }
    writeContract({
      abi: MARKETPLACE_ABI,
      address: env.marketplaceAddress,
      functionName: 'setFeeTreasury',
      args: [val as `0x${string}`],
    });
    void postAudit('market:setFeeTreasury', { treasury: val });
  };

  return (
    <div className="space-y-2">
      <Row label="feeTreasury">
        <input
          className="brawl-input"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          spellCheck={false}
        />
      </Row>
      <TxFooter
        onClick={handle}
        busy={isPending || isMining}
        success={isSuccess}
        err={err}
        hash={hash}
        reset={reset}
        label="Update marketplace treasury"
        currentHint={`current: ${current ?? ', '}`}
      />
    </div>
  );
}

function MarketPauseToggle({
  paused,
  onSuccess,
}: {
  paused: boolean | undefined;
  onSuccess: () => void;
}) {
  const { env } = requireEnv();
  const { writeContract, isPending, isMining, err, hash, isSuccess, reset } = useTxWrite(onSuccess);
  const postAudit = useAuditPost();

  const handle = () => {
    if (paused === undefined) return;
    writeContract({
      abi: MARKETPLACE_ABI,
      address: env.marketplaceAddress,
      functionName: paused ? 'unpause' as never : 'pause' as never,
      args: [] as never,
    });
    void postAudit(paused ? 'market:unpause' : 'market:pause', {});
  };

  return (
    <div className="space-y-2">
      <Row label="marketplace paused?">
        <div className="text-sm font-mono text-brawl-text">
          {paused === undefined ? ', ' : paused ? 'YES (new listings + buys blocked)' : 'no (normal)'}
        </div>
      </Row>
      <TxFooter
        onClick={handle}
        busy={isPending || isMining}
        success={isSuccess}
        err={err}
        hash={hash}
        reset={reset}
        label={paused ? 'Unpause marketplace' : 'Pause marketplace'}
      />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 md:grid-cols-[16rem_1fr] md:items-center">
      <div className="text-sm font-mono text-brawl-text-dim">{label}</div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function TxFooter({
  onClick,
  busy,
  success,
  err,
  hash,
  reset,
  label,
  currentHint,
}: {
  onClick: () => void;
  busy: boolean;
  success: boolean;
  err: string | null;
  hash: `0x${string}` | undefined;
  reset: () => void;
  label: string;
  currentHint?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" className="brawl-btn" onClick={onClick} disabled={busy}>
          {busy ? 'Submitting…' : label}
        </button>
        {success && (
          <span className="text-sm font-mono text-brawl-green">
            ✓ mined
            {hash && (
              <span className="ml-1 text-brawl-text-faint break-all">{hash.slice(0, 10)}…</span>
            )}
          </span>
        )}
        {(success || err) && (
          <button
            type="button"
            className="text-sm font-mono text-brawl-text-dim hover:text-brawl-orange"
            onClick={reset}
          >
            reset
          </button>
        )}
      </div>
      {currentHint && (
        <div className="text-sm font-mono text-brawl-text-faint">{currentHint}</div>
      )}
      {err && <div className="text-xs text-brawl-red break-all">{err}</div>}
    </div>
  );
}

// ─── Founder fight discount (Duel.founderDiscountBps) ─────────────────
function FounderDiscountEditor({
  current,
  available,
  onSuccess,
}: {
  current: bigint | undefined;
  available: boolean;
  onSuccess: () => void;
}) {
  const { env } = requireEnv();
  const { writeContract, isPending, isMining, err, hash, isSuccess, reset } = useTxWrite(onSuccess);
  const postAudit = useAuditPost();
  const [val, setVal] = useState('');

  useEffect(() => {
    if (current !== undefined) setVal(String(current));
  }, [current]);

  if (!available) {
    return (
      <div className="space-y-1">
        <div className="brawl-header text-sm text-brawl-text">Founder fight discount</div>
        <div className="text-sm text-brawl-text-faint font-mono">
          Not available, needs Duel v5+ (`founderDiscountBps`). Currently the
          contract uses the v4 hardcoded constant. Redeploy via Deploy.s.sol
          to unlock the editor.
        </div>
      </div>
    );
  }

  const handle = () => {
    try {
      const bps = BigInt(val.trim());
      if (bps < 0n || bps > 10000n) throw new Error('bps must be 0-10000');
      writeContract({
        abi: DUEL_ABI,
        address: env.duelAddress,
        functionName: 'setFounderDiscountBps',
        args: [bps],
      });
      void postAudit('duel:setFounderDiscountBps', { bps: bps.toString() });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'invalid input');
    }
  };

  return (
    <div className="space-y-2">
      <Row label="founderDiscountBps (0-10000; 2500 = 25%)">
        <input
          className="brawl-input"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          inputMode="numeric"
          placeholder="2500"
        />
      </Row>
      <TxFooter
        onClick={handle}
        busy={isPending || isMining}
        success={isSuccess}
        err={err}
        hash={hash}
        reset={reset}
        label="Update founder discount"
        currentHint={`current: ${current ?? ', '} bps (${current !== undefined ? Number(current) / 100 : ', '}% off for tokens 1-100)`}
      />
      <div className="text-sm text-brawl-text-faint font-mono">
        Founders pay (10000 - bps) / 10000 of fight cost. 2500 = 25% off,
        5000 = 50% off, 0 = no discount, 10000 = free fights.
      </div>
    </div>
  );
}

// ─── Tier pricing (MintDrop.priceTiers) ───────────────────────────────
type TierRow = {
  upToSold: string;
  ethPrice: string;   // wei
  usdcPrice: string;  // 6dp
  usdtPrice: string;  // 6dp
};
const EMPTY_TIER: TierRow = { upToSold: '', ethPrice: '0', usdcPrice: '0', usdtPrice: '0' };

function TierPricingEditor({
  tierCount,
  available,
  onSuccess,
}: {
  tierCount: bigint | undefined;
  available: boolean;
  onSuccess: () => void;
}) {
  const { env } = requireEnv();
  const { writeContract, isPending, isMining, err, hash, isSuccess, reset } = useTxWrite(onSuccess);
  const postAudit = useAuditPost();
  const [tiers, setTiers] = useState<TierRow[]>([]);
  const [tiersPrefilled, setTiersPrefilled] = useState(false);

  // Pull each on-chain tier so the editor reflects what's actually deployed
  // (instead of a stale hardcoded default — which caused the editor to show
  // the original $0/$40/$45/$50/$60 ladder long after the keeper repegged).
  const tierCountN = tierCount !== undefined ? Number(tierCount) : 0;
  const tierReads = useReadContracts({
    contracts: Array.from({ length: tierCountN }, (_, i) => ({
      abi: MINTDROP_ABI,
      address: env.mintDropAddress,
      functionName: 'priceTierAt' as const,
      args: [BigInt(i)] as const,
    })),
    query: { enabled: available && tierCountN > 0 },
  });

  useEffect(() => {
    if (tiersPrefilled) return;
    if (!tierReads.data || tierReads.data.length === 0) return;
    const rows: TierRow[] = tierReads.data.map((r) => {
      const v = r.result as unknown;
      if (!v) return { ...EMPTY_TIER };
      // viem returns the struct as a named-fields object for named ABIs.
      const o = v as {
        upToSold?: number | bigint;
        ethPrice?: bigint;
        usdcPrice?: bigint;
        usdtPrice?: bigint;
      };
      return {
        upToSold: String(o.upToSold ?? 0),
        ethPrice: String(o.ethPrice ?? 0n),
        usdcPrice: String(o.usdcPrice ?? 0n),
        usdtPrice: String(o.usdtPrice ?? 0n),
      };
    });
    setTiers(rows);
    setTiersPrefilled(true);
  }, [tierReads.data, tiersPrefilled]);

  if (!available) {
    return (
      <div className="space-y-1">
        <div className="brawl-header text-sm text-brawl-text">Tiered mint pricing</div>
        <div className="text-sm text-brawl-text-faint font-mono">
          Not available, needs MintDrop v5+ (`priceTiers`). Redeploy via
          Deploy.s.sol with `TIERED_PRICING=true` to unlock.
        </div>
      </div>
    );
  }

  const updateRow = (i: number, k: keyof TierRow, v: string) => {
    setTiers((rows) => rows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  };
  const addRow = () => setTiers((rows) => [...rows, { ...EMPTY_TIER }]);
  const removeRow = (i: number) =>
    setTiers((rows) => rows.filter((_, idx) => idx !== i));

  const handle = () => {
    try {
      // upToSold is uint16 in the contract (MAX_MINT=2000 fits comfortably).
      // Must stay as a Number for viem to encode the right selector.
      const parsed = tiers.map((r, i) => {
        const upToN = Number.parseInt(r.upToSold, 10);
        const eth = BigInt(r.ethPrice || '0');
        const usdc = BigInt(r.usdcPrice || '0');
        const usdt = BigInt(r.usdtPrice || '0');
        if (!Number.isFinite(upToN) || upToN < 1 || upToN > 65535) {
          throw new Error(`tier ${i + 1}: upToSold must be 1..65535`);
        }
        if (eth < 0n || usdc < 0n || usdt < 0n) {
          throw new Error(`tier ${i + 1}: prices must be >= 0`);
        }
        return { upToSold: upToN, ethPrice: eth, usdcPrice: usdc, usdtPrice: usdt };
      });
      // Ascending check.
      for (let i = 1; i < parsed.length; i++) {
        const prev = parsed[i - 1]!;
        const cur = parsed[i]!;
        if (cur.upToSold <= prev.upToSold) {
          throw new Error('tiers must be sorted ascending by upToSold');
        }
      }
      writeContract({
        abi: MINTDROP_ABI,
        address: env.mintDropAddress,
        functionName: 'setPriceTiers',
        args: [parsed],
      });
      void postAudit('mintdrop:setPriceTiers', {
        count: parsed.length,
        tiers: parsed.map((t) => ({
          upToSold: t.upToSold,
          ethPrice: t.ethPrice.toString(),
          usdcPrice: t.usdcPrice.toString(),
          usdtPrice: t.usdtPrice.toString(),
        })),
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'invalid input');
    }
  };

  return (
    <div className="space-y-3">
      <div className="brawl-header text-sm text-brawl-text">Tiered mint pricing</div>
      <div className="text-xs text-brawl-text-faint font-mono">
        Current on-chain tier count: {tierCount?.toString() ?? ', '}.
        Edit rows below + Update to replace the table. Prices are raw wei
        (ETH) / 6dp (USDC/USDT). FREE tier = 0.
      </div>
      <div className="space-y-2">
        {tiers.map((t, i) => (
          <div key={i} className="grid grid-cols-12 gap-1 items-center text-xs font-mono">
            <input
              className="brawl-input col-span-2"
              placeholder="upToSold"
              value={t.upToSold}
              onChange={(e) => updateRow(i, 'upToSold', e.target.value)}
            />
            <input
              className="brawl-input col-span-3"
              placeholder="ETH wei"
              value={t.ethPrice}
              onChange={(e) => updateRow(i, 'ethPrice', e.target.value)}
            />
            <input
              className="brawl-input col-span-3"
              placeholder="USDC 6dp"
              value={t.usdcPrice}
              onChange={(e) => updateRow(i, 'usdcPrice', e.target.value)}
            />
            <input
              className="brawl-input col-span-3"
              placeholder="USDT 6dp"
              value={t.usdtPrice}
              onChange={(e) => updateRow(i, 'usdtPrice', e.target.value)}
            />
            <button
              type="button"
              className="col-span-1 text-brawl-red hover:text-brawl-orange"
              onClick={() => removeRow(i)}
              title="Remove tier"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className="brawl-btn brawl-btn-secondary text-sm"
          onClick={addRow}
        >
          + Add tier
        </button>
      </div>
      <TxFooter
        onClick={handle}
        busy={isPending || isMining}
        success={isSuccess}
        err={err}
        hash={hash}
        reset={reset}
        label="Replace tier table"
        currentHint={`tiers: ${tiers.length} rows`}
      />
    </div>
  );
}

/**
 * Generic USD-cents target editor. User types dollars (e.g. "1.50"), we
 * write cents to the contract. Keeper bot picks up the new target within
 * 5 minutes and rebalances the on-chain wei amount(s) automatically.
 */
function UsdCentsEditor({
  label,
  current,
  contract,
  abi,
  functionName,
  auditKey,
  help,
  onSuccess,
}: {
  label: string;
  current: bigint | undefined;
  contract: `0x${string}`;
  abi: readonly unknown[];
  functionName: string;
  auditKey: string;
  help: string;
  onSuccess: () => void;
}) {
  const { writeContract, isPending, isMining, err, hash, isSuccess, reset } = useTxWrite(onSuccess);
  const postAudit = useAuditPost();
  const [val, setVal] = useState('');

  useEffect(() => {
    if (current !== undefined) setVal((Number(current) / 100).toFixed(2));
  }, [current]);

  const handle = async () => {
    try {
      const dollars = Number(val);
      if (!Number.isFinite(dollars) || dollars < 0) throw new Error('invalid dollar amount');
      const cents = BigInt(Math.round(dollars * 100));
      writeContract({
        abi: abi as never,
        address: contract,
        functionName: functionName as never,
        args: [cents] as never,
      });
      void postAudit(auditKey, { cents: cents.toString() });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'invalid amount');
    }
  };

  return (
    <div className="space-y-2">
      <Row label={label}>
        <div className="flex items-center gap-1">
          <span className="text-brawl-text-faint">$</span>
          <input
            className="brawl-input"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            inputMode="decimal"
            placeholder="1.00"
          />
        </div>
      </Row>
      <TxFooter
        onClick={handle}
        busy={isPending || isMining}
        success={isSuccess}
        err={err}
        hash={hash}
        reset={reset}
        label="Update USD target"
        currentHint={`current: $${current !== undefined ? (Number(current) / 100).toFixed(2) : '—'}`}
      />
      <div className="text-sm text-brawl-text-faint font-mono">{help}</div>
    </div>
  );
}
