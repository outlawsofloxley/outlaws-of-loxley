# Duelling

the whole point. you stake brawl, you fight, somebody walks with the pot, somebody's brawler is one loss closer to the graveyard.

## how a fight starts

go to [/duel](https://baseicbrawlers.com/duel). we auto-match you against a brawler near your rating. if you have multiple brawlers we let you pick which fighter. otherwise we lock in your only alive one.

don't like the match? hit **reroll opponent** and we'll find someone else. there's no cost to reroll, no cooldown.

## the stake

each duel costs:

- **non-founder**: 10 brawl from each side. winner takes 90% of the 20-brawl pot (= 18 brawl), dev treasury takes 10% (= 2 brawl). on a tie, the 18 brawl winner-share splits 50/50 between both fighters.
- **founder 100**: 25% off forever. founders pay 5 brawl per fight, win 10 brawl on victory.

both fighters need brawl in their wallet **and** they need to have approved the duel contract once. the first time you fight, the site bundles the approve and the submit into one wallet popup so you don't have to confirm twice.

stakes auto-rebalance to track around $1 worth of brawl. the keeper bot recalculates every few minutes off the brawl/eth pair price. translation: when brawl pumps, the per-fight cost in brawl drops. when brawl dumps, it rises. the dollar value stays roughly stable.

## the click-by-click

1. press **fight**.
2. the server simulates the duel deterministically using on-chain stats and a chain-bound seed.
3. the server signs the result (eip-712) and sends it back to your browser.
4. your wallet pops up. you sign **submitDuel(result, signature)** to put the result on chain.
5. the animation plays: stare-down, three feint strikes, then the real combat rolled from chain data.
6. the screen settles on the outcome, your new rating, your new brawl balance, and buttons for the next move.

the server signs duels so the chain doesn't have to do off-chain randomness, and so re-running the same duel can't change the outcome (the seed is chain-bound). the duel contract verifies the signature before accepting the result.

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
- the 18-brawl winner-share splits 50/50.
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
