# Marketplace

every outlaw is a regular ERC-721. you can sell them, buy them, or send them to a friend. the in-game marketplace lives at [/market](https://outlaws-of-loxley.vercel.app/market). prices are in testnet eth, which is to say: prices are pretend. good practice for mainnet, zero stakes today.

## listing an outlaw

1. open your outlaw's page (find them under [/me](https://outlaws-of-loxley.vercel.app/me) or by token id).
2. find the **marketplace** panel and enter a price.
3. first time listing: two wallet popups, one to approve the marketplace contract, one to set the price. after that the approval is sticky and it's one popup per listing.
4. you keep the nft in your wallet the whole time. listing is approval-based, not escrow. nothing gets custodied.

while listed, the outlaw is **locked out of duels**. the duel contract refuses to let a listed outlaw fight, so nobody can sell a fighter out from under a buyer mid-match. cancel the listing if you want to fight.

## buying

1. browse [/market](https://outlaws-of-loxley.vercel.app/market) or open any listed outlaw.
2. click **buy**. one popup, testnet eth deducted, nft lands in your wallet.
3. the marketplace takes a dev fee from the sale (shown on the listing; the contract hard-caps the fee at 10%, it can never be set higher).

buying a hanged outlaw is allowed. someone can list a fighter that's still at the gallows, you can buy it, and you decide whether to pay the cut-down or keep it as a grim trophy. the dead flag and the loss streak travel with the nft.

## seller actions on an active listing

- **update price**: change the ask without delisting. one popup.
- **cancel**: pull the listing. always works, nothing gets stuck on the contract.

if you transfer a listed nft to another wallet, the stale listing can't be executed: nobody can buy an outlaw from someone who no longer owns it.

## external marketplaces

token metadata follows the standard nft metadata spec, so third-party marketplaces can read outlaws without any special work. on robinhood chain testnet there isn't really an external nft market scene yet, so in practice: trade here. at mainnet this section gets more interesting.

## transferring (gift / send to a friend)

normal nft transfer. outlaw's page → **owner actions** → **transfer**, paste the address, one popup. rating, record, dead-or-alive state, everything travels with the nft. a transfer is a clean ownership change, not a reset.
