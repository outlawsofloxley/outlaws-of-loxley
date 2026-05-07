/**
 * Site footer. Centered row of social links + a short brand tagline below.
 * Renders on every page, after the main content. Inline SVG icons (no
 * external dep) so the bundle stays tiny.
 */
import type { ReactElement } from 'react';
import Link from 'next/link';

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

const SOCIALS: SocialLink[] = [
  { href: 'https://discord.gg/RjvBEA5CVd', label: 'Discord', icon: DiscordIcon },
  { href: 'https://x.com/BASEicBrawlers', label: 'X', icon: XIcon },
  { href: 'https://t.me/baseicbrawlers', label: 'Telegram', icon: TelegramIcon },
];

export function Footer() {
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
        <p className="brawl-header text-[0.65rem] text-brawl-text-faint tracking-wider">
          BASEic by name. Brutal by attitude.
        </p>
        <p className="text-xs text-brawl-text-faint">
          <Link href="/about" className="hover:text-brawl-orange transition-colors">
            How to Play
          </Link>
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
