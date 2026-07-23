# Duelling

the whole point. you stake LAWS, you fight, somebody walks with the pot, somebody's outlaw is one loss closer to the gallows.

reminder before anything else: this is testnet. the LAWS you're staking came free with your mint. fight recklessly, that's what it's for.

## how a fight starts

go to [/duel](https://outlaws-of-loxley.vercel.app/duel). the matchmaker pairs you against an outlaw near your rating. if you own several outlaws you pick your fighter, otherwise your only alive one is locked in. don't like the match? reroll and it finds someone else.

## the stake

each duel costs a small amount of LAWS per fighter (the live number is on the duel page, testnet amounts are tiny). both stakes go into the pot:

- **win**: you take the pot, minus a dev cut (the contract hard-caps the dev share at 20% of the pot).
- **lose**: your stake is gone and your loss streak ticks up.
- **tie**: the pot, minus the dev cut, splits down the middle. a tie also resets both fighters' loss streaks, so it's a better result than it sounds.

paying in eth or LAWS, your pick per fight, is a mainnet roadmap item (the currency router). on testnet, fights are LAWS only.

## approvals

first fight from a wallet pops an extra prompt: approve the duel contract to take your LAWS stake. after that it's one popup per fight. you can revoke the allowance any time from your wallet if you want a clean exit.

## the click-by-click

1. press **fight**.
2. the game server simulates the duel deterministically from on-chain stats and a chain-bound seed, then signs the result (eip-712). re-requesting the same matchup gives you the same signed result: there's no re-rolling a fight you don't like.
3. your wallet pops. you submit the signed result on-chain. the duel contract verifies the signature before any tokens move.
4. the animation plays. and if either fighter carries a bow, longbow, crossbow, arbalest, or the golden longbow, you'll see the arrow actually fly across the arena and land. 🏹 melee fighters lunge and clash instead.
5. the screen settles on the outcome, your new rating, your new LAWS balance, and buttons for the next move.

## combat mechanics

turn-based, simultaneous resolution. each round:

1. **initiative**: higher dex attacks first.
2. **to-hit**: d20 + dex against the defender's armour class.
3. **damage**: weapon damage roll + str bonus.
4. **type advantage**: blade beats blunt, blunt beats ranged, ranged beats blade. advantage multiplies damage by 1.15×.
5. **crit on a natural 20**: double damage.
6. **simultaneous hits**: if both attacks land in a round, both fighters take damage in the same step.

first to zero hp loses. both hit zero in the same round, it's a tie.

## rating moves

after every duel the elo formula recalculates from the rating gap and the result. beat someone 200 above you, climb a lot. lose to someone 200 below, drop a lot. expected results barely move the needle.

[/leaderboard](https://outlaws-of-loxley.vercel.app/leaderboard) sorts everyone by rating. [/history](https://outlaws-of-loxley.vercel.app/history) is the full duel log, and every outlaw's page carries its own record.

## three losses in a row = the gallows

lose three duels back-to-back without a win or a tie in between and your outlaw dies. off to the gallows, which has its own chapter. a win resets the streak. a tie resets the streak too. the counter only cares about consecutive losses.

## duel feeds

duel results posting to community channels (discord and friends) is coming with the socials, which don't exist yet. for now the [/history](https://outlaws-of-loxley.vercel.app/history) page is the town crier.
