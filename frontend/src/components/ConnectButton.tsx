'use client';

/**
 * Wallet connect button.
 *
 * Three display states:
 *   1. Not connected, shows "CONNECT WALLET". Clicking opens a small picker
 *      with one button per available connector (browser extension via
 *      `injected` + Coinbase Wallet / Smart Wallet).
 *   2. Connected to wrong chain, shows "WRONG NETWORK" in red with a
 *      "SWITCH" button that prompts the wallet to switch.
 *   3. Connected to correct chain, shows the truncated address + ETH balance
 *      and a "DISCONNECT" button.
 */
import { useEffect, useRef, useState } from 'react';
import {
  useAccount,
  useBalance,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from 'wagmi';
import { formatEther } from 'viem';
import { requireEnv } from '@/lib/env';
import { chainNameFor } from '@/lib/wagmi';

function shortAddr(addr: `0x${string}`): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// EIP-1193 code 4001 = user rejected. viem also throws `UserRejectedRequestError`
// (sometimes wrapped as `cause`). Rejecting a wallet prompt isn't an error —
// it's a user choice — so we hide the error UI entirely in that case.
function isUserRejection(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: number; cause?: { name?: string; code?: number } };
  return (
    e.name === 'UserRejectedRequestError' ||
    e.code === 4001 ||
    e.cause?.name === 'UserRejectedRequestError' ||
    e.cause?.code === 4001
  );
}

// viem errors expose `.shortMessage` (just the headline, no `Details:` /
// `Version:` footer). Fall back to the first line of `.message` if missing.
function cleanErrorMessage(err: { message?: string; shortMessage?: string }): string {
  return err.shortMessage ?? err.message?.split('\n')[0] ?? 'Connection failed';
}

// EIP-6963 wallets ship their own icon via the announce protocol (we read
// `connector.icon` directly), but our explicitly-registered connectors —
// Coinbase Wallet and WalletConnect — don't expose one. Map them to the
// bundled brand SVGs in /public/wallet-icons/ so they're not visually
// orphaned next to the named EIP-6963 entries.
function fallbackIconFor(connectorId: string): string | undefined {
  if (connectorId === 'coinbaseWallet' || connectorId === 'coinbaseWalletSDK') {
    return '/wallet-icons/coinbase.svg';
  }
  if (connectorId === 'walletConnect') {
    return '/wallet-icons/walletconnect.svg';
  }
  return undefined;
}

