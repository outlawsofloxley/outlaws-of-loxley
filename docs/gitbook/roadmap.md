# Roadmap

this is a wishlist, not a contract.

dates here are intentionally vague. the project is one person on one keyboard. things shift, things get re-prioritised, things get cut entirely. the contracts that are live today are the contracts that are live today, and they don't depend on any of this stuff shipping. if nothing below ever happens, the game still works.

what you see below is what i'd like to build next, ordered by how close to "i'm actually working on this" each item is. if you want something not on this list, post in `#suggestions` on discord.

## shipped

these are live on mainnet right now:

- **2,000 brawlers + 1 king**, minted via `MintDrop` at $20 → $50 across 6 tiers. usd-pegged via the chainlink eth/usd feed + a keeper bot.
- **1v1 duels** with stakes payable in $BRAWL or ETH. winner takes 90% of pot, dev 10%, ties refund both sides.
- **10 house brawlers** (token IDs 1-10) on the keeper EOA, auto-fight whenever a player queues up — guarantees there's always someone to duel.
- **graveyard + resurrection** at $100 base, capped at $500, tier-multiplier scaled, usd-pegged via keeper.
- **on-chain marketplace** with 7.5% fee, hard-capped at 10%, pause function exists for emergency only.
- **$BRAWL token** with:
  - ownership **renounced** (`owner()` returns `0x0`)
  - launch limits **lifted** (no max wallet, no max tx)
  - LP **burned to 0xdead** at launch (permanent, no key)
  - no buy/sell tax (none ever existed)
- **20,000 BRAWL team-token lock** in our own `BRAWLTimelock` contract. 6-month linear vest, immutable beneficiary, no admin function. countdown at [/lock](https://baseicbrawlers.com/lock).
- **dev dashboard** at /dash for live economics + tunable settings.
- **discord bot** posting duel results, deaths, sales, listings live.

## now

actively being designed or written, no shipping date promised:

- **2v2 team duels**. two brawlers per side, summed stats determine the fight roll. winner team splits the pot. losers risk death same as 1v1. probably a new `TeamDuel.sol` contract that wraps the existing Duel result logic.
- **weapons shop**. right now every brawler ships with a weapon rolled at mint (immutable to the token). the shop would let you buy a separate weapon as a tradeable item, then equip it on any brawler you own. likely separate `WeaponShop.sol` + `Weapons` ERC-1155 contract so weapons can be listed on the existing marketplace.

## next

planned, will start when "now" items wrap:

- **5v5 team duels**. extension of the 2v2 contract once balance is proven. bigger pots, longer rolls, more interesting strategy around composition.
- **tournament brackets**. sign-up window, single-elimination, prize pool funded by entry fees + an optional dev top-up. probably weekly or biweekly. winner gets the pot, top 3 get title NFTs.
- **ranked seasons** with leaderboard resets every ~90 days. season trophies (cosmetic NFTs) for top finishers.
- **mobile UX polish**. the site works on mobile but it isn't great. better wallet flow, better duel page, better marketplace browsing.

## later

on the wishlist, will build when "next" items wrap:

- **2-of-3 gnosis safe** for the dev wallet. currently a single EOA. multisig migration de-risks the trust-based 10k dev allocation + the keeper bot ownership.
- **weapon crafting**. combine N weapons → 1 rarer weapon. burns inputs. opens up an economy around rolling for high-tier gear.
- **spectator side-bets**. let non-owners stake $BRAWL on the outcome of a queued duel. spectator pot pays out alongside the fighter pot. needs careful design to avoid manipulation.
- **guilds**. on-chain teams of N brawlers that share an ELO pool. captains can recruit. guild-vs-guild fights for status.

## maybe

might happen if there's demand, won't be sad if it doesn't:

- **new brawler waves** beyond the 2,000 + king. would be a separate collection with its own contract, very loud announcement, no "surprise mint." current `Brawlers` contract has a hard cap, so anything new is provably additive.
- **cross-chain bridge** (BSC, Arbitrum, etc). only if base congestion ever becomes a real problem. currently base gas is cheap enough that this isn't a priority.
- **partner game crossovers**. brawlers showing up in other base games or vice versa. interesting but only if the partner is solid.

## won't do

these are off the table by design. they're listed so the boundary is clear:

- **no new $BRAWL mint**, ever. the token has no `mint()` function. supply is fixed at 100,000 forever.
- **no presale / no VC round**. already past launch, but for the record.
- **no "buy your way out of death" with cash**. resurrection costs ETH that goes to the dev treasury, you don't get a discount for spending USD off-chain.
- **no centralised escape hatch** on $BRAWL. ownership is renounced. there's no admin to email.
- **no rugpull-by-keeper-bot**. the keeper has permission only to call `setFightEconomics` + `setResurrectionCost` (re-pegging USD targets). it cannot move user funds, mint, pause, or upgrade.

---

if any of this excites you, you're in the right place. if none of it does, the game still works just fine on the 1v1 mechanics that are live today. either way, GM brawlers.
