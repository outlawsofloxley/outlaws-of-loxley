# Fight-cost keeper

Long-running bot that keeps `Duel.fightCost` pegged to ~$1 USD worth of $BRAWL.

## What it does

Every 5 minutes:

1. Reads BRAWL/ETH spot price from the Aerodrome v2 BRAWL/ETH pair reserves.
2. Reads ETH/USD from Chainlink's Base mainnet aggregator.
3. Computes BRAWL/USD = `(eth_reserve / brawl_reserve) × eth_usd`.
4. Calculates target fight cost: `target_brawl = $1 / brawl_usd`.
5. Clamps to `[1, 1000] BRAWL` for safety.
6. If `|target − current| / current ≥ 5%`, calls
   `Duel.setFightEconomics(target, devShareBps, devTreasury)` from the
   keeper EOA.

## Why this approach

The Duel contract already has a `setFightEconomics` owner function with a
hard `MAX_FIGHT_COST = 10,000 BRAWL` cap. We don't need new contract code.
Off-chain rebalancing is also resistant to flash-loan price manipulation
that would attack on-chain price-reading inside `applyDuelResult`.

## Setup

```bash
cp .env.example .env
# fill in mainnet values: KEEPER_PRIVATE_KEY, DUEL_ADDRESS, BRAWL_ADDRESS,
# BRAWL_PAIR_ADDRESS, DEV_TREASURY
docker compose up --build -d
docker logs -f baseic-brawlers-keeper
```

The keeper EOA needs:
- A small ETH balance (~0.005 ETH covers months of updates on Base mainnet)
- **Owner role on the Duel contract** — granted by transferring Duel
  ownership to the keeper, OR by adding it as an authorised setter (not yet
  built; for v1 the owner IS the keeper).

## Trust model + audit notes

- Hard caps: contract enforces `MAX_FIGHT_COST = 10,000 BRAWL`. Keeper
  enforces `MIN = 1 BRAWL` and `MAX = 1,000 BRAWL` as additional guardrails.
- Manipulation resistance: 5-min spot snapshots are vulnerable to short-lived
  pair-reserve attacks. At $1k MC, the attack cost (push BRAWL ±5%) exceeds
  the per-fight savings. Upgrade to TWAP via `priceXCumulativeLast` when
  treasury / MC justifies the audit.
- Idempotent: if BRAWL/USD doesn't move ≥5%, keeper does nothing.

## Operations

- **Logs**: `docker logs -f baseic-brawlers-keeper` shows every tick.
- **Restart**: `docker compose restart keeper`.
- **Pause updates**: set `DRY_RUN=true` in `.env`, restart.
- **Tighten threshold**: lower `DELTA_THRESHOLD` (e.g. 0.02 = 2%) — more
  responsive, more gas.

## Why ETH/USD via Chainlink and not just BRAWL/USDC pair

We launch with one LP pair: BRAWL/ETH on Aerodrome. There's no BRAWL/USDC
pair on day one, so we triangulate: BRAWL→ETH (from pair) × ETH→USD (from
Chainlink). When a BRAWL/USDC pair exists, the keeper can be simplified to
read it directly.
