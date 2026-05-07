# BASEic Brawlers, session state

> Live handoff doc. Update at the end of every session. New sessions read this
> first to skip context-rebuild. Long history lives in `docs/PHASE_HISTORY.md`.
> Stable project context lives in `BASEicBrawlers.md`.

## Last updated
2026-05-07: **v12 contracts deployed to Sepolia**, adds `isHouseBrawler` mapping override on Brawlers so deploy-time keeper fighters in the 1..100 founder range get NO founder discount / freebie / airdrop. Deploy.s.sol gained optional `HOUSE_BRAWLERS_COUNT` + `HOUSE_KEEPER_ADDRESS` env-driven step (mints + flags + transfers in one shot). 139 forge tests pass. v12 Sepolia rehearsal: 10 house brawlers seeded at IDs 1-10, isHouseBrawler=true verified, dash whitelist auto-seeded via NEXT_PUBLIC_HOUSE_BRAWLER_IDS.

Earlier today (also 2026-05-07): v11 contracts shipped Marketplace folded into Deploy.s.sol + `duel.setMarketplace()` auto-wire + `initialRarityHash()`/`rarityHash()`/`freezeRarity()` rarity commitments. Body font swapped VT323 → JetBrains Mono. Coinbase Wallet connector wired. Discord/X/Telegram footer added. Awaiting funded deployer wallet + dev address to ship mainnet.

## Mainnet readiness — locked decisions
- BRAWL supply: **100,000** fixed
- Allocations: **30k LP / 5k dev / 65k governance treasury** (Snapshot-vote-gated 2-of-3 Safe)
- LP seed: **30k BRAWL + $300 ETH** → BRAWL @ $0.010, MC $1,000
- LP lock: **90 days on Unicrypt**
- Mint pricing: **$20/$25/$30/$35/$40/$50** across 6 tiers (1-50 / 51-100 / 101-500 / 501-1000 / 1001-1500 / 1501-2000)
- Mint proceeds: **100% to dev wallet** (no LP-from-mints, no airdrops on mint)
- Fight cost: **~$1 USD in BRAWL**, auto-rebalanced every 5min by `marketing/keeper/`
- Anti-sniper: existing BRAWL.sol mechanics (tradingEnabled gate + auto-blacklist + 0.5% maxTx + 1% maxWallet)
- Governance graduation: Snapshot+Safe at launch → on-chain Governor at $250k MC milestone
- Etherscan multichain key stored in `.env.base-mainnet` for `forge verify-contract`

## Next gating action
**Awaiting**: funded deployer wallet PKEY (~$400 ETH for LP + gas) and dev wallet address from operator. After those land, `npm run deploy:mainnet` ships. Full runbook: `LAUNCH-PLAYBOOK.html`.

## Last live state (Sepolia v12, 2026-05-07)

**v12 addresses (Sepolia, chain 84532)**:
- `BRAWL       = 0x0e373387f6fd51f9b6ce0d73e1576fd97d3f62a5`
- `BRAWLERS    = 0x72aa4d388dc833b2daba00bf6b1127f2a15ec9a8`
- `DUEL        = 0xd02191ad301340afad6dfed9659f7600209d04b5`
- `GRAVEYARD   = 0x16c4df3061032fad401797da9cecc934eba3b39f`
- `MINTDROP    = 0x7570f91c39524c89039bcf7fa96b8548ab2b86c8`
- `MARKETPLACE = 0x868a890bdde7f2d6f3e9401a383d045ca72b1942`
- `MOCKUSDT    = 0xe251805dc49b1752aaa603159c65cffb8d9f22c9`
- House brawlers: tokenIds 1..10 (all C/U via `_skipRareForDev`), all `isHouseBrawler=true`
- Dash whitelist auto-seeds from `NEXT_PUBLIC_HOUSE_BRAWLER_IDS=1,2,...,10`

## Where we are
- **Art polish pass deployed 2026-05-05** to https://baseicbrawlers.com.
  Build `frontend-g4zlgmolh-ghubbers-projects.vercel.app`, smoke tests green
  (`/api/token/2001` 200, `/api/token/2001/image` 200, fresh SVG serving).
  All changes in `frontend/src/lib/brawlerArt.ts`:
  - **Faces**: freckles' third pixel was overwriting the right-eye sclera —
    fixed by moving freckles to outer cheek (cols `CX±2`). Moustache
    dropped entirely; its 4-pixel wing sat directly under the eye row and
    read as a droopy unibrow at thumbnail scale. Goatee is the only
    facial-hair option now. Scar moved from col 13 → col 14 (was colliding
    with the right-eye sclera at row 8, making #55/#63 in the mint preview
    look like the eye was a tear streak).
  - **Weapons**: 1-pixel auto dark outline (`#0E0810`) around every weapon
    silhouette via a 3-pass `drawWeapon` (collect pixels → outline neighbours
    → re-stamp body). Opt-out via `outline: false` on `WeaponSprite` for the
    four near-black guns (pistol/shotgun/bazooka/rail gun). Bat redetailed
    (shine column, two grip-tape rings sandwiching a wood band). Knife
    widened from 1-pixel to 3-pixel blade with white centre highlight.
    Machete and flaming sword got a fuller-groove centre stripe (`D` =
    `#7A7A7A`); flaming sword's blade widened from 1 to 3 pixels to match.
  - **Backgrounds**: token-deterministic 5-pixel twinkle scatter replaces
    the static corner crosses. 1 / 2 / 3 / 4 / 5 / 6 twinkles from common
    up to king. Fisher-Yates over a 14-position safe-zone pool seeded by
    tokenId via a separate LCG, so brawler rolls are unaffected. Per-rarity
    palette preserved (yellow from rare up, orange + gold for epic and
    king). Common gets its first-ever sparkle. `drawPlus` removed (dead).
  - **Palettes**: `HAIR_COLORS` expanded 10 → 16; orange / green / blue /
    bright-red vibrants now ~50% of pulls. `SKIN_PALETTES` reweighted 70%
    lighter / 30% darker (pale + light-tan + peach listed twice each).
    Aesthetic call per D: lighter skin makes outfit and rarity-bg colours
    pop better at 24x32.
  - Discord bot's portrait fetcher picks up the new art automatically on
    next request; no bot restart needed.