export function ConnectButton() {
  // useAccount's chainId is the connector's real chain; useChainId falls back
  // to config.chains[0] when the wallet is on an unconfigured chain, which
  // hides the "wrong network" state for unknown chains (e.g. BSC Testnet).
  const { address, isConnected, chainId: activeChainId } = useAccount();
  const { connect, connectors, isPending: isConnecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching, error: switchError } = useSwitchChain();
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

  // Auto-prompt the user to switch networks ONLY when they just clicked a
  // connector option (not on auto-reconnect from cached wagmi state). Without
  // this gate the wallet pops up asking to switch chains every page load,
  // which feels like the site is auto-prompting "connect wallet" on visit.
  // The flag is set inside each option's onClick below, then consumed once
  // here. The manual "Switch to <chain>" button in the wrong-chain state
  // stays visible as a retry path if the user rejects.
  const userJustClickedConnectRef = useRef(false);
  useEffect(() => {
    if (!isConnected || !address) {
      userJustClickedConnectRef.current = false;
      return;
    }
    if (!userJustClickedConnectRef.current) return;
    // We have a fresh user-initiated connection. Consume the flag whether or
    // not we end up firing switchChain — we only want one auto-prompt per
    // click, never on subsequent re-renders.
    userJustClickedConnectRef.current = false;
    if (activeChainId === env.chainId) return;
    switchChain({ chainId: env.chainId });
  }, [isConnected, address, activeChainId, env.chainId, switchChain]);

  // Picker open/closed state for the multi-wallet dropdown. Closed by default.
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close the picker on outside click + Escape.
  useEffect(() => {
    if (!pickerOpen) return;
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPickerOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  // State 1: not connected
  if (!isConnected) {
    // wagmi v2 + multiInjectedProviderDiscovery (default ON) exposes one
    // connector per EIP-6963-announced browser extension, plus the explicit
    // ones we registered (`injected` / `coinbaseWallet` / `walletConnect`).
    // EIP-6963 connectors all have `type: 'injected'` and a non-`'injected'`
    // id derived from the wallet's RDNS (e.g. `io.rainbow`, `io.metamask`,
    // `com.binance.wallet`). Filter accordingly.
    const eip6963Wallets = connectors.filter(
      (c) => c.type === 'injected' && c.id !== 'injected',
    );
    const genericInjected = connectors.find((c) => c.id === 'injected');
    const coinbase = connectors.find(
      (c) => c.id === 'coinbaseWalletSDK' || c.id === 'coinbaseWallet',
    );
    const wc = connectors.find((c) => c.id === 'walletConnect');

    // Helper: clicking any wallet entry sets the user-initiated flag so the
    // auto-switch-chain effect fires exactly once after we land connected.
    const pick = (connector: (typeof connectors)[number]) => () => {
      setPickerOpen(false);
      userJustClickedConnectRef.current = true;
      connect({ connector });
    };

    const options: {
      key: string;
      label: string;
      sub?: string;
      iconUrl?: string;
      onClick: () => void;
    }[] = [];

    // 1. EIP-6963 browser extensions (Rainbow, MetaMask, Rabby, Binance, …).
    //    Render each by its announced name + icon — much clearer than a
    //    single generic "Browser Wallet" entry when the user has multiple.
    for (const c of eip6963Wallets) {
      const icon = (c as { icon?: string }).icon;
      options.push({
        key: c.uid ?? c.id,
        label: c.name,
        ...(icon ? { iconUrl: icon } : {}),
        onClick: pick(c),
      });
    }
    // 2. Coinbase Wallet (extension OR Smart Wallet passkey, single SDK).
    if (coinbase) {
      const icon = fallbackIconFor(coinbase.id);
      options.push({
        key: 'coinbase',
        label: 'Coinbase Wallet',
        sub: 'or Smart Wallet (passkey, no install)',
        ...(icon ? { iconUrl: icon } : {}),
        onClick: pick(coinbase),
      });
    }
    // 3. WalletConnect — only when project id configured. Covers every
    //    mobile wallet (Rainbow Mobile, Trust, Binance Mobile, MetaMask
    //    Mobile, …) via the QR-code modal.
    if (wc) {
      const icon = fallbackIconFor(wc.id);
      options.push({
        key: 'walletConnect',
        label: 'WalletConnect',
        sub: 'Mobile: Rainbow, Trust, Binance, others — scan QR',
        ...(icon ? { iconUrl: icon } : {}),
        onClick: pick(wc),
      });
    }
    // 4. Generic `window.ethereum` fallback. Hide when we already exposed
    //    EIP-6963 wallets (otherwise the user sees both the named wallet
    //    AND a generic "Browser Wallet" entry that points at the same one).
    if (eip6963Wallets.length === 0 && genericInjected && hasInjected !== false) {
      options.push({
        key: 'injected',
        label: 'Browser Wallet',
        sub: 'MetaMask, Rabby, Brave, Frame…',
        onClick: pick(genericInjected),
      });
    }
    // 5. Mobile-no-injected fallback: MetaMask deeplink. Bounces the user
    //    into MM's in-app browser where the injected connector works.
    if (hasInjected === false) {
      const url =
        typeof window !== 'undefined' && window.location.hostname
          ? `${window.location.hostname}${window.location.pathname}`
          : 'baseicbrawlers.com';
      const mmLink = `https://metamask.app.link/dapp/${url}`;
      options.push({
        key: 'metamask-deeplink',
        label: 'Open in MetaMask',
        sub: 'Mobile app deeplink',
        onClick: () => {
          window.location.href = mmLink;
        },
      });
    }

    const disabled = isConnecting || options.length === 0;
    return (
      <div className="relative flex flex-col items-end gap-1" ref={pickerRef}>
        <button
          type="button"
          className="brawl-btn"
          disabled={disabled}
          onClick={() => setPickerOpen((v) => !v)}
          aria-expanded={pickerOpen}
          aria-haspopup="menu"
        >
          {isConnecting ? 'Connecting…' : 'Connect Wallet'}
        </button>
        {pickerOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-2 w-64 bg-brawl-panel border-2 border-brawl-border shadow-xl z-50 flex flex-col"
          >
            {options.map((o) => (
              <button
                key={o.key}
                type="button"
                role="menuitem"
                className="text-left px-3 py-3 border-b border-brawl-border last:border-b-0 hover:bg-brawl-bg transition-colors flex items-center gap-3"
                onClick={o.onClick}
              >
                {o.iconUrl ? (
                  // EIP-6963 icons are typically inline data: URLs (base64
                  // SVG/PNG) embedded by the wallet itself, so loading is
                  // synchronous and there's nothing for next/image to
                  // optimise. Plain <img> is the right tool.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={o.iconUrl}
                    alt=""
                    className="w-6 h-6 flex-shrink-0"
                  />
                ) : (
                  <span className="w-6 h-6 flex-shrink-0" aria-hidden />
                )}
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-brawl-text">{o.label}</span>
                  {o.sub && (
                    <span className="block text-xs text-brawl-text-dim mt-0.5">{o.sub}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
        {connectError && !isUserRejection(connectError) && (
          <span className="text-xs text-brawl-red max-w-xs text-right">
            {cleanErrorMessage(connectError)}
          </span>
        )}
      </div>
    );
  }

  // State 2: connected to wrong chain. The auto-prompt effect above fires
  // wallet_switchEthereumChain (and wallet_addEthereumChain if the wallet
  // doesn't have it yet) on first connect; if the user rejects, this manual
  // SWITCH button stays visible so they can retry.
  if (activeChainId !== env.chainId) {
    const targetName = chainNameFor(env.chainId);
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-brawl-red uppercase tracking-wide">
            Wrong Network
          </span>
          <button
            type="button"
            className="brawl-btn brawl-btn-danger"
            disabled={isSwitching}
            onClick={() => switchChain({ chainId: env.chainId })}
          >
            {isSwitching ? 'Switching…' : `Switch to ${targetName}`}
          </button>
        </div>
        {switchError && !isUserRejection(switchError) && (
          <span className="text-xs text-brawl-red max-w-xs text-right">
            {cleanErrorMessage(switchError)}
          </span>
        )}
      </div>
    );
  }

  // State 3: happy path
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-col items-end text-xs leading-tight">
        <span className="text-brawl-cyan font-mono">{address ? shortAddr(address) : ', '}</span>
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
