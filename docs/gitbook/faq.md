# FAQ

questions people actually ask. if yours isn't here, drop it in #help on discord.

## what happens if i lose my wallet?

your brawlers are ERC-721 NFTs tied to the address. lose the keys, lose the brawlers. there's no recovery, no re-issue, no support team that can dig you out. standard self-custody rules: write your seed down, store it offline, never paste it anywhere.

i can't restore them. the chain doesn't care if it was you or a thief who has the keys.

## can i transfer a brawler to a friend?

yes. on a brawler's detail page, click **owner actions → transfer**, paste their address, sign the tx. standard ERC-721 `safeTransferFrom`. founder perks, rating, win/loss record, all travel with the nft.

## can i sell them outside the in-app market?

yes. token metadata at `/api/token/{id}` is opensea-spec compliant, so brawlers appear on opensea (and any other marketplace that reads the same standard) without any extra work from us. the in-app market takes 7.5%, opensea takes 2.5%. trade-off: external buyers don't see the live duel history embed inside the listing.

## is this safe?

contracts are open-source on github. the rarity shuffle is committed pre-mint via `initialRarityHash` so anyone can re-derive and verify it from the public `masterSeed`. the brawl token's ownership is renounced shortly after deploy (verify `owner()` on basescan returns `0x0`). the LP tokens were burned to `0x000...dEaD` at launch — permanent, no key, no recovery (check `basescan.org/address/0x000...dEaD#tokentxns` for the brawl/eth pair).

what's not in scope: a paid security audit, a multisig on the game contracts. if you want full institutional-grade safety, this isn't it. if you want a small game with public proofs and a one-person team being honest about it, this is it.

don't put in more than you can lose.

## why does my first duel need two wallet popups?

the first time you duel from a wallet, you approve the duel contract to spend your brawl (one popup). that approval is sticky, it persists across fights. every subsequent duel only needs the submit popup.

the site bundles the approve and the submit into one click on the first fight, but they're still two separate signatures because that's how erc-20 + arbitrary contract calls work on ethereum.

## why base?

cheap gas (a duel costs cents in usd-equivalent), fast finality (~2s blocks), coinbase distribution funnel for new players, and the chain has actual culture. baseic brawlers is a wordplay on **basic** + **base**. the art is intentionally crayon-simple, the chain is base, the vibe is unashamed.

## why does the art look so basic?

on purpose. we're not chasing photorealism. every brawler is rolled by a 32×24 procedural pixel-art generator: same seed in, same warrior out, no off-chain assets, no cloud storage. crayon-simple, deterministic, basically base. (yes, that pun is the whole identity. yes, i'm aware.)

## who built this?

a solo dev. me. building on base. everything ships under the same wallet, same handle, same lack of a marketing team.

## are there team tokens / vesting / advisors?

