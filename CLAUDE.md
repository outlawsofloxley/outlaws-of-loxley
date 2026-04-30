# BASEic Brawlers — Project Context for Claude

> Read automatically by Claude Code when you open a session in this directory.
> Keep this file concise — long historical detail lives in `docs/PHASE_HISTORY.md`.
> **Live session state**: `SESSION_STATE.md` — current status + pending actions.
> Read it after this file before starting work.

## What this project is

**BASEic Brawlers** (rebranded from "Brawlers" 2026-04-27) — on-chain NFT
battle game on Base. Owner is **D**, building solo for personal use.

- Pixel-art NFT warriors duel for ELO ($BRAWL stakes)
- Three consecutive losses → brawler dies → resurrect with ETH
- 2000 supply + 1-of-1 King; **VRF-based rarity shuffle planned for mainnet**
- $30 mint price ($20 dev / $10 + matched BRAWL → LP)
- Target chain: **Base mainnet** for v1; currently running on **Base Sepolia** (chain 84532)

## Current state — 2026-04-28 (v4 + custom domain)

**LIVE**: https://baseicbrawlers.com (Base Sepolia, chain 84532) — vercel preview alias https://frontend-liard-nine-57.vercel.app still works
**Dev dashboard**: https://baseicbrawlers.com/dash (HMAC cookie auth, not in nav)

**v3 contracts deployed 2026-04-27** with:
- BRAWL anti-sniping (trading toggle + max-tx 0.5% + max-wallet 1% + anti-bot block + blacklist)
- Auto-paired BRAWL on every mint (50 BRAWL + $10 ETH → lpTreasury)
- Bulk mint discount (5+ → 1 free, 10+ → 3 free, 20 → 7 free)
- Lottery extra mint (1-in-2000 chance per paid mint)
- Founder fight discount (50% off for token IDs 1-100)
- Free first resurrect for founder tokens 1-100
- Founder badges (gold ★ FOUNDER 50 for IDs 1-50, cyan ★ FOUNDER 100 for 51-100)
- New brand + logo (King Brawler with sidekicks on diamond-blue)
- Two-row centered nav (logo | BASEic Brawlers | wallet)

LP launch script (`script/SeedAndLockLP.s.sol`) ready for mainnet day —
seeds Aerodrome v2 BRAWL/ETH pool + locks LP on Unicrypt for 6 months.

**Socials (live, set 2026-04-28)**:
- Site:     https://baseicbrawlers.com
- Telegram: https://t.me/baseicbrawlers
- X:        https://x.com/BASEicBrawlers
- All three are NatSpec-tagged in `contracts/BRAWL.sol` + `contracts/Brawlers.sol`
  headers (basescan + DexScreener pick them up on verification).

**One-click boot**: `boot.bat` at repo root opens two windows — one
running the bot daemon (auto-restart on crash), one for Claude Code (run
`claude resume` to pick this conversation, or `claude` for new). Pin to
taskbar for one-click reboot recovery. `stop-bots.bat` kills the bots.

**Marketing art shipped 2026-04-28**: `marketing/art/` has 6 images
generated via Pollinations (free, no key, browser UA required to bypass
gate): `pfp.png` (1024² king-on-throne), `x-banner.png` (1500×500 arena
scene), `tg-header.png` (1024×576 5-brawler lineup), `tg-pfp-square.png`
(640² king close-up), `founder-celebration.png`, `graveyard.png`.
Re-run `python3 marketing/art/gen.py` to regenerate.

**Marketing kit**: `marketing/` directory holds the full pre-launch +
launch + week-1 ops kit:
- `marketing/content/` — TG pinned messages, X launch thread, week-1 calendar,
  KOL outreach DM templates, shill pack, gpt-image-1 art prompts
- `marketing/bots/` — Grammy Telegram bots (welcome / raid / leaderboard).
  Pure-JS, JSON file persistence (`bots-state.json`) — no native deps so
  `npm install` is clean on Node 25 + Windows. Boot with `npm run all` after
  filling `.env` (template at `.env.example`).
- **Bot tokens stored in `marketing/bots/.env`** (gitignored): RAID + LEADERBOARD
  tokens are wired (created via @BotFather 2026-04-28). Welcome bot token still
  pending — D needs to re-create `@baseicbrawlers_welcome_bot` via /newbot.
- Outstanding: `PUBLIC_GROUP_ID` (add @RawDataBot to `@baseicbrawlers`, copy
  the negative integer ID, drop in `.env`).

