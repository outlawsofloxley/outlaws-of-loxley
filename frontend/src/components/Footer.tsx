/**
 * Site footer. Centered row of social links + a short brand tagline below.
 * Renders on every page, after the main content. Inline SVG icons (no
 * external dep) so the bundle stays tiny.
 */
import type { ReactElement } from 'react';
import { requireEnv } from '@/lib/env';

interface SocialLink {
  href: string;
  label: string;
  icon: ReactElement;
}

// Simple-icons-style monochrome glyphs. Sized via the parent <a>; the path
// inherits currentColor so hover states work via Tailwind text-color classes.
const DiscordIcon = (
  <svg viewBox="0 0 24 24" aria-hidden className="w-5 h-5" fill="currentColor">
    <path d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3a14.06 14.06 0 0 0-.617 1.249 18.27 18.27 0 0 0-5.486 0A12.5 12.5 0 0 0 9.83 3a19.74 19.74 0 0 0-3.76 1.371C2.524 9.616 1.594 14.736 2.06 19.78A19.94 19.94 0 0 0 8.1 22.5c.49-.66.926-1.362 1.299-2.094a12.7 12.7 0 0 1-2.046-.972c.171-.124.34-.252.503-.385a13.61 13.61 0 0 0 11.39 0c.165.133.333.261.503.385-.654.379-1.34.703-2.046.972.373.732.808 1.434 1.299 2.094a19.94 19.94 0 0 0 6.04-2.72c.541-5.83-.879-10.91-3.726-15.41ZM8.78 16.732c-1.182 0-2.156-1.082-2.156-2.41 0-1.327.957-2.408 2.156-2.408 1.2 0 2.176 1.08 2.156 2.408 0 1.328-.957 2.41-2.156 2.41Zm6.44 0c-1.182 0-2.156-1.082-2.156-2.41 0-1.327.957-2.408 2.156-2.408 1.2 0 2.176 1.08 2.156 2.408 0 1.328-.957 2.41-2.156 2.41Z" />
  </svg>
);

const XIcon = (
  <svg viewBox="0 0 24 24" aria-hidden className="w-5 h-5" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.452-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
  </svg>
);

const TelegramIcon = (
  <svg viewBox="0 0 24 24" aria-hidden className="w-5 h-5" fill="currentColor">
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0Zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
  </svg>
);

const GitHubIcon = (
  <svg viewBox="0 0 24 24" aria-hidden className="w-5 h-5" fill="currentColor">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
  </svg>
);

const GitBookIcon = (
  <svg viewBox="0 0 24 24" aria-hidden className="w-5 h-5" fill="currentColor">
    <path d="M10.802 17.77a.703.703 0 1 1-.002 1.406.703.703 0 0 1 .002-1.406m11.024-4.347a.703.703 0 1 1 .001-1.406.703.703 0 0 1-.001 1.406m0-2.876a2.176 2.176 0 0 0-2.174 2.174c0 .233.039.465.115.691l-7.181 3.823a2.165 2.165 0 0 0-1.784-.937c-.829 0-1.584.475-1.95 1.216l-6.451-3.402c-.682-.358-1.192-1.48-1.138-2.502.028-.533.212-.947.493-1.107.178-.1.392-.092.62.027l.042.023c1.71.9 7.304 3.847 7.54 3.956.363.169.565.237 1.185-.057l11.564-6.014c.17-.064.368-.227.368-.474 0-.342-.354-.477-.355-.477-.658-.315-1.669-.788-2.655-1.25-2.108-.987-4.497-2.105-5.546-2.655-.906-.475-1.635-.074-1.766.006l-.252.125C7.78 6.048 1.46 9.178 1.1 9.397.457 9.789.058 10.57.025 11.495c-.052 1.466.69 2.995 1.725 3.55l6.835 3.524a2.174 2.174 0 0 0 2.165 2.008 2.177 2.177 0 0 0 2.158-1.939l7.555-4.045c.404.31.898.484 1.412.484A2.177 2.177 0 0 0 24 12.901a2.176 2.176 0 0 0-2.174-2.174"/>
  </svg>
);

const GITBOOK_URL = 'https://docs.baseicbrawlers.com';

