/**
 * Wagmi configuration, this is where we wire together:
 *   - The custom "Brawlers Local" chain (or whatever the user pointed us at)
 *   - The transport (HTTP over the RPC URL)
 *   - The connectors (injected / browser wallet only for local dev)
 *
 * We lazy-initialize the config because env vars might not be populated at
 * module-load time during SSR (e.g. Next.js build phase without .env.local).
 * Client components call `getWagmiConfig()` inside the provider which runs
 * after the browser has mounted.
 */
import { createConfig, http, fallback } from 'wagmi';
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors';
import { defineChain, type Chain } from 'viem';
import { requireEnv } from './env';

/** Per-chain RPC pool. Used for fallback transport so a single rate-limited
 *  endpoint doesn't break the dapp. The env-configured RPC is tried first,
 *  then the rest in order. Base Sepolia's `sepolia.base.org` is notoriously
 *  rate-limited; publicnode + blastapi are much more generous. */
function rpcPoolFor(chainId: number): string[] {
  if (chainId === 84532) {
    return [
      'https://base-sepolia-rpc.publicnode.com',
      'https://base-sepolia.public.blastapi.io',
      'https://sepolia.base.org',
    ];
  }
  if (chainId === 8453) {
    return [
      'https://base-rpc.publicnode.com',
      'https://base.blockpi.network/v1/rpc/public',
      'https://mainnet.base.org',
    ];
  }
  return [];
}

/** Native gas token metadata per chain. Exported so UI code can label prices. */
export function nativeCurrencyFor(chainId: number): {
  name: string;
  symbol: string;
  decimals: 18;
} {
  if (chainId === 97) return { name: 'Test BNB', symbol: 'tBNB', decimals: 18 };
  if (chainId === 56) return { name: 'BNB', symbol: 'BNB', decimals: 18 };
  // ETH-denominated chains: Ethereum mainnet/Sepolia, Base, Base Sepolia, Anvil, etc.
  return { name: 'Ether', symbol: 'ETH', decimals: 18 };
}

export function nativeSymbol(chainId: number): string {
  return nativeCurrencyFor(chainId).symbol;
}

export function chainNameFor(chainId: number): string {
  if (chainId === 31337) return 'Anvil Local';
  if (chainId === 97) return 'BSC Testnet';
  if (chainId === 56) return 'BNB Smart Chain';
  if (chainId === 8453) return 'Base';
  if (chainId === 84532) return 'Base Sepolia';
  if (chainId === 1) return 'Ethereum';
  return `Chain ${chainId}`;
}

// Block explorer per chain. Used in the chain definition so wagmi can pass
// `blockExplorerUrls` to `wallet_addEthereumChain` — wallets that don't yet
// have the chain configured render the explorer link in their add-chain
// confirmation, which makes the prompt look legit instead of bare-bones.
function blockExplorerFor(chainId: number): { name: string; url: string } | null {
  if (chainId === 8453) return { name: 'Basescan', url: 'https://basescan.org' };
  if (chainId === 84532) return { name: 'Basescan Sepolia', url: 'https://sepolia.basescan.org' };
  if (chainId === 1) return { name: 'Etherscan', url: 'https://etherscan.io' };
  if (chainId === 56) return { name: 'BscScan', url: 'https://bscscan.com' };
  if (chainId === 97) return { name: 'BscScan Testnet', url: 'https://testnet.bscscan.com' };
  return null;
}

/** Build a viem `Chain` from env config. Includes the full RPC pool so
 *  wallets that auto-add the chain inherit the redundant endpoints. */
function buildChain(chainId: number, rpcUrl: string): Chain {
  const pool = [rpcUrl, ...rpcPoolFor(chainId)].filter(
    (u, i, arr) => arr.indexOf(u) === i,
  );
  const explorer = blockExplorerFor(chainId);
  return defineChain({
    id: chainId,
    name: chainNameFor(chainId),
    nativeCurrency: nativeCurrencyFor(chainId),
    rpcUrls: {
      default: { http: pool },
    },
    blockExplorers: explorer ? { default: explorer } : undefined,
    // Multicall3 lives at the canonical deterministic address on most public
    // EVM chains (verified for Base, BSC Testnet, Ethereum, etc.), but Anvil
    // doesn't always predeploy it. Registering it where it exists lets wagmi's
    // useReadContracts batch N reads into one RPC hop; on chains where it's
    // missing, wagmi returns "Cannot decode zero data" errors instead of
    // falling back. So: enable everywhere EXCEPT Anvil.
    contracts:
      chainId === 31337
        ? undefined
        : {
            multicall3: {
              address: '0xcA11bde05977b3631167028862bE2a173976CA11',
              blockCreated: 0,
            },
          },
    // Anvil doesn't have a block explorer, leaving this unset is fine.
    // Mark mainnets distinctly so wallets can render "testnet" badges.
    testnet: chainId !== 1 && chainId !== 56 && chainId !== 8453,
  });
}

// Cache the config so re-renders don't rebuild it. `let` + guard is fine here
// because this module is a singleton per browser session.
let cached: ReturnType<typeof createConfig> | null = null;

export function getWagmiConfig() {
  if (cached) {
    return cached;
  }

  const { env } = requireEnv();
  const chain = buildChain(env.chainId, env.rpcUrl);

  // Build connector list. wagmi v2's `multiInjectedProviderDiscovery` is on
  // by default, so EIP-6963-announcing browser extensions (Rainbow, MetaMask,
  // Rabby, Brave, Frame, Binance Wallet, etc.) appear as separate connectors
  // in `useConnect().connectors` automatically — we only need to register the
  // generic `injected` (legacy `window.ethereum` fallback), Coinbase, and
  // (optionally) WalletConnect explicitly.
  const connectors: ReturnType<typeof injected>[] = [
    // Legacy `window.ethereum` fallback for users on browsers that don't yet
    // implement EIP-6963 announcement (older wallets, niche browsers).
    injected({ shimDisconnect: true }),
    // Coinbase Wallet: covers extension/mobile native AND Smart Wallet
    // (passkey, no install) in one connector.
    coinbaseWallet({
      appName: 'BASEic Brawlers',
      appLogoUrl: 'https://baseicbrawlers.com/logo.svg',
      preference: { options: 'all' },
    }) as unknown as ReturnType<typeof injected>,
  ];
  if (env.walletConnectProjectId) {
    // WalletConnect: QR/deeplink for mobile wallets (Rainbow, Trust, Binance,
    // MetaMask Mobile, hundreds more). Only registered when a project id is
    // configured — without it the WC SDK throws on init.
    connectors.push(
      walletConnect({
        projectId: env.walletConnectProjectId,
        metadata: {
          name: 'BASEic Brawlers',
          description: 'Pixel-art duels on Base',
          url: 'https://baseicbrawlers.com',
          icons: ['https://baseicbrawlers.com/logo.svg'],
        },
        showQrModal: true,
      }) as unknown as ReturnType<typeof injected>,
    );
  }

  cached = createConfig({
    chains: [chain],
    connectors,
    transports: {
      // Fallback transport, viem rotates through these on RPC errors so a
      // single rate-limited endpoint can't kill mints / reads. Per-call
      // retry config keeps user-facing actions responsive.
      [chain.id]: fallback(
        [env.rpcUrl, ...rpcPoolFor(chain.id)]
          .filter((u, i, arr) => arr.indexOf(u) === i)
          .map((u) => http(u, { timeout: 5000, retryCount: 2 })),
        { rank: false },
      ),
    },
    ssr: false,
  });

  return cached;
}
