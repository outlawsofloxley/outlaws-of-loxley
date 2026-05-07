'use client';

/**
 * /about. How to Play / About page.
 *
 * Public onboarding. Covers wallet setup (Base), faucet links for Sepolia
 * testing, minting, matchmaking, BRAWL stakes, rarity tiers, the
 * resurrection curve, leaderboard/history, and the King.
 */
import Link from 'next/link';

export default function AboutPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 md:px-8 py-8 space-y-10">
      <header className="border-b border-brawl-border pb-5">
        <h1 className="brawl-header text-3xl md:text-4xl text-brawl-orange mb-3">
          ⚔ BASEic Brawlers
        </h1>
        <p className="brawl-header text-base md:text-lg text-brawl-text mb-3">
          Basic art. Brutal arena. Built on Base.
        </p>
        <p className="text-base md:text-lg text-brawl-text-dim leading-relaxed">
          Not photorealistic. Not stock-art. Just{' '}
          <strong className="text-brawl-text">crayon-simple deterministic
          pixel art</strong> rolled fresh on every mint by a 32×24 procedural
          generator. Same seed in, same warrior out. <strong>2000</strong>{' '}
          fighters in the drop, one 1-of-1 King for the dev. Mint, stake
          BRAWL, fight other players for a 90/10 pot split, climb the
          leaderboard, try not to end up in the graveyard. All on-chain on{' '}
          <strong className="text-brawl-text">Base</strong>. Backend-signed
          duels for replay safety. Chainlink VRF for the rarity shuffle so
          nobody can pre-compute their roll.
        </p>
        <div className="mt-3 text-sm text-brawl-text-faint italic">
          BASEic by name. Not by attitude.
        </div>
      </header>

      {/* ─── Wallet setup ─────────────────────────────────── */}
      <Section title="1. Set up your wallet">
        <p>
          You need an Ethereum-compatible wallet with the Base network
          configured. MetaMask is the easiest; Rabby, Coinbase Wallet, and most
          others work too. Coinbase Wallet has Base built in by default.
        </p>
        <Callout>
          <strong>On mobile?</strong> Mobile Chrome and Safari can&rsquo;t talk
          to wallet apps directly. Instead, open this dapp inside MetaMask
          mobile&rsquo;s built-in browser:
          <ol className="mt-2 list-decimal pl-5 space-y-1 text-sm">
            <li>Install the <strong>MetaMask</strong> app from the App Store / Play Store</li>
            <li>
              Tap the big orange <strong>Connect Wallet</strong> button on this page. On
              mobile it becomes <strong>Open in MetaMask</strong> and deep-links to the
              app automatically
            </li>
            <li>
              MetaMask opens, loads this dapp in its in-app browser, prompts you to
              approve the connection
            </li>
            <li>
              You now have a full dapp experience: mint, duel, trade, everything works
              the same as desktop
            </li>
          </ol>
        </Callout>
        <Callout>
          <strong>Add Base to MetaMask</strong>
          <ul className="mt-2 list-disc pl-5 space-y-1 font-mono text-sm">
            <li>Network name: <Mono>Base</Mono></li>
            <li>RPC URL: <Mono>https://mainnet.base.org</Mono></li>
            <li>Chain ID: <Mono>8453</Mono></li>
            <li>Currency symbol: <Mono>ETH</Mono></li>
            <li>Block explorer: <Mono>https://basescan.org</Mono></li>
          </ul>
          <p className="mt-3 text-sm text-brawl-text-dim">
            Or click <strong>Connect</strong> at the top-right. MetaMask will
            prompt you to add the chain automatically the first time.
          </p>
        </Callout>
        <Callout>
          <strong>Want to try without spending?</strong> Point your wallet at{' '}
          <Mono>Base Sepolia</Mono> (chain <Mono>84532</Mono>). A separate
          deployment runs there with the same code, fake money, no risk.
          <ul className="mt-2 list-disc pl-5 space-y-1 font-mono text-sm">
            <li>RPC URL: <Mono>https://sepolia.base.org</Mono></li>
            <li>Block explorer: <Mono>https://sepolia.basescan.org</Mono></li>
          </ul>
        </Callout>
      </Section>

      {/* ─── Faucet ─────────────────────────────────── */}
      <Section title="2. Bridge some ETH (or grab Sepolia ETH)">
        <p>
          On <strong>Base mainnet</strong>, you need real ETH on Base to pay
          gas and mint. The cheapest way to get there is{' '}
          <a
            href="https://bridge.base.org"
            target="_blank"
            rel="noreferrer"
            className="text-brawl-orange hover:underline"
          >
            bridge.base.org
          </a>
          . Bridge ETH from Ethereum mainnet for a few dollars in gas, takes
          a couple of minutes. Coinbase users can also withdraw ETH directly
          to Base from the Coinbase app for free.
        </p>
        <p>
          On <strong>Base Sepolia</strong> (testing), grab free Sepolia ETH:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>
            <a
              href="https://www.alchemy.com/faucets/base-sepolia"
              target="_blank"
              rel="noreferrer"
              className="text-brawl-orange hover:underline"
            >
              Alchemy Base Sepolia faucet
            </a>
            : 0.5 Sepolia ETH per day, no signup needed for low amounts.
          </li>
          <li>
            <a
              href="https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet"
              target="_blank"
              rel="noreferrer"
              className="text-brawl-orange hover:underline"
            >
              Coinbase Base Sepolia faucet
            </a>
            : easy if you already have a Coinbase account.
          </li>
        </ul>
        <p className="text-sm text-brawl-text-dim">
          Mint prices range $20-$50 in ETH-equivalent depending on which
          slot you grab (cheapest tier is the founders, slots 1-50 at $20).
          Duels cost pennies of gas. On Sepolia, everything is free.
        </p>
      </Section>

      {/* ─── Mint ─────────────────────────────────── */}
      <Section title="3. Mint a brawler">
        <p>
          Head to{' '}
          <Link href="/mint" className="text-brawl-orange hover:underline">
            /mint
          </Link>{' '}
          and pick how many you want (1, 2, 5, 10, or 20 at a time, up to 20
          per transaction). Pricing is tiered, payable in{' '}
          <Mono>ETH</Mono>, <Mono>USDC</Mono>, or <Mono>USDT</Mono> on Base:
        </p>
        <ul className="text-base space-y-1 ml-4">
          <li><strong>Slots 1-50</strong>: $20 (founder)</li>
          <li><strong>Slots 51-100</strong>: $25 (founder)</li>
          <li><strong>Slots 101-500</strong>: $30</li>
          <li><strong>Slots 501-1000</strong>: $35</li>
          <li><strong>Slots 1001-1500</strong>: $40</li>
          <li><strong>Slots 1501-2000</strong>: $50</li>
        </ul>
        <p>
          Mint money goes 100% to the dev wallet. No LP siphon, no buy/sell tax.
          The LP gets seeded once at launch (30k BRAWL paired with the dev&rsquo;s ETH)
          and then locked on Unicrypt for 90 days. Fight stakes are about $1
          worth of BRAWL each, auto-rebalanced as the price moves. Founders 1-100
          pay 25% less per fight and get a free first resurrect.
        </p>
        <p>
          Every brawler is randomly generated with a name, stats, a weapon, and
          BASEic pixel art. The rarity and weapon you get are pre-shuffled at
          deploy time using <strong>Chainlink VRF</strong> so the order is
          provably random. Nobody can pre-compute which mint pulls a King.
        </p>
        <Callout>
          <strong className="text-brawl-yellow">★ FOUNDER 50</strong> (token IDs 1–50), gold founder badge on
          your card forever. Top of the trophy case. Plus all FOUNDER 100 perks
          below.
          <div className="mt-2"><strong className="text-brawl-cyan">★ FOUNDER 100</strong> (token IDs 1–100):
            <ul className="mt-1 list-disc pl-5 space-y-1 text-sm">
              <li>Cheapest tier on the mint (slots 1-50 at $20, 51-100 at $25), never repeated</li>
              <li>Bonus <Mono>+20 BRAWL</Mono> airdropped on mint (on top of the standard 50, so 70 total)</li>
              <li><strong>25% discount</strong> on every duel stake (7.5 BRAWL/fight instead of 10)</li>
              <li><strong>First resurrection FREE</strong>. Your first death doesn&rsquo;t cost ETH.</li>
              <li>Cyan founder badge on every card (gold for IDs 1-50)</li>
            </ul>
          </div>
        </Callout>
        <Callout>
          <strong>Bulk-mint discount</strong>. Buy in volume, get bonus brawlers free:
          <ul className="mt-2 list-disc pl-5 space-y-1 text-sm">
            <li>Mint <strong>5</strong> → get <strong>1 bonus</strong> = 6 brawlers for the price of 5</li>
            <li>Mint <strong>10</strong> → get <strong>3 bonus</strong> = 13 brawlers for the price of 10</li>
            <li>Mint <strong>20</strong> → get <strong>7 bonus</strong> = 27 brawlers for the price of 20</li>
          </ul>
        </Callout>
        <Callout>
          <strong className="text-brawl-orange">⚀ Lottery</strong>. Every paid mint has a{' '}
          <strong>1-in-2000 chance</strong> of dropping a free bonus brawler in
          the same tx. The kind of luck you can&rsquo;t buy.
        </Callout>
        <Callout>
          <strong>Rarity distribution</strong>. 2000 brawlers in the drop plus
          1 King:
          <ul className="mt-2 list-disc pl-5 space-y-1 text-sm">
            <li>
              <span className="text-rarity-common">Common</span>: 1240 brawlers
              (Knife, Baseball Bat, Crowbar)
            </li>
            <li>
              <span className="text-rarity-uncommon">Uncommon</span>: 500
              brawlers (Machete, Pistol)
            </li>
            <li>
              <span className="text-rarity-rare">Rare</span>: 200 brawlers
              (Shotgun, Sledgehammer)
            </li>
            <li>
              <span className="text-rarity-epic">Legendary</span>: 40 brawlers
              (Flaming Sword, Electric Axe)
            </li>
            <li>
              <span className="text-brawl-yellow">Epic</span>: 20 brawlers
              (Bazooka, Rail Gun), rarest in the drop
            </li>
            <li>
              <span className="text-brawl-orange">The King</span>: 1/1
              (Kingsblade, tokenId 2001), dev wallet only
            </li>
          </ul>
        </Callout>
      </Section>

      {/* ─── Stats and combat ─────────────────────────────────── */}
      <Section title="4. Stats, weapons, and combat">
        <p>
          Every brawler has six D&D-style stats rolled on mint. Each affects how
          they fight:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>
            <strong>Strength (STR)</strong>: damage bonus and minimum damage floor.
          </li>
          <li>
            <strong>Dexterity (DEX)</strong>: to-hit chance, armour class,
            initiative order.
          </li>
          <li>
            <strong>Constitution (CON)</strong>: starting HP and armour class.
          </li>
          <li>
            <strong>Intelligence (INT) / Wisdom (WIS) / Charisma (CHA)</strong>:
            reserved for future content (spellcasting, crits, taunts etc).
            Safe to dump for now.
          </li>
        </ul>
        <p>
          Combat is turn-based with simultaneous damage. Each round, whoever has
          higher DEX attacks first. Hits land when <Mono>d20 + DEX</Mono> &ge;
          defender&rsquo;s armour class. Crits happen on 20s. First to zero HP
          loses. If both go to zero in the same round, it&rsquo;s a tie and the
          pot splits.
        </p>
      </Section>

      {/* ─── Duel ─────────────────────────────────── */}
      <Section title="5. Duel another player">
        <p>
          Head to{' '}
          <Link href="/duel" className="text-brawl-orange hover:underline">
            /duel
          </Link>{' '}
          and we&rsquo;ll auto-match you against a brawler near your Rating. If
          you own multiple brawlers, pick your fighter. Otherwise we lock in
          your only alive one. Don&rsquo;t like the match? Hit{' '}
          <em>Reroll opponent</em> and we&rsquo;ll find someone else.
        </p>
        <Callout>
          <strong>The stake</strong>: each duel costs{' '}
          <span className="text-brawl-orange">10 BRAWL</span> from each side
          (Founder 100 brawlers pay just <span className="text-brawl-cyan">5 BRAWL</span>, half off forever).
          Winner takes 90% of the pot, 10% goes to the dev treasury. On a tie,
          the winner-share splits 50/50. You need both fighters to have the BRAWL
          and to have approved the Duel contract once (one-click button handles
          both on first fight).
        </Callout>
        <p>
          When you click <strong>Fight</strong>, the server simulates the duel,
          signs the result, and your wallet pops up to confirm. Once you sign,
          the animation plays: intro stare-down, three feint strikes, then the
          real combat rolled from chain data. Stays on screen when it ends with
          the outcome, your new balance, and buttons.
        </p>
      </Section>

      {/* ─── Rating ─────────────────────────────────── */}
      <Section title="6. Rating + leaderboard">
        <p>
          Every brawler starts at <Mono>Rating 1000</Mono>. Rating moves after
          every duel using the classic Elo formula. Win against someone higher
          rated and you climb fast. Lose to someone lower rated and you drop
          hard. The{' '}
          <Link href="/leaderboard" className="text-brawl-orange hover:underline">
            /leaderboard
          </Link>{' '}
          shows everyone ranked by Rating. The{' '}
          <Link href="/history" className="text-brawl-orange hover:underline">
            /history
          </Link>{' '}
          page has the full duel log. Each brawler&rsquo;s individual fight
          history is on their detail page.
        </p>
      </Section>

      {/* ─── Death + graveyard ─────────────────────────────────── */}
      <Section title="7. Death and resurrection">
        <p>
          Lose three duels in a row and your brawler dies and goes to the{' '}
          <Link href="/graveyard" className="text-brawl-orange hover:underline">
            /graveyard
          </Link>
          . Dead brawlers can&rsquo;t fight again until they&rsquo;re
          resurrected. The cost scales with how tough your brawler is and how
          many wins they&rsquo;ve racked up:
        </p>
        <Callout>
          <Mono>
            cost = base × tierMult / 10 × (10 + wins) / 10
          </Mono>
          <p className="mt-2 text-sm text-brawl-text-dim">
            tierMult is 1× for Common, 1.5× Uncommon, 2.5× Rare, 4× Legendary,
            7× Epic, 15× King. Base cost is set at deploy time to ~$10 worth
            of <Mono>ETH</Mono> on Base.
          </p>
          <ul className="mt-2 list-disc pl-5 space-y-1 text-sm">
            <li>A fresh Common at 0 wins: ~$10</li>
            <li>Uncommon at 3 wins: ~$20</li>
            <li>Legendary at 5 wins: ~$60</li>
            <li>Epic at 10 wins: ~$140</li>
            <li>King (hopefully never): ~$150 base + win multiplier</li>
          </ul>
        </Callout>
        <p>
          The fight win streak resets on resurrection, so a dead brawler
          re-enters the arena at their existing Rating but with their three
          losses still on record. They just can&rsquo;t die again immediately.
        </p>
      </Section>

      {/* ─── House fighters ─────────────────────────────────── */}
      <Section title="8. House fighters: always a match ready">
        <p>
          A handful of brawlers owned by the dev wallet sit permanently in the
          arena as <strong>HOUSE</strong> fighters. They show up tagged with
          <em> HOUSE</em> in Browse and the Marketplace, and they always count
          as duel-ready. When you need a fight and no humans are online, you can
          still brawl against the house.
        </p>
        <p>
          Behind the scenes, a keeper service auto-resurrects any dead HOUSE
          brawler within seconds of their third loss (using the dev wallet&rsquo;s
          ETH for the resurrection cost) so the pool never thins out. Their
          stats and Rating work exactly like every other brawler. No secret
          buffs.
        </p>
      </Section>

      {/* ─── Marketplace ─────────────────────────────────── */}
      <Section title="9. Marketplace: buy & sell brawlers">
        <p>
          Any brawler can be listed for sale on the{' '}
          <Link href="/market" className="text-brawl-orange hover:underline">
            /market
          </Link>
          {' '}page. Payments are in <Mono>ETH</Mono> on Base, NOT BRAWL.
          BRAWL stays reserved for duel stakes + open-market DEX trading.
        </p>
        <Callout>
          <strong>How selling works</strong>
          <ol className="mt-2 list-decimal pl-5 space-y-1 text-sm">
            <li>Go to your brawler&rsquo;s detail page.</li>
            <li>In the Marketplace panel, enter a price in ETH.</li>
            <li>
              First time: click <strong>Approve & List</strong>. Two wallet
              popups (approve the marketplace to transfer the NFT, then list
              the price). Subsequent listings only need one popup.
            </li>
            <li>
              You keep the NFT in your wallet the whole time. Listing is
              approval-based, no escrow. Transfer it elsewhere and the listing
              auto-invalidates at buy time.
            </li>
            <li>
              When someone buys, <strong>5%</strong> of the sale goes to the
              dev treasury and <strong>95%</strong> to you. NFT transfers to the
              buyer, ETH lands in your wallet.
            </li>
          </ol>
        </Callout>
        <p>
          Seller actions on an active listing: <em>Update price</em> or{' '}
          <em>Cancel</em>. Cancel is always available even if the marketplace
          is paused by the dev for an emergency, so nothing gets stuck.
        </p>
      </Section>

      {/* ─── The King ─────────────────────────────────── */}
      <Section title="10. The King (1/1, tokenId #2001)">
        <p>
          There&rsquo;s one 1-of-1 brawler, <strong>The King Brawler</strong>.
          All stats at 18, starting Rating 2000, level 10, wields the Kingsblade
          (50-100 damage, speed 10), sits on a diamond-blue background. Only
          mintable by the dev wallet, only ever exists once, sits above all
          rarity tiers.
        </p>
        <p>
          If you meet him in the arena, expect to lose. If you beat him,
          expect the internet to talk about it for days.
        </p>
      </Section>

      {/* ─── Trust signals ──────────────────────────────────────────── */}
      <Section title="11. Trust signals: what we ship to prove this isn't a rug">
        <p>
          BASEic Brawlers is a one-shot, fixed-supply project. We ship the
          guarantees that let you sleep easy:
        </p>
        <Callout>
          <strong>BRAWL ownership renounced after launch settles.</strong>{' '}
          The BRAWL ERC-20 launches with anti-sniper limits (1% max wallet,
          0.5% max tx) so bots can&rsquo;t snipe block 0. After about 48 hours
          once the launch settles, the dev calls <Mono>renounceOwnership()</Mono>
          on the BRAWL contract. From that point nobody can change the whitelist,
          blacklist, or limits ever again. The token becomes a true fixed-supply
          ERC-20 with zero admin functions. <em>You can verify this on-chain.</em>
        </Callout>
        <Callout>
          <strong>LP locked for 6 months on Unicrypt at launch.</strong>{' '}
          When the BRAWL/ETH liquidity pool is seeded on Aerodrome, the LP
          token is deposited into Unicrypt&rsquo;s standard lock contract for
          6 months. Dev cannot pull liquidity during the lock. The lock URL is
          published at launch, anyone can independently verify.
        </Callout>
        <Callout>
          <strong>Game contracts stay dev-controlled (intentionally).</strong>{' '}
          The Duel, MintDrop, Graveyard, and Marketplace contracts stay owned
          by the dev wallet so we can tune <em>game</em> parameters (fight
          cost, mint price, fees) as the meta evolves. None of these contracts
          can mint BRAWL, drain LP, or take user funds beyond the documented
          flows. Game tuning is not the same as rug capability.
        </Callout>
        <Callout>
          <strong>No team allocation, no presale, no VC round.</strong>{' '}
          100k BRAWL supply, fully transparent allocation:
          <ul className="mt-1 list-disc pl-5 space-y-1 text-sm">
            <li><strong>Initial LP seed</strong>: 2,500 BRAWL + ~$500 ETH (dev funds).</li>
            <li><strong>Auto-paired BRAWL</strong>: 50k locked in MintDrop, drips into LP as people mint.</li>
            <li><strong>Founder airdrops</strong>: 2,000 BRAWL to first 100 minters.</li>
            <li><strong>Dev / treasury / season prizes</strong>: 45,500 BRAWL on dev wallet (no vesting contract, trust-based reserve for future seasons and partnerships).</li>
          </ul>
        </Callout>
      </Section>

      {/* ─── Tips ─────────────────────────────────────────────────── */}
      <Section title="12. Tips">
        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <strong>Farm easy wins early</strong>. Match into the same Rating
            band. Don&rsquo;t pick fights above you until your BRAWL stack is
            deep enough to absorb a few losses.
          </li>
          <li>
            <strong>Watch the combat log</strong>. Work out why you lost. Was
            it bad rolls, or was your opponent just statistically better? If
            your Dex is low, you attack last. That&rsquo;s a structural
            problem, not bad luck.
          </li>
          <li>
            <strong>Don&rsquo;t die.</strong> Resurrection costs real ETH and
            Rating drops with every loss. Sometimes the right play is to stop
            dueling a brawler who&rsquo;s on a two-loss streak.
          </li>
          <li>
            <strong>Batch mint</strong>. 20 mints in one tx only costs one gas
            fee. If you&rsquo;re going to spend money anyway, go big.
          </li>
        </ul>
      </Section>

      {/* ─── FAQ ─────────────────────────────────── */}
      <Section title="13. FAQ">
        <FAQ
          q="What happens if I lose my wallet?"
          a="Your brawlers are ERC-721 NFTs tied to the address. Lose the keys, lose the brawlers. Standard self-custody rules: write your seed down, store it offline, never paste it anywhere."
        />
        <FAQ
          q="Can I transfer a brawler to a friend?"
          a="Yes. On a brawler's detail page, click Owner Actions → Transfer, paste their address. Standard ERC-721 safeTransferFrom."
        />
        <FAQ
          q="Can I sell them?"
          a="Yes, both on the in-app /market (5% dev fee, ETH-denominated) and on OpenSea (token metadata at /api/token/[id] is OpenSea-spec compliant)."
        />
        <FAQ
          q="Is this safe?"
          a="Contracts are open-source. Mint randomness uses Chainlink VRF so the rarity shuffle is provably random. Treasury is a single EOA in v1 (will migrate to a Safe multisig before any contract upgrades). Don't paste seed phrases anywhere. This site never needs them."
        />
        <FAQ
          q="Why does my first duel need two wallet popups?"
          a="The first time you duel from a wallet, you approve the Duel contract to spend your BRAWL (one popup). Every subsequent duel only needs the submit popup. We bundle the approve and submit on that first click so there's no intermediate wait."
        />
        <FAQ
          q="Why Base?"
          a="Cheap gas (a duel costs cents), fast finality (~2s blocks), Coinbase distribution funnel, and a growing onchain culture. BASEic Brawlers is a wordplay on basic + Base. The art is intentionally crayon-simple, the chain is Base, the vibe is unashamed."
        />
        <FAQ
          q="Why does the art look so basic?"
          a="On purpose. We're not chasing photorealism. Every brawler is rolled by a 32×24 procedural pixel-art generator: same seed in, same warrior out, no off-chain assets, no cloud. Crayon-simple, deterministic, basically Base."
        />
        <FAQ
          q="Who built this?"
          a="An independent dev team building on Base. Source will be opened progressively as the project matures."
        />
      </Section>

      {/* ─── Get started ─────────────────────────────────── */}
      <div className="brawl-card p-6 text-center space-y-4 border-2 border-brawl-orange">
        <div className="brawl-header text-xl text-brawl-orange">
          Ready? Let&rsquo;s go.
        </div>
        <p className="text-sm text-brawl-text-dim">
          Connect your wallet from the nav bar above, bridge some ETH to Base
          (or grab Sepolia ETH for testing), mint a brawler, and step into the
          arena.
        </p>
        <div className="flex gap-3 flex-wrap justify-center">
          <Link href="/mint" className="brawl-btn">
            Mint a Brawler
          </Link>
          <Link href="/duel" className="brawl-btn brawl-btn-secondary">
            Duel
          </Link>
          <Link href="/browse" className="brawl-btn brawl-btn-secondary">
            Browse Roster
          </Link>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="brawl-header text-lg md:text-xl text-brawl-text border-b border-brawl-border pb-2">
        {title}
      </h2>
      <div className="text-sm text-brawl-text space-y-3 leading-relaxed">{children}</div>
    </section>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="brawl-card p-4 border-l-4 border-brawl-orange text-sm text-brawl-text-dim">
      {children}
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-sm md:text-xs bg-brawl-bg border border-brawl-border px-1.5 py-0.5 text-brawl-cyan break-all inline-block max-w-full">
      {children}
    </span>
  );
}

function FAQ({ q, a }: { q: string; a: string }) {
  return (
    <details className="brawl-card p-3 group">
      <summary className="cursor-pointer brawl-header text-xs text-brawl-orange hover:text-brawl-orange-hover list-none">
        <span className="text-brawl-text-faint group-open:rotate-90 inline-block transition-transform mr-2">
          ▶
        </span>
        {q}
      </summary>
      <p className="mt-3 text-sm text-brawl-text-dim leading-relaxed">{a}</p>
    </details>
  );
}
