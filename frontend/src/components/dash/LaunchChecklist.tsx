'use client';

/**
 * LaunchChecklist, pre-launch + launch-day playbook for Base mainnet.
 * Read-only reference card. Doesn't track state on-chain (yet), just a
 * visible reminder for D so the launch ops aren't done from memory.
 */

interface Step {
  title: string;
  detail: string;
  done?: boolean;
  cmd?: string;
}

const PRE_LAUNCH: Step[] = [
  {
    title: '1. Fund mainnet deployer',
    detail:
      'Bridge ~$300 of ETH to the deployer wallet on Base. Covers contract gas + LP seed (~$500 ETH side) + safety buffer.',
  },
  {
    title: '2. Verify Unicrypt mainnet locker address',
    detail:
      'Check https://app.uncx.network/lockers for the current Base v2 locker contract. Set UNICRYPT_LOCKER env before running SeedAndLockLP script.',
  },
  {
    title: '3. Run forge tests one last time',
    detail: 'forge test should report 110+ passing. Any failure blocks deploy.',
    cmd: 'cd /c/tools/brawlers && forge test',
  },
  {
    title: '4. Confirm mainnet env file',
    detail:
      'Create .env.base-mainnet with mainnet deployer key, RPC, USDC/USDT addresses (Base mainnet, NOT Sepolia), and confirm AIRDROP_PER_MINT=0 (no per-mint airdrop on mainnet, only the 20 BRAWL founder bonus).',
  },
  {
    title: '5. Decide founder airdrop reserve size',
    detail:
      '20 BRAWL × 100 founders = 2,000 BRAWL needs to be on MintDrop at deploy. Plus 50,000 BRAWL for LP-pairing reserve. Total 52k transferred from initial holder to MintDrop.',
  },
];

const LAUNCH_DAY: Step[] = [
  {
    title: '1. Deploy contracts to Base mainnet',
    detail:
      'Deploy.s.sol with mainnet env + TIERED_PRICING=true (locked-in 2026-04-28): tier table 100 free / 400 @$40 / 500 @$45 / 500 @$50 / 500 @$60. RESURRECTION_COST=0.1 ETH (~$200 floor at Common at 0 wins; tier × win multipliers push Epic at 0 wins to ~$1400, King at 0 wins to ~$3000). FIGHT_COST=10 BRAWL/fighter (founders pay 25% less = 7.5). FOUNDER_DISCOUNT_BPS defaults to 2500 (25%); editable post-deploy via dash. AIRDROP_PER_MINT=0 (only 20-BRAWL founder bonus on mainnet). LP_SHARE_BPS=3333 ($10/mint to LP fund). LP_BRAWL_PER_MINT=50. Tier ETH prices use $4k-ETH conversion; override per-tier via TIER2_ETH..TIER5_ETH if ETH price has drifted at launch.',
    cmd: 'set -a; source .env.base-mainnet; set +a && \\\nTIERED_PRICING=true \\\nRESURRECTION_COST=100000000000000000 FIGHT_COST=10000000000000000000 \\\nAIRDROP_PER_MINT=0 FOUNDER_AIRDROP=20000000000000000000 \\\nLP_SHARE_BPS=3333 LP_BRAWL_PER_MINT=50000000000000000000 \\\nforge script script/Deploy.s.sol:Deploy --rpc-url https://mainnet.base.org --broadcast --chain-id 8453',
  },
  {
    title: '2. Mint the King',
    detail: 'mintKing(deployer) → tokenId 2001 to dev wallet. One-of-one.',
    cmd: 'cast send $BRAWLERS_ADDRESS "mintKing(address)" $DEPLOYER_ADDRESS --private-key $DEPLOYER_KEY --rpc-url https://mainnet.base.org',
  },
  {
    title: '3. Top up MintDrop with LP-pair BRAWL',
    detail:
      '50,000 BRAWL transferred from deployer to MintDrop. Used to pair $10 of every mint with matching BRAWL → lpTreasury.',
    cmd: 'cast send $BRAWL_ADDRESS "transfer(address,uint256)" $MINTDROP_ADDRESS 50000000000000000000000 --private-key $DEPLOYER_KEY --rpc-url https://mainnet.base.org',
  },
  {
    title: '4. Seed BRAWL/ETH LP on Aerodrome + lock for 6 months',
    detail:
      'One-tx script: adds liquidity, whitelists pair on BRAWL, locks LP token on Unicrypt. Publish the Unicrypt URL as proof.',
    cmd: 'forge script script/SeedAndLockLP.s.sol:SeedAndLockLP --rpc-url https://mainnet.base.org --broadcast --chain-id 8453',
  },
  {
    title: '5. Enable BRAWL trading',
    detail:
      'One-way switch. Activates anti-bot window (1 block) and limits (max-tx 0.5%, max-wallet 1%).',
    cmd: 'cast send $BRAWL_ADDRESS "enableTrading()" --private-key $DEPLOYER_KEY --rpc-url https://mainnet.base.org',
  },
  {
    title: '6. Open the mint publicly',
    detail:
      'Update frontend env to mainnet addresses, redeploy Vercel, announce in Discord/Twitter. Mint goes live the moment env is updated.',
  },
  {
    title: '7. Watch for snipers in first hour',
    detail:
      'Anti-bot auto-blacklists contract receivers in block 0. If a known scammer slips through, manually blacklist with cast send $BRAWL_ADDRESS "blacklist(address,string)" $ADDR "reason".',
  },
];

