/**
 * Command handlers for the CLI.
 *
 * Each command is a function (state, args) => string (the output to print).
 * Commands mutate `state` directly; the REPL saves after each call.
 *
 * Keeping commands as separate functions makes them trivially testable
 * without a readline instance.
 */
import { randomBytes } from 'node:crypto';
import type { GameState } from './store.js';
import {
  findBrawler,
  aliveBrawlers,
  deadBrawlers,
  addBrawler,
  applyDuelResult as storeApplyDuel,
  renameBrawler,
} from './store.js';
import { createBrawler, totalGames } from '../core/brawler.js';
import { simulateFight } from '../sim/combat.js';
import { applyDuelResult as eloApply } from '../core/elo.js';
import { brawlerLine, brawlerDetail, formatFight, c } from './format.js';

/** Result of a command: text to print, plus whether state changed (so we save). */
export interface CommandResult {
  output: string;
  mutated: boolean;
  exit?: boolean;
}

export function commandHelp(): CommandResult {
  const lines: string[] = [
    '',
    c.bold('COMMANDS'),
    '',
    '  ' + c.cyan('help                   ') + c.gray('Show this help'),
    '  ' + c.cyan('mint [n]               ') + c.gray('Mint n new brawlers (default 1, max 100)'),
    '  ' + c.cyan('list                   ') + c.gray('Show all alive brawlers'),
    '  ' + c.cyan('show <id>              ') + c.gray('Show detailed view of one brawler'),
    '  ' + c.cyan('duel <idA> <idB>       ') + c.gray('Fight two brawlers with a random seed'),
    '  ' + c.cyan('duel <idA> <idB> <hex> ') + c.gray('Fight with a specific seed (replay)'),
    '  ' + c.cyan('graveyard              ') + c.gray('Show dead brawlers'),
    '  ' + c.cyan('leaderboard            ') + c.gray('Top 10 by ELO'),
    '  ' + c.cyan('rename <id> <name>     ') + c.gray('Rename a brawler'),
    '  ' + c.cyan('history [n]            ') + c.gray('Last n duels (default 10)'),
    '  ' + c.cyan('reset                  ') + c.gray('Wipe all state (prompts first)'),
    '  ' + c.cyan('quit | exit            ') + c.gray('Exit the game'),
    '',
    c.bold('ON-CHAIN'),
    '',
    '  ' + c.cyan('addr                   ') + c.gray('Show configured contract addresses'),
    '  ' + c.cyan('whoami                 ') + c.gray('Show player address + ETH balance'),
    '  ' + c.cyan('mint-onchain [n]       ') + c.gray('Mint n real NFTs (default 1, max 20)'),
    '  ' + c.cyan('sync [id]              ') + c.gray('Pull chain state into local cache'),
    '  ' + c.cyan('duel-onchain a b [seed]') + c.gray('Sign + submit an on-chain duel'),
    '  ' + c.cyan('resurrect <id>         ') + c.gray('Pay the fee to revive a dead brawler'),
    '',
  ];
  return { output: lines.join('\n'), mutated: false };
}

export function commandMint(state: GameState, args: string[]): CommandResult {
  const n = args.length === 0 ? 1 : parseInt(args[0]!, 10);
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    return { output: c.red('mint: count must be an integer between 1 and 100'), mutated: false };
  }
  const lines: string[] = [];
  lines.push('');
  for (let i = 0; i < n; i++) {
    const tokenId = state.nextTokenId;
    const brawler = createBrawler(state.masterSeed, tokenId);
    addBrawler(state, brawler);
    state.nextTokenId++;
    lines.push('  ' + c.green('+ minted') + ' ' + brawlerLine(brawler));
  }
  lines.push('');
  return { output: lines.join('\n'), mutated: true };
}

export function commandList(state: GameState): CommandResult {
  const alive = aliveBrawlers(state);
  if (alive.length === 0) {
    return {
      output: c.gray('\n  No living brawlers. Use `mint` to create one.\n'),
      mutated: false,
    };
  }
  const sorted = [...alive].sort((a, b) => b.elo - a.elo);
  const lines: string[] = [''];
  for (const b of sorted) {
    lines.push('  ' + brawlerLine(b));
  }
  lines.push('');
  lines.push(c.gray(`  ${sorted.length} alive`));
  lines.push('');
  return { output: lines.join('\n'), mutated: false };
}

