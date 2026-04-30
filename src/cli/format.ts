/**
 * Terminal display helpers.
 *
 * We use raw ANSI escape codes (no dependency). Windows Terminal, modern
 * PowerShell, and macOS Terminal all handle these fine. The colors module
 * respects the NO_COLOR environment variable and disables itself if stdout
 * is not a TTY (e.g. piped to a file).
 */
import type { Brawler, CombatEvent, FightResult, WeaponRarity } from '../core/types.js';
import { startingHp, armorClass, abilityModifier } from '../core/stats.js';

// ─── Color support ──────────────────────────────────────────────────

const COLORS_ENABLED =
  process.env['NO_COLOR'] === undefined && !!process.stdout.isTTY;

function wrap(open: number, close: number) {
  return (s: string): string => (COLORS_ENABLED ? `\x1b[${open}m${s}\x1b[${close}m` : s);
}

export const c = {
  reset: wrap(0, 0),
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  italic: wrap(3, 23),
  underline: wrap(4, 24),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  white: wrap(37, 39),
  gray: wrap(90, 39),
};

// Rarity colors match MMO conventions
export function rarityColor(rarity: WeaponRarity): (s: string) => string {
  switch (rarity) {
    case 'common':
      return c.white;
    case 'uncommon':
      return c.green;
    case 'rare':
      return c.blue;
    case 'epic':
      return c.magenta;
    case 'legendary':
      return c.yellow;
  }
}

// ─── Banner ─────────────────────────────────────────────────────────

export function banner(): string {
  return [
    '',
    c.bold(c.red('  ▄▄▄▄  ▓█████▄  ▄▄▄       █     █░ ██▓    ▓█████  ██▀███    ██████ ')),
    c.bold(c.red(' ▓█████▄ ▒██▀ ██▌▒████▄    ▓█░ █ ░█░▓██▒    ▓█   ▀ ▓██ ▒ ██▒▒██    ▒ ')),
    c.bold(c.red(' ▒██▒ ▄██░██   █▌▒██  ▀█▄  ▒█░ █ ░█ ▒██░    ▒███   ▓██ ░▄█ ▒░ ▓██▄   ')),
    c.bold(c.red(' ▒██░█▀  ░▓█▄   ▌░██▄▄▄▄██ ░█░ █ ░█ ▒██░    ▒▓█  ▄ ▒██▀▀█▄    ▒   ██▒')),
    c.bold(c.red(' ░▓█  ▀█▓░▒████▓  ▓█   ▓██▒░░██▒██▓ ░██████▒░▒████▒░██▓ ▒██▒▒██████▒▒')),
    c.gray('  Type ' + c.bold('help') + c.gray(' for commands, ') + c.bold('quit') + c.gray(' to exit.')),
    '',
  ].join('\n');
}

// ─── Brawler formatters ─────────────────────────────────────────────

/** One-line brawler summary for list views. */
export function brawlerLine(b: Brawler): string {
  const id = c.dim('#' + String(b.tokenId).padStart(3, '0'));
  const name = c.bold(b.name.padEnd(25).slice(0, 25));
  const stats = c.gray(
    `STR${String(b.stats.strength).padStart(2)} DEX${String(b.stats.dexterity).padStart(2)} CON${String(b.stats.constitution).padStart(2)}`,
  );
  const weapon = rarityColor(b.weapon.rarity)(b.weapon.name.padEnd(14));
  const elo = c.cyan('ELO ' + String(b.elo).padStart(4));
  const record = c.gray(`(${b.wins}W/${b.losses}L${b.ties > 0 ? '/' + b.ties + 'T' : ''})`);
  const status = b.status === 'dead' ? c.red(' ✝') : '';
  return `${id} ${name} ${stats} ${weapon} ${elo} ${record}${status}`;
}

