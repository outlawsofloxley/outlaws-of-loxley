'use client';

/**
 * Fetches the DB-backed house whitelist from /api/house/whitelist once and
 * caches it at module scope so the N components on a page share the same
 * promise. Refreshes on explicit `refetch()` or after window focus > 60s
 * stale.
 *
 * The endpoint is public (no auth needed), the whitelist is visible
 * information (BrawlerCard displays HOUSE badges to everyone).
 */
import { useCallback, useEffect, useState } from 'react';

interface State {
  whitelist: ReadonlySet<number>;
  loading: boolean;
  error: string | null;
  loadedAt: number | null;
}

let cachedPromise: Promise<State> | null = null;
let cachedState: State | null = null;
const STALE_MS = 60_000;
const listeners = new Set<(s: State) => void>();

function notify(s: State) {
  cachedState = s;
  for (const l of listeners) l(s);
}

async function fetchWhitelist(): Promise<State> {
  try {
    const res = await fetch('/api/house/whitelist', { cache: 'no-store' });
    if (!res.ok) {
      return {
        whitelist: cachedState?.whitelist ?? new Set(),
        loading: false,
        error: `HTTP ${res.status}`,
        loadedAt: Date.now(),
      };
    }
    const json = (await res.json()) as { ok?: boolean; whitelist?: number[] };
    const ids = Array.isArray(json.whitelist) ? json.whitelist : [];
    return {
      whitelist: new Set(ids),
      loading: false,
      error: null,
      loadedAt: Date.now(),
    };
  } catch (e) {
    return {
      whitelist: cachedState?.whitelist ?? new Set(),
      loading: false,
      error: e instanceof Error ? e.message : 'fetch failed',
      loadedAt: Date.now(),
    };
  }
}

function loadOnce(force: boolean): Promise<State> {
  if (cachedPromise && !force) return cachedPromise;
  if (
    cachedState &&
    cachedState.loadedAt !== null &&
    Date.now() - cachedState.loadedAt < STALE_MS &&
    !force
  ) {
    return Promise.resolve(cachedState);
  }
  cachedPromise = fetchWhitelist().then((s) => {
    notify(s);
    return s;
  });
  return cachedPromise;
}

export function useHouseWhitelist(): {
  whitelist: ReadonlySet<number>;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const [state, setState] = useState<State>(() =>
    cachedState ?? { whitelist: new Set(), loading: true, error: null, loadedAt: null },
  );

  useEffect(() => {
    listeners.add(setState);
    // Kick off a load if we don't have anything yet; if cached, hand it back.
    if (!cachedState) {
      void loadOnce(false);
    } else {
      setState(cachedState);
    }
    return () => {
      listeners.delete(setState);
    };
  }, []);

  const refetch = useCallback(async () => {
    cachedPromise = null;
    await loadOnce(true);
  }, []);

  return {
    whitelist: state.whitelist,
    loading: state.loading,
    error: state.error,
    refetch,
  };
}

/** Synchronous accessor for code paths that already have a Set in hand. */
export function currentHouseWhitelist(): ReadonlySet<number> {
  return cachedState?.whitelist ?? new Set();
}

/** Used by dashboard mutations to prime the cache without a network round-trip. */
export function setHouseWhitelistCache(ids: number[]): void {
  notify({
    whitelist: new Set(ids),
    loading: false,
    error: null,
    loadedAt: Date.now(),
  });
}
