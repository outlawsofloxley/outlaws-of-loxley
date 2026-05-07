'use client';

/**
 * Top navigation. Two-row layout on desktop:
 *   Row 1: [logo] [BASEic Brawlers (centered)] [wallet]
 *   Row 2: [Browse] [Mint] [Market] [Duel] [Leaders] [History] [Graveyard] [About]
 *
 * Mobile (below md): single row with logo + brand + wallet + hamburger,
 * nav items collapse into a slide-down drop panel. Drop panel closes on
 * route change, outside click, or item tap.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ConnectButton } from './ConnectButton';

interface NavItem {
  href: string;
  label: string;
  disabled?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/browse', label: 'Browse' },
  { href: '/mint', label: 'Mint' },
  { href: '/market', label: 'Market' },
  { href: '/duel', label: 'Duel' },
  { href: '/leaderboard', label: 'Leaders' },
  { href: '/ranks', label: 'Ranks' },
  { href: '/history', label: 'History' },
  { href: '/graveyard', label: 'Graveyard' },
  { href: '/me', label: 'Profile' },
  { href: '/about', label: 'How to Play' },
];

export function NavBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
    return undefined;
  }, [open]);

  return (
    <>
      <nav className="border-b border-brawl-border bg-brawl-bg/95 backdrop-blur sticky top-0 z-50">
        {/* Row 1: 3-col grid, logo | brand (centered) | wallet/menu.
            Grid keeps the brand pinned to the visual center of the navbar
            regardless of the side columns' widths. */}
        <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 grid grid-cols-[auto_1fr_auto] items-center gap-3">
          {/* Left: logo only (clickable) */}
          <Link
            href="/"
            className="flex items-center hover:opacity-80 transition-opacity"
            aria-label="BASEic Brawlers home"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.svg"
              alt="BASEic Brawlers"
              width="40"
              height="40"
              className="w-9 h-9 md:w-11 md:h-11 pixel"
              style={{ imageRendering: 'pixelated' }}
            />
          </Link>

          {/* Center: brand text, pinned dead-center via the grid 1fr column */}
          <Link
            href="/"
            className="brawl-header text-sm md:text-xl text-brawl-text whitespace-nowrap text-center hover:text-brawl-orange transition-colors"
          >
            <span className="text-brawl-orange">BASE</span>ic Brawlers
          </Link>

          {/* Right: wallet + mobile hamburger */}
          <div className="flex items-center gap-2 justify-self-end">
            <div className="hidden sm:block">
              <ConnectButton />
            </div>
            <button
              type="button"
              className="md:hidden flex items-center justify-center w-11 h-11 border-2 border-brawl-border hover:border-brawl-orange text-brawl-text transition-colors"
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <span className="brawl-header text-xl leading-none">
                {open ? '✕' : '☰'}
              </span>
            </button>
          </div>
        </div>

        {/* Row 2: nav items, desktop only, centered under the brand */}
        <div className="hidden md:block border-t border-brawl-border/60">
          <div className="max-w-7xl mx-auto px-4 md:px-8 h-12 flex items-center justify-center gap-6">
            {NAV_ITEMS.map((item) => (
              <DesktopNavLink key={item.href} item={item} pathname={pathname} />
            ))}
          </div>
        </div>
      </nav>

      {/* Mobile drop panel */}
      {open && (
        <>
          <div
            className="fixed inset-0 top-16 z-40 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="fixed left-0 right-0 top-16 z-50 bg-brawl-bg border-b-2 border-brawl-border shadow-2xl md:hidden">
            <div className="sm:hidden p-3 border-b border-brawl-border">
              <ConnectButton />
            </div>
            <div className="flex flex-col">
              {NAV_ITEMS.map((item) => {
                const isActive = pathname === item.href;
                if (item.disabled) {
                  return (
                    <span
                      key={item.href}
                      className="brawl-header text-base text-brawl-text-faint px-5 py-4 border-b border-brawl-border cursor-not-allowed"
                    >
                      {item.label}
                    </span>
                  );
                }
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={
                      'brawl-header text-base px-5 py-4 border-b border-brawl-border transition-colors ' +
                      (isActive
                        ? 'text-brawl-orange bg-brawl-panel'
                        : 'text-brawl-text hover:text-brawl-orange hover:bg-brawl-panel')
                    }
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function DesktopNavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const isActive = pathname === item.href;
  if (item.disabled) {
    return (
      <span
        className="brawl-header text-sm text-brawl-text-faint cursor-not-allowed"
        title="Coming soon"
      >
        {item.label}
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      className={
        'brawl-header text-sm transition-colors whitespace-nowrap ' +
        (isActive ? 'text-brawl-orange' : 'text-brawl-text hover:text-brawl-orange')
      }
    >
      {item.label}
    </Link>
  );
}
