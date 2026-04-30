# BASEic Brawlers, session state

> Live handoff doc. Update at the end of every session. New sessions read this
> first to skip context-rebuild. Long history lives in `docs/PHASE_HISTORY.md`.
> Stable project context lives in `CLAUDE.md`.

## Last updated
2026-04-30 evening (v6 contracts live on Sepolia, deploy orchestrator in repo)

## Where we are
- **v6 contracts deployed 2026-04-30** to Base Sepolia via the new
  orchestrator (`scripts/deploy.mjs`). Fresh addresses in
  `.env.base-sepolia`. Old v5 contracts at `0x936ae7…` etc. stay alive
  on-chain but are no longer referenced by the frontend. v6 includes
  every audit fix (EIP-712 signatures, one-time-set pointers, refund
  overpay, owner caps, tier coverage check).
- **Live**: https://baseicbrawlers.com. Vercel production deployed, smoke
  tests pass: `/api/token/2001` returns King metadata, `/api/marketplace/listings`
  returns `[]`, `/api/history/sync` returns `200`.
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
- **Marketing art** (last verified 2026-04-30 evening):
  - Procedural assets are byte-identical to a fresh regen against the
    current `frontend/src/lib/brawlerArt.ts` (em-dash sweep was
    comment-only, didn't shift output).
  - 126 sample SVGs in `marketing/art/samples/`, plus `contact_sheet.png`,
    `rarity_showcase.png`, `mint_preview_100.png`, `base_archetypes.png`,
    `fixed_combos.png`.
  - 8 composited marketing pieces just regenerated via `compose.py`:
    `x-banner.png`, `tg-cover.png`, `founder-{1,50,100}.png`,
    `death-scene.png`, `main-pfp.png`, `rarity-showcase.png`.
  - 5 Kling animation MP4s in `videos/` (king, knight-epic,
    mafia-legendary, mongol-rare, spartan-epic) from Apr 29.
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
- **fixed_combos.png audit closed** (2026-04-29): all 12 archetype:rarity rows
  show consistent faces with RAISED mouth label (or `OFFSET=-1` for
  pirate:uncommon). v5 mouth-fix patch confirmed working.
- **contact_sheet.png face-cleanup pass closed** (2026-04-29 evening). D
  circled 22 brawlers with munted faces. Three root-cause bugs in
  `frontend/src/lib/brawlerArt.ts` fixed:
    1. Eyepatch (`Accessory='eyepatch'`) was rolling on **any** archetype at
       18% × 1/3 chance, so ~6% of all brawlers got an eyepatch even on
       non-pirate kings, mafia, samurai, etc. Removed `'eyepatch'` from the
       random pool at the `accessory` roll site (line ~726). Pirates
       already use `forceAccessory: ['earring']` so they're unaffected.
       The eyepatch case in `drawAccessory` is left in place so it can be
       opted back in via `spec.forceAccessory` if ever wanted.
    2. Moustache facialHair *replaced* the mouth. The face had eyes plus a
       2-pixel dark bar above the lip and **no mouth row** rendered at
       all. Made the moustache + mouth always render together so the face
       reads as a moustachioed open mouth instead of no mouth.
    3. `expression='squint'` skipped `drawEye()` entirely and put two
       dark dots at the pupil positions. On dark-skinned brawlers those
       dots blended into the skin and the face read as eyeless. Squint
       now calls `drawEye` first (white sclera + pupil) and stamps a line
       over the pupil. Closed-eye with the sclera still anchoring the face.
  Regenerated `marketing/art/samples/*` (126 SVGs) and `contact_sheet.png`.
  All 22 previously-circled brawlers verified clean. `npx tsc --noEmit`
  clean. 211/211 vitest tests pass. Forge tests untouched (no contract
  changes). Frontend redeployed.
- **Frontend code is v5-ready and v4-defensive**. Reads `MintDrop.batchCost`
  with fallback to flat `ethPrice * count`. Dash editors for tiered pricing
  and founder discount render a "needs v5+" hint until the new reads succeed.

## Pending / next actions
1. **500-mint test on Base Sepolia with mates** (NOW UNBLOCKED). v6
   contracts are live and clean (totalSold = 0). Distribute mint links,
   eyeball `/audit` live tab, verify rarity distribution. D's wallet
   still hits the dev-rarity-cap (Common/Uncommon only), so mates need
   to mint from fresh wallets to surface Epic/Rare on-chain.
2. **Telegram welcome bot token**. D needs to re-create
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
