/**
 * Onchain client: assembles an ethers v6 provider, wallets, and Contract
 * instances from validated config.
 *
 * The `player` wallet is what sends transactions (mint, submitDuel, resurrect).
 * The `signer` wallet is what cryptographically signs DuelResult structs so
 * the Duel contract will accept them, it's an off-chain role, the key never
 * sends transactions in Phase 5.
 *
 * Both wallets share the same JsonRpcProvider so we only open one connection.
 */
import { Contract, JsonRpcProvider, Network, Wallet } from 'ethers';
import type { OnchainConfig } from './config.js';
import { BRAWLERS_ABI, DUEL_ABI, GRAVEYARD_ABI } from './abi.js';

/** Handles to all onchain resources. Returned by `createClient`. */
export interface OnchainClient {
  readonly provider: JsonRpcProvider;
  readonly player: Wallet;
  /** Off-chain signer for DuelResult structs. Not a transaction sender. */
  readonly dutySigner: Wallet;
  readonly brawlers: Contract;
  readonly duel: Contract;
  readonly graveyard: Contract;
  readonly config: OnchainConfig;
}

/**
 * Build the full client from a validated config.
 *
 * Does not hit the network, provider is lazy. Callers should issue a small
 * read (e.g. `provider.getBlockNumber()`) to confirm the RPC is reachable
 * before doing real work.
 */
export function createClient(cfg: OnchainConfig): OnchainClient {
  // staticNetwork must be a Network object (not `true`) when we also pass the
  // network argument, passing `true` here would be ignored and trigger a
  // chain-id probe on every call. See ethers v6 migration guide.
  const network = Network.from(cfg.chainId);
  const provider = new JsonRpcProvider(cfg.rpcUrl, network, {
    staticNetwork: network,
  });
  const player = new Wallet(cfg.playerKey, provider);
  const dutySigner = new Wallet(cfg.signerKey, provider);

  // Contracts bound to the player wallet, writes are signed by player.
  const brawlers = new Contract(cfg.brawlersAddress, BRAWLERS_ABI, player);
  const duel = new Contract(cfg.duelAddress, DUEL_ABI, player);
  const graveyard = new Contract(cfg.graveyardAddress, GRAVEYARD_ABI, player);

  return { provider, player, dutySigner, brawlers, duel, graveyard, config: cfg };
}

/** Cleanly tear down the JSON-RPC provider's network connection. */
export async function closeClient(client: OnchainClient): Promise<void> {
  await client.provider.destroy();
}
