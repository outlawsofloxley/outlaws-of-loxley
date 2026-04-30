# BASEic Brawlers — Session State

> Live handoff doc. Update at the end of every session. New sessions read this
> first to skip context-rebuild. Long history lives in `docs/PHASE_HISTORY.md`;
> stable project context lives in `CLAUDE.md`.

## Last updated
2026-04-29 evening (face-cleanup deployed + git re-rooted, ready for GitHub push)

## Where we are
- **v5 contracts deployed 2026-04-29** to Base Sepolia (chain 84532). Addresses
  in `.env.base-sepolia` (canonical source) and synced to `frontend/.env.local`.
- **Live**: https://baseicbrawlers.com — Vercel production redeployed 4h ago,
  serves v5 BRAWLERS `0x936ae7…`. Verified by hitting `/api/token/1`.
- **fixed_combos.png audit closed** (2026-04-29): all 12 archetype:rarity rows
  show consistent faces with RAISED mouth label (or `OFFSET=-1` for
  pirate:uncommon). v5 mouth-fix patch confirmed working.
- **contact_sheet.png face-cleanup pass closed** (2026-04-29 evening):
  D circled 22 brawlers with "munted" faces. Three root-cause bugs in
  `frontend/src/lib/brawlerArt.ts` fixed:
    1. Eyepatch (`Accessory='eyepatch'`) was rolling on **any** archetype at
       18% × 1/3 chance → ~6% of all brawlers got an eyepatch even on
       non-pirate kings, mafia, samurai, etc. Removed `'eyepatch'` from the
       random pool at the `accessory` roll site (line ~726). Pirates
       already use `forceAccessory: ['earring']` so they're unaffected;
       the eyepatch case in `drawAccessory` is left in place so it can be
       opted back into via spec.forceAccessory if ever wanted.
    2. Moustache facialHair *replaced* the mouth — face had eyes + a
       2-pixel dark bar above the lip and **no mouth row** rendered at
       all. Made the moustache + mouth always render together so the
       face reads as "moustachioed open mouth" instead of "no mouth".
    3. `expression='squint'` skipped `drawEye()` entirely and put two
       dark dots at the pupil positions. On dark-skinned brawlers those
       dots blended into the skin and the face read as eyeless. Squint
       now calls `drawEye` first (white sclera + pupil) and stamps line
       over the pupil — closed-eye with the sclera still anchoring the
       face.
  Regenerated `marketing/art/samples/*` (126 SVGs) + `contact_sheet.png`.
  All 22 previously-circled brawlers verified clean. `npx tsc --noEmit`
  clean; 211/211 vitest tests pass; forge tests untouched (no contract
  changes). **Frontend not yet redeployed** — D will eyeball the
  regenerated contact sheet first, then `vercel deploy --prod --yes`.
- **Frontend code is v5-ready and v4-defensive**: reads `MintDrop.batchCost`
  with fallback to flat `ethPrice * count`; dash editors for tiered pricing
  and founder discount render "needs v5+" hint until the new reads succeed.

## Pending / next actions
1. **Create GitHub repo + push** (D's task on wake — repo is staged, not
   committed yet). Steps:
   a. Choose visibility (public / private) and pick a license. Update the
      "License TBD" line in `README.md` and add a `LICENSE` file. MIT or
      Apache-2.0 are the safe defaults if you want it open.
   b. `gh repo create baseicbrawlers --public --source=. --remote=origin
      --push=false` (or use the GitHub web UI and `git remote add origin
      <url>`).
   c. Make the initial commit:
      ```bash
      cd /c/tools/brawlers
      git commit -m "$(cat <<'EOF'
      Initial commit — BASEic Brawlers v5 (Base Sepolia live)

      Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
      EOF
      )"
      git push -u origin main
      ```
   - Repo was re-rooted at `/c/tools/brawlers` (was at `/c/tools/`).
   - Submodules re-cloned and pinned: forge-std `0844d7e1`,
     openzeppelin-contracts `dbb6104c`. `forge test` still passes 112/112.
   - 268 files staged, .git is 59MB (mostly OZ submodule history).
   - Audited for secrets — only Anvil's well-known public test keys in
     `.env.example` and `script/Deploy.s.sol` (intentional, documented).
     `.env`, `.env.base-sepolia`, `.env.testnet`, `frontend/.env.local`,
     `marketing/bots/.env`, `*.bak`, `.claude/scheduled_tasks.lock`,
     `.claude/settings.local.json`, `out/`, `broadcast/`, `cache/` all
     gitignored.

2. **500-mint test on Base Sepolia with friends** — art is ready, contracts
   unchanged. Mint, eyeball `/audit` live tab, verify rarity distribution.
   D's wallet still hits dev-rarity-cap (Common/Uncommon only) — friends
   need to mint from fresh wallets to surface Epic/Rare on-chain.
2. **Telegram welcome bot token** — D needs to re-create
   `@baseicbrawlers_welcome_bot` via @BotFather /newbot. RAID + LEADERBOARD
   tokens already wired in `marketing/bots/.env`.
3. **`PUBLIC_GROUP_ID`** — add @RawDataBot to `@baseicbrawlers`, copy the
   negative integer ID, drop in `marketing/bots/.env`.
4. **Marketplace v5 redeploy** (deferred, not blocking) — current marketplace
   `0xEeab07…` is still v4. Per `.env.base-sepolia` comment, redeploy if
   needed. No active blocker today.
5. **Git re-root** — repo was `git init`d at `C:\tools\` parent. No commits
   yet, safe to re-init at `C:\tools\brawlers\` before first push to GitHub.
6. **CLI `mint-onchain` rewrite** — still calls `brawlers.mint()` directly;
   reverts on testnets. Rewrite to use `MintDrop.mintWithETH`. UI unaffected.

## Mainnet-day playbook (locked)
- Tiered pricing: 100 free / 400 @$40 / 500 @$45 / 500 @$50 / 500 @$60
- Founder discount: 25% (Duel.setFounderDiscountBps, default 2500)
- Founders 1-100 get 1 free resurrect
- Run `script/SeedAndLockLP.s.sol` → seeds Aerodrome v2 BRAWL/ETH pool +
  locks LP on Unicrypt for 6 months
- BRAWL renounce sequence: whitelist game contracts + LP router → seed LP
  → enableTrading() → 24-48h watch + blacklist obvious bots → liftLimits()
  → renounceOwnership()
- Game contracts (Duel/MintDrop/Marketplace/Graveyard) stay dev-controlled

## Loose ends Claude should NOT touch without explicit greenlight
- Broadcasting any tx from deployer or signer key
- BRAWL trading/limits state on testnet (already enabled + lifted)
- Vercel env var changes (use `vercel env rm` + `vercel env add` carefully)
- Renouncing BRAWL ownership

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
```

## How to use this file
- New session: read this first, then skim CLAUDE.md for stable context.
- End of session: update "Last updated" line + "Where we are" + adjust
  "Pending / next actions" so the next Claude opens cold-ready.
- Never let this file sprawl. Long history goes to `docs/PHASE_HISTORY.md`.
