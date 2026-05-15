# Marketplace

every brawler is a regular ERC-721 nft. you can sell them. you can buy them. you can send them to a friend.

the in-app marketplace lives at [/market](https://baseicbrawlers.com/market). prices are in **eth on base**, not brawl. brawl is reserved for fight stakes and dex trading. mixing the two would make balance management a headache.

## listing a brawler for sale

1. open your brawler's detail page (you'll find them under [/me](https://baseicbrawlers.com/me) or by searching their token id).
2. find the **marketplace** panel.
3. enter a price in eth. the site calculates the 7.5% dev fee and shows you the net you'd receive.
4. first time you list: click **approve & list**. two wallet popups: one to approve the marketplace contract to transfer your nft, one to set the price. every subsequent listing is just one popup, the approval is sticky.
5. you keep the nft in your wallet the whole time. listing is approval-based, not escrow. nothing custodied.

while listed, the brawler is **locked from duels**. the duel contract refuses to let a listed brawler fight, so you can't sell out from under a buyer mid-match. cancel the listing if you want to fight.

if the listing is active and you transfer the nft elsewhere (to another wallet, to a friend), the listing auto-invalidates at buy time. nobody can buy a brawler you no longer own. the marketplace handles this gracefully.

## buying

1. browse [/market](https://baseicbrawlers.com/market) or open any listed brawler directly.
2. click **buy**. one wallet popup, eth deducted, nft lands in your wallet.
3. **7.5% of the sale goes to the dev treasury, 92.5% to the seller.**

buying a dead brawler is allowed. the seller can list a graveyard brawler, you can buy it, and you decide whether to resurrect or keep it as a memorial. the on-chain `isDead` flag carries with the nft, so does the loss streak counter.

## seller actions on an active listing

- **update price**: change the asking price without delisting. one popup.
- **cancel**: pull the listing. always works, even if the marketplace is paused for an emergency. nothing gets stuck on the contract.

## why the 7.5% fee

the marketplace contract takes 7.5% of every sale and routes it to the dev treasury. that pays for ongoing development, the keeper bot infrastructure, the discord, the website hosting, and any future seasons.

7.5% is mid-range for nft marketplaces. opensea is 2.5%, blur is 0%, magic eden is variable. we picked 7.5% because we run all the infra ourselves (rpc nodes, indexer db, discord bots, telegram userbot, the keeper bots) and the platform doesn't have other revenue past the initial mint.

## opensea / external markets

token metadata at `/api/token/{id}` is opensea-spec compliant, so brawlers will appear on opensea (and other marketplaces that read the same standard) without any extra work from us.

if you sell on opensea, opensea takes their 2.5% and no royalty enforcement happens on most non-base markets. our 7.5% only fires on the in-app marketplace. trade-off: external markets are cheaper for the seller, but the buyer doesn't get the in-app trust signals (live duel history, rating curve, listing-lockout-from-duels protection, etc).

most players will use the in-app market for activity discovery and opensea for liquidity. that's fine.

## transferring (gift / send to friend)

it's a normal nft transfer. on the brawler's detail page → **owner actions** → **transfer**. paste the address. one wallet popup. nft moves.

founder perks travel with the nft. so does death state. so does the rating. transferring is a clean ownership change, not a reset.
