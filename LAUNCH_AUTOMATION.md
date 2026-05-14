# Launch automation plan

Written by Claude overnight 2026-05-14 → 15 while Darren slept. Mainnet deploy targeted ~03:00 UTC Friday (12:30 ACST). This doc consolidates the investigation into LP locking, team-token locking, tx-receipt comms, Dexscreener 100/100, and scanner red flag reduction. Each section ends with `▶ Decision needed:` or `▶ I'll execute this:` so you can scan top-to-bottom in the morning.

Read order: §1 (status) → §6 (decisions you need to make) → §7 (launch sequence).

---

## 1. Where we are

- **Sepolia v12 rehearsal complete**: 10 duels, 1 death, 3 marketplace listings + buys (per CLAUDE.md 2026-05-08 → 10 session).
- **Frontend live** on `baseicbrawlers.com`. Footer + nav point at `docs.baseicbrawlers.com`. `/about` → 308 redirect.
- **GitBook live** at `docs.baseicbrawlers.com` with the PROD-voice handbook.
- **X account live + automated**: profile complete, banner uploaded, first hype tweet at https://x.com/BASEicBrawlers/status/2054873099548651910. Cookie-based session at `marketing/scripts/x/.session.json`.
- **Mainnet env vars unfilled** (`.env.base-mainnet` has `<paste-after-deploy>` placeholders). Will populate at deploy.
- **Existing `script/SeedAndLockLP.s.sol`** does most of the LP-seed + lock flow but uses the older 6-arg `lockLPToken` signature. Needs the `_countryCode` param added (see §2).

---

## 2. LP lock: UNCX V2 on Aerodrome (Base)

**Locker contract (confirmed via UNCX docs):**
`0x30e522deDfFE3e3d11Cd53E27d18Cd4F016eD870` — UNCX Liquidity Locker V2, supports Aerodrome.

**Function signature (V2.1):**
```solidity
function lockLPToken(
    address _lpToken,
    uint256 _amount,
    uint256 _unlock_date,
    address payable _referral,
    bool _fee_in_eth,
    address payable _withdrawer,
    uint16 _countryCode    // ← new param the existing script is missing
) external payable
```

**Fees on Base:**
- **Flat: 0.1 ETH per lock** (~$300 USD at $3k ETH)
- **Percentage: 1% of LP locked** (UNCX takes 1% of the LP tokens as its cut)

**The cost problem.** The LAUNCH-PLAYBOOK's wallet section plans `$300 ETH (LP) + ~0.05 ETH gas` for the deployer. Per the playbook's `addLiquidityETH (30k BRAWL + 0.075 ETH)`, the ETH side of LP is only **0.075 ETH (~$225)** — but UNCX's flat fee is **0.1 ETH (~$300)**. The lock fee is *bigger than the LP itself*.

**Three viable paths:**

| | Cost (ETH) | Recoverable? | Scanner read | Trust signal | Recommended? |
|---|---|---|---|---|---|
| **A. UNCX 6-month lock** | 0.1 + 1% LP | Yes, after unlock | "locked LP — UNCX" (recognised) | Strong | ✅ if LP-side is ≥ 0.3 ETH |
| **B. Burn LP to `0xdead`** | 0 | **Never** | "burned LP" (max signal) | Maximum | ✅ if LP is small AND you commit fully |
| **C. Custom `TokenTimelock`** | ~$2 gas | Yes, after unlock | "unknown contract" (no signal) | Weak | ❌ — defeats the purpose |

`▶ Decision needed`: pick A or B. My recommendation: **bump LP-side ETH to 0.5 ETH and do UNCX 6-month lock (A)** — that's $1,500 LP with ~$300 UNCX fee = 80/20 ratio, scanner-friendly, and preserves your option to renew/migrate the lock later. If you'd rather keep LP small ($225) AND want maximum trust, go B (burn) — the on-chain receipt to `0xdead` is the strongest possible signal but it's *permanent*.

`▶ I'll execute this`: once you pick A or B, I'll update `SeedAndLockLP.s.sol` (V2.1 signature + your chosen path) and run it as part of the launch sequence. The Aerodrome `addLiquidityETH` half is identical in both paths; only the post-add step differs.

---

## 3. Team token lock: UNCX Token Vesting V2

**Vesting contract on Base:**
`0x7ca3dE7D58A0bCAd115184597553485A919320c5` — UNCX V2 Token Vesting.

