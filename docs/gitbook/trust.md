# Trust signals

i'm one person building this. that's the charm and the limit. so let's be specific about what i can and can't do to your money once you've minted.

this chapter is the unsexy part. read it anyway.

## the brawl token: ownership renounced

the brawl ERC-20 launched with two safety nets:

- **1% max wallet**: no single wallet can hold more than 1,000 brawl (1% of 100k supply).
- **0.5% max tx**: no single trade can move more than 500 brawl.

these were anti-sniper limits. block 0 of trading is bot territory. the limits stopped any one bot from front-running everyone and dumping into the pool.

**24-48 hours after launch settled**, the dev called `renounceOwnership()` on the brawl contract. from that point:
- nobody can change the limits ever again
- nobody can mint new brawl
- nobody can blacklist or whitelist anyone
- nobody can pause trading

the token is a true fixed-supply ERC-20 with zero admin functions. verify on basescan: `owner()` returns the zero address.

## LP locked for 6 months on unicrypt

at launch, the brawl/eth liquidity pool was seeded on aerodrome and the LP token was immediately deposited into [unicrypt](https://app.uncx.network) for **6 months**.

while the lock is active, nobody can pull the liquidity. not the dev, not anyone. the lock URL is in #links on the discord. anyone can verify on-chain.

when the 6-month lock expires, the LP token releases back to the dev wallet. the dev's options at that point are: re-lock for another period, migrate the pool, or pull liquidity. i'll be transparent about which one and why when the time comes.

## game contracts stay dev-controlled (intentionally)

the **duel**, **mintdrop**, **graveyard**, and **marketplace** contracts stay owned by the dev wallet. that's deliberate.

these are *game* contracts. they need ongoing tuning:
- fight cost calibration as brawl price moves
- mint price tweaks if a tier sells out and the meta needs adjusting
- marketplace fee changes if competitive forces it
- pause / unpause if a bug appears (escape hatch)

what these contracts can NOT do:
- mint brawl (locked off behind the renounced ERC-20)
- drain the LP (locked on unicrypt)
- take user funds beyond the documented fight stakes, mint prices, and marketplace fees
- transfer your nfts without your approval

the difference between **game tuning** and **rug capability** matters. you should know which is which.

## no team allocation, no presale, no vc round

100,000 brawl supply, transparent split:

- **initial LP**: 50,000 brawl + ~$200 eth, paired on Aerodrome v2 and the LP token burned to `0xdead`. permanent. no team unlock, no rug path.
- **team vault**: 20,000 brawl locked on UNCX V2 token vesting. 6-month linear vest, no cliff, single beneficiary = dev wallet. verifiable on app.uncx.network.
- **auto-fight keeper wallet**: 20,000 brawl held by the keeper EOA. used as the per-fight stake float for the 10 house brawlers + as fightCost dust. recycles through duels (winner gets the pot back), doesn't deplete.
- **dev / ops / season prizes**: 10,000 brawl on the dev wallet. ops budget for infra, future seasons, partnerships. no contract enforcement on this slice — trust-based.
- **MintDrop airdrop pool**: 0 brawl. the per-mint and founder airdrop bonuses were both dropped at launch to keep allocation lean. founders keep the free first revive + 25% fight discount + free Tier-1 mint; players don't get BRAWL on mint.

that's 100,000 brawl total. no presale, no team cliff hidden anywhere. 70% of supply is either burned (LP) or locked (team vault) at launch. the remaining 30% is auto-fight float + ops budget.

this isn't a token where the team holds half. there's no vesting cliff to fear. there's also no "team's gonna sell" clock, because there isn't a team in the institutional sense. just me.

## what you should keep an eye on

- **basescan** the brawl token contract: confirm `owner()` returns `0x0`.
- **the unicrypt lock URL** (in #links on the discord).
- **the dev wallet** on basescan: any large brawl transfer out is worth a question.
- **#announcements** in discord for upgrades or major changes.

if i ever do something sketchy, the on-chain receipts will be public within seconds. that's the only enforcement i can really offer. but it's better than nothing, and it's better than most projects.

## scope, honestly

this is a small solo build. that's the appeal. it's also the constraint.

- there's no paid security audit. solidity tests cover the core flows (duel signing, mint hash, marketplace approvals, resurrection math). they're not the same as a paid audit.
- there's no team to escalate to if i get hit by a bus. the dev wallet is one EOA. a 2-of-3 gnosis safe migration is on the roadmap.
- there's no rapid response to discord drama. if you have a real bug, post in #bug-reports with repro steps. i'll get to it.

basically don't put more in than you can lose. that's true of every crypto thing. it's especially true here.
