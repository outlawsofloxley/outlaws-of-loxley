'use client';

/**
 * WalletNamePanel — let any connected wallet claim a display name (handle)
 * via a signed message. The handle then surfaces wherever the wallet's
 * address would be shown in the UI (brawler detail, owner pages, etc).
 */
import { useEffect, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { useWalletName, invalidateWalletName } from '@/hooks/useWalletNames';

export function WalletNamePanel() {
  const { address, isConnected } = useAccount();
  const currentName = useWalletName(address);
  const { signMessageAsync, isPending } = useSignMessage();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setDraft(currentName ?? '');
  }, [currentName]);

  const handle = async () => {
    if (!address) return;
    const trimmed = draft.trim();
    if (trimmed.length < 2 || trimmed.length > 24) {
      setErr('Name must be 2–24 characters');
      return;
    }
    setErr(null);
    setSuccess(null);
    setBusy(true);
    try {
      const message = `BASEic Brawlers handle: ${trimmed}`;
      const sig = await signMessageAsync({ message });
      const res = await fetch('/api/profile/name', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed, signature: sig }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; name?: string };
      if (!json.ok) {
        setErr(json.error ?? `HTTP ${res.status}`);
      } else {
        invalidateWalletName(address, trimmed);
        setSuccess(`Locked in as "${trimmed}"`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'sign failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="brawl-card p-4 space-y-3">
      <div className="brawl-header text-sm text-brawl-orange">Your handle</div>
      <p className="text-sm text-brawl-text-dim">
        Set a display name for your wallet. Other players see this on your
        brawler cards instead of your raw 0x address. Free, no gas — you
        just sign a message proving you own the wallet.
      </p>
      {!isConnected ? (
        <div className="text-sm text-brawl-text-faint">Connect a wallet to set a handle.</div>
      ) : (
        <>
          {currentName && (
            <div className="text-sm font-mono text-brawl-text-dim">
              Currently:{' '}
              <span className="text-brawl-text">{currentName}</span>
            </div>
          )}
          <div className="flex gap-2">
            <input
              className="brawl-input flex-1"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. ChiefBrawler"
              maxLength={24}
            />
            <button
              type="button"
              className="brawl-btn"
              onClick={handle}
              disabled={busy || isPending || draft.trim().length < 2}
            >
              {busy || isPending ? 'Sign…' : currentName ? 'Update' : 'Claim'}
            </button>
          </div>
          <div className="text-sm text-brawl-text-faint font-mono">
            2–24 chars. Letters, digits, space, _ . - allowed. Names are
            unique — first to claim wins.
          </div>
          {err && <div className="text-sm text-brawl-red">{err}</div>}
          {success && <div className="text-sm text-brawl-green">✓ {success}</div>}
        </>
      )}
    </div>
  );
}
