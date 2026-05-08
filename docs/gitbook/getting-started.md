# Getting started

three steps. wallet, eth, connect. once you've done this once it'll take you 30 seconds next time.

## 1. set up a wallet

click **connect wallet** at the top right of any page on baseicbrawlers.com. you'll get a picker with these options:

- **browser wallets**: anything that announces itself via eip-6963. metamask, rabby, brave wallet, frame, phantom, rainbow, binance wallet. each shows up in the picker by name with its own icon. pick the one you have installed.
- **coinbase wallet**: covers two paths in one click. if you have the coinbase wallet extension or app, it uses that. if you don't, it spins up a smart wallet (passkey-based, nothing to install, opens in a new tab). good for first-timers.
- **walletconnect**: qr code or deeplink for any mobile wallet. rainbow mobile, trust, binance mobile, metamask mobile, hundreds of others. scan with your phone, you're in.

if you're on mobile chrome or safari with no wallet at all, the picker also shows an **open in metamask** deeplink that bounces you into metamask's in-app browser.

## 2. add base to your wallet

if your wallet doesn't already know about base, the connect flow will offer to add it for you. one click, both networks if you want them:

**base mainnet**
- network name: base
- rpc: https://mainnet.base.org
- chain id: 8453
- currency: ETH
- explorer: https://basescan.org

**base sepolia (testnet, for trying before spending)**
- network name: base sepolia
- rpc: https://sepolia.base.org
- chain id: 84532
- currency: ETH
- explorer: https://sepolia.basescan.org

if you connect on the wrong network, the site auto-prompts a switch one time per connect. reject it and the manual switch button stays visible.

## 3. get some eth

**on mainnet** you need real eth on base to mint and pay gas. cheapest path:

- bridge eth from ethereum mainnet via [bridge.base.org](https://bridge.base.org). a few dollars in gas, a couple of minutes.
- if you're on coinbase exchange already, withdraw eth straight to your base address from the coinbase app. no bridge needed, no fee.

**on sepolia** it's all free testnet eth:

- [alchemy base sepolia faucet](https://www.alchemy.com/faucets/base-sepolia), 0.5 testnet eth per day, no signup for small amounts.
- [coinbase base sepolia faucet](https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet), easy if you already have a coinbase account.

mint prices are $20-$50 in eth-equivalent depending on which slot you grab. duels cost pennies of gas. on sepolia, everything is free.

## you're connected. what next?

- want to mint? go to **/mint**. read the **minting** chapter first if you want to know what you're paying for.
- already minted somewhere else? **/me** shows your roster.
- just looking? **/browse** is the full 2,000-brawler grid. **/leaderboard** is the rating ladder.
