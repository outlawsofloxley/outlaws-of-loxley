# Trust signals

i'm one person building this. that's the charm and the limit. so let's be specific about what i can and can't do to your money once you've minted.

this chapter is the unsexy part. read it anyway.

## the brawl token: ownership renounced after launch settles

the brawl ERC-20 launches with two safety nets:

- **1% max wallet**: no single wallet can hold more than 1,000 brawl (1% of 100k supply).
- **0.5% max tx**: no single trade can move more than 500 brawl.

these are anti-sniper limits. block 0 of trading is bot territory. the limits stop one bot from front-running everyone and dumping into the pool.

**about 24-48 hours after launch settles**, the dev calls `renounceOwnership()` on the brawl contract. from that point:
- nobody can change the limits ever again
- nobody can mint new brawl
- nobody can blacklist or whitelist anyone
- nobody can pause trading

the token becomes a true fixed-supply ERC-20 with zero admin functions. you can verify on basescan once it's done, the `owner()` function returns the zero address.

## LP locked for 6 months on unicrypt

when the brawl/eth liquidity pool gets seeded on aerodrome at launch, the LP token is immediately deposited into [unicrypt](https://app.uncx.network) for **6 months**.

while the lock is active, nobody can pull the liquidity. not the dev, not anyone. the lock URL gets posted in #links on discord on launch day. anyone can verify on-chain.

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

- **initial LP seed**: 2,500 brawl + ~$500 eth, paired and locked.
- **auto-paired into LP via mintdrop**: 50,000 brawl. as people mint, brawl drips into the LP at a calibrated rate. the more public mints, the deeper the liquidity.
- **founder airdrops**: 2,000 brawl total. distributed automatically to the first 100 minters (20 each, on top of the standard 50 mint airdrop = 70 brawl per founder).
- **dev / treasury / season prizes**: 45,500 brawl on the dev wallet. trust-based reserve for future seasons, partnerships, prize pools, and ongoing development. no vesting contract. you're trusting me not to dump it. if i do, you'll see it on basescan within seconds and the project is over.

that's 100,000 brawl total, no team cliff hidden anywhere. the 50-brawl per-mint airdrop comes out of the 50,000-brawl auto-paired pool (the same pool that drips into LP). the founder bonus is the only separate budget.

this isn't a token where the team holds half. there's no vesting cliff to fear. there's also no "team's gonna sell" clock, because there isn't a team in the institutional sense. just me.

## what you should keep an eye on

- **basescan** the brawl token contract: confirm `owner()` returns 0x0 within ~48h of launch.
- **the unicrypt lock URL** (posted in #links on discord launch day).
- **the dev wallet** on basescan: any large brawl transfer out is worth a question.
- **#announcements** in discord for upgrades or major changes.

if i ever do something sketchy, the on-chain receipts will be public within seconds. that's the only enforcement i can really offer. but it's better than nothing, and it's better than most projects.

## scope, honestly

this is a small solo build. that's the appeal. it's also the constraint.

- there's no security audit yet. solidity tests cover the core flows (duel signing, mint hash, marketplace approvals, resurrection math). they're not the same as a paid audit.
- there's no team to escalate to if i get hit by a bus. the dev wallet is one EOA. plans to migrate to a 2-of-3 gnosis safe before any contract upgrades are real, but right now they're plans.
- there's no rapid response to discord drama. if you have a real bug, post in #bug-reports with repro steps. i'll get to it.

basically don't put more in than you can lose. that's true of every crypto thing. it's especially true here.
