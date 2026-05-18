'use client';

/**
 * BRAWL price widget. Pulls BRAWL/ETH live from the Aerodrome v2 pair
 * reserves and converts via Chainlink ETH/USD. No external API — purely
 * on-chain reads, so it survives DexScreener rate limits.
 */
import { useMemo } from 'react';
import { useReadContract } from 'wagmi';
import { formatUnits, parseAbi, type Address } from 'viem';
import { BRAWL_ABI, AERODROME_PAIR_ABI } from '@/lib/abi';
import { requireEnv } from '@/lib/env';

const CHAINLINK_ETH_USD_BASE: Address = '0x71041dDdAd3595F9CEd3DcCFBe3D1F4b0a16Bb70';
const AGGREGATOR_V3_ABI = parseAbi([
  'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)',
  'function decimals() view returns (uint8)',
]);

export function BrawlPricePanel() {
  const { env } = requireEnv();
  const refreshMs = 30_000;

  const totalSupply = useReadContract({
    abi: BRAWL_ABI,
    address: env.brawlAddress,
    functionName: 'totalSupply',
  });

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
    if (!ethUsdRound.data || ethUsdDecimals.data === undefined) return null;
    const arr = ethUsdRound.data as readonly [bigint, bigint, bigint, bigint, bigint];
    const answer = arr[1];
    if (answer <= 0n) return null;
    return Number(answer) / 10 ** Number(ethUsdDecimals.data);
  }, [ethUsdRound.data, ethUsdDecimals.data]);

  const brawlEth = useMemo(() => {
    if (!pairReserves.data || !pairToken0.data || !env.brawlPairAddress) return null;
    const [r0, r1] = pairReserves.data as readonly [bigint, bigint, number];
    const t0 = (pairToken0.data as Address).toLowerCase();
    const brawl = env.brawlAddress.toLowerCase();
    const [brawlR, ethR] = t0 === brawl ? [r0, r1] : [r1, r0];
    if (brawlR === 0n) return null;
    return Number(ethR) / Number(brawlR);
  }, [pairReserves.data, pairToken0.data, env.brawlAddress, env.brawlPairAddress]);

  const brawlUsd = useMemo(() => {
    if (brawlEth === null || ethUsd === null) return null;
    return brawlEth * ethUsd;
  }, [brawlEth, ethUsd]);

  const lpEthDepth = useMemo(() => {
    if (!pairReserves.data || !pairToken0.data) return null;
    const [r0, r1] = pairReserves.data as readonly [bigint, bigint, number];
    const t0 = (pairToken0.data as Address).toLowerCase();
    const brawl = env.brawlAddress.toLowerCase();
    const ethR = t0 === brawl ? r1 : r0;
    return Number(formatUnits(ethR, 18));
  }, [pairReserves.data, pairToken0.data, env.brawlAddress]);

  const supply = totalSupply.data
    ? Number(formatUnits(totalSupply.data as bigint, 18)).toLocaleString()
    : '—';

  return (
    <div className="brawl-card p-4 space-y-2">
      <div className="brawl-header text-sm text-brawl-orange">$BRAWL price</div>
      {brawlUsd !== null ? (
        <>
          <div className="flex items-baseline gap-2">
            <span className="brawl-header text-2xl text-brawl-cyan">
              ${brawlUsd.toFixed(brawlUsd < 0.01 ? 6 : 4)}
            </span>
            <span className="text-xs font-mono text-brawl-text-faint">per BRAWL</span>
          </div>
          {brawlEth !== null && (
            <div className="text-xs font-mono text-brawl-text-dim">
              {brawlEth.toFixed(8)} ETH per BRAWL
              {ethUsd !== null && (
                <span className="text-brawl-text-faint"> · ETH=${ethUsd.toFixed(2)}</span>
              )}
            </div>
          )}
          {lpEthDepth !== null && (
            <div className="text-xs font-mono text-brawl-text-faint">
              LP depth: {lpEthDepth.toFixed(4)} ETH on Aerodrome
            </div>
          )}
        </>
      ) : (
        <div className="text-brawl-text text-sm">
          Loading from Aerodrome pair{' '}
          <span className="text-brawl-text-faint">
            {env.brawlPairAddress
              ? `${env.brawlPairAddress.slice(0, 6)}…${env.brawlPairAddress.slice(-4)}`
              : '(NEXT_PUBLIC_BRAWL_PAIR_ADDRESS unset)'}
          </span>
        </div>
      )}
      <div className="text-sm font-mono text-brawl-text-dim pt-1 border-t border-brawl-border">
        Total supply: <span className="text-brawl-cyan">{supply}</span> BRAWL (fixed, no inflation)
      </div>
      <div className="text-xs font-mono text-brawl-text-faint">
        Price computed live from Aerodrome v2 reserves × Chainlink ETH/USD. Updates every 30s.
      </div>
    </div>
  );
}
