# Key holders

a transparent breakdown of who holds $BRAWL, what each large wallet does, and which ones can't be touched. if you ever see a top-holder concentration screenshot and worry it's centralised, this page is the receipt.

## the headline

**100,000 total $BRAWL supply. fixed. owner renounced. no more can ever be minted.**

of that 100k:
- **~20% is permanently locked** in the team timelock (6-month linear vest, no admin, no escape hatch)
- **~20% is in the burned LP** (LP tokens sent to `0xdead`, can't be withdrawn ever)
- **~20% is the keeper float** (ops wallet for the house brawlers + arena auto-fights, recycles through duels)
- **~10% is the dev wallet** (ops + future seasons + partnerships)
- **~30% is in players' hands** (everything bought on aerodrome since launch)

so when you see the top-10 holders chart and the top 4 wallets each hold 10-20%, it's NOT four insiders. it's the timelock, the burned LP, the keeper, and the dev wallet. three of those four are either contract-locked or physically can't move tokens.

## the address list

every large $BRAWL holder, what it is, and how to verify:

| role | address | balance | can it sell? |
|------|---------|---------|--------------|
| 🔒 **team vault timelock** | [`0xdD4F...C761`](https://basescan.org/address/0xdD4Fda3AED746E81481d58958e6E8c6D2e7cC761#code) | 20,000 BRAWL | only releases linearly over 6 months to dev wallet (beneficiary is immutable). live countdown at [/lock](https://baseicbrawlers.com/lock) |
| 🏟️ **BRAWL/ETH aerodrome pair** | [`0xf99F...e3c`](https://basescan.org/address/0xf99F374AC9479BC8E224d5E56e3e815B6cc48e3c) | ~19,700 BRAWL | only via swaps. the LP tokens that represent ownership of this pool were burned to `0xdead` at launch — nobody can call `removeLiquidity()` ever |
| ⚙️ **keeper (game ops)** | [`0x6137...c04E`](https://basescan.org/address/0x613794Dc02cc1a9f29Fbbdc8C5A82d08162bc04E) | ~19,500 BRAWL | controlled by the dev, used as stake float for the 10 house brawlers + arena auto-fights. recycles through duels (winners get the BRAWL back into the pool), doesn't drain. no on-chain lock — trust-based |
| 👤 **dev wallet** | [`0x5b1A...6805`](https://basescan.org/address/0x5b1A749cc7bF1dE8ecA505769BD34Ba65f456805) | ~10,100 BRAWL | dev's wallet for ops, marketing, future season prizes. no on-chain lock — trust-based. any large transfer out shows on basescan within a block |
| 💀 **0xdead (LP burn target)** | [`0x000...dEaD`](https://basescan.org/address/0x000000000000000000000000000000000000dEaD) | holds the **LP tokens**, not BRAWL | the receipt tokens for the aerodrome pool. no private key. permanent. this is why the LP can never be pulled |

## what each address physically CAN'T do

let's be specific about the on-chain enforcement.

### the timelock (20k)
- **can't sell now**: the [`BRAWLTimelock` contract](https://basescan.org/address/0xdD4Fda3AED746E81481d58958e6E8c6D2e7cC761#code) only releases tokens linearly across 6 months. anyone (you, me, a random redditor) can call `release()` — it just pushes the currently-vested portion to the beneficiary.
- **beneficiary can't be changed**: the `beneficiary` field is `immutable` in the constructor. no setter exists. read the source.
- **can't be sped up**: the `startTimestamp`, `cliffSeconds`, and `durationSeconds` are also all `immutable`. no admin function, no upgrade path, no proxy.
- **no owner**: the contract has no `Ownable` import. zero admin functions exist in the bytecode.

### the LP pair (~19.7k BRAWL, plus paired ETH)
- **can't be pulled**: the LP token representing ownership was sent to `0x000...dEaD` immediately after seeding. no key. permanent.
- **can only change via swaps**: as people trade BRAWL ↔ ETH on aerodrome, the ratio inside the pool shifts. that's normal AMM behaviour. fees from each swap accrue back to the pool, so the underlying value tends to grow slowly.

### the keeper (~19.5k)
- this is operational — it stakes BRAWL when a house brawler fights, gets it back if the house wins, loses it if the house loses. over time the keeper's BRAWL float should stay roughly constant since house brawlers play to about 50% win rate.
- **no contract lock** on this. if you don't trust the dev to keep using it as ops float, treat it as part of the dev allocation.

### the dev wallet (~10k)
- **no contract lock**. trust-based. the dev intends to use this for ongoing development costs, marketing, future season prize pools, and partnerships.
- any movement is public on basescan. if you see a large transfer to a CEX, that's a signal.

## what about the top wallet on the chart?

if you check dexscreener or a top-holders view, you might see a single wallet at 21% that's NOT in the table above. that's almost always:

- an early buyer who aped a lot at sub-$10k mcap
- a market maker accumulating
- a re-distributor wallet that bought and is reselling small

it's NOT controlled by the dev. if you want to know whose wallet it is, check basescan and follow the transfers. if it bought on aerodrome via swap, it's a real buyer.

## the math

| category | amount | % of supply | status |
|----------|--------|-------------|--------|
| timelock | 20,000 | 20% | locked 6mo |
| LP (pool side) | ~19,700 | ~20% | LP burned, only swap-accessible |
| keeper | ~19,500 | ~20% | game ops, trust-based |
| dev | ~10,100 | ~10% | dev ops, trust-based |
| **non-circulating (locked or operational)** | **~69,300** | **~69%** | |
| **circulating (player-held)** | **~30,700** | **~31%** | |
| **total** | **100,000** | **100%** | fixed forever |

(numbers float a bit as the keeper and LP transact. timelock is exactly 20,000 until 6 months from launch, when linear vesting starts releasing.)

## verifying any of this yourself

every claim on this page is on-chain:

1. **total supply is 100,000**: read `BRAWL.totalSupply()` on basescan.
2. **owner is `0x0`**: read `BRAWL.owner()` on basescan. expect `0x000...0000`.
3. **timelock holds 20k**: read `BRAWL.balanceOf(0xdD4F...C761)` on basescan, divide by 1e18.
4. **timelock has no owner**: read the [contract source](https://basescan.org/address/0xdD4Fda3AED746E81481d58958e6E8c6D2e7cC761#code), search for `Ownable` — not there.
5. **LP burned**: find the LP token contract for the aerodrome BRAWL/ETH pair, read its `balanceOf(0x000...dEaD)`. expect it to hold the full LP token supply (modulo any accrued fee LPs).

if anything on this page doesn't match what you see on basescan, **the on-chain truth wins** — and tell me in [#bug-reports](https://discord.gg/RjvBEA5CVd) so i can fix the page.

## tl;dr for the scroll-past reader

- 100k fixed supply, owner renounced, no more BRAWL can ever exist.
- ~69% is either locked, burned, or operational ops float.
- ~31% is in players' hands.
- the timelock is bytecode-immutable. the LP is bytecode-burned. that's two of the top four wallets neutralised forever.
- the dev wallet + keeper aren't locked but every move is visible on basescan in real time.