**Renounce playbook for BRAWL** (after mainnet launch settles):
1. Whitelist game contracts + LP router → seed LP
2. enableTrading() (one-way)
3. Watch 24-48h, blacklist obvious bots
4. liftLimits() (one-way)
5. **renounceOwnership()** — whitelist/blacklist/limits frozen forever

Game contracts (Duel/MintDrop/Marketplace/Graveyard) **stay dev-controlled**
for game tuning — no rug-able functions in those.

For the full iteration history (phases 1 through 7-iter-14), see
`docs/PHASE_HISTORY.md`. For the in-flight work pinned to memory, check
`brawlers_phase7_bsctestnet_live.md` and `brawlers_dashboard_built.md` in
`C:\Users\darre\.claude\projects\C--tools\memory\`.

### Known loose ends (not blocking)

- **CLI `mint-onchain`** still calls `brawlers.mint()` directly — works on
  Anvil (PLAYER_KEY == owner), reverts on BSC Testnet. Rewrite to use
  `MintDrop.mintWithETH` when targeting testnet/mainnet. UI is unaffected.
- **BRAWL distribution**: deployer holds 75,000 BRAWL. 50k for future LP,
  10k dev, 15k reserve — all manual transfers when ready.
- **Custom Vercel domain** — currently the auto-alias.
- **Git re-root**: repo was `git init`d at `C:\tools\` (parent dir). No
  commits yet, safe to re-init at `C:\tools\brawlers\`. Needed before first
  push to GitHub.
- **500-mint test on BSC Testnet** with friends — art is ready, contracts
  unchanged. Just mint, eyeball `/audit` live tab, verify rarity distribution.
- **Deferred features** (waiting on D's next greenlight):
  - House-brawler keeper with auto-dueling cron
  - Level-up mechanic (currently all brawlers stuck at level 1)
  - Real commissioned pixel art (replace `renderBrawlerArt` or swap
    `/api/token/[id]/image` to fetch from IPFS)
  - Migrate to Base Sepolia / Base mainnet

## Project layout

```
C:\tools\brawlers\
├── contracts/              Solidity (Brawlers, Duel, Graveyard, BRAWL,
│                           MintDrop, Marketplace, mocks/MockUSDT, lib/)
├── script/                 Deploy.s.sol + DeployMarketplace.s.sol
├── src/                    TypeScript CLI and game engine (root)
│   ├── core/               rng, stats, weapons, elo, brawler, types
│   ├── sim/                combat simulator
│   ├── cli/                REPL, commands, format, onchainCommands
│   └── onchain/            ethers v6 client, ABIs, contract wrappers
├── test/                   Vitest (164 CLI + 47 parity = 211) + forge (112)
│   ├── sim_parity.test.ts  Locks frontend sim === root sim byte-for-byte
│   └── solidity/           Brawlers/Duel/Graveyard/Parity/Phase7/Marketplace
├── frontend/               Next.js 16 + wagmi 3 web UI + API routes (7a)
│   ├── src/app/            Pages (browse, mint, duel, graveyard, leaderboard,
│   │                       history, market, brawler/[id]/*, owner/[address],
│   │                       dash, audit, sample10) + API routes (token, run-duel,
│   │                       history, marketplace, house, dash)
│   ├── src/components/     NavBar, ConnectButton, BrawlerCard, PixelAvatar,
│   │                       DuelAnimation, MarketplacePanel, ArenaLineup,
│   │                       dash/* (DashAuthGate, StatsPanels, SettingsEditors,
│   │                       HouseManagementPanel, EmergencyUnstickPanel)
│   ├── src/hooks/          useBrawler, useAllBrawlers, useDuelHistory,
│   │                       useListing, useMarketListings, useHouseWhitelist
│   ├── src/lib/            abi.ts, env.ts, wagmi.ts, brawlerArt.ts,
│   │                       pixelAvatarSvg.ts, duelDb.ts, dashDb.ts,
│   │                       dashAuth.ts, houseKeeper.ts
│   ├── src/middleware.ts   Gates /dash + /api/dash/*
│   ├── src/core/           DUPLICATE of root src/core/* (server-side sim)
│   └── src/sim/combat.ts   DUPLICATE of root sim — see PARITY note below
├── docs/PHASE_HISTORY.md   Full iteration history (1 through 7-iter-14)
├── foundry.toml, remappings.txt, .env, .env.example, CLAUDE.md, README.md
└── package.json            Root project (CLI, vitest, tsx, ethers 6.16)
```

Two separate npm packages — root and `frontend/`. They do NOT share
`node_modules`.

## Environment

- **Windows 11**, **Node 22.22.2 + npm 10.9.7**, **Foundry 1.5.1**
- **Git Bash** for Foundry, **PowerShell or Bash** for Node
- **Two terminal windows**: Window 1 runs `anvil`, Window 2 runs everything else

## Deployed contracts — Base Sepolia (chain 84532)

Deployer + owner EOA: `0x5b1A749cc7bF1dE8ecA505769BD34Ba65f456805` (fresh
2026-04-27 wallet — zero link to BSC days). Signer for /api/run-duel:
`0x189724793a0C257C2889F16d422b9Be175f44012`.

Deployed 2026-04-29 (v5 — env source-of-truth in `.env.base-sepolia`):
- `BRAWL       = 0x1d2caa58c6b2d70e84405a68ca6bf7b9b5675b51`   (anti-sniping, dev-cap rare-skip)
- `BRAWLERS    = 0x936ae7d74930d52ef460b77d34e9947dd8c8bb4d`   (2000 supply + king at 2001 + 8 mouth fixes)
- `DUEL        = 0xf4dfb5f21c9c11623d79fc360747f83f34e57d35`   (founder discount editable, default 25%)
- `GRAVEYARD   = 0x43cd05987ab4528f2332a9e9aabaf90a8bd9c9c7`   (free first resurrect for founders)
- `MINTDROP    = 0xc58d5f6cf1659100a1476eeec5f3c7f0d074372f`   (TIERED pricing: 100 free / 400 @$40 / 500 @$45 / 500 @$50 / 500 @$60)
- `MARKETPLACE = 0xEeab07c9CE7EaEFCfa378619b61d97fbCBbFDB4d`   (still v4 — redeploy if needed)
- `MOCKUSDT    = 0x54b36bb51f20f9ca446024a092b46b5136a01ec2`
- `USDC (real) = 0x036CbD53842c5426634e7929541eC2318f3dCF7e`

**On-chain state (Sepolia testing)**:
- King (#2001) minted to deployer.
- BRAWL: 25k airdrop pool + 50k LP-pair pool seeded to MintDrop. Trading enabled, limits lifted.
- `baseURI = https://baseicbrawlers.com/api/token/` (set 2026-04-28 via `setBaseURI`, tx `0xb54dbfedba5450b1900c8970c7ae153cfa760458c07a9df55cf945293d48377b`).
- Sepolia micro prices: 0.0001 ETH mint, 0.01 USDT/USDC (v4 still flat).
- **Mainnet pricing locked in 2026-04-28 — TIERED in MintDrop v5+:**
  - Tier 1 (1-100):    FREE (founder slot)
  - Tier 2 (101-500):  $40
  - Tier 3 (501-1000): $45
  - Tier 4 (1001-1500): $50
  - Tier 5 (1501-2000): $60
  - Set via `setPriceTiers` post-deploy or `TIERED_PRICING=true` env at deploy.
  - ETH-equivalents calibrated to $4k ETH; per-tier override via `TIER2_ETH..TIER5_ETH`.
- Fight cost: 10 BRAWL/fighter (founders pay 25% less = 7.5).
  Founder discount tunable post-deploy: `Duel.setFounderDiscountBps(uint256)`,
  default `founderDiscountBps = 2500` (25%), cap 10000.
- Resurrection: `base × tierMult/10 × (10 + wins)/10`. Founders 1-100 get 1 free.

**v5 SHIPPED 2026-04-29.** Tiered pricing (100 free / $40 / $45 / $50 / $60),
tunable founder discount (default 25%, was 50%), and the brawlerArt mouth
fixes (8 more combos in RAISE_MOUTH; pirate:uncommon offset corrected from
+2 to -1) are all live on Sepolia. Vercel env updated, frontend redeployed.

D mints with the deployer wallet still hit the dev-rarity-cap (Common/Uncommon
only) — Epic/Rare must be minted from a different address to surface them on-chain.
For marketing art we use the LOCAL brawlerArt module to generate sprites
deterministically per (archetype, rarity, tokenId) without minting — same
algorithm, same visual.

**Frontend already v5-ready (defensive — works against both v4 and v5):**
- `mint/page.tsx` — reads `MintDrop.batchCost(count)` for tx value; falls
  back to flat `ethPrice * count` when v4 contract reverts the read
- `dash/SettingsEditors.tsx` — added `FounderDiscountEditor` and
  `TierPricingEditor`; both render a "needs v5+" hint until the read succeeds
- `lib/abi.ts` DUEL_ABI swaps `FOUNDER_DISCOUNT_BPS` const → `founderDiscountBps`
  state + `setFounderDiscountBps`; MINTDROP_ABI adds `priceTierCount` /
  `priceTierAt` / `priceForMint` / `batchCost` / `setPriceTiers`

Keys live in `/c/tools/brawlers/.env.base-sepolia` (gitignored). Same wallet
carries through to Base mainnet (chain 8453).

**RPC note**: Use `https://base-sepolia-rpc.publicnode.com` — `sepolia.base.org`
is heavily rate-limited and breaks both wallet broadcast + dapp reads.

For prior BSC Testnet deploys, BSC Sepolia v1/v2 deploys, and Anvil
addresses, see `docs/PHASE_HISTORY.md`.

## Working style — D's preferences

- **"/effort max"** — produce exhaustive, complete output. Full files, no
  snippets. Full instructions, no delegated steps. Self-audit before delivery.
- **Run instructions always at the BOTTOM** of a response in a clearly
  delimited block with its own heading.
- **Pipe verbose output to log files** — use `command 2>&1 | tee output.log`.
- **Always self-audit against all known vulnerabilities** before declaring done.
- **Test before claiming things work**. Use `npm run typecheck`, `npm test`,
  `forge test` — USE THEM. Don't say "this should compile" — run the compiler.
- **Prefer the smallest fix that works** over clever abstractions.
- **Only invoke state-changing blockchain txs when explicitly asked.** For
  verification, prefer `cast call` / `eth_call` over `cast send`.

## Startup commands

### Inspecting the live BSC Testnet deploy

```bash
source /c/tools/brawlers/.env.testnet
cast call "$BRAWLERS_ADDRESS" "nextTokenId()(uint32)" --rpc-url "$TESTNET_RPC"
cast call "$BRAWLERS_ADDRESS" "rarityOf(uint256)(uint8)" 501 --rpc-url "$TESTNET_RPC"
cast call "$MINTDROP_ADDRESS" "totalSold()(uint256)" --rpc-url "$TESTNET_RPC"
```

### Redeploying a new contract version to BSC Testnet

```bash
cd /c/tools/brawlers
set -a; source .env.testnet; set +a
export PRIVATE_KEY="$DEPLOYER_KEY"

BASE_URI="https://baseicbrawlers.com/api/token/" \
SIGNER_ADDRESS="$SIGNER_ADDRESS" \
BRAWL_INITIAL_HOLDER="$DEPLOYER_ADDRESS" \
DEV_TREASURY="$DEPLOYER_ADDRESS" \
MINT_TREASURY="$DEPLOYER_ADDRESS" \
RESURRECT_TREASURY="$DEPLOYER_ADDRESS" \
USDT_ADDRESS=0x0000000000000000000000000000000000000000 \
ETH_MINT_PRICE=100000000000000 \
USDT_MINT_PRICE=1000000 \
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$TESTNET_RPC" \
  --broadcast \
  --chain-id 97
```

After: update `.env.testnet` + `frontend/.env.local` + Vercel env vars,
redeploy Vercel, setBaseURI if alias changed.

### Vercel env var updates (non-interactive)

```bash
cd /c/tools/brawlers/frontend
vercel env rm NAME production --yes
vercel env add NAME production --value "VALUE" --yes
vercel deploy --prod --yes
```

### Local Anvil (optional)

```bash
cd /c/tools/brawlers
anvil                       # terminal 1
forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 \
  --broadcast --private-key 0xac0974…ff80
```

### Tests

```bash
cd /c/tools/brawlers
npm test         # 211 vitest (164 CLI + 47 parity)
forge test       # 112 forge tests
```

### Frontend local dev

```bash
cd C:\tools\brawlers\frontend
npm run dev        # → http://localhost:3000
npm run build
npm run typecheck
```

## Known recurring issues

### tsconfig.json in frontend keeps drifting

Next.js 16 auto-rewrites `frontend/tsconfig.json` on every `npm run dev`:
- `jsx: "preserve"` → `jsx: "react-jsx"`
- adds `.next/dev/types/**/*.ts` to include

Harmless. **DO NOT** use `".."` or `"../**/*"` in `exclude` — TypeScript
normalizes those paths and TS18003 blows up. Use `rootDir: "."` if you need
to constrain input scope.

### Multicall3 — re-enabled on BSC Testnet, off for Anvil

`frontend/src/lib/wagmi.ts` registers Multicall3 at `0xcA11…CA11` for chain 97
(BSC Testnet predeploys it). Anvil (31337) does NOT predeploy it — leave it
off there or `useReadContracts` returns `0x` and decode-fails on every page load.

### wagmi chain-detection — use `useAccount().chainId`

`useChainId()` returns `config.state.chainId`, which falls back to
`config.chains[0].id` when wallet is on an unconfigured chain. Use
`useAccount().chainId` (connector's actual current chain) instead.

### frontend needs `.env.local`

```powershell
cd C:\tools\brawlers\frontend
copy .env.example .env.local
```

`.env.local` also holds `BRAWLERS_SIGNER_KEY` — Node-runtime env var (no
`NEXT_PUBLIC_` prefix), only `/api/run-duel` reads it. On Vercel, set as a
**production** env var via `vercel env add` — NEVER commit.

### Vercel CLI quirks

- `vercel env add` needs `--value "X" --yes` for non-interactive.
- `yes |` does NOT bypass vercel's prompts. Use `--yes` flag explicitly.
- `--scope <personal-account>` errors; leave it off for personal accounts.
- `NEXT_PUBLIC_*` vars stored "sensitive" → `vercel env pull` shows them
  empty but the build reads them correctly. Don't re-add unnecessarily.

### Native currency labels

Derived from chainId via `nativeSymbol()` in `frontend/src/lib/wagmi.ts`.
BSC Testnet → `tBNB`; BSC mainnet → `BNB`; everything else (Anvil, Base,
Ethereum) → `ETH`.

### Next.js security patches

Pin Next to latest 16.0.x patch. CVE-2025-66478 affects <16.0.7. Currently
on 16.0.10. Bump when a new patch is released.

### Rarity ranking (post-2026-04-24 swap)

Ordered from rarest within the 500 drop: **Epic (5) > Legendary (10) >
Rare (50) > Uncommon (125) > Common (310)**, with **King (1/1, tokenId 501)**
above all. Internal contract tiers stay 0..4 for the shuffled drop + 5 for
king; the label swap is UI-only in `frontend/src/lib/rarity.ts` +
`frontend/src/app/api/token/[id]/route.ts`.

## Design language

Visually inspired by Fantums of Opera:

- Dark brick-tinted background (`#0d0d0f` page, `#1a1417` panels)
- Orange `#f5a623` primary CTA, red `#c13e3e` destructive/danger/dead
- **Rarity colors**: common gray / uncommon blue / rare purple / legendary
  orange / epic orange
- **All-purple background per brawler** (`#4A2C7A`–`#6A3AA8`) — applied
  during iter-14 art polish; replaces the dark-tinted brown/black panels
- Pixel font "Press Start 2P" for headers, monospace "VT323" for body
- All caps wide-letter-spacing on headers
- `PixelAvatar` is a thin wrapper around `lib/brawlerArt.ts` (pure function)
  so client cards and `/api/token/:id/image` return byte-identical SVGs

Tailwind tokens in `frontend/tailwind.config.ts`: `brawl-bg`, `brawl-orange`,
`rarity-rare`, etc.

## TS ↔ Solidity ↔ frontend-duplicate parity

Phase 4 established byte-identical behavior between:
- `contracts/Brawlers.sol::_rollBrawler` ↔ `src/core/brawler.ts::createBrawler`
- `contracts/Duel.sol::applyDuelResult` ↔ `src/core/elo.ts::applyDuelResult`
- Xorshift128+ RNG matches across both

Phase 7a added a **third copy** in `frontend/src/` (Next.js API routes
can't reach root `src/` without monorepo setup). `test/sim_parity.test.ts`
runs the same `(Brawler, Brawler, seed)` through root + frontend sims and
asserts identical `FightResult`. **47 parity tests pass.** If you touch
either copy, re-run `npm test` to catch drift.

Long-term: refactor into an npm workspace / shared package so there's one
copy. Until then, treat the duplication as gospel and mirror by hand.

## File of last resort

If you're confused about something that happened before this session:
- `git log --oneline --all` — once git is properly initialized; the repo
  currently has no commits.
- `docs/PHASE_HISTORY.md` — full iteration log archived from CLAUDE.md.
- Transcript `.txt` files in the project root (preserved from past compaction).
- `broadcast/Deploy.s.sol/<chainId>/run-latest.json` — canonical record of
  the last forge script deploy.
- `C:\Users\darre\.claude\projects\C--tools\memory\MEMORY.md` — Claude's
  persistent memory index.

## Final note for the next Claude

D is careful, technical, and doesn't tolerate sloppy work. When in doubt:
**run the tests, read the error, fix it, run the tests again.** Don't
hand-wave. Don't apologize excessively when something breaks — own it, fix
it, move on.

The escalation point that matters: **never broadcast a real tx from the
deployer or signer key without explicit authorization**. Use `cast call`
(eth_call) to simulate when verifying behavior. `cast send` needs a green
light.
