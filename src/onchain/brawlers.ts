/**
 * High-level Brawlers contract operations.
 *
 * All functions take an OnchainClient (so tests can inject a mock) and return
 * domain types, never raw ethers results. This file is the boundary between
 * "ethers types" and "our types".
 */
import type {
  ContractTransactionReceipt,
  ContractTransactionResponse,
  EventLog,
  Log,
} from 'ethers';
import type { OnchainClient } from './client.js';
import type { Brawler } from '../core/types.js';
import {
  fromOnchainBrawler,
  fromOnchainWeapon,
  type OnchainBrawlerTuple,
  type OnchainWeaponTuple,
} from './convert.js';

/** Type guard: was this log successfully decoded into a known event? */
function isEventLog(log: Log | EventLog): log is EventLog {
  return (log as EventLog).fragment !== undefined;
}

/** Read the next tokenId that would be assigned on mint. */
export async function readNextTokenId(client: OnchainClient): Promise<number> {
  const next = (await client.brawlers['nextTokenId']!()) as bigint;
  return Number(next);
}

/** Verify the configured Brawlers contract actually has code at its address. */
export async function verifyBrawlersContractExists(client: OnchainClient): Promise<void> {
  const code = await client.provider.getCode(client.config.brawlersAddress);
  if (code === '0x' || code === '0x0') {
    throw new Error(
      `No contract deployed at BRAWLERS_ADDRESS ${client.config.brawlersAddress} on chain ${client.config.chainId}. ` +
        `Did you deploy? Run \`forge script script/Deploy.s.sol --rpc-url ${client.config.rpcUrl} --broadcast --private-key <key>\`.`,
    );
  }
}

/** Fetch one brawler's full state from chain, assembled as a local Brawler. */
export async function fetchBrawler(
  client: OnchainClient,
  tokenId: number,
): Promise<Brawler> {
  // Two parallel reads: the struct and its weapon row.
  const [tupleRaw, weaponRaw] = (await Promise.all([
    client.brawlers['getBrawler']!(tokenId),
    client.brawlers['getBrawlerWeapon']!(tokenId),
  ])) as [unknown, unknown];

  const tuple = tupleRaw as OnchainBrawlerTuple;
  const weapon = fromOnchainWeapon(weaponRaw as OnchainWeaponTuple);
  return fromOnchainBrawler(tokenId, tuple, weapon, Date.now());
}

/** Result of one successful on-chain mint. */
export interface MintResult {
  readonly tokenId: number;
  readonly txHash: string;
  readonly blockNumber: number;
  readonly gasUsed: bigint;
  readonly brawler: Brawler;
}

/**
 * Mint one brawler to the player's address.
 *
 * Flow:
 *   1. send `mint(player.address)` with optional explicit nonce
 *   2. wait 1 confirmation
 *   3. decode the BrawlerMinted event from the receipt to get tokenId
 *   4. fetch full Brawler state from chain
 *
 * The optional `nonce` argument is critical for batched mints: ethers v6's
 * JsonRpcProvider pre-fetches nonce from the node only when needed, which can
 * race two consecutive sends into the same nonce slot. Callers doing batches
 * should fetch `provider.getTransactionCount(player, 'pending')` once and
 * pass n, n+1, n+2, ... explicitly.
 *
 * Throws if the tx reverts, no BrawlerMinted event is found, or the receipt
 * otherwise can't be interpreted.
 */
export async function mintBrawlerOnchain(
  client: OnchainClient,
  nonce?: number,
): Promise<MintResult> {
  const overrides = nonce !== undefined ? { nonce } : {};
  const tx = (await client.brawlers['mint']!(
    client.player.address,
    overrides,
  )) as ContractTransactionResponse;
  const receipt: ContractTransactionReceipt | null = await tx.wait(1);
  if (!receipt) {
    throw new Error(`Mint tx ${tx.hash} had no receipt (dropped?)`);
  }
  if (receipt.status !== 1) {
    throw new Error(`Mint tx ${tx.hash} reverted (status ${String(receipt.status)})`);
  }

  // Find the BrawlerMinted event. ethers v6 returns logs typed as
  // Array<Log | EventLog>; EventLog is the subtype that carries .fragment/.args
  // when the log matched an ABI entry.
  let tokenId: number | null = null;
  for (const log of receipt.logs) {
    if (!isEventLog(log)) {
      continue;
    }
    if (log.fragment.name === 'BrawlerMinted') {
      tokenId = Number(log.args[0] as bigint);
      break;
    }
  }
  if (tokenId === null) {
    throw new Error(`Mint tx ${tx.hash} succeeded but no BrawlerMinted event found`);
  }

  const brawler = await fetchBrawler(client, tokenId);
  return {
    tokenId,
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    brawler,
  };
}
