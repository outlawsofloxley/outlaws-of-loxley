'use client';

/**
 * Read-only dashboard widgets: revenue, BRAWL supply, health.
 *
 * Polls /api/dash/stats and /api/dash/sync on mount. Data refresh every
 * 30s. All numeric formatting tolerates very-large strings (wei bigints)
 * by doing math on strings.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatEther, formatUnits } from 'viem';
import { nativeSymbol } from '@/lib/wagmi';
import { requireEnv } from '@/lib/env';

interface DashStats {
  ok: true;
  health: {
    rpcPingMs: number;
    rpcError: string | null;
    dbPingMs: number;
    dbError: string | null;
    duelSyncLastBlock: string | null;
    duelSyncUpdatedAt: string | null;
    marketSyncLastBlock: string | null;
    marketSyncUpdatedAt: string | null;
  };
  revenue: {
    mint: {
      ethTotalWei: string;
      usdtTotal: string;
      ethCount: number;
      usdtCount: number;
    };
    duelDev: {
      duelCount: number;
      revenueWei: string;
      fightCost: string;
      devShareBps: number;
    };
    marketplace: {
      feeTotalWei: string;
      priceTotalWei: string;
      count: number;
      feeBps: number | null;
    };
    graveyard: {
      totalWei: string;
      count: number;
    };
  };
  settings: {
    fightCost: string;
    devShareBps: number;
    devTreasury: string | null;
    graveyardCost: string | null;
    mintEthPrice: string | null;
    mintUsdtPrice: string | null;
    mintAirdrop: string | null;
    mintTreasury: string | null;
    totalSold: string | null;
    marketFeeBps: number | null;
    marketTreasury: string | null;
    marketPaused: boolean;
    duelPaused: boolean;
    graveyardPaused: boolean;
    mintPaused: boolean;
  };
  brawl: {
    totalSupply: string;
    mintDropAirdropPool: string;
  };
  brawlers: {
    nextTokenId: number;
    kingMinted: boolean;
    totalMinted: number;
  };
  keeper: {
    address: string | null;
    bnbBalanceWei: string | null;
    brawlBalanceWei: string | null;
  };
  daily: {
    mints: Array<{ day: string; count: number }>;
    duels: Array<{ day: string; count: number }>;
    marketSales: Array<{ day: string; count: number; fee: string; price: string }>;
  };
  audit: Array<{
    id: number;
    action: string;
    payload: unknown;
    actor: string | null;
    created_at: string;
  }>;
  chainId: number;
}

export function StatsPanels() {
  const { env } = requireEnv();
  const [data, setData] = useState<DashStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncInfo, setSyncInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadingStats(true);
    setErr(null);
    try {
      const res = await fetch('/api/dash/stats', { cache: 'no-store' });
      if (!res.ok) throw new Error(`stats HTTP ${res.status}`);
      const json = (await res.json()) as DashStats;
      setData(json);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed to load stats');
    } finally {
      setLoadingStats(false);
    }
  }, []);

  const runSync = useCallback(async () => {
    setSyncing(true);
    setSyncInfo(null);
    try {
      const [hist, market, dash] = await Promise.all([
        fetch('/api/history/sync', { method: 'POST' }).then((r) => r.json()).catch(() => ({ ok: false })),
        fetch('/api/marketplace/sync', { method: 'POST' }).then((r) => r.json()).catch(() => ({ ok: false })),
        fetch('/api/dash/sync', { method: 'POST' }).then((r) => r.json()).catch(() => ({ ok: false })),
      ]);
      const counts: string[] = [];
      if (hist.ok) counts.push(`duel=${hist.eventsInserted ?? 0}`);
      if (market.ok) counts.push(`market=${market.eventsProcessed ?? 0}`);
      if (dash.ok) counts.push(`mint=${dash.mintInserted ?? 0}·res=${dash.resurrectInserted ?? 0}·sale=${dash.saleInserted ?? 0}`);
      setSyncInfo(counts.join(' / '));
      await load();
    } catch (e) {
      setSyncInfo('error: ' + (e instanceof Error ? e.message : 'sync'));
    } finally {
      setSyncing(false);
    }
  }, [load]);

  useEffect(() => {
    void load();
    // fire-and-forget: kick a sync so first visit catches up
    void runSync();
    const h = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(h);
  }, [load, runSync]);

  const sym = nativeSymbol(env.chainId);

  const mintEthTotal = useMemo(
    () => (data ? formatEther(BigInt(data.revenue.mint.ethTotalWei)) : '0'),
    [data],
  );
  const mintUsdtTotal = useMemo(() => {
    if (!data) return '0';
    // MockUSDT is 6-decimal
    return formatUnits(BigInt(data.revenue.mint.usdtTotal), 6);
  }, [data]);
  const duelDevRev = useMemo(
    () => (data ? formatEther(BigInt(data.revenue.duelDev.revenueWei)) : '0'),
    [data],
  );
  const marketFee = useMemo(
    () => (data ? formatEther(BigInt(data.revenue.marketplace.feeTotalWei)) : '0'),
    [data],
  );
  const marketGross = useMemo(
    () => (data ? formatEther(BigInt(data.revenue.marketplace.priceTotalWei)) : '0'),
    [data],
  );
  const resurrectRev = useMemo(
    () => (data ? formatEther(BigInt(data.revenue.graveyard.totalWei)) : '0'),
    [data],
  );

  const keeperBnb = useMemo(
    () => (data?.keeper.bnbBalanceWei ? formatEther(BigInt(data.keeper.bnbBalanceWei)) : '—'),
    [data],
  );
  const keeperBrawl = useMemo(
    () =>
      data?.keeper.brawlBalanceWei
        ? formatUnits(BigInt(data.keeper.brawlBalanceWei), 18)
        : '—',
    [data],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="brawl-header text-lg text-brawl-orange">Revenue</div>
        <div className="flex items-center gap-3">
          {syncInfo && (
            <span className="text-sm font-mono text-brawl-text-dim">{syncInfo}</span>
          )}
          <button
            type="button"
            className="brawl-btn brawl-btn-secondary text-xs px-2 py-1 min-h-0"
            onClick={runSync}
            disabled={syncing}
          >
            {syncing ? 'Syncing…' : 'Sync events'}
          </button>
          <button
            type="button"
            className="brawl-btn brawl-btn-secondary text-xs px-2 py-1 min-h-0"
            onClick={load}
            disabled={loadingStats}
          >
            {loadingStats ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {err && <div className="brawl-card p-3 text-xs text-brawl-red">{err}</div>}

      {!data ? (
        <div className="brawl-card p-4 text-sm text-brawl-text-dim">
          Loading stats…
        </div>
      ) : (
        <>
          {/* Revenue grid */}
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <RevenueCard
              label="Mint (native)"
              value={`${truncNum(mintEthTotal)} ${sym}`}
              sub={`${data.revenue.mint.ethCount} mints`}
            />
            <RevenueCard
              label="Mint (USDT)"
              value={`${truncNum(mintUsdtTotal)} USDT`}
              sub={`${data.revenue.mint.usdtCount} mints`}
            />
            <RevenueCard
              label={`Duel dev share (${(data.revenue.duelDev.devShareBps / 100).toFixed(1)}%)`}
              value={`${truncNum(duelDevRev)} BRAWL`}
              sub={`${data.revenue.duelDev.duelCount} duels`}
            />
            <RevenueCard
              label={`Marketplace fees (${data.revenue.marketplace.feeBps !== null ? (data.revenue.marketplace.feeBps / 100).toFixed(1) : '—'}%)`}
              value={`${truncNum(marketFee)} ${sym}`}
              sub={`${data.revenue.marketplace.count} sales · ${truncNum(marketGross)} ${sym} gross`}
            />
            <RevenueCard
              label="Graveyard"
              value={`${truncNum(resurrectRev)} ${sym}`}
              sub={`${data.revenue.graveyard.count} resurrections`}
            />
            <RevenueCard
              label="Total brawlers minted"
              value={String(data.brawlers.totalMinted)}
              sub={`next id: ${data.brawlers.nextTokenId} · King: ${data.brawlers.kingMinted ? 'yes' : 'no'}`}
            />
            <RevenueCard
              label="BRAWL airdrop pool"
              value={`${truncNum(formatUnits(BigInt(data.brawl.mintDropAirdropPool), 18))}`}
              sub={`total supply ${truncNum(formatUnits(BigInt(data.brawl.totalSupply), 18))}`}
            />
            <RevenueCard
              label="Keeper wallet"
              value={`${truncNum(keeperBnb)} ${sym}`}
              sub={`${truncNum(keeperBrawl)} BRAWL`}
            />
          </div>

          {/* Daily counts */}
          <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
            <DailyBar title="Mints (30d)" items={data.daily.mints} />
            <DailyBar title="Duels (30d)" items={data.daily.duels} />
            <DailyBar
              title={`Market sales (30d, fees in ${sym})`}
              items={data.daily.marketSales.map((r) => ({
                day: r.day,
                count: r.count,
              }))}
            />
          </div>

          {/* Health */}
          <div className="brawl-card p-4">
            <div className="brawl-header text-sm text-brawl-orange mb-3">Health</div>
            <div className="grid gap-3 grid-cols-1 md:grid-cols-2 text-sm font-mono">
              <HealthRow
                label="RPC ping"
                value={`${data.health.rpcPingMs} ms`}
                error={data.health.rpcError}
              />
              <HealthRow
                label="Postgres ping"
                value={`${data.health.dbPingMs} ms`}
                error={data.health.dbError}
              />
              <HealthRow
                label="Duel sync last block"
                value={data.health.duelSyncLastBlock ?? '—'}
                sub={data.health.duelSyncUpdatedAt ? new Date(data.health.duelSyncUpdatedAt).toLocaleString() : null}
              />
              <HealthRow
                label="Market sync last block"
                value={data.health.marketSyncLastBlock ?? '—'}
                sub={data.health.marketSyncUpdatedAt ? new Date(data.health.marketSyncUpdatedAt).toLocaleString() : null}
              />
            </div>
          </div>

          {/* Audit log */}
          {data.audit.length > 0 && (
            <div className="brawl-card p-4">
              <div className="brawl-header text-sm text-brawl-orange mb-3">Audit log (30 most recent)</div>
              <div className="space-y-1 text-sm font-mono max-h-64 overflow-y-auto">
                {data.audit.map((row) => (
                  <div key={row.id} className="flex items-center gap-3 border-b border-brawl-border/40 py-1">
                    <span className="text-brawl-text-faint whitespace-nowrap">
                      {new Date(row.created_at).toLocaleString()}
                    </span>
                    <span className="text-brawl-orange">{row.action}</span>
                    <span className="text-brawl-text-dim break-all">
                      {row.payload ? JSON.stringify(row.payload) : '-'}
                    </span>
                    {row.actor && (
                      <span className="ml-auto text-brawl-text-faint truncate">
                        {row.actor.slice(0, 10)}…
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function truncNum(s: string): string {
  // Keep up to 6 meaningful decimals, strip trailing zeros.
  if (!s.includes('.')) return s;
  const parts = s.split('.');
  const whole = parts[0] ?? '0';
  const frac = parts[1] ?? '';
  const trimmed = frac.slice(0, 6).replace(/0+$/, '');
  return trimmed.length === 0 ? whole : `${whole}.${trimmed}`;
}

function RevenueCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="brawl-card p-4 space-y-1">
      <div className="text-xs brawl-header text-brawl-text-dim">{label}</div>
      <div className="text-lg font-bold text-brawl-orange break-all">{value}</div>
      {sub && <div className="text-sm font-mono text-brawl-text-faint">{sub}</div>}
    </div>
  );
}

function HealthRow({ label, value, sub, error }: { label: string; value: string; sub?: string | null; error?: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline gap-2">
        <span className="text-brawl-text-dim">{label}:</span>
        <span className={error ? 'text-brawl-red' : 'text-brawl-cyan'}>{value}</span>
      </div>
      {sub && <div className="text-sm text-brawl-text-faint pl-4">{sub}</div>}
      {error && <div className="text-xs text-brawl-red pl-4 break-all">{error}</div>}
    </div>
  );
}

function DailyBar({ title, items }: { title: string; items: Array<{ day: string; count: number }> }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="brawl-card p-4">
      <div className="brawl-header text-xs text-brawl-orange mb-2">{title}</div>
      {items.length === 0 ? (
        <div className="text-sm text-brawl-text-faint">No data yet</div>
      ) : (
        <div className="flex items-end gap-0.5 h-24">
          {items.map((i) => (
            <div
              key={i.day}
              className="flex-1 bg-brawl-orange/60 hover:bg-brawl-orange transition-colors"
              style={{ height: `${(i.count / max) * 100}%` }}
              title={`${i.day}: ${i.count}`}
            />
          ))}
        </div>
      )}
      <div className="text-sm font-mono text-brawl-text-faint mt-1">
        {items.length} days · max {max}
      </div>
    </div>
  );
}
