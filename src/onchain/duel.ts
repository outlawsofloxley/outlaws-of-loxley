/**
 * High-level Duel contract operations.
 *
 * The flow for submitting a duel:
 *   1. Run the fight simulator locally (Phase 2 code, unchanged)
 *   2. Compute new ELOs (Phase 2 code, unchanged)
 *   3. Build DuelResult struct with a fresh nonce + 1h expiry
 *   4. Ask the contract to hash it (view call, free, avoids hash-mismatch bugs)
 *   5. Sign the hash with the signer wallet (EIP-191 prefix added by signMessage)
 *   6. Submit (result, signature) to the contract from the player wallet
 *   7. Wait 1 confirmation, decode the DuelCompleted event
 *
 * The SIGNER wallet is distinct from the PLAYER wallet. Signer signs the
 * structured data; player broadcasts the tx. In production these are separate
 * machines; in Phase 5 local dev both keys are in .env.
 */
import { randomBytes } from 'node:crypto';
import type {
  ContractTransactionReceipt,
  ContractTransactionResponse,
  EventLog,
  Log,
} from 'ethers';
import { getBytes } from 'ethers';
import type { OnchainClient } from './client.js';
import type { FightResult } from '../core/types.js';

/** 1 hour in seconds — submission window before the signed result expires. */
export const DUEL_EXPIRY_SECONDS = 3600;

/** The struct the contract expects. Field names MUST match the Solidity tuple. */
export interface DuelResultStruct {
  readonly tokenA: bigint;
  readonly tokenB: bigint;
  readonly winnerId: bigint; // 0 for tie
  readonly rounds: bigint;
  readonly seed: bigint;
  readonly newEloA: bigint;
  readonly newEloB: bigint;
  readonly nonce: bigint;
  readonly expiry: bigint;
}

/** Type guard: was this log successfully decoded into a known event? */
function isEventLog(log: Log | EventLog): log is EventLog {
  return (log as EventLog).fragment !== undefined;
}

/** Generate a fresh 256-bit nonce. randomBytes is cryptographically strong. */
export function freshNonce(): bigint {
  const bytes = randomBytes(32);
  // BigInt.fromBuffer isn't a thing — do it manually
  let n = 0n;
  for (const b of bytes) {
    n = (n << 8n) | BigInt(b);
  }
  return n;
}

/**
 * Assemble the DuelResult struct from a local FightResult + ELO math.
 *
 * `newEloA` / `newEloB` come from the Phase 2 `applyDuelResult()` (post-floor).
 * `winnerId` is 0n on a tie, else uint32 of the winning tokenId.
 */
export function buildDuelResult(args: {
  fight: FightResult;
  newEloA: number;
  newEloB: number;
  nowSeconds?: number; // for tests — defaults to now
}): DuelResultStruct {
  const { fight, newEloA, newEloB } = args;
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  return {
    tokenA: BigInt(fight.brawlerAId),
    tokenB: BigInt(fight.brawlerBId),
    winnerId: BigInt(fight.winnerId ?? 0),
    rounds: BigInt(fight.rounds),
    seed: fight.seed,
    newEloA: BigInt(newEloA),
    newEloB: BigInt(newEloB),
    nonce: freshNonce(),
    expiry: BigInt(now + DUEL_EXPIRY_SECONDS),
  };
}

/** Hash the result on-chain (view call) to avoid re-implementing abi.encode. */
export async function hashDuelResult(
  client: OnchainClient,
  result: DuelResultStruct,
): Promise<string> {
  // The contract takes a single struct argument. ethers v6 expects it as a tuple/object.
  const hash = (await client.duel['hashDuelResult']!(result)) as string;
  return hash;
}

/**
 * Sign the result. Uses `wallet.signMessage(bytes)` which automatically applies
 * the EIP-191 prefix that the contract's `MessageHashUtils.toEthSignedMessageHash`
 * expects when recovering.
 */
export async function signDuelResult(
  client: OnchainClient,
  result: DuelResultStruct,
): Promise<string> {
  const hash = await hashDuelResult(client, result);
  const signature = await client.dutySigner.signMessage(getBytes(hash));
  return signature;
}

/** One successful submitDuel tx with its decoded event. */
export interface SubmitResult {
  readonly txHash: string;
  readonly blockNumber: number;
  readonly gasUsed: bigint;
  /** True if `BrawlerDied(tokenA)` was emitted. */
  readonly tokenADied: boolean;
  /** True if `BrawlerDied(tokenB)` was emitted. */
  readonly tokenBDied: boolean;
}

/**
 * Submit a signed DuelResult to the Duel contract. Waits 1 confirmation.
 *
 * Caller is responsible for pre-flight (chain ID, contract presence, both
 * brawlers alive) so this function can stay focused on signing + sending.
 *
 * Returns event-decoded side effects (deaths) so the caller can update local
 * state without a second RPC roundtrip.
 */
export async function submitDuelOnchain(
  client: OnchainClient,
  result: DuelResultStruct,
  nonce?: number,
): Promise<SubmitResult> {
  const signature = await signDuelResult(client, result);

  const overrides = nonce !== undefined ? { nonce } : {};
  const tx = (await client.duel['submitDuel']!(
    result,
    signature,
    overrides,
  )) as ContractTransactionResponse;
  const receipt: ContractTransactionReceipt | null = await tx.wait(1);
  if (!receipt) {
    throw new Error(`submitDuel tx ${tx.hash} had no receipt`);
  }
  if (receipt.status !== 1) {
    throw new Error(`submitDuel tx ${tx.hash} reverted (status ${String(receipt.status)})`);
  }

  // Inspect events for deaths
  let aDied = false;
  let bDied = false;
  for (const log of receipt.logs) {
    if (!isEventLog(log)) {
      continue;
    }
    if (log.fragment.name === 'BrawlerDied') {
      const tid = log.args[0] as bigint;
      if (tid === result.tokenA) {
        aDied = true;
      }
      if (tid === result.tokenB) {
        bDied = true;
      }
    }
  }

  return {
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    tokenADied: aDied,
    tokenBDied: bDied,
  };
}
