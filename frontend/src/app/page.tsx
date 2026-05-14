import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-6 md:p-8">
      <div className="max-w-3xl w-full text-center space-y-6 md:space-y-8">
        <div className="space-y-3 md:space-y-4">
          <h1 className="brawl-header text-2xl sm:text-3xl md:text-5xl text-brawl-text leading-tight break-words flex flex-col items-center gap-2 md:gap-3">
            <span className="text-brawl-orange leading-none">⚔</span>
            <span>BASEic Brawlers</span>
          </h1>
          <p className="brawl-header text-xs sm:text-xs md:text-sm text-brawl-text-dim">
            Basic art. Brutal arena. Built on Base.
          </p>
        </div>

        <div className="space-y-2 text-base sm:text-lg md:text-xl text-brawl-text">
          <p>2000 pixel warriors. Mint one. Stake BRAWL. Brawl for the pot.</p>
          <p className="text-brawl-text-dim">
            Three losses in a row and you&rsquo;re{' '}
            <span className="text-brawl-red">dead</span>, resurrection
            isn&rsquo;t free.
          </p>
          <p className="text-brawl-text-dim text-sm sm:text-base md:text-lg">
            Procedural pixel art, on-chain rarity (1240/500/200/40/20 + 1 King),
            server-signed duels, Neon-cached history. Crayon-simple. Base-native.
          </p>
        </div>

        <div className="flex items-center justify-center gap-3 pt-4 flex-wrap">
          <a
            href="https://docs.baseicbrawlers.com"
            target="_blank"
            rel="noreferrer"
            className="brawl-btn"
          >
            How to Play
          </a>
          <Link href="/mint" className="brawl-btn brawl-btn-secondary">
            Mint a Brawler
          </Link>
          <Link href="/browse" className="brawl-btn brawl-btn-secondary">
            Browse Roster
          </Link>
        </div>

        <div className="pt-8 text-sm text-brawl-text-faint font-mono">
          First time here?{' '}
          <a
            href="https://docs.baseicbrawlers.com"
            target="_blank"
            rel="noreferrer"
            className="text-brawl-orange hover:underline"
          >
            Read the handbook
          </a>
        </div>
      </div>
    </div>
  );
}
