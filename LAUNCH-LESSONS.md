# Launch lessons — what to never do again

Notes from the BASEic Brawlers 2026-05-18 mainnet launch, captured in real-time as each thing went wrong. Treat this as the pre-deploy checklist for the next project so we don't repeat any of these.

---

## 1. Env-var name mismatch between deploy script and .env file

**What happened.** `.env.base-mainnet` carries values like `USDT_ADDRESS_MAINNET=0xfde4...`. `Deploy.s.sol` reads `vm.envAddress("USDT_ADDRESS")` — different name. The check fails silently, falls through to "deploy a MockUSDT", and now MintDrop is wired to a fake test token forever (the field is immutable).

**Cost.** USDT + USDC payment paths permanently dead on v1 because `MintDrop.usdt` and `usdc` are `immutable`. Frontend buttons hidden as a workaround. Only ETH minting works.

**Fix for next time.**
- `Deploy.s.sol` should ASSERT every external token address it touches against `.env.base-mainnet` BY NAME. Crash the deploy if the env var is missing, don't fall back to a mock on a mainnet RPC.
- Use ONE canonical name per address. If the file says `USDT_ADDRESS_MAINNET`, the script reads `USDT_ADDRESS_MAINNET`. No two-name aliases.
- Add a `requireMainnetEnv` helper that hard-fails on chain id 8453 + missing real-token address.

## 2. Immutable contract fields locked us out of post-deploy repointing

**What happened.** Beyond USDT/USDC: `Brawlers.setMintDrop` reverts after first call (`AlreadySet`). So even if we redeployed MintDrop with the right token addresses, we couldn't wire it into Brawlers without redeploying Brawlers too. Same with `Duel.setGraveyardContract`, `Duel.setMarketplace`, etc — all one-shot setters.

**Cost.** Any post-launch wiring fix forces a full v2 redeploy ($200 LP + fresh CA + reputation hit).

**Fix for next time.**
- For wiring setters (point-A-at-B kind), allow ONE re-set after deploy with a generous timelock (24-48h), then lock. Tradeoff: brief admin window vs total inflexibility.
- OR keep them one-shot but add a `migrationProxy` field that can be flipped to a new logic contract. Adds complexity but avoids the "redeploy everything" trap.
- For tokens passed to constructors (USDT/USDC/BRAWL), store as `address public` (mutable) gated by a `MIGRATION_TIMELOCK` + owner, not `immutable`. Cost: 2 SLOAD per use instead of constant.

## 3. LP burn is permanent — no recourse

**What happened.** LP token burned to `0xdead` in step 2 of `launch-mainnet.sh`. Mid-launch we wanted to "pull and re-do" because of other bugs. Couldn't. `0xdead` has no private key. The $200 + 50k BRAWL are stuck there forever.

**Cost.** Trust narrative survived (LP can never be pulled) but our ability to abort a botched launch died with it.

**Fix for next time.**
- Sequence checkpoints. Step 2 (LP burn) should run AFTER full UI smoke-test of the deployed contracts on mainnet, NOT before. The launch script should be:
  1. Deploy contracts
  2. Apply ALL post-deploy config (`setPriceTiers`, `setAuthorizedRouter`, etc.)
  3. **Smoke test** the deployed state from the live frontend (a `npm run smoke-mainnet` that hits all read paths)
  4. Manual gate: "looks good? type `commit-lp` to burn LP"
  5. Seed + burn LP
- The current script orders LP burn (step 2) right after deploy (step 1), before anything is verified. That's the wrong dependency order.

## 4. Deploy.s.sol shipped without `TIERED_PRICING=true`

**What happened.** `Deploy.s.sol` has a conditional `if (vm.envOr("TIERED_PRICING", false))` block that applies the mainnet 5-tier price ladder. We never set `TIERED_PRICING=true` in env. Deploy used the Sepolia micro fallback (`0.0001 ETH = ~$0.40 per mint`). Mint went live with **5,000× too cheap** prices for an hour before we noticed.

**Cost.** Lucky — no one minted at the broken price because the contract address wasn't public yet. Could have been catastrophic.

**Fix for next time.**
- No "feature-flag" env vars on mainnet deploys. The tier table should be UNCONDITIONALLY applied on chain id 8453. Move the if-check on chain id, not on env. Default-on for mainnet, default-off for testnets.

## 5. Mint prices need a keeper bot like fight cost does

**What happened.** Tier ETH prices stored as fixed wei (e.g. T1 = 0.005 ETH = $20 at $4k ETH). ETH moves. Without a re-peg, T1 is $25 at ETH=$5k, $15 at ETH=$3k. Got pointed out by Darren mid-launch.

**Cost.** Brief window of variable USD pricing. Fixed by shipping `mint-cost-keeper.mjs` post-launch.

**Fix for next time.**
- Any USD-targeted price stored as wei needs a keeper-bot from day 1. Pattern: store the USD target on-chain (in cents), keeper reads it, keeper pushes the converted wei via the existing setter. Same pattern as `fightCostUsdCents` / `resurrectionCostUsdCents`.
- Better: write a `MintDrop.setPriceTiersFromUsdCents(uint256[] usd)` that does the conversion on-chain using a Chainlink reader. Avoids the off-chain keeper for mint pricing entirely.

