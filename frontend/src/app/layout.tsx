import type { Metadata } from 'next';
import { Providers } from './providers';
import { NavBar } from '@/components/NavBar';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://baseicbrawlers.com'),
  title: {
    default: 'BASEic Brawlers',
    template: '%s | BASEic Brawlers',
  },
  description:
    'Basic art, brutal arena. 2000 pixel-art warriors brawling on Base. Duel, die, resurrect.',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    apple: '/favicon.svg',
  },
  openGraph: {
    title: 'BASEic Brawlers',
    description:
      'Basic art, brutal arena. 2000 pixel-art warriors brawling on Base. Duel, die, resurrect.',
    url: 'https://baseicbrawlers.com',
    siteName: 'BASEic Brawlers',
    images: [{ url: '/logo.svg', width: 512, height: 512, alt: 'BASEic Brawlers' }],
    type: 'website',
  },
  twitter: {
    card: 'summary',
    site: '@BASEicBrawlers',
    creator: '@BASEicBrawlers',
    title: 'BASEic Brawlers',
    description:
      'Basic art, brutal arena. 2000 pixel-art warriors brawling on Base. Duel, die, resurrect.',
    images: ['/logo.svg'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          Google Fonts preload. We pick "Press Start 2P" for the retro pixel
          display font (used in headers) and "VT323" for long-form text, both
          are free and served by Google Fonts.
          preconnect on both google host + gstatic cuts ~200ms off first paint.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>
          <NavBar />
          <main className="min-h-[calc(100vh-4rem)] md:min-h-[calc(100vh-7rem)]">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
