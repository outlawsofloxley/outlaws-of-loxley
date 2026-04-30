import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Fantums-inspired palette, distilled from the screenshots
        // Backgrounds
        'brawl-bg': '#0d0d0f', // Page background (near-black)
        'brawl-panel': '#1a1417', // Card / panel background (warm brick-dark)
        'brawl-panel-hover': '#2a1f23',
        'brawl-border': '#3a2b30',

        // Text
        'brawl-text': '#f5f5f5',
        'brawl-text-dim': '#9a9a9a',
        'brawl-text-faint': '#5a5a5a',

        // Accents
        'brawl-orange': '#f5a623', // Primary CTA, banners
        'brawl-orange-hover': '#ffb84a',
        'brawl-red': '#c13e3e', // Destructive, dead, danger
        'brawl-red-dark': '#7a1f1f',

        // Rarity tiers (mirrors the Fantums rarity colors in the screenshots)
        'rarity-common': '#9a9a9a',
        'rarity-uncommon': '#4a9eff',
        'rarity-rare': '#b866e8',
        'rarity-epic': '#f5a623',

        // Data visualization
        'brawl-cyan': '#4bc9d4', // ELO numbers, stat values
        'brawl-green': '#52c055', // Positive delta, alive status
        'brawl-yellow': '#e6c200', // Warning, weapon highlights
      },
      fontFamily: {
        // Pixel display font for headers/big text, monospace for body
        pixel: ['"Press Start 2P"', 'monospace'],
        mono: ['"VT323"', '"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      backgroundImage: {
        // Subtle brick texture for panels (pure CSS, no external file needed)
        'brawl-brick':
          'linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0) 100%), radial-gradient(circle at 30% 40%, rgba(122,80,60,0.04) 0%, transparent 50%)',
      },
    },
  },
  plugins: [],
};

export default config;