export function commandShow(state: GameState, args: string[]): CommandResult {
  if (args.length === 0) {
    return { output: c.red('show: need a brawler ID, e.g. `show 1`'), mutated: false };
  }
  const id = parseInt(args[0]!, 10);
  if (!Number.isInteger(id)) {
    return { output: c.red(`show: invalid ID "${args[0]!}"`), mutated: false };
  }
  const b = findBrawler(state, id);
  if (!b) {
    return { output: c.red(`show: brawler ${id} not found`), mutated: false };
  }
  return { output: brawlerDetail(b), mutated: false };
}

export function commandDuel(state: GameState, args: string[]): CommandResult {
  if (args.length < 2 || args.length > 3) {
    return {
      output: c.red('duel: usage is `duel <idA> <idB> [hex-seed]`'),
      mutated: false,
    };
  }
  const idA = parseInt(args[0]!, 10);
  const idB = parseInt(args[1]!, 10);
  if (!Number.isInteger(idA) || !Number.isInteger(idB)) {
    return { output: c.red('duel: IDs must be integers'), mutated: false };
  }
  if (idA === idB) {
    return { output: c.red('duel: a brawler cannot fight themselves'), mutated: false };
  }
  const a = findBrawler(state, idA);
  const b = findBrawler(state, idB);
  if (!a) return { output: c.red(`duel: brawler ${idA} not found`), mutated: false };
  if (!b) return { output: c.red(`duel: brawler ${idB} not found`), mutated: false };
  if (a.status !== 'alive') {
    return { output: c.red(`duel: ${a.name} is in the graveyard`), mutated: false };
  }
  if (b.status !== 'alive') {
    return { output: c.red(`duel: ${b.name} is in the graveyard`), mutated: false };
  }

  // Seed: user-provided hex or freshly random.
  let seed: bigint;
  if (args.length === 3) {
    const raw = args[2]!;
    const hex = raw.startsWith('0x') || raw.startsWith('0X') ? raw.slice(2) : raw;
    if (!/^[0-9a-fA-F]+$/.test(hex)) {
      return {
        output: c.red('duel: seed must be a hex string (with or without 0x prefix)'),
        mutated: false,
      };
    }
    seed = BigInt('0x' + hex);
  } else {
    // 64-bit random from crypto. Loop explicitly to keep TS happy with Buffer types.
    const bytes = randomBytes(8);
    let s = 0n;
    for (let i = 0; i < 8; i++) {
      s = (s << 8n) | BigInt(bytes[i]!);
    }
    seed = s;
  }

  const fight = simulateFight(a, b, seed);

  // ELO
  const outcomeForA =
    fight.winnerId === a.tokenId ? 'win' : fight.winnerId === b.tokenId ? 'loss' : 'tie';
  const elo = eloApply(a.elo, b.elo, totalGames(a), totalGames(b), outcomeForA);

  // Apply to state
  const result = storeApplyDuel(state, fight, elo.deltaA, elo.deltaB, elo.newA, elo.newB);

  // Build output
  const nameOf = (id: number): string => {
    if (id === a.tokenId) return a.name;
    if (id === b.tokenId) return b.name;
    return '??';
  };

  const lines: string[] = [];
  lines.push(formatFight(fight, nameOf));

  // ELO summary
  const sign = (n: number): string => (n >= 0 ? '+' + n : String(n));
  lines.push('');
  lines.push(
    '  ' +
      c.bold(a.name) +
      '  ELO ' +
      c.gray(String(a.elo) + ' → ') +
      c.cyan(c.bold(String(result.a.elo))) +
      '  ' +
      (elo.deltaA >= 0 ? c.green(sign(elo.deltaA)) : c.red(sign(elo.deltaA))),
  );
  lines.push(
    '  ' +
      c.bold(b.name) +
      '  ELO ' +
      c.gray(String(b.elo) + ' → ') +
      c.cyan(c.bold(String(result.b.elo))) +
      '  ' +
      (elo.deltaB >= 0 ? c.green(sign(elo.deltaB)) : c.red(sign(elo.deltaB))),
  );
  // Death announcements
  if (result.aDiedNow) {
    lines.push('');
    lines.push(c.red(c.bold(`  ✝  ${a.name} collapses after three consecutive defeats.`)));
  }
  if (result.bDiedNow) {
    lines.push('');
    lines.push(c.red(c.bold(`  ✝  ${b.name} collapses after three consecutive defeats.`)));
  }
  lines.push('');

  return { output: lines.join('\n'), mutated: true };
}

