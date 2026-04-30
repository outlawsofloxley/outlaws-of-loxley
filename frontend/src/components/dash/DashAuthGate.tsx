'use client';

/**
 * DashAuthGate, wraps the dashboard page. Checks /api/dash/session to
 * see if a valid cookie exists. If not, renders the sign-in flow:
 *   1. GET /api/dash/nonce → receive nonce + message
 *   2. User signs via wagmi `useSignMessage`
 *   3. POST /api/dash/login { nonce, signature } → cookie set
 *   4. Re-check /api/dash/session → gate unlocks
 *
 * The server-held secret is what actually protects the dashboard; this
 * component just manages the UX.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAccount, useConnect, useSignMessage } from 'wagmi';
import { injected } from 'wagmi/connectors';

interface SessionState {
  loading: boolean;
  authed: boolean;
  addr: string | null;
  expiresAt: string | null;
  error: string | null;
}

interface NonceResp {
  ok: boolean;
  nonce: string;
  expiresAt: string;
  message: string;
  devAddress: string;
  error?: string;
}

export function DashAuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionState>({
    loading: true,
    authed: false,
    addr: null,
    expiresAt: null,
    error: null,
  });
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { signMessageAsync, isPending: isSigning } = useSignMessage();
  const [loginStatus, setLoginStatus] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    setSession((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch('/api/dash/session', { cache: 'no-store' });
      if (!res.ok) {
        setSession({ loading: false, authed: false, addr: null, expiresAt: null, error: `HTTP ${res.status}` });
        return;
      }
      const json = (await res.json()) as {
        ok?: boolean;
        authed?: boolean;
        addr?: string;
        expiresAt?: string;
      };
      setSession({
        loading: false,
        authed: json.authed === true,
        addr: json.addr ?? null,
        expiresAt: json.expiresAt ?? null,
        error: null,
      });
    } catch (e) {
      setSession({
        loading: false,
        authed: false,
        addr: null,
        expiresAt: null,
        error: e instanceof Error ? e.message : 'session check failed',
      });
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const handleConnect = useCallback(async () => {
    try {
      const c = connectors.find((conn) => conn.id === 'injected') ?? connectors[0];
      if (c) {
        await connect({ connector: c });
      } else {
        await connect({ connector: injected() });
      }
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : 'connect failed');
    }
  }, [connect, connectors]);

  const handleSignIn = useCallback(async () => {
    setLoginError(null);
    setLoginStatus('Requesting nonce…');
    try {
      const nonceRes = await fetch('/api/dash/nonce');
      if (!nonceRes.ok) {
        const err = (await nonceRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `nonce HTTP ${nonceRes.status}`);
      }
      const nonceJson = (await nonceRes.json()) as NonceResp;
      if (!nonceJson.ok) throw new Error(nonceJson.error ?? 'nonce error');

      setLoginStatus('Open your wallet to sign…');
      const signature = await signMessageAsync({ message: nonceJson.message });

      setLoginStatus('Verifying…');
      const loginRes = await fetch('/api/dash/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nonce: nonceJson.nonce, signature }),
      });
      if (!loginRes.ok) {
        const err = (await loginRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `login HTTP ${loginRes.status}`);
      }
      setLoginStatus('Session opened');
      await loadSession();
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : 'sign-in failed');
      setLoginStatus(null);
    }
  }, [signMessageAsync, loadSession]);

  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/dash/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    await loadSession();
  }, [loadSession]);

  if (session.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-brawl-text-faint text-sm">Checking session…</div>
      </div>
    );
  }

  if (!session.authed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-6">
        <div className="brawl-card p-6 max-w-md w-full space-y-4">
          <div className="brawl-header text-lg text-brawl-orange">Dev Dashboard</div>
          <p className="text-sm text-brawl-text-dim leading-relaxed">
            Sign a message with the dev wallet to unlock. This doesn&rsquo;t
            move any funds, it just proves you hold the key.
          </p>

          {!isConnected ? (
            <button
              type="button"
              className="brawl-btn w-full"
              onClick={handleConnect}
              disabled={isConnecting}
            >
              {isConnecting ? 'Connecting…' : 'Connect wallet'}
            </button>
          ) : (
            <>
              <div className="text-sm font-mono text-brawl-text-dim break-all">
                Connected: {address}
              </div>
              <button
                type="button"
                className="brawl-btn w-full"
                onClick={handleSignIn}
                disabled={isSigning}
              >
                {isSigning ? 'Waiting for signature…' : 'Sign to log in'}
              </button>
            </>
          )}

          {loginStatus && (
            <div className="text-sm text-brawl-text-dim">{loginStatus}</div>
          )}
          {loginError && (
            <div className="text-xs text-brawl-red">{loginError}</div>
          )}
          {session.error && (
            <div className="text-xs text-brawl-red">{session.error}</div>
          )}
        </div>
        <div className="text-sm font-mono text-brawl-text-faint">
          The session cookie is HMAC-signed + HttpOnly + 24h TTL.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="border-b border-brawl-border bg-brawl-panel/40">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-2 flex items-center justify-between text-sm font-mono gap-4 flex-wrap">
          <span className="text-brawl-text-dim">
            dev session · <span className="text-brawl-orange break-all">{session.addr}</span>
            {session.expiresAt && (
              <span className="ml-2 text-brawl-text-faint">
                exp: {new Date(session.expiresAt).toLocaleString()}
              </span>
            )}
          </span>
          <button type="button" className="text-brawl-red hover:underline" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}
