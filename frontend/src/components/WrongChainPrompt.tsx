'use client';

/**
 * Card shown on write-action pages when the connected wallet is on a chain
 * other than the one wagmi is configured for. Offers an inline "Switch"
 * button (wagmi's `switchChain` falls back to `wallet_addEthereumChain`
 * automatically when the chain isn't already in the wallet, using the
 * rpcUrls + nativeCurrency we defined in `lib/wagmi.ts`).
 */
import { useSwitchChain } from 'wagmi';

interface Props {
  currentChainId: number | undefined;
  expectedChainId: number;
}

export function WrongChainPrompt({ currentChainId, expectedChainId }: Props) {
  const { switchChain, isPending, error } = useSwitchChain();

  return (
    <div className="brawl-card p-6 space-y-4 border-brawl-red">
      <div className="brawl-header text-sm text-brawl-red">Wrong Network</div>
      <p className="text-sm text-brawl-text-dim">
        Your wallet is on chain{' '}
        <span className="text-brawl-red font-mono">{currentChainId ?? '?'}</span>. This app talks
        to chain{' '}
        <span className="text-brawl-orange font-mono">{expectedChainId}</span> (Anvil Local on your
        machine).
      </p>
      <div className="flex gap-3 items-center flex-wrap">
        <button
          type="button"
          className="brawl-btn brawl-btn-danger"
          disabled={isPending}
          onClick={() => switchChain({ chainId: expectedChainId })}
        >
          {isPending ? 'Switching…' : `Switch to ${expectedChainId}`}
        </button>
        {error && (
          <span className="text-xs text-brawl-red font-mono break-words max-w-md">
            {error.message}
          </span>
        )}
      </div>
      <p className="text-sm font-mono text-brawl-text-faint">
        First time? Your wallet will prompt to add &ldquo;Anvil Local&rdquo; with RPC{' '}
        <code>http://127.0.0.1:8545</code>. Accept it.
      </p>
    </div>
  );
}
