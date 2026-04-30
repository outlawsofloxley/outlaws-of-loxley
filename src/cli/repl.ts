/**
 * REPL: readline loop + command dispatch.
 *
 * The REPL owns the GameState in memory and passes it to each command
 * handler. After any command that mutated state, we save to disk before
 * prompting again. On Ctrl+C we save and exit gracefully.
 */
import * as readline from 'node:readline';
import type { GameState } from './store.js';
import { saveState, newState } from './store.js';
import {
  commandHelp,
  commandMint,
  commandList,
  commandShow,
  commandDuel,
  commandGraveyard,
  commandLeaderboard,
  commandRename,
  commandHistory,
  commandReset,
  commandQuit,
} from './commands.js';
import {
  commandAddr,
  commandWhoami,
  commandMintOnchain,
  commandSync,
  commandDuelOnchain,
  commandResurrect,
} from './onchainCommands.js';
import { banner, c } from './format.js';

export interface ReplOptions {
  readonly dataPath: string;
  initialState: GameState;
}

export async function runRepl(opts: ReplOptions): Promise<void> {
  // `state` is held in a mutable container so the reset command can swap it.
  const ref: { state: GameState } = { state: opts.initialState };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: c.bold(c.red('> ')),
  });

  process.stdout.write(banner());
  rl.prompt();

  // Queue of pending lines. readline fires a `line` event per line even when
  // the user pastes a whole block, we serialize execution here so that an
  // async command (like `mint-onchain`) blocks any queued follow-up commands
  // until it completes. Without this, pasted commands run concurrently and
  // output interleaves.
  const queue: string[] = [];
  let running = false;
  let closed = false;

  async function drain(): Promise<void> {
    if (running) {
      return;
    }
    running = true;
    try {
      while (queue.length > 0 && !closed) {
        const line = queue.shift()!;
        await handleLine(line);
      }
    } finally {
      running = false;
    }
  }

  const handleLine = async (line: string): Promise<void> => {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      rl.prompt();
      return;
    }
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0]!.toLowerCase();
    const args = parts.slice(1);

    let result;
    try {
      result = await dispatch(ref, cmd, args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(c.red('  error: ' + msg) + '\n');
      rl.prompt();
      return;
    }

    process.stdout.write(result.output + '\n');

    if (result.mutated) {
      try {
        saveState(opts.dataPath, ref.state);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stdout.write(c.red('  SAVE FAILED: ' + msg) + '\n');
      }
    }

    if (result.exit) {
      closed = true;
      rl.close();
      return;
    }
    rl.prompt();
  };

  rl.on('line', (line) => {
    queue.push(line);
    // fire-and-forget: drain() internally handles errors per-command
    drain().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(c.red('  UNHANDLED: ' + msg) + '\n');
      rl.prompt();
    });
  });

  rl.on('SIGINT', () => {
    process.stdout.write('\n' + c.gray('  Ctrl+C, saving and exiting.') + '\n');
    try {
      saveState(opts.dataPath, ref.state);
    } catch {
      // best-effort on exit
    }
    closed = true;
    rl.close();
  });

  // Wait until the readline is closed before returning.
  await new Promise<void>((resolve) => {
    rl.on('close', resolve);
  });
}

async function dispatch(
  ref: { state: GameState },
  cmd: string,
  args: string[],
): Promise<{ output: string; mutated: boolean; exit?: boolean }> {
  switch (cmd) {
    case 'help':
    case '?':
      return commandHelp();
    case 'mint':
      return commandMint(ref.state, args);
    case 'list':
    case 'ls':
      return commandList(ref.state);
    case 'show':
    case 'info':
      return commandShow(ref.state, args);
    case 'duel':
    case 'fight':
      return commandDuel(ref.state, args);
    case 'graveyard':
    case 'grave':
      return commandGraveyard(ref.state);
    case 'leaderboard':
    case 'top':
      return commandLeaderboard(ref.state);
    case 'rename':
      return commandRename(ref.state, args);
    case 'history':
    case 'log':
      return commandHistory(ref.state, args);
    case 'reset': {
      const result = commandReset(args);
      if (result.mutated) {
        ref.state = newState(ref.state.masterSeed);
      }
      return result;
    }
    case 'addr':
      return commandAddr();
    case 'whoami':
      return await commandWhoami();
    case 'mint-onchain':
    case 'mintchain':
      return await commandMintOnchain(ref.state, args);
    case 'sync':
      return await commandSync(ref.state, args);
    case 'duel-onchain':
    case 'duelchain':
    case 'fightchain':
      return await commandDuelOnchain(ref.state, args);
    case 'resurrect':
    case 'revive':
      return await commandResurrect(ref.state, args);
    case 'quit':
    case 'exit':
    case 'q':
      return commandQuit();
    default:
      return {
        output: c.red(`unknown command: "${cmd}". Type "help" for the list.`),
        mutated: false,
      };
  }
}
