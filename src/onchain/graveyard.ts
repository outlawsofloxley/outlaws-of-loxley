/**
 * High-level Graveyard contract operations.
 *
 * Resurrection flow:
 *   1. Read `resurrectionCost()` from chain (don't hardcode — owner can change it)
 *   2. Send `resurrect(tokenId)` with that value attached
 *   3. Wait 1 confirmation, decode Resurrected event
 *
 * The Graveyard internally calls back into Brawlers + Duel to flip isDead and
 * reset consecutiveLosses, so the caller only needs one tx.
 */
import type {
  ContractTransactionReceipt,
  ContractTransactionResponse,
} from 'ethers';
import type { OnchainClient } from './client.js';

/** Result of a successful resurrect tx. */
export interface ResurrectResult {
  readonly txHash: string;
  readonly blockNumber: number;
  readonly gasUsed: bigint;
  /** Amount of ETH in wei actually sent (= resurrectionCost at that moment). */
  readonly paid: bigint;
}

/** Read the current resurrection cost in wei. */
export async function readResurrectionCost(client: OnchainClient): Promise<bigint> {
  const cost = (await client.graveyard['resurrectionCost']!()) as bigint;
  return cost;
}

/** Check whether the configured Graveyard address has contract code. */
export async function verifyGraveyardContractExists(client: OnchainClient): Promise<void> {
  const code = await client.provider.getCode(client.config.graveyardAddress);
  if (code === '0x' || code === '0x0') {
    throw new Error(
      `No contract deployed at GRAVEYARD_ADDRESS ${client.config.graveyardAddress}.`,
    );
  }
}

/**
 * Resurrect a dead brawler by paying the fee to the Graveyard contract.
 *
 * Throws if tx reverts (e.g. brawler not dead, wrong owner, insufficient payment,
 * resurrection paused).
 */
export async function resurrectOnchain(
  client: OnchainClient,
  tokenId: number,
  nonce?: number,
): Promise<ResurrectResult> {
  const cost = await readResurrectionCost(client);
  const overrides: { value: bigint; nonce?: number } = { value: cost };
  if (nonce !== undefined) {
    overrides.nonce = nonce;
  }
  const tx = (await client.graveyard['resurrect']!(
    tokenId,
    overrides,
  )) as ContractTransactionResponse;
  const receipt: ContractTransactionReceipt | null = await tx.wait(1);
  if (!receipt) {
    throw new Error(`resurrect tx ${tx.hash} had no receipt`);
  }
  if (receipt.status !== 1) {
    throw new Error(`resurrect tx ${tx.hash} reverted (status ${String(receipt.status)})`);
  }

  return {
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    paid: cost,
  };
}
