# Getting started

three steps. wallet, testnet eth, connect. and because this is testnet, every step is free. worst case you lose ten minutes, not money.

## 1. set up a wallet

click **connect wallet** at the top right of any page on [outlaws-of-loxley.vercel.app](https://outlaws-of-loxley.vercel.app). you'll get a picker:

- **browser wallets**: anything that announces itself via eip-6963. metamask, rabby, brave wallet, rainbow, phantom, and friends. each shows up by name with its own icon. pick the one you have installed.
- **walletconnect**: qr code or deeplink for mobile wallets. scan with your phone, you're in.

if you've never had a wallet: install metamask, write your seed phrase on paper, come back. testnet is the ideal place to make your first-wallet mistakes.

## 2. add robinhood chain testnet

the connect flow offers to add the network for you, one click. if you'd rather do it by hand:

**robinhood chain testnet**
- network name: robinhood chain testnet
- rpc: https://rpc.testnet.chain.robinhood.com
- chain id: 46630
- currency: ETH
- explorer: https://explorer.testnet.chain.robinhood.com

connect on the wrong network and the site prompts a switch. mainnet robinhood chain (chain id 4663) exists but the game is **not** deployed there yet. testnet only for now.

## 3. get some testnet eth

everything on-chain needs a little testnet eth for gas and the micro mint price. it's free:

- hit the faucet: https://faucet.testnet.chain.robinhood.com
- it has a browser bot-check, so it may make you prove you're a human. you are, probably.

mint prices on testnet are deliberately tiny, a rounding error of test eth. every mint also airdrops **50 LAWS** into your wallet so you can start duelling straight away. no dex, no swap, no buying anything.

## you're connected. what next?

- want to mint? go to [/mint](https://outlaws-of-loxley.vercel.app/mint). read the **minting** chapter first if you want to know what you're getting.
- already minted? [/me](https://outlaws-of-loxley.vercel.app/me) shows your roster.
- just looking? [/browse](https://outlaws-of-loxley.vercel.app/browse) is the full 2,000-outlaw grid, [/leaderboard](https://outlaws-of-loxley.vercel.app/leaderboard) is the rating ladder, and [/gallows](https://outlaws-of-loxley.vercel.app/gallows) is where the unlucky ones hang. 🪦
