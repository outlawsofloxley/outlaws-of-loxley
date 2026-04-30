# LAUNCH.md, BASEic Brawlers deploy playbook

One-page reference for running the deploy orchestrator. The orchestrator
itself lives at `scripts/deploy.mjs`.

## Targets

| Target  | Chain | RPC env       | Env file              |
|---------|-------|---------------|-----------------------|
| sepolia | 84532 | TESTNET_RPC   | .env.base-sepolia     |
| mainnet | 8453  | MAINNET_RPC   | .env.base-mainnet     |

Both env files are gitignored. Sepolia exists today; mainnet you create
when you're ready (copy from sepolia, swap RPC + chainId, refund deployer).

## Prerequisites

- Foundry 1.5+ on PATH (`forge`, `cast`)
- Node 20+
- Vercel CLI authed to the `baseicbrawlers` account
- Deployer wallet funded:
  - Sepolia: at least 0.05 ETH (free from any Base Sepolia faucet)
  - Mainnet: at least 0.2 ETH (bridge via https://bridge.base.org)

## Sepolia, dry run (zero broadcast, only checks)

```
npm run deploy:sepolia:dry
```

Does pre-flight: tools, env file, RPC reachable, chainId match, deployer
balance, contracts compile, forge tests pass. Exits cleanly without
touching anything.

## Sepolia, full deploy

```
npm run deploy:sepolia
```

Runs every phase end-to-end: preflight, forge deploy, parse broadcast,
update `.env.base-sepolia`, mint the King NFT, sync Vercel env vars,
trigger Vercel production deploy, smoke test, write the markdown report.

Output:
- `logs/deploy-sepolia-<timestamp>.log`  full transcript
- `logs/deploy-sepolia-<timestamp>.md`   summary report

## Mainnet preflight

```
npm run deploy:mainnet:preflight
```

Same checks as sepolia preflight, but against the mainnet RPC + chainId.
Use this to confirm the deployer wallet has enough ETH and the env is
correct before pulling the trigger.

## Mainnet, full deploy (one-shot, real money)

```
npm run deploy:mainnet
```

The orchestrator will pause for two confirmations before broadcasting.
After it finishes, manually:

1. Run `script/SeedAndLockLP.s.sol` to seed BRAWL/ETH on Aerodrome and
   lock LP on Unicrypt.
2. Watch for 24-48 hours. Use the dashboard (`/dash`) to blacklist
   obvious sniper bots as they appear.
3. Call `liftLimits()` on BRAWL.
4. Call `renounceOwnership()` on BRAWL.
5. Manually transfer BRAWL allocations:
   - 50,000 BRAWL into the LP-pair pool (paired with ETH)
   - 10,000 BRAWL to dev wallet
   - 15,000 BRAWL to community reserve

Game contracts (Duel, MintDrop, Marketplace, Graveyard) stay
dev-controlled forever for game-tuning. They have no rug-able functions.

## Running a single phase

If you've already deployed and just want to redo one step:

```
node scripts/deploy.mjs --target sepolia --phase smoke-test
node scripts/deploy.mjs --target sepolia --phase update-vercel
node scripts/deploy.mjs --target sepolia --phase mint-king
```

Single-phase mode reads existing addresses from `.env.<target>` so you
can rerun bits without redeploying contracts.

## Rolling back

The deploy is additive on-chain (old contracts keep existing). To roll
back the live site to a previous deploy:

1. Edit `.env.<target>` and put the old addresses back under
   `BRAWL_ADDRESS`, `BRAWLERS_ADDRESS`, etc.
2. Run `node scripts/deploy.mjs --target <target> --phase update-vercel`
3. Run `node scripts/deploy.mjs --target <target> --phase vercel-deploy`

## Phase reference

| Phase          | What it does                                            |
|----------------|---------------------------------------------------------|
| preflight      | Tools, env file, RPC, chainId, balance, build, tests    |
| forge-deploy   | Runs `forge script Deploy.s.sol --broadcast`            |
| parse-broadcast| Reads addresses from `broadcast/.../run-latest.json`    |
| update-env-file| Writes new addresses into `.env.<target>`               |
| mint-king      | `cast send mintKing()` to deployer (skips if minted)    |
| update-vercel  | Syncs `NEXT_PUBLIC_*_ADDRESS` to Vercel production env  |
| vercel-deploy  | Triggers `vercel deploy --prod`                         |
| smoke-test     | cast-call wiring checks + HTTP probes against live site |
| report         | Writes a markdown summary to `logs/`                    |
