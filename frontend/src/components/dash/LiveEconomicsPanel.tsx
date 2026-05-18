'use client';

/**
 * Live economics panel — single read-only dashboard widget that surfaces
 * every per-fight / per-resurrect / marketplace number live from chain,
 * with USD conversions via Chainlink ETH/USD.
 *
 * Sources:
 *   - BRAWL/ETH from the Aerodrome v2 pair reserves (NEXT_PUBLIC_BRAWL_PAIR_ADDRESS).
 *   - ETH/USD from Chainlink (Base mainnet: 0x71041dDdAd3595F9CEd3DcCFBe3D1F4b0a16Bb70).
 *   - Fight cost (BRAWL wei) from DuelRouter.fightCostBrawl (when configured)
 *     or Duel.fightCost (legacy fallback).
 *   - Resurrect base cost (ETH wei) from Graveyard.resurrectionCost.
 *   - Marketplace fee from Marketplace.feeBps.
 *
 * Read-only; no writes. Polls every 30s via wagmi's built-in refetch.
 */
import { useMemo } from 'react';
import { useReadContract, useBalance } from 'wagmi';
import { formatUnits, parseAbi, type Address } from 'viem';
import {
  DUEL_ABI,
  GRAVEYARD_ABI,
  MARKETPLACE_ABI,
  BRAWL_ABI,
  AERODROME_PAIR_ABI,
  DUEL_ROUTER_ABI,
} from '@/lib/abi';
import { requireEnv } from '@/lib/env';

const CHAINLINK_ETH_USD_BASE: Address = '0x71041dDdAd3595F9CEd3DcCFBe3D1F4b0a16Bb70';
const AGGREGATOR_V3_ABI = parseAbi([
  'function latestRoundData() view returns (uint80,int256 answer,uint256,uint256 updatedAt,uint80)',
  'function decimals() view returns (uint8)',
]);