export function commandGraveyard(state: GameState): CommandResult {
  const dead = deadBrawlers(state);
  if (dead.length === 0) {
    return { output: c.gray('\n  The graveyard is empty.\n'), mutated: false };
  }
  const lines: string[] = [''];
  lines.push(c.bold(c.red('  THE GRAVEYARD')));
  lines.push('');
  for (const b of dead) {
    lines.push('  ' + c.red('✝ ') + brawlerLine(b));
  }
  lines.push('');
  return { output: lines.join('\n'), mutated: false };
}

export function commandLeaderboard(state: GameState): CommandResult {
  const alive = aliveBrawlers(state);
  if (alive.length === 0) {
    return { output: c.gray('\n  No brawlers yet.\n'), mutated: false };
  }
  const top = [...alive].sort((a, b) => b.elo - a.elo).slice(0, 10);
  const lines: string[] = [''];
  lines.push(c.bold('  LEADERBOARD'));
  lines.push('');
  top.forEach((b, i) => {
    const rank = c.yellow(`  ${String(i + 1).padStart(2)}.`);
    lines.push(`${rank} ${brawlerLine(b)}`);
  });
  lines.push('');
  return { output: lines.join('\n'), mutated: false };
}

export function commandRename(state: GameState, args: string[]): CommandResult {
  if (args.length < 2) {
    return { output: c.red('rename: usage is `rename <id> <new name>`'), mutated: false };
  }
  const id = parseInt(args[0]!, 10);
  if (!Number.isInteger(id)) {
    return { output: c.red(`rename: invalid ID "${args[0]!}"`), mutated: false };
  }
  const newName = args.slice(1).join(' ');
  try {
    const b = renameBrawler(state, id, newName);
    return {
      output: '\n  ' + c.green('renamed:') + ' ' + brawlerLine(b) + '\n',
      mutated: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { output: c.red('rename: ' + msg), mutated: false };
  }
}

export function commandHistory(state: GameState, args: string[]): CommandResult {
  const n = args.length === 0 ? 10 : parseInt(args[0]!, 10);
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    return { output: c.red('history: count must be an integer between 1 and 100'), mutated: false };
  }
  const recent = state.duelHistory.slice(-n).reverse();
  if (recent.length === 0) {
    return { output: c.gray('\n  No duels yet.\n'), mutated: false };
  }
  const nameOf = (id: number): string => {
    const b = findBrawler(state, id);
    return b ? b.name : `#${id}`;
  };
  const lines: string[] = [''];
  lines.push(c.bold(`  LAST ${recent.length} DUELS`));
  lines.push('');
  for (const d of recent) {
    const nameA = nameOf(d.brawlerAId);
    const nameB = nameOf(d.brawlerBId);
    const winner =
      d.winnerId === null
        ? c.yellow('TIE')
        : c.green(nameOf(d.winnerId));
    lines.push(
      '  ' +
        c.gray('#' + String(d.id).padStart(4, '0')) +
        ' ' +
        nameA +
        c.gray(' vs ') +
        nameB +
        c.gray(' → ') +
        winner +
        c.gray(` (${d.rounds}r, seed 0x${d.seed.toString(16)})`),
    );
  }
  lines.push('');
  return { output: lines.join('\n'), mutated: false };
}

/** Reset returns mutated=true even though the caller handles clearing state itself. */
export function commandReset(args: string[]): CommandResult {
  // Require explicit confirmation
  if (args.length === 0 || args[0] !== 'confirm') {
    return {
      output:
        '\n  ' +
        c.yellow('This will permanently delete all brawlers and duel history.') +
        '\n  Type ' +
        c.bold('reset confirm') +
        ' to proceed.\n',
      mutated: false,
    };
  }
  // The REPL detects this command separately and wipes state; we just echo.
  return { output: c.green('\n  State wiped. Use `mint` to start over.\n'), mutated: true };
}

export function commandQuit(): CommandResult {
  return { output: c.gray('\n  Saved. Goodbye.\n'), mutated: false, exit: true };
}
