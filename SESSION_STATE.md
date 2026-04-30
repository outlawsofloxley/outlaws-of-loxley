# BASEic Brawlers, session state

> Live handoff doc. Update at the end of every session. New sessions read this
> first to skip context-rebuild. Long history lives in `docs/PHASE_HISTORY.md`.
> Stable project context lives in `CLAUDE.md`.

## Last updated
2026-04-30 (private GitHub repo created + pushed, language sweep + audit done)

## Where we are
- **v5 contracts deployed 2026-04-29** to Base Sepolia (chain 84532). Addresses
  in `.env.base-sepolia` (canonical source) and synced to `frontend/.env.local`.
- **Live**: https://baseicbrawlers.com. Vercel production redeployed, serves
  v5 BRAWLERS `0x936ae7…`. Verified by hitting `/api/token/1`.
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
1. **Audit fixes for mainnet day**. Pick the ones that matter from the
   audit at the bottom of this session's transcript. Highest priorities:
   - Graveyard refund of overpayment (CRITICAL).
   - MintDrop ETH routing order (CRITICAL).
   - Duel signature chain ID for cross-chain replay safety (HIGH).
   - Add CSP, HSTS, X-Frame-Options headers to `next.config.ts` (LOW but easy).
   - Tighten `/api/run-duel` expiry from 1h to 5min (MEDIUM, easy edit).
2. **500-mint test on Base Sepolia with mates**. Art is ready, contracts
   unchanged. Mint, eyeball `/audit` live tab, verify rarity distribution.
   D's wallet still hits the dev-rarity-cap (Common/Uncommon only), so
   mates need to mint from fresh wallets to surface Epic/Rare on-chain.
3. **Telegram welcome bot token**. D needs to re-create
   `@baseicbrawlers_welcome_bot` via @BotFather /newbot. RAID and
   LEADERBOARD tokens are already wired in `marketing/bots/.env`.
4. **`PUBLIC_GROUP_ID`**. Add @RawDataBot to `@baseicbrawlers`, copy the
   negative integer ID, drop in `marketing/bots/.env`.
5. **Marketplace v5 redeploy** (deferred, not blocking). The current
   marketplace `0xEeab07…` is still v4. Redeploy if needed. No blocker today.
6. **CLI `mint-onchain` rewrite**. Still calls `brawlers.mint()` directly,
   reverts on testnets. Rewrite to use `MintDrop.mintWithETH`. UI unaffected.

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
# Sanity-check live deploy points to v5 BRAWLERS
curl -s https://baseicbrawlers.com/api/token/2001 | head -c 400

# Inspect on-chain state on Sepolia
source /c/tools/brawlers/.env.base-sepolia
cast call "$BRAWLERS_ADDRESS" "nextTokenId()(uint32)" \
  --rpc-url https://base-sepolia-rpc.publicnode.com

# Regenerate marketing art (Pollinations, free, no key)
python3 /c/tools/brawlers/marketing/art/gen.py

# Redeploy frontend after env changes
cd /c/tools/brawlers/frontend && vercel deploy --prod --yes

# GitHub
gh repo view baseicbrawlers/baseic-brawlers --web
git push                              # subsequent pushes
```

## How to use this file
- New session: read this first, then skim CLAUDE.md for stable context.
- End of session: update "Last updated" + "Where we are" + adjust
  "Pending / next actions" so the next Claude opens cold-ready.
- Never let this file sprawl. Long history goes to `docs/PHASE_HISTORY.md`.
