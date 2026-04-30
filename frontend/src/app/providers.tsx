'use client';

/**
 * Top-level client providers for the app.
 *
 * Responsibilities, in order of concern:
 *   1. Validate env vars before anything else; show a friendly error page if
 *      the user hasn't created .env.local yet.
 *   2. Construct a singleton QueryClient (TanStack Query is a hard peer dep
 *      of wagmi v3; wagmi pipes all async state through it).
 *   3. Wrap children in WagmiProvider with our lazy-built config.
 *
 * Everything below this component can safely use wagmi hooks.
 */
import { type ReactNode, useState } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getWagmiConfig } from '@/lib/wagmi';
import { validateEnv } from '@/lib/env';

/** Pretty error screen shown when env is missing/invalid. */
function EnvMissingScreen({ errors }: { errors: readonly string[] }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="brawl-card max-w-2xl w-full p-8 space-y-6">
        <h1 className="brawl-header text-2xl text-brawl-red">Setup Required</h1>
        <p className="text-brawl-text-dim">
          The frontend can&rsquo;t start because required environment variables are missing or
          invalid.
        </p>
        <ul className="space-y-1 text-sm text-brawl-red pl-4 list-disc">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
        <div className="pt-4 border-t border-brawl-border space-y-3 text-sm text-brawl-text-dim">
          <p className="text-brawl-text">To fix:</p>
          <ol className="space-y-1 pl-4 list-decimal">
            <li>
              Copy{' '}
              <code className="px-1 bg-brawl-bg text-brawl-orange">frontend/.env.example</code> to{' '}
              <code className="px-1 bg-brawl-bg text-brawl-orange">frontend/.env.local</code>.
            </li>
            <li>Fill in the contract addresses from your Anvil deployment.</li>
            <li>
              Restart the dev server (<code className="px-1 bg-brawl-bg">Ctrl-C</code> then{' '}
              <code className="px-1 bg-brawl-bg">npm run dev</code>).
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  // Validate env on mount. Pure function, no hooks needed inside useState lazy init.
  const envResult = validateEnv();

  // QueryClient must be stable across renders. `useState` with a lazy initializer
  // is the canonical React pattern for "create once per component instance."
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Keep chain reads fresh but don't hammer the RPC.
            staleTime: 10_000, // 10 seconds
            // Don't retry indefinitely on local dev errors — fail fast instead.
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  // wagmi config also needs to be stable. We pass a dummy factory if env is
  // invalid because hooks must run in the same order every render. The value
  // gets thrown away when we render EnvMissingScreen below.
  const [wagmiConfig] = useState(() => (envResult.ok ? getWagmiConfig() : null));

  if (!envResult.ok || !wagmiConfig) {
    return (
      <EnvMissingScreen
        errors={envResult.ok ? ['Unknown configuration error'] : envResult.errors}
      />
    );
  }

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
