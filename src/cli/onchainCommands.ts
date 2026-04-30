/**
 * Phase 5 on-chain commands.
 *
 * Kept in a separate file from commands.ts so the off-chain game continues to
 * work even if ethers fails to import (unlikely, but isolates the blast
 * radius).
 *
 * All network calls are wrapped in try/catch and return a CommandResult, the
 * REPL loop never sees an unhandled rejection from Phase 5 code.
 */
import type { CommandResult } from './commands.js';
import { randomBytes } from 'node:crypto';
import { readConfig, requireConfig } from '../onchain/config.js';
import type { OnchainClient } from '../onchain/client.js';
import { createClient, closeClient } from '../onchain/client.js';
import {
  fetchBrawler,
  mintBrawlerOnchain,
  readNextTokenId,
  verifyBrawlersContractExists,
} from '../onchain/brawlers.js';
import {
  buildDuelResult,
  submitDuelOnchain,
} from '../onchain/duel.js';
import {
  readResurrectionCost,
  resurrectOnchain,
  verifyGraveyardContractExists,
} from '../onchain/graveyard.js';
import type { GameState } from './store.js';
import { findBrawler, upsertBrawler } from './store.js';
import type { Brawler } from '../core/types.js';
import { simulateFight } from '../sim/combat.js';
import { applyDuelResult as eloApply } from '../core/elo.js';
import { totalGames } from '../core/brawler.js';
import { c, formatFight } from './format.js';
import { ethAmount, formatOnchainError, okTag, shortHex } from './onchainHelpers.js';

/**
 * `addr`, print the currently configured contract addresses.
 *
 * Pure read from env; never hits the network. Useful as a first diagnostic
 * when on-chain commands misbehave.
 */
export function commandAddr(): CommandResult {
  const v = readConfig();

  const lines: string[] = [''];
  lines.push(c.bold('ON-CHAIN CONFIG'));
  lines.push('');
  lines.push(
    `  ${okTag(v.rpcUrl !== null)} RPC URL        ${v.rpcUrl ?? c.gray('(unset)')}`,
  );
  lines.push(
    `  ${okTag(v.chainId !== null)} Chain ID       ${v.chainId === null ? c.gray('(unset)') : String(v.chainId)}`,
  );
  lines.push('');
  lines.push(
    `  ${okTag(v.brawlersAddress !== null)} Brawlers       ${v.brawlersAddress ?? c.gray('(unset)')}`,
  );
  lines.push(
    `  ${okTag(v.duelAddress !== null)} Duel           ${v.duelAddress ?? c.gray('(unset)')}`,
  );
  lines.push(
    `  ${okTag(v.graveyardAddress !== null)} Graveyard      ${v.graveyardAddress ?? c.gray('(unset)')}`,
  );
  lines.push('');
  lines.push(
    `  ${okTag(v.playerKeySet)} Player key     ${v.playerKeySet ? c.gray('SET (hidden)') : c.red('(not set)')}`,
  );
  lines.push(
    `  ${okTag(v.signerKeySet)} Signer key     ${v.signerKeySet ? c.gray('SET (hidden)') : c.red('(not set)')}`,
  );
  lines.push('');

  const allGood =
    v.rpcUrl !== null &&
    v.chainId !== null &&
    v.brawlersAddress !== null &&
    v.duelAddress !== null &&
    v.graveyardAddress !== null &&
    v.playerKeySet &&
    v.signerKeySet;

  if (allGood) {
    lines.push('  ' + c.green('Ready for on-chain commands.'));
  } else {
    lines.push('  ' + c.red('Config incomplete.') + c.gray(' Copy .env.example → .env and fill values.'));
  }
  lines.push('');

  return { output: lines.join('\n'), mutated: false };
}

/**
 * `whoami`, print the player's address, its ETH balance, and block height.
 *
 * Hits the RPC (one getBalance + one getBlockNumber). Network failures are
 * caught and rendered as a one-line error.
 */