const POST_LAUNCH: Step[] = [
  {
    title: '8. Wait 24-48h for launch to settle',
    detail:
      'Watch DexScreener / Aerodrome for healthy trading. Monitor Discord for issues. Resist any urge to tweak settings during this window.',
  },
  {
    title: '9. liftLimits() on BRAWL',
    detail:
      'Removes max-tx and max-wallet caps permanently. Trading becomes fully open.',
    cmd: 'cast send $BRAWL_ADDRESS "liftLimits()" --private-key $DEPLOYER_KEY --rpc-url https://mainnet.base.org',
  },
  {
    title: '10. renounceOwnership() on BRAWL',
    detail:
      'Final trust signal, whitelist/blacklist/limits all frozen forever. Game contracts (Duel/MintDrop/Marketplace/Graveyard) stay dev-controlled for game tuning. Announce the renounce tx.',
    cmd: 'cast send $BRAWL_ADDRESS "renounceOwnership()" --private-key $DEPLOYER_KEY --rpc-url https://mainnet.base.org',
  },
  {
    title: '11. Drip LP-treasury accumulations into LP',
    detail:
      'Periodically (weekly?) take ETH + BRAWL accumulated in lpTreasury wallet and add to the BRAWL/ETH LP via Aerodrome UI. Re-lock new LP tokens on Unicrypt.',
  },
];

export function LaunchChecklist() {
  return (
    <div className="brawl-card p-4 space-y-5">
      <div className="flex items-baseline justify-between">
        <h2 className="brawl-header text-lg text-brawl-orange">Launch Playbook</h2>
        <span className="text-xs text-brawl-text-faint font-mono">
          Reference for mainnet day
        </span>
      </div>
      <p className="text-sm text-brawl-text-dim">
        Step-by-step ops for Base mainnet launch. Each <code className="font-mono text-brawl-cyan">cmd</code> is
        ready to copy-paste once the env file is sourced. Order matters, 
        skipping a step usually means redeploying.
      </p>

      <Phase title="Pre-launch" steps={PRE_LAUNCH} />
      <Phase title="Launch day" steps={LAUNCH_DAY} />
      <Phase title="Post-launch (24-72h)" steps={POST_LAUNCH} />
    </div>
  );
}

function Phase({ title, steps }: { title: string; steps: Step[] }) {
  return (
    <div>
      <h3 className="brawl-header text-sm text-brawl-text mb-2 border-b border-brawl-border pb-1">
        {title}
      </h3>
      <div className="space-y-3">
        {steps.map((s) => (
          <div key={s.title} className="border-l-2 border-brawl-border pl-3">
            <div className="brawl-header text-sm text-brawl-orange">{s.title}</div>
            <div className="text-sm text-brawl-text-dim mt-1 leading-relaxed">{s.detail}</div>
            {s.cmd && (
              <pre className="mt-2 p-2 bg-brawl-bg border border-brawl-border rounded font-mono text-xs text-brawl-cyan overflow-x-auto whitespace-pre-wrap break-all">
                {s.cmd}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