const SOCIALS: SocialLink[] = [
  { href: 'https://discord.gg/RjvBEA5CVd', label: 'Discord', icon: DiscordIcon },
  { href: 'https://x.com/BASEicBrawlers', label: 'X', icon: XIcon },
  { href: 'https://t.me/baseicbrawlers', label: 'Telegram', icon: TelegramIcon },
  { href: 'https://github.com/baseicbrawlers/baseic-brawlers', label: 'GitHub', icon: GitHubIcon },
  { href: GITBOOK_URL, label: 'GitBook', icon: GitBookIcon },
];

export function Footer() {
  // Pull live contract + pair addresses from env so the trading links always
  // point at whatever's actually deployed on mainnet.
  const env = (() => {
    try { return requireEnv().env; } catch { return null; }
  })();
  const brawlAddr = env?.brawlAddress;
  const pairAddr = env?.brawlPairAddress;
  const aerodromeSwap = brawlAddr
    ? `https://aerodrome.finance/swap?from=eth&to=${brawlAddr}`
    : null;
  const dexScreener = pairAddr
    ? `https://dexscreener.com/base/${pairAddr}`
    : null;
  const basescanToken = brawlAddr
    ? `https://basescan.org/token/${brawlAddr}`
    : null;

  return (
    <footer className="border-t border-brawl-border bg-brawl-bg/95 mt-12">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-6 flex flex-col items-center gap-3">
        <ul className="flex items-center gap-5">
          {SOCIALS.map((s) => (
            <li key={s.label}>
              <a
                href={s.href}
                target="_blank"
                rel="noreferrer"
                aria-label={s.label}
                title={s.label}
                className="flex items-center gap-2 text-brawl-text-dim hover:text-brawl-orange transition-colors"
              >
                {s.icon}
                <span className="brawl-header text-xs">{s.label}</span>
              </a>
            </li>
          ))}
        </ul>
        {brawlAddr && (
          <div className="flex flex-col items-center gap-1.5 text-xs">
            <div className="text-brawl-text-faint font-mono">
              $BRAWL CA:{' '}
              <a
                href={basescanToken ?? '#'}
                target="_blank"
                rel="noreferrer"
                className="text-brawl-orange hover:underline break-all"
                title="View on Basescan"
              >
                {brawlAddr}
              </a>
            </div>
            <div className="flex items-center gap-3 flex-wrap justify-center">
              {aerodromeSwap && (
                <a
                  href={aerodromeSwap}
                  target="_blank"
                  rel="noreferrer"
                  className="brawl-header text-[0.7rem] text-brawl-cyan hover:text-brawl-orange transition-colors"
                >
                  → Trade on Aerodrome
                </a>
              )}
              {dexScreener && (
                <a
                  href={dexScreener}
                  target="_blank"
                  rel="noreferrer"
                  className="brawl-header text-[0.7rem] text-brawl-cyan hover:text-brawl-orange transition-colors"
                >
                  → Chart on DexScreener
                </a>
              )}
              {env?.brawlTimelockAddress && (
                <a
                  href="/lock"
                  className="brawl-header text-[0.7rem] text-brawl-green hover:text-brawl-orange transition-colors"
                  title="20k team BRAWL locked, 6mo linear vest — live countdown"
                >
                  → Team Lock
                </a>
              )}
            </div>
          </div>
        )}
        <p className="brawl-header text-[0.65rem] text-brawl-text-faint tracking-wider">
          BASEic by name. Brutal by attitude.
        </p>
        <p className="text-xs text-brawl-text-faint">
          <a
            href={GITBOOK_URL}
            target="_blank"
            rel="noreferrer"
            className="hover:text-brawl-orange transition-colors"
          >
            How to Play
          </a>
          <span className="mx-2">·</span>
          <a
            href={`${GITBOOK_URL}/roadmap`}
            target="_blank"
            rel="noreferrer"
            className="hover:text-brawl-orange transition-colors"
          >
            Roadmap
          </a>
          <span className="mx-2">·</span>
          <a
            href="https://basescan.org"
            target="_blank"
            rel="noreferrer"
            className="hover:text-brawl-orange transition-colors"
          >
            Basescan
          </a>
        </p>
      </div>
    </footer>
  );
}