- **v6 contracts deployed 2026-04-30** to Base Sepolia via the new
  orchestrator (`scripts/deploy.mjs`). Fresh addresses in
  `.env.base-sepolia`. Old v5 contracts at `0x936ae7…` etc. stay alive
  on-chain but are no longer referenced by the frontend. v6 includes
  every audit fix (EIP-712 signatures, one-time-set pointers, refund
  overpay, owner caps, tier coverage check).
- **v6 addresses (Sepolia, chain 84532)**:
  - `BRAWL     = 0xf3b431d2afec0286723e058b7cf0110783323a0a`
  - `BRAWLERS  = 0x55695a72714a05ce1cab069e9d42341912f47602`
  - `DUEL      = 0x09ac227ae70a030b5edb5c892a6c3ed730e4d4df`
  - `GRAVEYARD = 0x7897a918e625e10b9658963d05e006980b0db918`
  - `MINTDROP  = 0xbf2db93fb3f642639a3a53942b224fa697ee31bd`
  - `MOCKUSDT  = 0x6afee7c9bb4b8e47a085fb7f2769f840ccad696c`
- **Deploy orchestrator** at `scripts/deploy.mjs`. Single command rolls
  out preflight, forge deploy, address parsing, env updates, Vercel sync,
  Vercel deploy, smoke tests. `npm run deploy:sepolia` rehearsed clean
  on the v6 rollout. `npm run deploy:mainnet` is the same flow with
  two safety prompts. See `LAUNCH.md` for the full playbook.
- **Marketing art** (last verified 2026-05-05 evening, regenerated against
  the art polish pass):
  - 168 SVGs in `samples/`, 126 in `big/`, 251 in `showcase/`, 12 in `weapons/`.
  - Sheets refreshed: `contact_sheet.png` (full 168-tile roster),
    `inspect_munted.png` (16-tile zoom), `weapons_sheet.png` (12-weapon
    showcase), `fixed_combos.png`, `base_archetypes.png`, `rarity_showcase.png`,
    `mint_preview_100.png`, `scene_variants.png` (background flavour A/B sheet).
  - 8 composited marketing pieces refreshed via `compose.py`: `main-pfp.png`,
    `x-banner.png`, `tg-cover.png`, `rarity-showcase.png`,
    `founder-{1,50,100}.png`, `death-scene.png`.
  - 5 Kling animation MP4s in `videos/` (king, knight-epic, mafia-legendary,
    mongol-rare, spartan-epic) from Apr 29 — NOT regenerated; they predate
    the art polish pass and show the older skin/hair distribution.
  - All marketing copy already references 2,000 supply (1240 / 500 / 200 /
    40 / 20 + 1 King). Stray "500" references in `content/*.md` are
    banner dimensions or tier ranges, not supply.
  - `marketing/art/` is gitignored (local-only binary blobs;
    deterministically reproducible via the regen scripts).
- **GitHub repo**: https://github.com/baseicbrawlers/baseic-brawlers
  (private, commit `65eb013`, 268 files). Pushed 2026-04-30 under the
  `baseicbrawlers` GH account using a noreply commit email so the real
  address never lands in history.
- **Language sweep done 2026-04-30**: every em-dash across 166 first-party
  text files swapped for plain punctuation, AI-style phrasing rewritten in
  the docs (README, BASEicBrawlers.md, SESSION_STATE.md, about page, marketing
  copy). Australian English spellings used in prose. Code identifiers
  untouched.
- **Security audit done 2026-04-30** (Solidity + frontend agents). Findings
  written up at the end of the session with fix priorities for mainnet day.
  Highlights: Graveyard accepts overpayment without refund; Marketplace
  fee rounding worth a closer look; Duel signatures should add chain ID
  for cross-chain replay safety; a few rate-limit gaps on public sync
  endpoints.
- **Face cleanup passes closed**: 2026-04-29 (eyepatch over-rolled,
  moustache replaced mouth, squint went eyeless on dark-skinned brawlers
  — all fixed) and 2026-05-05 (freckles+sclera collision, moustache
  dropped, scar+sclera collision — all fixed in the art polish pass
  above). Full triage in `docs/PHASE_HISTORY.md`.