no advisors. team tokens YES — 20,000 brawl is locked in our own [`BRAWLTimelock`](https://basescan.org/address/0xdD4Fda3AED746E81481d58958e6E8c6D2e7cC761#code) vesting contract. 6-month linear vest, no cliff, immutable beneficiary = dev wallet, no admin function on the contract. anyone can call `release()` to push the vested portion to the beneficiary. countdown UI lives at [baseicbrawlers.com/lock](https://baseicbrawlers.com/lock).

the rest of the supply (full breakdown in **trust signals**):
- 27,500 brawl in the burned LP (effectively gone forever)
- 20,000 brawl on the keeper EOA (auto-fight stake float, recycles through duels)
- 10,000 brawl dev liquid (ops, infra, season prizes — trust-based, not vested)

so 70% of supply is either burned-LP or locked-vest at launch. 20% is keeper float that recycles. 10% is dev ops.

## what if a contract has a bug?

post in #bug-reports on discord with repro steps, expected behaviour, what actually happened, your wallet, and a tx hash if relevant. i'll triage. for actively-exploiting bugs, dm a mod first, public post second, so we can pause the affected contract before it gets drained.

the duel, mintdrop, graveyard, and marketplace contracts have a `pause()` function (escape hatch) that the dev can call. it's deliberately not on the brawl token (which is renounced).

## what's the keeper bot?

a small service that runs off the dev wallet. its job:

- recalculate the per-fight brawl cost every few minutes so it tracks ~$1.
- auto-resurrect dead **house brawlers** so the duel pool never thins.
- nothing else. doesn't move user funds, doesn't sign duels (the server does that), doesn't change rarity.

the keeper holds a small eth budget for gas (~0.005 eth covers months at base prices). it only has permission to call `setFightEconomics` on the duel contract.

## what happens to the LP after launch?

nothing. the LP was burned to `0xdead` at launch — there's no unlock date, no re-lock, no "what if". the brawl/eth aerodrome pair will keep accruing swap fees back into itself, and those fees compound for the players holding brawl. there is no key for the burn address, so the LP can never be pulled. the only way out for liquidity is for users to swap their brawl back.

## what happens at the end of the 6-month team-lock vest?

the dev wallet will hold the full 20k once it's done linearly streaming over the 180 days. those tokens become liquid in the dev wallet at that point — same trust-based commitment as the 10k that's already there. countdown on [/lock](https://baseicbrawlers.com/lock).

## are there going to be more drops?

maybe seasons, maybe not. the project is "the 2,000 + 1 king brawlers exist forever." there's no plan to mint more. if i ever did add new content, it'd be a separate collection with its own contract and very loud signposting.

## is there a roadmap?

yes — full version on the [roadmap page](roadmap.md). short version: 2v2 duels and a weapons shop are next, 5v5 + tournaments + ranked seasons come after. it's a wishlist not a contract — dates are deliberately vague because the project is one person on one keyboard.

## can i mint multiple brawlers in one transaction?

yes, 1, 2, 5, 10, or 20. bulk discount applies (see **minting**).

## what's the fight cost in dollars?

$1 per side per fight, period. you pay in brawl OR eth — your choice, per-fighter. $2 in the pot, winner takes 90% (~$1.80), dev treasury takes 10%. on ties each side gets their stake back, no dev cut. founders pay 75% of the per-side cost ($0.75). a keeper bot watches chainlink eth/usd + the aerodrome brawl/eth pool and repegs the per-fight brawl/eth quantities every 5 minutes so $1 stays $1.

## my brawler died, can i play with another wallet to resurrect cheaper?

no, the resurrection cost is set by the brawler's tier and wins, not who owns them or who pays. transferring to a new wallet doesn't reset anything. you can transfer mid-graveyard if you want, the nft moves, the dead state moves with it, and the new owner pays the same eth to resurrect.

## i lost three duels in a row, then someone bought my dead brawler. now what?

they own a dead brawler. they can resurrect them at full cost (founder freebie doesn't apply if a non-founder buys a founder brawler, see below) or leave them dead and trade them as a graveyard collectible. resurrected brawlers go back to alive with the loss streak reset.

## founder perks transfer with the nft, right?

yes. the nft carries the perks, not the wallet. on-chain checks key off `tokenId`, not `msg.sender` or the original minter. so if you buy founder #42 from someone, you now have founder #42's perks:

- **25% fight discount** — Duel.fighterCost(42) returns $0.75 worth regardless of who owns it.
- **free first resurrect** if the flag `hasUsedFreeResurrect[42]` is still false. Graveyard tracks this per tokenId, so the freebie travels with the nft until consumed.
- **founder badge** in the UI — rendered from tokenId.

caveat: the **first free resurrect** is one-shot. if the original minter died, used the free resurrect, then sold, the new owner doesn't get a second free one (the on-chain flag is sticky once flipped).

## i hit "approve & list" on the marketplace and only got one popup, not two

you're a returning seller. the approval is sticky from the last time you listed anything. one popup is correct on subsequent listings.

## i want to leave. can i?

yes. nothing keeps you here. transfer your brawlers to a friend, list them on the market, sell on opensea, or just ignore them in your wallet. nothing depreciates if you stop playing.

## can i contact you directly?

discord is best. ping a mod in #help or post in #general. dm responses are slower because i'm one person and dms are also a scam vector that i try not to normalize.