function fmtUsd(n: number | null, digits = 2): string {
  if (n === null || !Number.isFinite(n)) return '—';
  if (n < 0.01) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(digits)}`;
}

function fmtBig(wei: bigint | undefined, decimals = 18, digits = 4): string {
  if (wei === undefined) return '—';
  const n = Number(formatUnits(wei, decimals));
  if (n < 0.0001) return n.toExponential(2);
  return n.toFixed(digits);
}

export function LiveEconomicsPanel() {
  const { env } = requireEnv();
  const refreshMs = 30_000;

  // ── ETH/USD via Chainlink ──
  const ethUsdRound = useReadContract({
    abi: AGGREGATOR_V3_ABI,
    address: CHAINLINK_ETH_USD_BASE,
    functionName: 'latestRoundData',
    query: { refetchInterval: refreshMs },
  });
  const ethUsdDecimals = useReadContract({
    abi: AGGREGATOR_V3_ABI,
    address: CHAINLINK_ETH_USD_BASE,
    functionName: 'decimals',
  });
  const ethUsd = useMemo(() => {
    if (!ethUsdRound.data || !ethUsdDecimals.data) return null;
    const [, answer] = ethUsdRound.data as readonly [bigint, bigint, bigint, bigint, bigint];
    const dec = Number(ethUsdDecimals.data);
    if (answer <= 0n) return null;
    return Number(answer) / 10 ** dec;
  }, [ethUsdRound.data, ethUsdDecimals.data]);

  // ── BRAWL/ETH spot from Aerodrome pair reserves ──
  const pairReserves = useReadContract({
    abi: AERODROME_PAIR_ABI,
    address: env.brawlPairAddress ?? undefined,
    functionName: 'getReserves',
    query: { enabled: !!env.brawlPairAddress, refetchInterval: refreshMs },
  });
  const pairToken0 = useReadContract({
    abi: AERODROME_PAIR_ABI,
    address: env.brawlPairAddress ?? undefined,
    functionName: 'token0',
    query: { enabled: !!env.brawlPairAddress },
  });
  const brawlEthSpot = useMemo(() => {
    if (!pairReserves.data || !pairToken0.data) return null;
    const [r0, r1] = pairReserves.data as readonly [bigint, bigint, number];
    const t0 = (pairToken0.data as Address).toLowerCase();
    const brawl = env.brawlAddress.toLowerCase();
    const [brawlR, ethR] = t0 === brawl ? [r0, r1] : [r1, r0];
    if (brawlR === 0n) return null;
    // Returns: how many ETH wei per 1 BRAWL wei. Same decimals (18) so the
    // ratio is unit-free.
    return Number(ethR) / Number(brawlR);
  }, [pairReserves.data, pairToken0.data, env.brawlAddress]);
  const brawlUsd = useMemo(() => {
    if (brawlEthSpot === null || ethUsd === null) return null;
    return brawlEthSpot * ethUsd;
  }, [brawlEthSpot, ethUsd]);

  // ── Fight cost (router preferred, falls back to legacy Duel) ──
  const fightCostRouter = useReadContract({
    abi: DUEL_ROUTER_ABI,
    address: env.duelRouterAddress ?? undefined,
    functionName: 'fightCostBrawl',
    query: { enabled: !!env.duelRouterAddress, refetchInterval: refreshMs },
  });
  const fightCostEthRouter = useReadContract({
    abi: DUEL_ROUTER_ABI,
    address: env.duelRouterAddress ?? undefined,
    functionName: 'fightCostEth',
    query: { enabled: !!env.duelRouterAddress, refetchInterval: refreshMs },
  });
  const fightCostLegacy = useReadContract({
    abi: DUEL_ABI,
    address: env.duelAddress,
    functionName: 'fightCost',
    query: { enabled: !env.duelRouterAddress, refetchInterval: refreshMs },
  });
  const fightCostBrawl = (fightCostRouter.data ?? fightCostLegacy.data) as bigint | undefined;
  const fightCostEth = fightCostEthRouter.data as bigint | undefined;
  const fightCostUsd = useMemo(() => {
    if (fightCostBrawl === undefined || brawlUsd === null) return null;
    return Number(formatUnits(fightCostBrawl, 18)) * brawlUsd;
  }, [fightCostBrawl, brawlUsd]);

  // ── Resurrect base cost ──
  const resurrectCost = useReadContract({
    abi: GRAVEYARD_ABI,
    address: env.graveyardAddress,
    functionName: 'resurrectionCost',
    query: { refetchInterval: refreshMs },
  });
  const resurrectUsd = useMemo(() => {
    if (resurrectCost.data === undefined || ethUsd === null) return null;
    return Number(formatUnits(resurrectCost.data as bigint, 18)) * ethUsd;
  }, [resurrectCost.data, ethUsd]);

  // ── Marketplace fee ──
  const marketplaceFee = useReadContract({
    abi: MARKETPLACE_ABI,
    address: env.marketplaceAddress,
    functionName: 'feeBps',
    query: { refetchInterval: refreshMs },
  });
  const marketplaceFeePct = marketplaceFee.data !== undefined
    ? Number(marketplaceFee.data as number) / 100
    : null;

  // ── Keeper wallet balances ──
  const keeperAddr = env.houseKeeperAddress;
  const keeperEth = useBalance({
    address: keeperAddr ?? undefined,
    query: { enabled: !!keeperAddr, refetchInterval: refreshMs },
  });
  const keeperBrawl = useReadContract({
    abi: BRAWL_ABI,
    address: env.brawlAddress,
    functionName: 'balanceOf',
    args: keeperAddr ? [keeperAddr] : undefined,
    query: { enabled: !!keeperAddr, refetchInterval: refreshMs },
  });

  // ── Chainlink staleness ──
  const ethUsdStaleMin = useMemo(() => {
    if (!ethUsdRound.data) return null;
    const [, , , updatedAt] = ethUsdRound.data as readonly [bigint, bigint, bigint, bigint, bigint];
    const ageS = Math.floor(Date.now() / 1000) - Number(updatedAt);
    return Math.max(0, Math.floor(ageS / 60));
  }, [ethUsdRound.data]);

  return (
    <div className="brawl-card p-4 space-y-3">
      <div className="brawl-header text-sm text-brawl-orange">
        Live economics
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm font-mono">
        <div className="text-brawl-text-dim">ETH/USD (Chainlink)</div>
        <div className="text-brawl-text text-right">
          {ethUsd !== null ? fmtUsd(ethUsd) : '—'}
          {ethUsdStaleMin !== null && (
            <span className="text-brawl-text-faint ml-2">
              ({ethUsdStaleMin}m ago)
            </span>
          )}
        </div>

        <div className="text-brawl-text-dim">BRAWL/USD (Aerodrome)</div>
        <div className="text-brawl-text text-right">
          {brawlUsd !== null ? fmtUsd(brawlUsd, 6) : '—'}
        </div>

        <div className="text-brawl-text-dim">BRAWL/ETH spot</div>
        <div className="text-brawl-text text-right">
          {brawlEthSpot !== null ? (
            <span className="font-mono">
              {brawlEthSpot.toFixed(8)} <span className="text-brawl-text-faint">ETH</span>
              {brawlUsd !== null && (
                <span className="text-brawl-text-faint ml-2">
                  ({fmtUsd(brawlUsd, 6)})
                </span>
              )}
            </span>
          ) : (
            '—'
          )}
        </div>
      </div>

      <div className="border-t border-brawl-border" />

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm font-mono">
        <div className="text-brawl-text-dim">Fight cost (target ~$1)</div>
        <div className="text-brawl-text text-right">
          <div>{fightCostBrawl !== undefined ? `${fmtBig(fightCostBrawl)} BRAWL` : '—'}</div>
          {fightCostEth !== undefined && (
            <div className="text-brawl-text-faint">or {fmtBig(fightCostEth, 18, 6)} ETH</div>
          )}
          {fightCostUsd !== null && (
            <div className="text-brawl-cyan">≈ {fmtUsd(fightCostUsd)}</div>
          )}
        </div>

        <div className="text-brawl-text-dim">Resurrect base (target ~$100)</div>
        <div className="text-brawl-text text-right">
          <div>{resurrectCost.data !== undefined ? `${fmtBig(resurrectCost.data as bigint, 18, 5)} ETH` : '—'}</div>
          {resurrectUsd !== null && (
            <div className="text-brawl-cyan">≈ {fmtUsd(resurrectUsd)}</div>
          )}
        </div>

        <div className="text-brawl-text-dim">Marketplace fee</div>
        <div className="text-brawl-text text-right">
          {marketplaceFeePct !== null ? `${marketplaceFeePct.toFixed(2)}%` : '—'}
        </div>
      </div>

      {keeperAddr && (
        <>
          <div className="border-t border-brawl-border" />
          <div className="brawl-header text-xs text-brawl-orange">
            Auto-fight wallet (keeper)
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm font-mono">
            <div className="text-brawl-text-dim">Address</div>
            <div className="text-brawl-text-faint text-right font-mono text-xs">
              {keeperAddr.slice(0, 6)}…{keeperAddr.slice(-4)}
            </div>
            <div className="text-brawl-text-dim">ETH balance (gas)</div>
            <div className="text-brawl-text text-right">
              {keeperEth.data ? Number(formatUnits(keeperEth.data.value, 18)).toFixed(4) : '—'} ETH
            </div>
            <div className="text-brawl-text-dim">BRAWL balance (stakes)</div>
            <div className="text-brawl-text text-right">
              {keeperBrawl.data !== undefined ? fmtBig(keeperBrawl.data as bigint, 18, 2) : '—'} BRAWL
            </div>
          </div>
        </>
      )}

      <div className="text-xs text-brawl-text-faint pt-2 font-mono">
        Updates every 30s. fight-cost-keeper + resurrection-cost-keeper repeg
        BRAWL/ETH stakes to the USD targets via setFightEconomics +
        setResurrectionCost when on-chain BRAWL/USD drifts more than 5%.
      </div>
    </div>
  );
}