export async function commandWhoami(): Promise<CommandResult> {
  let client: OnchainClient | undefined;
  try {
    const cfg = requireConfig();
    client = createClient(cfg);
  } catch (err) {
    return {
      output: formatOnchainError(err) + '\n  ' + c.gray('run `addr` to inspect current config.'),
      mutated: false,
    };
  }

  try {
    // Use allSettled so if one request fails, we don't leave the others dangling
    // with an unhandled rejection when closeClient() -> destroy() cancels them.
    const results = await Promise.allSettled([
      client.provider.getBalance(client.player.address),
      client.provider.getBlockNumber(),
      client.provider.getNetwork(),
    ]);
    const [balanceR, blockR, networkR] = results;
    // If all three failed, treat as a connection error; otherwise show what we can.
    if (balanceR.status === 'rejected' && blockR.status === 'rejected' && networkR.status === 'rejected') {
      return { output: formatOnchainError(balanceR.reason), mutated: false };
    }

    const playerAddr = client.player.address;
    const signerAddr = client.dutySigner.address;
    const balance = balanceR.status === 'fulfilled' ? balanceR.value : null;
    const blockNumber = blockR.status === 'fulfilled' ? blockR.value : null;
    const network = networkR.status === 'fulfilled' ? networkR.value : null;

    const lines: string[] = [''];
    lines.push(c.bold('WHOAMI'));
    lines.push('');
    lines.push(`  Player:      ${c.cyan(playerAddr)}`);
    lines.push(`  Balance:     ${balance !== null ? c.green(ethAmount(balance)) : c.red('(rpc error)')}`);
    lines.push('');
    lines.push(`  Signer:      ${c.cyan(signerAddr)} ${c.gray('(off-chain signer, no txs)')}`);
    lines.push('');
    lines.push(`  RPC:         ${client.config.rpcUrl}`);
    lines.push(`  Chain ID:    ${network !== null ? String(network.chainId) : c.red('(rpc error)')}`);
    lines.push(`  Block:       ${blockNumber !== null ? blockNumber : c.red('(rpc error)')}`);
    lines.push('');

    if (network !== null && Number(network.chainId) !== client.config.chainId) {
      lines.push(
        '  ' +
          c.red(
            `WARNING: RPC chain ID ${String(network.chainId)} != config BRAWLERS_CHAIN_ID ${client.config.chainId}`,
          ),
      );
      lines.push('');
    }

    return { output: lines.join('\n'), mutated: false };
  } catch (err) {
    return { output: formatOnchainError(err), mutated: false };
  } finally {
    if (client) await closeClient(client);
  }
}

// --- Re-export so index-style imports are easy ---

export { shortHex };

/**
 * `mint-onchain [n]`, mint n brawlers on-chain.
 *
 * Flow for each mint:
 *   1. Send `Brawlers.mint(player)` tx
 *   2. Wait 1 confirmation
 *   3. Decode the `BrawlerMinted` event for the tokenId
 *   4. Read back the full brawler state and upsert into local cache
 *
 * Runs sequentially (not parallel) so tx nonces stay in order with a single
 * RPC. If mint i succeeds but mint i+1 fails, everything up to i is already
 * saved, the command reports partial success. Cap at 20 per invocation.
 */
