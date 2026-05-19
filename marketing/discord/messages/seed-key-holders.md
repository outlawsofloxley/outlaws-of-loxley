# 🧾 $BRAWL holders, explained

100,000 fixed supply. owner renounced. no more $BRAWL can ever exist.

if you see 4 wallets at 10-20% each on the top-holders chart, here's what each one is:

🔒 **20,000 (20%), team vault timelock**
6mo linear vest, beneficiary immutable, no admin function
`0xdD4Fda3AED746E81481d58958e6E8c6D2e7cC761`

🏟️ **~19,700 (20%), aerodrome BRAWL/ETH LP**
LP receipt tokens burned to 0xdead at launch, nobody can ever pull this liquidity
`0xf99F374AC9479BC8E224d5E56e3e815B6cc48e3c`

⚙️ **~19,500 (20%), keeper wallet**
game ops, stake float for 10 house brawlers, recycles through duels
`0x613794Dc02cc1a9f29Fbbdc8C5A82d08162bc04E`

👤 **~10,100 (10%), dev wallet**
dev, marketing, future season prizes. no contract lock, every move public on basescan
`0x5b1A749cc7bF1dE8ecA505769BD34Ba65f456805`

## the math

~69% locked, burned, or operational. ~31% in players' hands.

the timelock and the LP are both bytecode-enforced. no human can move those tokens early, ever.

## verify yourself

- `BRAWL.totalSupply()` → 100,000e18
- `BRAWL.owner()` → `0x0` (renounced)
- read the timelock source on basescan, search for `Ownable` (not there)
- check `balanceOf(0xdead)` on the LP token contract

full address-by-address breakdown with on-chain proofs:
**https://docs.baseicbrawlers.com/key-holders**

if anything here doesn't match basescan, on-chain wins. tag a mod in #bug-reports.
