# Duelling

the whole point. you stake brawl, you fight, somebody walks with the pot, somebody's brawler is one loss closer to the graveyard.

## how a fight starts

go to [/duel](https://baseicbrawlers.com/duel). we auto-match you against a brawler near your rating. if you have multiple brawlers we let you pick which fighter. otherwise we lock in your only alive one.

don't like the match? hit **reroll opponent** and we'll find someone else. there's no cost to reroll, no cooldown.

## the stake

each duel costs **$1 per fighter, $2 total pot**. you can pay in brawl OR in eth, your choice. winner takes 90% of the pot, dev treasury takes 10%. on a tie, each fighter gets their own stake back (no dev cut on ties).

- **non-founder**: $1 per side. at launch that's roughly 500 brawl or 0.00025 eth — the exact number floats with price and the duel page shows the live quote before you sign.
- **founder 100**: 25% off forever. founders pay $0.75 per fight.

**dual-currency model**: when both fighters pay brawl, dev cut is paid in brawl. when both pay eth, dev cut is paid in eth. when one pays brawl and the other pays eth (mixed), dev always gets eth and the winner gets paid in whichever currency they chose (the loser's currency gets auto-swapped on aerodrome in the same transaction).

stakes auto-rebalance to track $1 USD. a keeper bot watches brawl/eth + the chainlink eth/usd feed every 5 minutes and repegs the brawl side via `setFightEconomics`. translation: when brawl pumps, the per-fight brawl amount drops. when brawl dumps, it rises. the dollar value stays at $1.

**approvals**: first fight from a wallet pops a few setup prompts — approve brawl, approve brawlers nft transfer, then the fight itself. after that, fights are one click. eth-side payment doesn't need any approval, you just attach msg.value to the fight.

**sandwich protection**: the eth↔brawl swap leg (mixed fights only) has a signed `amountOutMin` baked into the fight quote. if an mev bot tries to sandwich your fight, the swap output falls below the signed minimum and the tx reverts. no silent slippage.

## the click-by-click

1. press **fight**.
2. the server simulates the duel deterministically using on-chain stats and a chain-bound seed.
3. the server signs **two** eip-712 structs: the DuelResult (for the duel contract) and the FightQuote (for the router, with signed swap amounts so sandwiches revert).
4. your wallet pops up. you sign **DuelRouter.fight(quote, qsig, result, dsig)** with msg.value matching whichever ETH stakes you chose. the router takes brawler custody, runs the fight, redistributes the pot, returns your brawler.
5. the animation plays: stare-down, three feint strikes, then the real combat rolled from chain data.
6. the screen settles on the outcome, your new rating, your new brawl/eth balance, and buttons for the next move.

the server signs duels so the chain doesn't have to do off-chain randomness, and so re-running the same duel can't change the outcome (the seed is chain-bound). the duel contract verifies the result signature. the router verifies the quote signature. both happen before any token movement.

## combat mechanics

turn-based, simultaneous damage. each round:

1. **initiative**: whoever has higher dex attacks first.
2. **to-hit roll**: `d20 + dex` ≥ defender's armour class to land.
3. **damage**: weapon damage + str bonus, minus the floor.
4. **crit on natural 20**: double damage.
5. **simultaneous resolution**: if both attacks land in the same round, both fighters take damage in the same step.

first to zero hp loses. if both go to zero in the same round, it's a **tie** and the pot splits.

## ties

ties are rare but real. when they happen:
- both brawlers count it as a tie (not a win, not a loss). doesn't break a loss streak.
- each fighter gets their own stake back (whatever currency they paid). no dev cut on ties.
- both keep their existing rating delta as if they'd drawn (small, near-zero rating change).
- ties don't trigger death. neither brawler advances toward 3 losses.

## rating moves

after every duel, the elo formula recalculates based on:
- the rating gap between the two brawlers
- whether you won, lost, or tied
- the k-factor (standard chess elo, applied here to brawlers)

beat someone 200 rating above you, you climb a lot. lose to someone 200 below, you drop a lot. predict-the-result fights barely move the needle.

the [/leaderboard](https://baseicbrawlers.com/leaderboard) sorts everyone by rating descending. the [/history](https://baseicbrawlers.com/history) page is the full duel log. each brawler also has its own per-fighter history at /brawler/{id}/history.

## the discord and telegram feeds

every duel posts to **#duels** in the official discord automatically (winner, loser, weapon, rating change, on-chain link). every death posts to **#graveyard**. every brawler sale posts to **#marketplace**. join the discord if you like watching the feed.

## three losses in a row = dead

if your brawler loses three duels back-to-back without a win, they die and go to the graveyard. that has its own chapter.

(a tie does not break a loss streak, but a tie also doesn't add to the loss count. so 2 losses → 1 tie → 1 loss = still alive at 3 losses-with-1-tie.)