**Function signature:**
```solidity
function lock(address _token, LockParams[] calldata _lock_params) external

struct LockParams {
    address owner;          // who can withdraw vested tokens
    uint256 amount;         // BRAWL wei
    uint256 startEmission;  // unix ts vesting starts
    uint256 endEmission;    // unix ts vesting ends (linear between)
    address condition;      // optional release-condition contract; address(0) = pure time vest
}
```

**Fee:** `0.05 ETH + 0.1% of vested tokens` (Base). Cheaper than LP lock. For 22,750 BRAWL vested = ~22.75 BRAWL fee.

**Current dev allocation (per `trust.md`):**
- **45,500 BRAWL** sits on the dev wallet. Trust-based reserve, no contract. Earmarked for "future seasons, partnerships, prize pools, ongoing development." No vesting cliff today.

**Three options for what to lock:**

| | What to lock | Vest schedule | Trust signal | Ops liquidity | Recommended? |
|---|---|---|---|---|---|
| **A. Lock 100%** | All 45,500 | 12-month linear | Maximum | Zero short-term — can't pay infra bills | ❌ kills ops flexibility |
| **B. Lock 50%** | 22,750 | 6-month linear, no cliff | Strong | Keep 22,750 liquid for season-1 prize pool + ops | ✅ |
| **C. Lock 25%** | 11,375 | 3-month linear | Modest | Most liquid | ⚠ weakens the "dev can't dump" pitch |

`▶ Decision needed`: A / B / C, and vest duration. My recommendation: **B with 6-month linear vest, no cliff**. Locks half the dev bag, gives season-1 a deliberate trickle of releasable tokens for prizes + ops, demonstrates skin-in-the-game to scanners and holders without strangling operations.

`▶ I'll execute this`: new `script/LockTeamTokens.s.sol` calling UNCX's `lock()` with one `LockParams` entry, beneficiary = dev wallet, startEmission = `block.timestamp`, endEmission = `block.timestamp + 180 days`. Fires from the deployer wallet right after the LP-lock step in the launch sequence. The UNCX dashboard URL gets captured for the launch tweets.

---

## 4. Tx-receipt comms: X + Telegram auto-poster

Each on-chain milestone gets a receipt tweet + TG message with the basescan link, fired automatically by Claude during the launch sequence. Format:

```
✅ LP seeded on @AerodromeFi

🟦 30,000 BRAWL paired with 0.5 ETH
🔗 Pair: basescan.org/address/0x…

next: locking the LP on @UNCX_token for 6 months.
```

**Receipt set** (10 receipts over the launch sequence):

| # | Trigger | Content |
|---|---|---|
| R1 | `BRAWL.deployTransaction` mined | "$BRAWL deployed at 0x… 100k fixed supply." |
| R2 | `Brawlers.deployTransaction` mined | "Brawlers NFT deployed at 0x…" |
| R3 | All game contracts deployed | "Duel + MintDrop + Graveyard + Marketplace live." |
| R4 | `addLiquidityETH` mined | "LP seeded on @AerodromeFi" + amounts |
| R5 | UNCX LP lock confirmed | "🔒 LP locked 6 months on @UNCX_token" + lock URL |
| R6 | UNCX team-token vest confirmed | "🔒 22,750 $BRAWL dev allocation vesting 6 months" + URL |
| R7 | `BRAWL.enableTrading()` | "⚔ TRADING OPEN. The arena is live." → triggers full launch thread 1/12 |
| R8 | All contracts verified on Basescan | "✅ contracts verified, source readable on @basescan" |
| R9 | `BRAWL.renounceOwnership()` (24-48h later) | "👑 ownership renounced. owner() = 0x0." |
| R10 | First duel mined post-launch | "first duel: #N beat #M. the arena's open for business." |

**Implementation:**

- `marketing/scripts/x/post-receipt.mjs` — wraps `tweet.mjs`, takes a receipt-name + tx hash + optional image. Loads pre-templated text from `marketing/content/launch-receipts/`. Already have `tweet.mjs` from this session.
- `marketing/scripts/tg/post-receipt.mjs` — posts the same content to `t.me/baseicbrawlers` via one of the existing bot tokens (`BB_TG_BOT_LEADERBOARD_TOKEN` is the least personality-tied; happy to use any). Telegram Bot API `sendMessage`.
- Both scripts read the tx hash from a flag or stdin; `script/Deploy.s.sol` and the lock scripts can pipe their `console2.log` output through a small parser that triggers each receipt.

