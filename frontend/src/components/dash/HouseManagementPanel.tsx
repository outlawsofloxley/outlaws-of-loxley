'use client';

/**
 * House fighter management: list current, add new from dev-owned brawlers,
 * remove existing. Mutations go through /api/house/whitelist (dash-authed).
 *
 * Adding a fighter that isn't yet owned by the keeper wallet is still
 * recorded, the HOUSE badge only shows once both conditions are true.
 * This lets D pre-populate the whitelist with newly-minted IDs and then
 * transfer them to the keeper wallet in a follow-up step.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { useAllBrawlers } from '@/hooks/useAllBrawlers';
import { useHouseWhitelist, setHouseWhitelistCache } from '@/hooks/useHouseWhitelist';
import { requireEnv } from '@/lib/env';

export function HouseManagementPanel() {
  const { env } = requireEnv();
  const { whitelist, refetch } = useHouseWhitelist();
  const { brawlers } = useAllBrawlers();
  const { address } = useAccount();

  const [busyTokenId, setBusyTokenId] = useState<number | null>(null);
  const [addInput, setAddInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [keeperStatus, setKeeperStatus] = useState<{ deadCount: number; alive: number } | null>(null);

  const loadKeeper = useCallback(async () => {
    try {
      const res = await fetch('/api/house/status', { cache: 'no-store' });
      if (!res.ok) return;
      const json = (await res.json()) as {
        ok?: boolean;
        brawlers?: Array<{ isAlive: boolean }>;
      };
      if (json.ok && Array.isArray(json.brawlers)) {
        const alive = json.brawlers.filter((b) => b.isAlive).length;
        setKeeperStatus({ alive, deadCount: json.brawlers.length - alive });
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadKeeper();
    const h = window.setInterval(() => void loadKeeper(), 30_000);
    return () => window.clearInterval(h);
  }, [loadKeeper]);

  const whitelistArr = useMemo(() => Array.from(whitelist).sort((a, b) => a - b), [whitelist]);

  const keeperAddr = env.houseKeeperAddress;
  const isDevKeeper = !!(address && keeperAddr && address.toLowerCase() === keeperAddr.toLowerCase());

  // Split brawlers into "owned by keeper" (already HOUSE or candidate to enroll)
  // vs "owned by dev (me)", D might add any of his wallet's brawlers to the
  // whitelist and transfer them over in a follow-up step.
  const keeperOwned = useMemo(
    () =>
      brawlers.filter(
        (b) =>
          keeperAddr !== null &&
          b.owner.toLowerCase() === keeperAddr.toLowerCase(),
      ),
    [brawlers, keeperAddr],
  );
  const myOtherBrawlers = useMemo(() => {
    if (!address) return [];
    const mine = brawlers.filter((b) => b.owner.toLowerCase() === address.toLowerCase());
    return mine.filter((b) => !whitelist.has(b.tokenId));
  }, [brawlers, address, whitelist]);

  const callAdd = useCallback(
    async (tokenId: number) => {
      setBusyTokenId(tokenId);
      setError(null);
      try {
        const res = await fetch('/api/house/whitelist', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tokenId }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as { ok?: boolean; whitelist?: number[] };
        if (json.whitelist) setHouseWhitelistCache(json.whitelist);
        await refetch();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'add failed');
      } finally {
        setBusyTokenId(null);
      }
    },
    [refetch],
  );

  const callRemove = useCallback(
    async (tokenId: number) => {
      setBusyTokenId(tokenId);
      setError(null);
      try {
        const res = await fetch(`/api/house/whitelist?tokenId=${tokenId}`, { method: 'DELETE' });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as { ok?: boolean; whitelist?: number[] };
        if (json.whitelist) setHouseWhitelistCache(json.whitelist);
        await refetch();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'remove failed');
      } finally {
        setBusyTokenId(null);
      }
    },
    [refetch],
  );

  const handleAddInput = useCallback(async () => {
    const id = Number(addInput.trim());
    if (!Number.isInteger(id) || id < 1) {
      setError('enter a numeric tokenId');
      return;
    }
    await callAdd(id);
    setAddInput('');
  }, [addInput, callAdd]);

  return (
    <div className="space-y-4">
      <div className="brawl-header text-lg text-brawl-orange">
        Arena roster, King Brawler&rsquo;s fighters
      </div>
      <p className="text-sm text-brawl-text-dim">
        Pick which of your brawlers sit in the arena as guaranteed opponents
        for human players. They never fight each other (would just grind dev
        ELO against itself). When they die, the keeper auto-resurrects them
        so the roster stays full 24/7. Add or remove individual fighters
        below.
      </p>

      <div className="brawl-card p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <div className="text-brawl-text-dim font-mono">King Brawler wallet:</div>
          <div className="text-brawl-text font-mono break-all">{keeperAddr ?? ', '}</div>
          {isDevKeeper && (
            <span className="text-xs brawl-header text-brawl-orange">YOU</span>
          )}
        </div>
        {keeperStatus && (
          <div className="text-sm font-mono text-brawl-text-dim">
            {keeperStatus.alive + keeperStatus.deadCount} fighters in roster · {keeperStatus.alive} alive · {keeperStatus.deadCount} dead (auto-resurrect)
          </div>
        )}
        {error && <div className="text-xs text-brawl-red">{error}</div>}
      </div>

      {/* Current whitelist */}
      <div className="brawl-card p-4 space-y-3">
        <div className="brawl-header text-sm text-brawl-orange">
          Currently in arena ({whitelistArr.length})
        </div>
        {whitelistArr.length === 0 ? (
          <div className="text-sm text-brawl-text-dim">No fighters whitelisted yet.</div>
        ) : (
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
            {whitelistArr.map((id) => {
              const b = brawlers.find((x) => x.tokenId === id);
              const keeperOwns = b?.owner.toLowerCase() === keeperAddr?.toLowerCase();
              return (
                <div
                  key={id}
                  className="flex items-center justify-between border border-brawl-border px-3 py-2 gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="brawl-header text-xs text-brawl-text truncate">
                      #{id}
                      {b && <span className="ml-2 text-brawl-text-dim font-mono">{b.name}</span>}
                    </div>
                    <div className="text-sm font-mono text-brawl-text-faint">
                      {b
                        ? keeperOwns
                          ? 'in arena, duel-ready'
                          : `owned by ${b.owner.slice(0, 10)}… · transfer to King wallet first`
                        : 'not found on chain'}
                      {b && ' · '}
                      {b && (b.isDead ? 'dead' : 'alive')}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="brawl-btn brawl-btn-danger text-xs px-2 py-1 min-h-0"
                    onClick={() => callRemove(id)}
                    disabled={busyTokenId === id}
                  >
                    {busyTokenId === id ? '…' : 'Remove'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add by tokenId */}
      <div className="brawl-card p-4 space-y-3">
        <div className="brawl-header text-sm text-brawl-orange">Add by tokenId</div>
        <div className="flex gap-2">
          <input
            className="brawl-input flex-1"
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            placeholder="e.g. 7"
            inputMode="numeric"
          />
          <button type="button" className="brawl-btn" onClick={handleAddInput} disabled={busyTokenId !== null}>
            Add
          </button>
        </div>
        <div className="text-sm font-mono text-brawl-text-faint">
          The fighter only becomes duel-ready once it&rsquo;s owned by the
          King Brawler wallet (you can whitelist first and transfer later).
        </div>
      </div>

      {/* Keeper-owned brawlers not yet whitelisted */}
      {keeperOwned.some((b) => !whitelist.has(b.tokenId)) && (
        <div className="brawl-card p-4 space-y-3">
          <div className="brawl-header text-sm text-brawl-orange">
            Owned by King Brawler, not yet in arena
          </div>
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
            {keeperOwned
              .filter((b) => !whitelist.has(b.tokenId))
              .map((b) => (
                <div key={b.tokenId} className="flex items-center justify-between border border-brawl-border px-3 py-2 gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="brawl-header text-xs text-brawl-text truncate">#{b.tokenId} · {b.name}</div>
                    <div className="text-sm font-mono text-brawl-text-faint">rating {b.elo}</div>
                  </div>
                  <button
                    type="button"
                    className="brawl-btn text-xs px-2 py-1 min-h-0"
                    onClick={() => callAdd(b.tokenId)}
                    disabled={busyTokenId === b.tokenId}
                  >
                    {busyTokenId === b.tokenId ? '…' : 'Add'}
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Dev-owned (me) brawlers */}
      {myOtherBrawlers.length > 0 && (
        <div className="brawl-card p-4 space-y-3">
          <div className="brawl-header text-sm text-brawl-orange">
            Your other brawlers, click Add to send into the arena
          </div>
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
            {myOtherBrawlers.map((b) => (
              <div key={b.tokenId} className="flex items-center justify-between border border-brawl-border px-3 py-2 gap-2">
                <div className="min-w-0 flex-1">
                  <div className="brawl-header text-xs text-brawl-text truncate">#{b.tokenId} · {b.name}</div>
                  <div className="text-sm font-mono text-brawl-text-faint">rating {b.elo}</div>
                </div>
                <button
                  type="button"
                  className="brawl-btn text-xs px-2 py-1 min-h-0"
                  onClick={() => callAdd(b.tokenId)}
                  disabled={busyTokenId === b.tokenId}
                >
                  {busyTokenId === b.tokenId ? '…' : 'Add'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
