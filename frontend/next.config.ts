import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Pin Turbopack's workspace root to this directory so it doesn't walk up and
// pick up C:\Tools\pnpm-lock.yaml (which is unrelated, belongs to a sibling
// project). Without this, `npm run dev` logs a "multiple lockfiles" warning.
const here = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: here,
  },
  // /about is the legacy on-site how-to-play page. The gitbook handbook
  // at docs.baseicbrawlers.com is now the canonical onboarding doc; bounce
  // any direct visits or stale backlinks there permanently.
  //
  // Also: force the canonical hostname for everything else. When users
  // wallet-connect on a Vercel preview URL (e.g.
  // frontend-xyz.vercel.app, sometimes followed via a stale link), MetaMask
  // shows "frontend-xyz.vercel.app" as the requesting origin instead of
  // baseicbrawlers.com. Catching every non-canonical host with a 308 forces
  // the wallet origin to always be baseicbrawlers.com.
  async redirects() {
    return [
      {
        source: '/about',
        destination: 'https://docs.baseicbrawlers.com',
        permanent: true,
      },
      {
        source: '/:path*',
        has: [
          {
            type: 'host',
            value: '(?!baseicbrawlers\\.com$|www\\.baseicbrawlers\\.com$|localhost.*).*',
          },
        ],
        destination: 'https://baseicbrawlers.com/:path*',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