- **Frontend code is v5-ready and v4-defensive**. Reads `MintDrop.batchCost`
  with fallback to flat `ethPrice * count`. Dash editors for tiered pricing
  and founder discount render a "needs v5+" hint until the new reads succeed.

## Pending / next actions
1. **500-mint Sepolia rehearsal with the closed beta cohort** (NOW
   UNBLOCKED). v6 contracts are live and clean (totalSold = 0). Distribute
   mint links, eyeball `/audit` live tab, verify rarity distribution. The
   deployer wallet hits the dev-rarity-cap (Common/Uncommon only), so the
   beta cohort needs to mint from fresh wallets to surface Epic/Rare
   on-chain.
2. **Marketplace v6 redeploy** — DONE in v11 (folded into `Deploy.s.sol`).
   `duel.setMarketplace()` is auto-wired during deploy so listed brawlers
   get blocked from duels via `Duel.applyDuelResult` reading
   `Marketplace.isListed()`. `script/DeployMarketplace.s.sol` is now
   redundant for mainnet day; can be deleted later.
3. **CLI `mint-onchain` rewrite**. Still calls `brawlers.mint()` directly,
   reverts on testnets. Rewrite to use `MintDrop.mintWithETH`. UI unaffected.
4. **Mainnet day**. Run `npm run deploy:mainnet` when launch ETH is in
   the deployer wallet and marketing is primed. Orchestrator handles
   contracts + Vercel + smoke. Manual follow-ups: SeedAndLockLP.s.sol
   (Aerodrome LP + Unicrypt lock), 24-48h soak, BRAWL renounce sequence,
   manual BRAWL allocations (50k LP / 10k dev / 15k reserve).

**Comms/bots — DONE:**
- Discord live (`discord.gg/RjvBEA5CVd`, BB#4251 on TrueNAS, ⚔ verification gate working)
- Telegram bots fully wired in `marketing/bots/.env`: WELCOME / RAID / LEADERBOARD tokens, PUBLIC_GROUP_ID, ANNOUNCE_CHANNEL_ID

## Mainnet-day playbook (locked)
- Tiered pricing (locked 2026-05-06, NO free mints): 50 @$20 / 50 @$25 / 400 @$30 / 500 @$35 / 500 @$40 / 500 @$50 (sellout = $76,750)
- Founder discount: 25% (Duel.setFounderDiscountBps, default 2500)
- Founders 1-100 get 1 free resurrect
- Run `script/SeedAndLockLP.s.sol`. Seeds Aerodrome v2 BRAWL/ETH pool and
  locks LP on Unicrypt for 6 months.
- BRAWL renounce sequence: whitelist game contracts and LP router, seed LP,
  enableTrading(), 24 to 48 hour watch + blacklist obvious bots,
  liftLimits(), renounceOwnership().
- Game contracts (Duel/MintDrop/Marketplace/Graveyard) stay dev-controlled.

## Loose ends Claude should NOT touch without explicit greenlight
- Broadcasting any tx from deployer or signer key
- BRAWL trading/limits state on testnet (already enabled and lifted)
- Vercel env var changes (use `vercel env rm` and `vercel env add` carefully)
- Renouncing BRAWL ownership
- Flipping the GitHub repo public

## Deferred features (waiting on D's greenlight)
- House-brawler keeper with auto-dueling cron
- Level-up mechanic (currently all brawlers stuck at level 1)
- Real commissioned pixel art (replace `renderBrawlerArt` or swap
  `/api/token/[id]/image` to fetch from IPFS)
- Migration to Base mainnet

## Useful one-liners
```bash
# Deploy (full automated rollout; see LAUNCH.md for details)
npm run deploy:sepolia:dry         # preflight only, zero broadcast
npm run deploy:sepolia              # full Sepolia flow
npm run deploy:mainnet              # mainnet flow with two confirmations
node scripts/deploy.mjs --target sepolia --phase smoke-test  # re-run one phase

# Sanity-check live deploy points to v6 King
curl -s https://baseicbrawlers.com/api/token/2001 | head -c 400

# Inspect on-chain state on Sepolia
source /c/tools/brawlers/.env.base-sepolia
cast call "$BRAWLERS_ADDRESS" "nextTokenId()(uint32)" \
  --rpc-url https://base-sepolia-rpc.publicnode.com

# Regenerate marketing art (Pollinations, free, no key)
python3 /c/tools/brawlers/marketing/art/gen.py

# Trigger a fresh marketplace ghost prune
curl -s -X POST https://baseicbrawlers.com/api/marketplace/sync

# GitHub
gh repo view baseicbrawlers/baseic-brawlers --web
git push                              # subsequent pushes
```

## How to use this file
- New session: read this first, then skim BASEicBrawlers.md for stable context.
- End of session: update "Last updated" + "Where we are" + adjust
  "Pending / next actions" so the next Claude opens cold-ready.
- Never let this file sprawl. Long history goes to `docs/PHASE_HISTORY.md`.
