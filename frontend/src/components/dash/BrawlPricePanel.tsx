'use client';

/**
 * BRAWL price widget — placeholder until listed on a DEX.
 *
 * TODO(price): swap this when BRAWL is listed.
 * Integration sketch:
 *   - DexScreener: GET https://api.dexscreener.com/latest/dex/pairs/bsc/{pairAddress}
 *   - PancakeSwap subgraph query for last-trade price + 24h volume
 *   - Fallback: compute TWAP from Pancake v3 pool events
 *
 * For now, show circulating supply + status.
 */
import { useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { BRAWL_ABI } from '@/lib/abi';
import { requireEnv } from '@/lib/env';

export function BrawlPricePanel() {
  const { env } = requireEnv();
  const totalSupply = useReadContract({
    abi: BRAWL_ABI,
    address: env.brawlAddress,
    functionName: 'totalSupply',
  });

  const supply = totalSupply.data
    ? formatUnits(totalSupply.data as bigint, 18)
    : '—';

  return (
    <div className="brawl-card p-4 space-y-2">
      <div className="brawl-header text-sm text-brawl-orange">$BRAWL price</div>
      <div className="text-brawl-text text-sm">
        Not listed on a DEX yet — price <span className="text-brawl-text-faint">N/A</span>
      </div>
      <div className="text-sm font-mono text-brawl-text-dim">
        Total supply: <span className="text-brawl-cyan">{supply}</span> BRAWL (fixed, no inflation)
      </div>
      <div className="text-sm font-mono text-brawl-text-faint">
        When listed, the widget will pull last-trade price + 24h volume from DexScreener.
      </div>
    </div>
  );
}