/** Detailed single-brawler view. */
export function brawlerDetail(b: Brawler): string {
  const lines: string[] = [];
  const statusText =
    b.status === 'alive' ? c.green('ALIVE') : c.red('DEAD');
  lines.push('');
  lines.push(c.bold(b.name) + c.gray(` (Token #${b.tokenId})`) + '  ' + statusText);
  lines.push(c.dim('─'.repeat(50)));
  // Stats block
  const s = b.stats;
  const mod = (v: number) => {
    const m = abilityModifier(v);
    return (m >= 0 ? '+' : '') + m;
  };
  lines.push(
    c.gray('  STR ') + String(s.strength).padStart(2) + c.gray(` (${mod(s.strength)})`) +
      c.gray('   DEX ') + String(s.dexterity).padStart(2) + c.gray(` (${mod(s.dexterity)})`) +
      c.gray('   CON ') + String(s.constitution).padStart(2) + c.gray(` (${mod(s.constitution)})`),
  );
  lines.push(
    c.gray('  INT ') + String(s.intelligence).padStart(2) + c.gray(` (${mod(s.intelligence)})`) +
      c.gray('   WIS ') + String(s.wisdom).padStart(2) + c.gray(` (${mod(s.wisdom)})`) +
      c.gray('   CHA ') + String(s.charisma).padStart(2) + c.gray(` (${mod(s.charisma)})`),
  );
  // Derived combat values
  lines.push('');
  lines.push(
    c.gray('  HP ') + c.bold(String(startingHp(b.stats, b.level))) +
      c.gray('   AC ') + c.bold(String(armorClass(b.stats))) +
      c.gray('   Level ') + c.bold(String(b.level)) +
      c.gray('   XP ') + c.bold(String(b.xp)),
  );
  // Weapon
  const w = b.weapon;
  const wColor = rarityColor(w.rarity);
  lines.push('');
  lines.push(c.gray('  Weapon:  ') + wColor(c.bold(w.name)) + c.gray(` (${w.rarity}, ${w.type})`));
  lines.push(
    c.gray('           Damage ') + String(w.damageMin) + '-' + String(w.damageMax) +
      c.gray('   Speed ') + String(w.speed),
  );
  // Record
  lines.push('');
  lines.push(
    c.gray('  Record:  ') +
      c.green(String(b.wins) + 'W') + ' / ' +
      c.red(String(b.losses) + 'L') +
      (b.ties > 0 ? ' / ' + c.yellow(String(b.ties) + 'T') : '') +
      c.gray('   ELO ') + c.cyan(c.bold(String(b.elo))),
  );
  lines.push('');
  return lines.join('\n');
}

// ─── Fight log formatter ────────────────────────────────────────────

/**
 * Format a fight log for console output.
 * Needs a name lookup so it can print names rather than IDs.
 */
export function formatFight(fight: FightResult, nameOf: (id: number) => string): string {
  const lines: string[] = [];
  const nameA = nameOf(fight.brawlerAId);
  const nameB = nameOf(fight.brawlerBId);
  const resolveName = (id: number): string => {
    if (id === fight.brawlerAId) return nameA;
    if (id === fight.brawlerBId) return nameB;
    return '??';
  };

  lines.push('');
  lines.push(c.bold(`⚔  ${nameA} vs ${nameB}`));
  lines.push(c.dim(`   seed: 0x${fight.seed.toString(16)}`));
  lines.push('');

  for (const e of fight.events) {
    switch (e.type) {
      case 'round_start':
        lines.push(c.gray(`─── Round ${e.round} ───`));
        break;
      case 'attack_hit': {
        const attacker = resolveName(e.attackerId);
        const defender = resolveName(e.defenderId);
        const parts: string[] = [];
        parts.push(c.bold(attacker));
        if (e.isCritical) {
          parts.push(c.red(c.bold('CRIT!')));
        } else {
          parts.push(c.green('hits'));
        }
        parts.push(c.bold(defender));
        parts.push(c.yellow(`for ${e.damage} dmg`));
        if (e.typeAdvantage) {
          parts.push(c.cyan('(advantage)'));
        }
        parts.push(c.gray(`→ HP ${e.defenderHpAfter}`));
        lines.push('  ' + parts.join(' '));
        break;
      }
      case 'attack_miss': {
        const attacker = resolveName(e.attackerId);
        lines.push('  ' + c.bold(attacker) + ' ' + c.gray('misses.'));
        break;
      }
      case 'fight_end': {
        lines.push('');
        if (e.winnerId === null) {
          lines.push(c.yellow(c.bold('  DOUBLE KO — tie.')));
        } else {
          lines.push(c.green(c.bold(`  WINNER: ${resolveName(e.winnerId)}`)) + c.gray(` (${e.rounds} rounds)`));
        }
        break;
      }
    }
  }
  return lines.join('\n');
}
