'use client';

/**
 * Emergency unstick queue — current matchmaking is purely client-side
 * (no Arena.sol contract yet), so the button refreshes the house-keeper
 * state + triggers a sync, which is the only off-chain state that could
 * leave a player waiting. When the on-chain queue ships, this is where
 * we'll wire `arena.emergencyExit(tokenId)`.
 */
import { useCallback, useState } from 'react';

export function EmergencyUnstickPanel() {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const handle = useCallback(async () => {
    if (!confirm('Trigger emergency unstick? This forces a house-keeper sync + DB event sync. No on-chain queue exists yet, so this is a no-op for stuck players — but it ensures keeper fighters are fresh.')) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const [house, dash] = await Promise.all([
        fetch('/api/house/sync', { method: 'POST' }).then((r) => r.json()).catch(() => ({ ok: false })),
        fetch('/api/dash/sync', { method: 'POST' }).then((r) => r.json()).catch(() => ({ ok: false })),
      ]);
      setLast(
        `house actions: ${Array.isArray(house.actions) ? house.actions.length : 0} · dash sync: ${dash.chunksRun ?? 0} chunks`,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unstick failed');
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="brawl-card p-4 space-y-3">
      <div className="brawl-header text-sm text-brawl-orange">Emergency unstick</div>
      <p className="text-sm text-brawl-text-dim leading-relaxed">
        There&rsquo;s no on-chain queue yet, so nobody can actually get stuck. This
        button runs a full keeper-maintenance pass and kicks the event sync
        so the dashboard is up-to-date. Useful after contract redeploys or
        when a house fighter has been dead too long.
      </p>
      <button type="button" className="brawl-btn brawl-btn-danger" onClick={handle} disabled={busy}>
        {busy ? 'Working…' : 'Run emergency unstick'}
      </button>
      {last && <div className="text-sm font-mono text-brawl-green">✓ {last}</div>}
      {err && <div className="text-xs text-brawl-red">{err}</div>}
    </div>
  );
}
