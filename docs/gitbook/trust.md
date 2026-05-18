# Trust signals

i'm one person building this. that's the charm and the limit. so let's be specific about what i can and can't do to your money once you've minted.

this chapter is the unsexy part. read it anyway.

## the brawl token: ownership renounced

the brawl ERC-20 launched with two safety nets:

- **1% max wallet**: no single wallet can hold more than 1,000 brawl (1% of 100k supply).
- **0.5% max tx**: no single trade can move more than 500 brawl.

these were anti-sniper limits. block 0 of trading is bot territory. the limits stopped any one bot from front-running everyone and dumping into the pool.

**shortly after the deploy** (once the launch volatility settles), the dev will call `renounceOwnership()` on the brawl contract. from that point on:
- nobody can change the limits ever again
- nobody can mint new brawl
- nobody can blacklist or whitelist anyone
- nobody can pause trading

the token becomes a true fixed-supply ERC-20 with zero admin functions. verify on basescan: `owner()` returns the zero address.

## LP burned to 0xdead

at launch, the brawl/eth liquidity pool was seeded on aerodrome v2 and **the LP tokens were sent straight to `0x000...dEaD`**. permanent. the LP can never be pulled, full stop. no lock to renew, no unlock date, no "what happens later" question.

verify on-chain: the LP token contract for the brawl/eth aerodrome pair shows `0x000...dEaD` holding the entire LP supply (or close to it, modulo any swap fees that accrue back into the pool and don't tokenize). that address has no private key. nobody can withdraw.

## game contracts stay dev-controlled (intentionally)

the **duel**, **duelrouter**, **mintdrop**, **graveyard**, **marketplace**, and **brawlers** contracts stay owned by the dev wallet. that's deliberate, and it's separate from the brawl-token renouncement.

these are *game* contracts. they need ongoing tuning:
- **fight cost** calibration as brawl/eth prices move (the keeper bot repegs to $1 USD automatically)
- **resurrect cost** calibration (the keeper bot repegs to $100 base, capped at $500 per single revive)
- **mint price** tweaks if a tier sells out and the meta needs adjusting
- **marketplace fee** changes if competitive forces it (currently 7.5%, hard-capped at 10% in the contract)
- **pause / unpause** if a bug appears (escape hatch)

what these contracts can NOT do:
- mint brawl (locked off behind the renounced ERC-20)
- drain the LP (burned to `0xdead`, no key, no recovery)
- take user funds beyond the documented fight stakes, mint prices, marketplace fees, and resurrect costs
- transfer your nfts without your approval

the difference between **game tuning** and **rug capability** matters. you should know which is which.

## per-revive cap

even with a high-rarity king at 10+ wins, the resurrection formula (`base × tierMult × (10+wins)/100`) is **capped at $500 per single revive** by `Graveyard.resurrectionCap` (default 0.125 ETH). this stops the late-game from pricing out players entirely. the cap is dev-settable and the resurrect-cost-keeper bot mirrors it to USD as ETH price drifts, so $500 stays $500.

## no presale, no vc round, team tokens locked

100,000 brawl supply, transparent split:

- **initial LP**: 50,000 brawl + ~$200 eth, paired on Aerodrome v2 and the LP token burned to `0xdead`. permanent. no team unlock, no rug path.
- **team vault**: 20,000 brawl locked in our own `BRAWLTimelock` contract at [`0xdD4Fda3AED746E81481d58958e6E8c6D2e7cC761`](https://basescan.org/address/0xdD4Fda3AED746E81481d58958e6E8c6D2e7cC761#code). 6-month linear vest, no cliff, immutable beneficiary = dev wallet. no admin function, no owner, no escape hatch. anyone can call `release()` to push the vested portion to the beneficiary. live countdown + on-chain stats at [baseicbrawlers.com/lock](https://baseicbrawlers.com/lock).
- **auto-fight keeper wallet**: 20,000 brawl held by the keeper EOA. used as the per-fight stake float for the 10 house brawlers + as fightCost dust. recycles through duels (winner gets the pot back), doesn't deplete.
- **dev / ops / season prizes**: 10,000 brawl on the dev wallet. ops budget for infra, future seasons, partnerships. no contract enforcement on this slice — trust-based.
- **MintDrop airdrop pool**: 0 brawl. the per-mint and founder airdrop bonuses were both dropped at launch to keep allocation lean. founders keep the free first revive + 25% fight discount + free Tier-1 mint; players don't get BRAWL on mint.

that's 100,000 brawl total. no presale, no team cliff hidden anywhere. 70% of supply is either burned (LP) or locked (team vault) at launch. the remaining 30% is auto-fight float + ops budget.

this isn't a token where the team holds half. there's no vesting cliff to fear. there's also no "team's gonna sell" clock, because there isn't a team in the institutional sense. just me.

## what you should keep an eye on

- **basescan** the brawl token contract: confirm `owner()` returns `0x0`.
- **the LP burn address** on basescan: `0x000000000000000000000000000000000000dEaD` holding the brawl/eth pair tokens. anyone can verify.
- **the team-lock contract**: visit [baseicbrawlers.com/lock](https://baseicbrawlers.com/lock) for the live countdown, or read the [80-line source on basescan](https://basescan.org/address/0xdD4Fda3AED746E81481d58958e6E8c6D2e7cC761#code).
- **the dev wallet** on basescan: any large brawl transfer out is worth a question (note: the 20k team allocation has already left the dev wallet for the timelock — that transfer is the expected one).
- **#announcements** in discord for upgrades or major changes.

if i ever do something sketchy, the on-chain receipts will be public within seconds. that's the only enforcement i can really offer. but it's better than nothing, and it's better than most projects.

## scope, honestly

this is a small solo build. that's the appeal. it's also the constraint.

- there's no paid security audit. solidity tests cover the core flows (duel signing, mint hash, marketplace approvals, resurrection math). they're not the same as a paid audit.
- there's no team to escalate to if i get hit by a bus. the dev wallet is one EOA. a 2-of-3 gnosis safe migration is on the roadmap.
- there's no rapid response to discord drama. if you have a real bug, post in #bug-reports with repro steps. i'll get to it.

basically don't put more in than you can lose. that's true of every crypto thing. it's especially true here.
