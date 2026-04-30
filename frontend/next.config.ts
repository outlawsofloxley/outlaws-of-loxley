import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Pin Turbopack's workspace root to this directory so it doesn't walk up and
// pick up C:\Tools\pnpm-lock.yaml (which is unrelated — belongs to a sibling
// project). Without this, `npm run dev` logs a "multiple lockfiles" warning.
const here = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: here,
  },
};

export default nextConfig;
