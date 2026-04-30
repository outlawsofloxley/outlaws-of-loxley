/**
 * Onchain config: loads from process.env (populated by dotenv in main.ts)
 * and validates the required fields.
 *
 * Two validation modes:
 *   - `readConfig()` returns whatever is present, marking missing fields.
 *     Used by `addr` / `whoami` to SHOW the user their current config.
 *   - `requireConfig()` throws if anything's missing. Used by commands that
 *     actually need to talk to the chain.
 */
import { isAddress } from 'ethers';

/** Required vars for full onchain functionality. */
export interface OnchainConfig {
  readonly rpcUrl: string;
  readonly chainId: number;
  readonly brawlersAddress: string;
  readonly duelAddress: string;
  readonly graveyardAddress: string;
  /** 0x-prefixed 64-char hex. Never log this value. */
  readonly playerKey: string;
  /** 0x-prefixed 64-char hex. Never log this value. */
  readonly signerKey: string;
}

/** Partial config showing what's set and what's missing. */
export interface OnchainConfigView {
  rpcUrl: string | null;
  chainId: number | null;
  brawlersAddress: string | null;
  duelAddress: string | null;
  graveyardAddress: string | null;
  playerKeySet: boolean;
  signerKeySet: boolean;
}

const ENV_KEYS = {
  rpcUrl: 'BRAWLERS_RPC_URL',
  chainId: 'BRAWLERS_CHAIN_ID',
  brawlersAddress: 'BRAWLERS_ADDRESS',
  duelAddress: 'DUEL_ADDRESS',
  graveyardAddress: 'GRAVEYARD_ADDRESS',
  playerKey: 'BRAWLERS_PLAYER_KEY',
  signerKey: 'BRAWLERS_SIGNER_KEY',
} as const;

function getAddr(envKey: string): string | null {
  const v = process.env[envKey];
  if (!v || v.trim().length === 0) return null;
  return isAddress(v) ? v : null;
}

function getInt(envKey: string): number | null {
  const v = process.env[envKey];
  if (!v || v.trim().length === 0) return null;
  const n = parseInt(v, 10);
  return Number.isInteger(n) ? n : null;
}

function getStr(envKey: string): string | null {
  const v = process.env[envKey];
  if (!v || v.trim().length === 0) return null;
  return v.trim();
}

function isValidPrivateKey(v: string | undefined): boolean {
  if (!v) return false;
  // 0x + 64 hex chars
  return /^0x[0-9a-fA-F]{64}$/.test(v.trim());
}

/** Non-throwing view of the current onchain config. */
export function readConfig(): OnchainConfigView {
  return {
    rpcUrl: getStr(ENV_KEYS.rpcUrl),
    chainId: getInt(ENV_KEYS.chainId),
    brawlersAddress: getAddr(ENV_KEYS.brawlersAddress),
    duelAddress: getAddr(ENV_KEYS.duelAddress),
    graveyardAddress: getAddr(ENV_KEYS.graveyardAddress),
    playerKeySet: isValidPrivateKey(process.env[ENV_KEYS.playerKey]),
    signerKeySet: isValidPrivateKey(process.env[ENV_KEYS.signerKey]),
  };
}

/** Throws if any required field is missing or invalid. */
export function requireConfig(): OnchainConfig {
  const missing: string[] = [];
  const invalid: string[] = [];

  const rpcUrl = getStr(ENV_KEYS.rpcUrl);
  if (!rpcUrl) missing.push(ENV_KEYS.rpcUrl);

  const chainId = getInt(ENV_KEYS.chainId);
  if (chainId === null) missing.push(ENV_KEYS.chainId);

  const brawlersAddress = getAddr(ENV_KEYS.brawlersAddress);
  if (!brawlersAddress) {
    (process.env[ENV_KEYS.brawlersAddress] ? invalid : missing).push(ENV_KEYS.brawlersAddress);
  }
  const duelAddress = getAddr(ENV_KEYS.duelAddress);
  if (!duelAddress) {
    (process.env[ENV_KEYS.duelAddress] ? invalid : missing).push(ENV_KEYS.duelAddress);
  }
  const graveyardAddress = getAddr(ENV_KEYS.graveyardAddress);
  if (!graveyardAddress) {
    (process.env[ENV_KEYS.graveyardAddress] ? invalid : missing).push(ENV_KEYS.graveyardAddress);
  }

  const playerKey = process.env[ENV_KEYS.playerKey]?.trim() ?? '';
  if (!playerKey) missing.push(ENV_KEYS.playerKey);
  else if (!isValidPrivateKey(playerKey)) invalid.push(ENV_KEYS.playerKey);

  const signerKey = process.env[ENV_KEYS.signerKey]?.trim() ?? '';
  if (!signerKey) missing.push(ENV_KEYS.signerKey);
  else if (!isValidPrivateKey(signerKey)) invalid.push(ENV_KEYS.signerKey);

  if (missing.length > 0 || invalid.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing: ${missing.join(', ')}`);
    if (invalid.length > 0) parts.push(`invalid: ${invalid.join(', ')}`);
    throw new Error(`onchain config incomplete, ${parts.join('; ')}`);
  }

  return {
    rpcUrl: rpcUrl!,
    chainId: chainId!,
    brawlersAddress: brawlersAddress!,
    duelAddress: duelAddress!,
    graveyardAddress: graveyardAddress!,
    playerKey,
    signerKey,
  };
}