export async function commandMintOnchain(state: GameState, args: string[]): Promise<CommandResult> {
  const n = args.length === 0 ? 1 : parseInt(args[0]!, 10);
  if (!Number.isInteger(n) || n < 1 || n > 20) {
    return {
      output: c.red('mint-onchain: count must be an integer between 1 and 20'),
      mutated: false,
    };
  }

  let client: OnchainClient | undefined;
  try {
    const cfg = requireConfig();
    client = createClient(cfg);
  } catch (err) {
    return {
      output: formatOnchainError(err) + '\n  ' + c.gray('run `addr` to inspect current config.'),
      mutated: false,
    };
  }

  const lines: string[] = [''];
  lines.push(c.bold(`MINT-ONCHAIN × ${n}`));
  lines.push('');

  let successes = 0;

  try {
    // Preflight, chain ID and contract presence. These are cheap and worth
    // doing BEFORE burning gas on a tx that would then revert / mis-send.
    const network = await client.provider.getNetwork();
    if (Number(network.chainId) !== client.config.chainId) {
      lines.push(
        '  ' +
          c.red(
            `ABORT: RPC chain ID ${String(network.chainId)} != configured ${client.config.chainId}. `,
          ) +
          c.gray('\n  Refusing to broadcast transactions to the wrong chain.'),
      );
      lines.push('');
      return { output: lines.join('\n'), mutated: false };
    }
    await verifyBrawlersContractExists(client);

    // Pre-fetch the player's pending nonce ONCE. ethers v6 does not maintain
    // a nonce manager on Wallet, so successive contract calls can both pull
    // the same nonce from the node when they run back-to-back. Passing the
    // nonce explicitly as an override prevents that race.
    const startNonce = await client.provider.getTransactionCount(client.player.address, 'pending');

    for (let i = 0; i < n; i++) {
      try {
        const result = await mintBrawlerOnchain(client, startNonce + i);
        upsertBrawler(state, result.brawler);
        // Keep local nextTokenId ahead of the chain so `mint` (local) won't
        // collide. Chain's nextTokenId is (tokenId + 1), so mirror.
        if (state.nextTokenId <= result.tokenId) {
          state.nextTokenId = result.tokenId + 1;
        }
        successes++;
        lines.push(
          '  ' +
            c.green('✓') +
            ` #${result.tokenId} ` +
            c.gray(`tx ${shortHex(result.txHash)}`) +
            ` block ${result.blockNumber} ` +
            c.gray(`gas ${result.gasUsed.toString()}`) +
            ` "${result.brawler.name}" ` +
            c.cyan(result.brawler.weapon.name),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lines.push('  ' + c.red('✗ ' + msg));
        break;
      }
    }
  } finally {
    await closeClient(client);
  }

  lines.push('');
  if (successes === n) {
    lines.push('  ' + c.green(`Minted ${successes} of ${n}. Local cache updated.`));
  } else {
    lines.push(
      '  ' +
        c.red(`Minted ${successes} of ${n}.`) +
        ' ' +
        c.gray('Partial state saved; you can retry for the rest.'),
    );
  }
  lines.push('');

  return { output: lines.join('\n'), mutated: successes > 0 };
}

/**
 * `sync [id]`, reconcile local cache with chain state.
 *
 * With no arg: pull `nextTokenId` from chain, then fetch tokens 1..nextTokenId-1.
 * With an arg: fetch just that single tokenId.
 *
 * Always chain-wins. Prints a diff summary.
 */
export async function commandSync(state: GameState, args: string[]): Promise<CommandResult> {
  let targetId: number | null = null;
  if (args.length > 0) {
    const id = parseInt(args[0]!, 10);
    if (!Number.isInteger(id) || id < 1) {
      return { output: c.red(`sync: invalid token ID "${args[0]!}"`), mutated: false };
    }
    targetId = id;
  }

  let client: OnchainClient | undefined;
  try {
    const cfg = requireConfig();
    client = createClient(cfg);
  } catch (err) {
    return {
      output: formatOnchainError(err) + '\n  ' + c.gray('run `addr` to inspect current config.'),
      mutated: false,
    };
  }

  const lines: string[] = [''];
  lines.push(c.bold('SYNC'));
  lines.push('');

  let added = 0;
  let updated = 0;
  let errored = 0;

  try {
    const network = await client.provider.getNetwork();
    if (Number(network.chainId) !== client.config.chainId) {
      lines.push('  ' + c.red(`ABORT: RPC chain ID mismatch.`));
      lines.push('');
      return { output: lines.join('\n'), mutated: false };
    }
    await verifyBrawlersContractExists(client);

    let ids: number[];
    if (targetId !== null) {
      ids = [targetId];
      lines.push(`  Pulling token #${targetId} from chain...`);
    } else {
      const chainNext = await readNextTokenId(client);
      lines.push(`  Chain nextTokenId: ${chainNext}`);
      if (chainNext <= 1) {
        lines.push('  ' + c.gray('Nothing minted on chain yet.'));
        lines.push('');
        return { output: lines.join('\n'), mutated: false };
      }
      ids = Array.from({ length: chainNext - 1 }, (_, i) => i + 1);
      lines.push(`  Pulling ${ids.length} tokens from chain...`);
      // Keep local nextTokenId in lockstep so future local `mint` doesn't clash.
      if (state.nextTokenId < chainNext) {
        state.nextTokenId = chainNext;
      }
    }

    for (const id of ids) {
      try {
        const fromChain = await fetchBrawler(client, id);
        const existing = findBrawler(state, id);
        const wasUpdate = upsertBrawler(state, fromChain);
        if (wasUpdate) {
          // Only note it as 'updated' if fields actually differed from local.
          if (!existing || !sameCoreFields(existing, fromChain)) {
            updated++;
          }
        } else {
          added++;
        }
      } catch (err) {
        errored++;
        const msg = err instanceof Error ? err.message : String(err);
        lines.push(`  ${c.red('✗')} #${id}: ${msg}`);
      }
    }
  } finally {
    await closeClient(client);
  }

  lines.push('');
  const summary: string[] = [];
  if (added > 0) {
    summary.push(c.green(`${added} added`));
  }
  if (updated > 0) {
    summary.push(c.yellow(`${updated} updated`));
  }
  if (errored > 0) {
    summary.push(c.red(`${errored} errored`));
  }
  if (summary.length === 0) {
    summary.push(c.gray('no changes'));
  }
  lines.push('  ' + summary.join(c.gray(' · ')));
  lines.push('');

  return { output: lines.join('\n'), mutated: added > 0 || updated > 0 };
}

/**
 * Compare the "interesting" fields of two brawlers. Used by sync to decide if
 * the local cache actually drifted from chain. We ignore `createdAt` because
 * sync always stamps Date.now() on pulled records, so every pull would
 * otherwise look like an update.
 */
function sameCoreFields(a: Brawler, b: Brawler): boolean {
  if (a.tokenId !== b.tokenId) {
    return false;
  }
  if (a.name !== b.name) {
    return false;
  }
  if (a.level !== b.level) {
    return false;
  }
  if (a.xp !== b.xp) {
    return false;
  }
  if (a.elo !== b.elo) {
    return false;
  }
  if (a.wins !== b.wins) {
    return false;
  }
  if (a.losses !== b.losses) {
    return false;
  }
  if (a.ties !== b.ties) {
    return false;
  }
  if (a.status !== b.status) {
    return false;
  }
  if (a.weapon.name !== b.weapon.name) {
    return false;
  }
  if (
    a.stats.strength !== b.stats.strength ||
    a.stats.dexterity !== b.stats.dexterity ||
    a.stats.constitution !== b.stats.constitution ||
    a.stats.intelligence !== b.stats.intelligence ||
    a.stats.wisdom !== b.stats.wisdom ||
    a.stats.charisma !== b.stats.charisma
  ) {
    return false;
  }
  return true;
}

/**
 * `duel-onchain <idA> <idB> [hexSeed]`, run an on-chain duel.
 *
 * Flow:
 *   1. Preflight (chain match, contract present, both brawlers alive)
 *   2. Fetch fresh on-chain state for both brawlers (don't trust local cache, 
 *      someone else might have moved them)
 *   3. Run the fight simulation locally with the provided or random seed
 *   4. Compute new ELOs via Phase 2 code
 *   5. Build + sign DuelResult
 *   6. Submit to contract, wait 1 confirmation
 *   7. Re-sync both brawlers from chain into local cache
 *   8. Print fight log + on-chain summary
 *
 * Optional 3rd arg: hex seed (e.g. 0xdeadbeef). Useful for reproducing a
 * specific fight. When omitted, a fresh 64-bit seed is rolled locally.
 */
export async function commandDuelOnchain(state: GameState, args: string[]): Promise<CommandResult> {
  if (args.length < 2) {
    return {
      output: c.red('duel-onchain: need two token IDs, e.g. `duel-onchain 1 2`'),
      mutated: false,
    };
  }
  const idA = parseInt(args[0]!, 10);
  const idB = parseInt(args[1]!, 10);
  if (!Number.isInteger(idA) || !Number.isInteger(idB) || idA < 1 || idB < 1) {
    return { output: c.red('duel-onchain: invalid token ID(s)'), mutated: false };
  }
  if (idA === idB) {
    return { output: c.red('duel-onchain: a brawler cannot fight itself'), mutated: false };
  }

  // Parse optional seed
  let seed: bigint;
  if (args.length >= 3) {
    try {
      seed = BigInt(args[2]!); // BigInt accepts "42" and "0x2a"
      if (seed < 0n) {
        return { output: c.red('duel-onchain: seed must be non-negative'), mutated: false };
      }
    } catch {
      return {
        output: c.red(`duel-onchain: invalid seed "${args[2]!}", must be decimal or 0x hex`),
        mutated: false,
      };
    }
  } else {
    // Random 64-bit seed (8 bytes is plenty of entropy for an RNG seed)
    const bytes = randomBytes(8);
    let n = 0n;
    for (const b of bytes) {
      n = (n << 8n) | BigInt(b);
    }
    seed = n;
  }

  let client: OnchainClient | undefined;
  try {
    const cfg = requireConfig();
    client = createClient(cfg);
  } catch (err) {
    return {
      output: formatOnchainError(err) + '\n  ' + c.gray('run `addr` to inspect current config.'),
      mutated: false,
    };
  }

  const lines: string[] = [''];
  lines.push(c.bold('DUEL-ONCHAIN'));
  lines.push('');

  try {
    const network = await client.provider.getNetwork();
    if (Number(network.chainId) !== client.config.chainId) {
      lines.push('  ' + c.red('ABORT: RPC chain ID mismatch.'));
      lines.push('');
      return { output: lines.join('\n'), mutated: false };
    }
    await verifyBrawlersContractExists(client);

    // Fetch fresh state, we don't trust local cache for writes
    const [a, b] = await Promise.all([fetchBrawler(client, idA), fetchBrawler(client, idB)]);
    if (a.status !== 'alive') {
      lines.push('  ' + c.red(`Brawler #${idA} (${a.name}) is dead. Resurrect first.`));
      lines.push('');
      return { output: lines.join('\n'), mutated: false };
    }
    if (b.status !== 'alive') {
      lines.push('  ' + c.red(`Brawler #${idB} (${b.name}) is dead. Resurrect first.`));
      lines.push('');
      return { output: lines.join('\n'), mutated: false };
    }

    // Run sim locally
    const fight = simulateFight(a, b, seed);

    // Compute ELO, use Phase 2 math, which matches the contract because
    // we send the final ELOs in the signed payload.
    const outcomeForA =
      fight.winnerId === a.tokenId ? 'win' : fight.winnerId === b.tokenId ? 'loss' : 'tie';
    const elo = eloApply(a.elo, b.elo, totalGames(a), totalGames(b), outcomeForA);

    // Assemble + sign + submit
    const result = buildDuelResult({ fight, newEloA: elo.newA, newEloB: elo.newB });
    const submitted = await submitDuelOnchain(client, result);

    // Re-sync both brawlers from chain
    const [aFresh, bFresh] = await Promise.all([
      fetchBrawler(client, idA),
      fetchBrawler(client, idB),
    ]);
    upsertBrawler(state, aFresh);
    upsertBrawler(state, bFresh);
    if (state.nextTokenId <= Math.max(idA, idB)) {
      state.nextTokenId = Math.max(idA, idB) + 1;
    }

    // Fight log (same style as off-chain duel)
    const nameOf = (id: number): string => {
      if (id === a.tokenId) {
        return a.name;
      }
      if (id === b.tokenId) {
        return b.name;
      }
      return '??';
    };
    lines.push(formatFight(fight, nameOf));
    lines.push('');

    // ELO summary using pre/post chain values
    const sign = (n: number): string => (n >= 0 ? '+' + n : String(n));
    lines.push(
      '  ' +
        c.bold(a.name) +
        '  ELO ' +
        c.gray(String(a.elo) + ' → ') +
        c.cyan(c.bold(String(aFresh.elo))) +
        '  ' +
        (elo.deltaA >= 0 ? c.green(sign(elo.deltaA)) : c.red(sign(elo.deltaA))),
    );
    lines.push(
      '  ' +
        c.bold(b.name) +
        '  ELO ' +
        c.gray(String(b.elo) + ' → ') +
        c.cyan(c.bold(String(bFresh.elo))) +
        '  ' +
        (elo.deltaB >= 0 ? c.green(sign(elo.deltaB)) : c.red(sign(elo.deltaB))),
    );

    if (submitted.tokenADied) {
      lines.push('');
      lines.push(c.red(c.bold(`  ✝  ${a.name} collapses after three consecutive defeats.`)));
    }
    if (submitted.tokenBDied) {
      lines.push('');
      lines.push(c.red(c.bold(`  ✝  ${b.name} collapses after three consecutive defeats.`)));
    }

    lines.push('');
    lines.push(
      '  ' +
        c.gray('tx ') +
        shortHex(submitted.txHash) +
        c.gray('  block ') +
        String(submitted.blockNumber) +
        c.gray('  gas ') +
        submitted.gasUsed.toString(),
    );
    lines.push('');

    return { output: lines.join('\n'), mutated: true };
  } catch (err) {
    lines.push(formatOnchainError(err));
    lines.push('');
    return { output: lines.join('\n'), mutated: false };
  } finally {
    await closeClient(client);
  }
}

/**
 * `resurrect <id>`, pay the resurrection fee to revive a dead brawler.
 *
 * Flow:
 *   1. Preflight (chain match, Graveyard contract present)
 *   2. Fetch brawler from chain, confirm it's dead (can't resurrect a living brawler)
 *   3. Read current resurrection cost
 *   4. Confirm player has enough ETH
 *   5. Send `resurrect(tokenId)` with cost as value, wait 1 confirmation
 *   6. Re-sync the brawler into local cache
 */
export async function commandResurrect(state: GameState, args: string[]): Promise<CommandResult> {
  if (args.length < 1) {
    return { output: c.red('resurrect: need a token ID, e.g. `resurrect 3`'), mutated: false };
  }
  const tokenId = parseInt(args[0]!, 10);
  if (!Number.isInteger(tokenId) || tokenId < 1) {
    return { output: c.red(`resurrect: invalid token ID "${args[0]!}"`), mutated: false };
  }

  let client: OnchainClient | undefined;
  try {
    const cfg = requireConfig();
    client = createClient(cfg);
  } catch (err) {
    return {
      output: formatOnchainError(err) + '\n  ' + c.gray('run `addr` to inspect current config.'),
      mutated: false,
    };
  }

  const lines: string[] = [''];
  lines.push(c.bold(`RESURRECT #${tokenId}`));
  lines.push('');

  try {
    const network = await client.provider.getNetwork();
    if (Number(network.chainId) !== client.config.chainId) {
      lines.push('  ' + c.red('ABORT: RPC chain ID mismatch.'));
      lines.push('');
      return { output: lines.join('\n'), mutated: false };
    }
    await verifyBrawlersContractExists(client);
    await verifyGraveyardContractExists(client);

    const b = await fetchBrawler(client, tokenId);
    if (b.status === 'alive') {
      lines.push('  ' + c.red(`${b.name} is already alive, no resurrection needed.`));
      lines.push('');
      return { output: lines.join('\n'), mutated: false };
    }

    const cost = await readResurrectionCost(client);
    const balance = await client.provider.getBalance(client.player.address);
    if (balance < cost) {
      lines.push(
        '  ' +
          c.red(
            `Insufficient balance: need ${ethAmount(cost)}, have ${ethAmount(balance)}.`,
          ),
      );
      lines.push('');
      return { output: lines.join('\n'), mutated: false };
    }
    lines.push(`  Cost: ${c.yellow(ethAmount(cost))}`);
    lines.push(`  Brawler: ${b.name}  ${c.gray('(currently in graveyard)')}`);

    const receipt = await resurrectOnchain(client, tokenId);

    const bFresh = await fetchBrawler(client, tokenId);
    upsertBrawler(state, bFresh);

    lines.push('');
    if (bFresh.status === 'alive') {
      lines.push('  ' + c.green(`✓ ${b.name} rises from the dead.`));
    } else {
      lines.push('  ' + c.red('✗ Tx landed but brawler still marked dead, investigate.'));
    }
    lines.push('');
    lines.push(
      '  ' +
        c.gray('tx ') +
        shortHex(receipt.txHash) +
        c.gray('  block ') +
        String(receipt.blockNumber) +
        c.gray('  gas ') +
        receipt.gasUsed.toString() +
        c.gray('  paid ') +
        ethAmount(receipt.paid),
    );
    lines.push('');

    return { output: lines.join('\n'), mutated: true };
  } catch (err) {
    lines.push(formatOnchainError(err));
    lines.push('');
    return { output: lines.join('\n'), mutated: false };
  } finally {
    await closeClient(client);
  }
}
