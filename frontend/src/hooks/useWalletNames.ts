'use client';

/**
 * Resolve wallet addresses → display names. Bulk-batched + cached so that
 * rendering 100 BrawlerCards doesn't hammer the API per row.
 *
 * Pattern: components call `useWalletName(address)` for a single name, or
 * `useBulkWalletNames(addresses)` for an array. The hook auto-merges into
 * the shared cache and triggers a single batched fetch on mount when any
 * address is uncached.
 */
import { useEffect, useState } from 'react';

type Cache = Record<string, string | null>; // null = checked, no name

let cache: Cache = {};
const subscribers = new Set<() => void>();
const inFlight = new Set<string>();
const queue = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  for (const fn of subscribers) fn();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void doFlush();
  }, 60); // micro-batch within 60ms
}

async function doFlush() {
  if (queue.size === 0) return;
  const batch = [...queue];
  queue.clear();
  for (const a of batch) inFlight.add(a);
  try {
    const params = encodeURIComponent(batch.join(','));
    const res = await fetch(`/api/profile/names?addrs=${params}`, { cache: 'no-store' });
    const j = (await res.json()) as { names?: Record<string, string> };
    const names = j.names ?? {};
    for (const a of batch) {
      cache[a] = names[a] ?? null;
    }
    emit();
  } catch {
    for (const a of batch) cache[a] = null; // give up
    emit();
  } finally {
    for (const a of batch) inFlight.delete(a);
  }
}

function ensureRequested(addrLower: string) {
  if (cache[addrLower] !== undefined) return; // already known
  if (inFlight.has(addrLower)) return;
  queue.add(addrLower);
  scheduleFlush();
}

export function useWalletName(address: string | undefined): string | null {
  const [, force] = useState(0);
  useEffect(() => {
    if (!address) return;
    const a = address.toLowerCase();
    ensureRequested(a);
    const sub = () => force((n) => n + 1);
    subscribers.add(sub);
    return () => {
      subscribers.delete(sub);
    };
  }, [address]);
  if (!address) return null;
  const a = address.toLowerCase();
  return cache[a] ?? null;
}

export function useBulkWalletNames(addresses: string[]): Record<string, string> {
  const [, force] = useState(0);
  useEffect(() => {
    for (const a of addresses) ensureRequested(a.toLowerCase());
    const sub = () => force((n) => n + 1);
    subscribers.add(sub);
    return () => {
      subscribers.delete(sub);
    };
  }, [addresses]);
  const out: Record<string, string> = {};
  for (const a of addresses) {
    const v = cache[a.toLowerCase()];
    if (v) out[a.toLowerCase()] = v;
  }
  return out;
}

/** Eagerly invalidate one address (e.g. after the user just set their name). */
export function invalidateWalletName(address: string, newName?: string): void {
  const a = address.toLowerCase();
  if (newName) cache[a] = newName;
  else delete cache[a];
  emit();
}