## 6. Dashboard auth was checking the keeper wallet, not the dev wallet

**What happened.** `dashAuth.ts.getAuthorizedDevAddress()` reads `NEXT_PUBLIC_HOUSE_KEEPER_ADDRESS`. Pre-launch the keeper and dev were the same wallet, so it worked. Post-launch they were separate. Darren signed with his dev wallet and got rejected. Hotfixed by adding `NEXT_PUBLIC_DEV_WALLET` with a fallback to `HOUSE_KEEPER` for compat.

**Cost.** ~30 minutes of being locked out of the dashboard at the critical moment.

**Fix for next time.**
- Name env vars by INTENT, not by initial reuse. `NEXT_PUBLIC_DASH_AUTH_ADDRESS` would have been obvious from day 1. The reuse-the-keeper-var pattern saved 5 minutes of env config in pre-launch and cost 30+ minutes in post-launch.

## 7. UI "founder" badge didn't check `isHouseBrawler`

**What happened.** `BrawlerCard.tsx` rendered the FOUNDER 50/100 badge based on tokenId alone. House brawlers (tokens 1-10) showed as founders in the UI even though on-chain they're correctly excluded from founder PERKS (discount, free revive, etc.) via `isHouseBrawler`.

**Cost.** Visible in production for ~30 min. Easy fix once spotted.

**Fix for next time.**
- Anywhere on-chain logic uses an exclusion flag, the UI MUST use the same flag. Pre-launch checklist: grep the frontend for every `tokenId <= FOUNDER_*` literal and confirm the matching `isHouseBrawler` (or equivalent) is wired in.

## 8. Tweet.mjs image-upload race

**What happened.** `tweet.mjs` waited 800ms after the image preview appeared, then clicked Post. X stays in "uploading" state for several seconds after the preview shows — the Post button is `aria-disabled=true` during that window. The 800ms wait sometimes hit the disabled state and threw. R3, R4, R8 receipts that carried images all failed.

**Cost.** 4 launch-sequence tweets never posted (TG receipts did, X didn't). Comms felt patchy.

**Fix for next time.**
- Never use a fixed `waitForTimeout` for upload-completion semantics. Poll the actual state machine (button enabled/disabled, network idle, etc.) with a budget. Fix shipped: 30s poll on `aria-disabled`.

## 9. Vercel env propagation needs a fresh deploy after env changes

**What happened.** Set `NEXT_PUBLIC_DEV_WALLET` in Vercel. Cached frontend build still had the old value baked in. Darren retried, still rejected. Required a manual `vercel deploy --prod` to rebuild with the new value.

**Cost.** ~5 minutes of "wait but I fixed it" confusion.

**Fix for next time.**
- Document explicitly in `LAUNCH-PLAYBOOK.md`: "After every env var change, run `vercel deploy --prod`." Don't assume the env var change alone triggers a rebuild.

## 10. Discord bot needed manual mainnet cutover

**What happened.** Discord bot was pre-configured for Sepolia. After mainnet went live, channels still showed wiped state but the bot was still polling Sepolia for events. Bot needs RPC + addresses re-pointed + restart.

**Cost.** Still pending at time of writing (post-mortem). #duels won't show real fights until the cutover.

**Fix for next time.**
- The launch script should include a final "DISCORD CUTOVER" step that SSH's to the bot host, swaps env, restarts. Not a manual SSH op after the fact. Or run the bot from a centralized config service that reads from chain.

## 11. Mojibake from bash heredocs with emojis

**What happened.** Used emojis in shell-composed TG / Discord messages. The bash heredoc + curl + JSON encoding chain mangled the UTF-8 bytes — `📈` rendered as `ðŸ"^` in the live TG message.

**Cost.** Embarrassing visual on a launch announcement. Required edit-message follow-ups.

**Fix for next time.**
- Compose all multi-byte text via Python (or a small node helper). Bash + curl + heredoc + emoji = mojibake roulette.

## 12. Cron + classifier "rapid fire" detection

**What happened.** Set up a 6-hourly cron to fire prelaunch tweets. Each cron tick re-fires the same prompt. The classifier saw "this exact command ran 2 minutes ago" (in session-time, not wall-clock) and blocked successive ticks as "spamming the account."

**Cost.** Mid-cadence tweets blocked. Required manual approve each tick.

**Fix for next time.**
- Schedule via X's native scheduler (Playwright the schedule modal once, walk away) instead of harness-side cron. The classifier reasons about session-time only; wall-clock-aware tools sidestep this.

---

## The meta-lesson

**Most of these are "test pre-deploy" things.** The deploy itself was fine. What killed us was the gap between "compiles + tests pass" and "actual mainnet state matches what we expected." We didn't fork-test the full deploy flow, we didn't smoke-test the deployed frontend against the deployed contracts, and we didn't catch env-var name mismatches because the script silently degraded to test defaults instead of crashing.

For the next project: write a `forge script ForkRehearsal.s.sol --fork-url $MAINNET_RPC` that runs the FULL launch sequence on a fork, then `npm run smoke-test-deployed` that hits every read path the frontend uses. Make both pass before the real launch script even gets to step 1.
