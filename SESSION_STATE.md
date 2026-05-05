# BASEic Brawlers, session state

> Live handoff doc. Update at the end of every session. New sessions read this
> first to skip context-rebuild. Long history lives in `docs/PHASE_HISTORY.md`.
> Stable project context lives in `CLAUDE.md`.

## Last updated
2026-05-05 evening (art polish pass deployed: faces / weapons / twinkles / palettes)

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
  the docs (README, CLAUDE.md, SESSION_STATE.md, about page, marketing
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
2. **Telegram welcome bot token**. The operator needs to re-create
   `@baseicbrawlers_welcome_bot` via @BotFather /newbot. RAID and
   LEADERBOARD tokens are already wired in `marketing/bots/.env`.
3. **`PUBLIC_GROUP_ID`**. Add @RawDataBot to `@baseicbrawlers`, copy the
   negative integer ID, drop in `marketing/bots/.env`.
4. **Marketplace v6 redeploy** (deferred, not blocking). The Marketplace
   contract is still pointed at the old Brawlers contract from v4. Per
   the orchestrator design, redeploying the Marketplace is a separate
   forge script (`script/DeployMarketplace.s.sol`). For mainnet day this
   should be folded into the main deploy.
5. **CLI `mint-onchain` rewrite**. Still calls `brawlers.mint()` directly,
   reverts on testnets. Rewrite to use `MintDrop.mintWithETH`. UI unaffected.
6. **Mainnet day**. Run `npm run deploy:mainnet` when launch ETH is in
   the deployer wallet and marketing is primed. Orchestrator handles
   contracts + Vercel + smoke. Manual follow-ups: SeedAndLockLP.s.sol
   (Aerodrome LP + Unicrypt lock), 24-48h soak, BRAWL renounce sequence,
   manual BRAWL allocations (50k LP / 10k dev / 15k reserve).

## Mainnet-day playbook (locked)
- Tiered pricing: 100 free / 400 @$40 / 500 @$45 / 500 @$50 / 500 @$60
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
- New session: read this first, then skim CLAUDE.md for stable context.
- End of session: update "Last updated" + "Where we are" + adjust
  "Pending / next actions" so the next Claude opens cold-ready.
- Never let this file sprawl. Long history goes to `docs/PHASE_HISTORY.md`.
