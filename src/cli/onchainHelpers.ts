/**
 * Small formatting helpers used by on-chain CLI commands.
 *
 * Nothing here touches the network.
 */
import { formatEther } from 'ethers';
import { c } from './format.js';

/** Format a wei amount as ETH with 4 decimals, right-padded for tables. */
export function ethAmount(wei: bigint): string {
  const s = formatEther(wei);
  // formatEther returns e.g. "10000.0" or "0.01" — normalize to 4dp
  const n = Number(s);
  if (!Number.isFinite(n)) return s + ' ETH';
  return `${n.toFixed(4)} ETH`;
}

/** Mask a 0x-prefixed hex address/hash for compact display: 0x1234…abcd */
export function shortHex(hex: string): string {
  if (!hex.startsWith('0x') || hex.length < 10) return hex;
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}

/** Turn an ethers error into a short, colored single-line message. */
export function formatOnchainError(err: unknown): string {
  // ethers v6 packs lots of fields; prefer `shortMessage`, then `reason`, then message.
  if (typeof err === 'object' && err !== null) {
    const anyErr = err as {
      shortMessage?: string;
      reason?: string;
      code?: string;
      message?: string;
    };
    const reason = anyErr.shortMessage ?? anyErr.reason ?? anyErr.message ?? String(err);
    const code = anyErr.code ? ` [${anyErr.code}]` : '';
    return c.red('  error:') + ' ' + reason + c.gray(code);
  }
  return c.red('  error: ') + String(err);
}

/** Green OK, red FAIL tag used for config readouts. */
export function okTag(ok: boolean): string {
  return ok ? c.green('✓') : c.red('✗');
}
