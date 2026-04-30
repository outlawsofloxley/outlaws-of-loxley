'use client';

/**
 * Wallet connect button.
 *
 * Three display states:
 *   1. Not connected — shows "CONNECT WALLET", clicking triggers the injected
 *      wallet's connect flow (MetaMask, Rabby, etc).
 *   2. Connected to wrong chain — shows "WRONG NETWORK" in red with a
 *      "SWITCH" button that prompts the wallet to switch.
 *   3. Connected to correct chain — shows the truncated address + ETH balance
 *      and a "DISCONNECT" button.
 */
import { useEffect, useState } from 'react';
import {
  useAccount,
  useBalance,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from 'wagmi';
import { formatEther } from 'viem';
import { requireEnv } from '@/lib/env';

function shortAddr(addr: `0x${string}`): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function ConnectButton() {
  // useAccount's chainId is the connector's real chain; useChainId falls back
  // to config.chains[0] when the wallet is on an unconfigured chain, which
  // hides the "wrong network" state for unknown chains (e.g. BSC Testnet).
  const { address, isConnected, chainId: activeChainId } = useAccount();
  const { connect, connectors, isPending: isConnecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { env } = requireEnv();
  const { data: balance } = useBalance({
    address,
    // Only fetch when we actually have an address AND are on the right chain
    query: { enabled: isConnected && activeChainId === env.chainId },
  });

  // Defer `window.ethereum` detection to after hydration to avoid SSR/CSR
  // HTML mismatch. On the first render (both server and initial client pass),
  // this is `null` → we render the button in a neutral "Connect" state. After
  // hydration this flips to boolean and the title-tooltip reflects reality.
  const [hasInjected, setHasInjected] = useState<boolean | null>(null);
  useEffect(() => {
    setHasInjected(
      typeof window !== 'undefined' &&
        typeof (window as unknown as { ethereum?: unknown }).ethereum !== 'undefined',
    );
  }, []);

  // State 1: not connected
  if (!isConnected) {
    const injected = connectors.find((c) => c.id === 'injected' || c.type === 'injected');

    // Mobile Chrome/Safari path: no window.ethereum means the user doesn't
    // have an extension. Instead of the SDK (which hijacks window.ethereum
    // globally and breaks desktop), we render a deep-link that opens the
    // MetaMask app and navigates its in-app browser to our dapp URL. Inside
    // MM's browser, window.ethereum IS present and the injected connector
    // works natively — same flow as desktop from that point.
    if (hasInjected === false) {
      // MetaMask's deeplink convention: strip protocol, keep host + path.
      const url =
        typeof window !== 'undefined' && window.location.hostname
          ? `${window.location.hostname}${window.location.pathname}`
          : 'baseicbrawlers.com';
      const mmLink = `https://metamask.app.link/dapp/${url}`;
      return (
        <a
          href={mmLink}
          className="brawl-btn"
          // Force same-tab so MM takes over. Opening in a new tab on mobile
          // tends to lose the user — they never find the original.
          rel="noreferrer"
        >
          Open in MetaMask
        </a>
      );
    }

    // Desktop / in-app-browser path: inject connector is the right one.
    // hasInjected === null means we haven't hydrated yet — render optimistic.
    const disabled = isConnecting || !injected;
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          className="brawl-btn"
          disabled={disabled}
          onClick={() => {
            if (injected) connect({ connector: injected });
          }}
        >
          {isConnecting ? 'Connecting…' : 'Connect Wallet'}
        </button>
        {connectError && (
          <span className="text-xs text-brawl-red max-w-xs text-right">
            {connectError.message}
          </span>
        )}
      </div>
    );
  }

  // State 2: connected to wrong chain
  if (activeChainId !== env.chainId) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-brawl-red uppercase tracking-wide">
          Wrong Network ({activeChainId})
        </span>
        <button
          type="button"
          className="brawl-btn brawl-btn-danger"
          disabled={isSwitching}
          onClick={() => switchChain({ chainId: env.chainId })}
        >
          {isSwitching ? 'Switching…' : `Switch to ${env.chainId}`}
        </button>
      </div>
    );
  }

  // State 3: happy path
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-col items-end text-xs leading-tight">
        <span className="text-brawl-cyan font-mono">{address ? shortAddr(address) : '—'}</span>
        <span className="text-brawl-text-dim font-mono">
          {balance
            ? `${parseFloat(formatEther(balance.value)).toFixed(4)} ${balance.symbol}`
            : '…'}
        </span>
      </div>
      <button
        type="button"
        className="brawl-btn brawl-btn-secondary"
        onClick={() => disconnect()}
      >
        Disconnect
      </button>
    </div>
  );
}