`▶ I'll execute this`: write both poster scripts tonight + the launch-receipts templates. The full launch sequence becomes a single `bash script/launch-mainnet.sh` (or equivalent) that runs the forge scripts and fires each receipt as it goes.

`▶ Decision needed`: do you want a dedicated TG announce channel (`BB_TG_ANNOUNCE_CHANNEL_ID` is empty in secrets.env), or post to the main public group? If a dedicated channel, create one and paste the ID.

---

## 5. Dexscreener 100/100 + scanner red flag reduction

### Dexscreener token profile

Two paths to a full profile (logo, banner, description, socials):

1. **Free path:** Wait for CoinGecko to pick up the token, then Dexscreener auto-imports from CoinGecko. Slow — usually days post-listing.
2. **Paid path: "Enhanced Token Info"** — Dexscreener's self-serve product. Marketplace at https://marketplace.dexscreener.com. Submit logo, banner, description, links, and pay; profile activates within hours. Cost is per their pricing page (typically $300–$600 one-time for a single token).

`▶ Decision needed`: pay for Enhanced Token Info on launch day? My recommendation: **yes** — at launch you want every aggregator showing the brand polish, not a blank shell. Worth the one-time fee. If budget-constrained, skip and rely on CoinGecko (apply day 0 via https://www.coingecko.com/en/coins/new — free, takes ~48-72h).

`▶ I'll execute this`: prepare the asset bundle (logo 256x256 PNG from `marketing/art/main-pfp.png`, banner 1500x500 from `marketing/art/x-banner.png`, description matching the gitbook intro voice, socials list). When you give the green light, I submit the Dexscreener form + the CoinGecko listing simultaneously.

### Scanner red flags (Token Sniffer / GoPlus / Quick Intel)

Audit of BRAWL.sol against the most common flags:

| Flag | Current state | Fixable? | Action |
|---|---|---|---|
| **Mintable** | `_mint()` exists in OZ ERC20 (called once in constructor). Scanner detects it via bytecode analysis even though no public mint function exists. | Pre-deploy only, via override-and-revert pattern that breaks compilation. **Don't fix** — known false positive that informed traders see through after source verification. | accept |
| **Buy/Sell tax** | 0% / 0% | n/a — already clean | ✓ |
| **Honeypot** | No | n/a | ✓ |
| **Proxy contract** | No | n/a | ✓ |
| **Transfer pausable** | No (we have whitelist-gated `tradingEnabled` flag, but no `pause(transfers)`) | n/a | ✓ |
| **Owner can change balances** | No (no `setBalanceOf` or similar) | n/a | ✓ |
| **Hidden owner** | No (OZ Ownable, public) | n/a | ✓ |
| **Open source** | Yes (Basescan verification handles this) | n/a | ✓ post-verify |
| **Trading cooldown** | No | n/a | ✓ |
| **Has blacklist** | Yes (owner-only, with `reason` field). Scanner showed "No" in your screenshot — likely because the pattern doesn't match GoPlus's tax-related detection. | Leave as-is; it's the anti-sniper / anti-bot mechanism the trust.md chapter promises. | accept |
| **Has whitelist** | Yes (owner-only, for game-contract setup). Same situation as blacklist. | Leave as-is. | accept |
| **Ownership renounced** | "Unknown" → flips to "Yes" after `renounceOwnership()` 24-48h post-launch (playbook §16). | Post-launch, automatic. | ✓ scheduled |
| **Owner can lift limits** | Yes (`liftLimits()`). After renounce, this becomes uncallable too. | Post-renounce, automatic. | ✓ scheduled |

`▶ I'll execute this`: nothing to fix in the contract itself. The dominant scanner wins come from **(a) verifying the source on Basescan**, **(b) renouncing ownership within 48h** of trading enabling, **(c) the LP-lock receipt being visible on UNCX**, and **(d) having the Dexscreener / CoinGecko profile populated**. Tasks 1-4 of this doc all feed into the scanner score.

---

## 6. Decisions you need to make

Read top-to-bottom. None of these are urgent (launch is ~17h away) but each one drives a different script.

1. **LP lock path: A (UNCX 6 months) or B (burn to 0xdead)?**
   → My pick: A with 0.5 ETH LP-side instead of 0.075. → §2.
2. **Team token lock: 100% / 50% / 25%? Vest duration?**
   → My pick: 50% (22,750 BRAWL) over 6 months linear, no cliff. → §3.
3. **Telegram receipt channel: dedicated `#announcements` or main public group?**
   → My pick: dedicated channel — keeps the public group for chat, channel becomes the canonical "verify this address" reference. You'd create it + paste the ID into `BB_TG_ANNOUNCE_CHANNEL_ID`. → §4.
4. **Dexscreener Enhanced Token Info: pay (~$300-$600 one-time) on launch day, or rely on CoinGecko (slower but free)?**
   → My pick: pay. → §5.
5. **Final LP-side ETH amount** (the playbook says 0.075 ETH, my §2 recommendation bumps it to 0.5 ETH so the UNCX fee doesn't dominate).
6. **CountryCode for UNCX `lockLPToken`** — 36 (Australia) seems right. Confirm.

---

## 7. Launch-day execution sequence

This is what I'll run when you give the green light. Each step is fully scripted; no manual clicks.

```
T-30min  Pre-flight: forge test pass, .env.base-mainnet populated,
         deployer wallet funded (LP ETH + UNCX fees + gas reserve).

T+0      `forge script Deploy.s.sol --broadcast` — deploys all 6 contracts.
         R1, R2, R3 receipts fire as each contract confirms.

T+5min   `forge script SeedAndLockLP.s.sol --broadcast` — addLiquidityETH
         + UNCX LP lock. R4, R5 fire.

T+10min  `forge script LockTeamTokens.s.sol --broadcast` — UNCX vesting
         for the 22,750 BRAWL. R6 fires.

T+15min  `forge script EnableTrading.s.sol --broadcast` — calls
         BRAWL.enableTrading() + whitelists Duel/Graveyard/MintDrop.
         R7 fires (the BIG one — triggers the full 12-tweet launch
         thread on @BASEicBrawlers, plus TG announcement).

T+30min  Contracts verified on Basescan via forge verify-contract.
         R8 fires.

T+24-48h `forge script RenounceOwnership.s.sol --broadcast` — flips
         the brawl token owner to 0x0 after the anti-sniper window
         settles. R9 fires.
```

Each receipt is queued in `marketing/scripts/launch-receipts/` with the on-chain values templated in at fire time.

---

## 8. Open items before deploy

These are the gaps I cannot close from a script alone — most are decisions or external setups:

| | Item | Owner | Blocker for? |
|---|---|---|---|
| 1 | Decisions 1-6 from §6 | Darren | Everything |
| 2 | `BB_DEV_TREASURY_ADDRESS` filled in secrets.env (currently `<paste-when-known>`) | Darren | Deploy.s.sol team-token routing |
| 3 | `BB_KEEPER_ADDRESS` / `BB_KEEPER_KEY` generated + filled (currently `<paste-when-generated>`). Or, per CLAUDE.md, collapse keeper into dev wallet. | Darren | Deploy.s.sol keeper setup |
| 4 | Deployer wallet funded: LP ETH (per §2 decision) + 0.15 ETH UNCX fees + 0.05 ETH gas reserve | Darren | Launch |
| 5 | Public GitHub repo flip (the contracts NatSpec now links `github.com/baseicbrawlers/baseic-brawlers`; private repo 404s for scanner visitors) | Darren — flip at launch | Basescan source-trust signal |
| 6 | Bug-bounty / disclosure email (`security@baseicbrawlers.com`) set up so the contracts can carry a `@custom:security-contact` tag (optional but adds polish) | Darren | nice-to-have |
| 7 | `BB_TG_ANNOUNCE_CHANNEL_ID` set if you create a dedicated channel | Darren | TG receipts (§4) |
| 8 | Dexscreener Enhanced Token Info payment (if §6.4 = yes) | Darren | Day-0 profile completeness |
| 9 | Final go/no-go from Darren | Darren | All scripts |

---

## 9. What I'll have ready when you wake

All scripted, none executed:

- `script/SeedAndLockLP.s.sol` — updated to V2.1 signature (adds `countryCode`).
- `script/LockTeamTokens.s.sol` — new, calls UNCX V2 Token Vesting `lock()`.
- `script/EnableTrading.s.sol` — separate from Deploy.s.sol so the gap between deploy + trading-on is deliberate (LP-lock + team-lock happen in between).
- `script/RenounceOwnership.s.sol` — separate, run 24-48h post-launch.
- `marketing/scripts/x/post-receipt.mjs` — fires a templated receipt tweet for any of R1-R10.
- `marketing/scripts/tg/post-receipt.mjs` — same content to the configured TG target.
- `marketing/content/launch-receipts/R1..R10.txt` — the 10 templates.
- `script/launch-mainnet.sh` — orchestrates the whole sequence.

Nothing fires live until you say "ship it" tomorrow.
