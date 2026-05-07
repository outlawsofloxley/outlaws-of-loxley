#!/usr/bin/env node
/**
 * BASEic Brawlers — Discord server setup.
 *
 * Reads marketing/discord/template.json and applies it to a Discord guild,
 * idempotently. Re-runs always reapply: permission overwrites, slow-modes,
 * guild pointers, art uploads, welcome screen, onboarding. Roles, channels,
 * pinned messages, and seed messages are created once and skipped on
 * subsequent runs.
 *
 * Required env: DISCORD_BOT_TOKEN
 * Optional env: DISCORD_GUILD_ID
 *
 * Usage:
 *   node setup.mjs --guild <serverId>           # apply to existing server
 *   node setup.mjs --guild <serverId> --dry-run # plan only, no writes
 *
 * Discord no longer permits bots to create guilds (error 20001), so the
 * --guild flag is effectively required. The script prints a recovery
 * walkthrough if you forget it.
 *
 * No external deps. Uses Node 18+ native fetch.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(HERE, 'template.json');
const ENV_PATH = join(HERE, '.env');
const API = 'https://discord.com/api/v10';

const PERM = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  DEAFEN_MEMBERS: 1n << 23n,
  MOVE_MEMBERS: 1n << 24n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
};

const CHANNEL_TYPE = { text: 0, voice: 2, category: 4, stage: 13, forum: 15 };

// ─── env / args ──────────────────────────────────────────────────
function loadDotenv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadDotenv(ENV_PATH);

const argv = process.argv.slice(2);
const flag = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : null;
};
const DRY = !!flag('--dry-run');
const argGuildRaw = flag('--guild');
const isSnowflake = (v) => typeof v === 'string' && /^\d{17,20}$/.test(v);

const ARG_GUILD = isSnowflake(argGuildRaw) ? argGuildRaw : null;
const ENV_GUILD = isSnowflake(process.env.DISCORD_GUILD_ID) ? process.env.DISCORD_GUILD_ID : null;
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = ARG_GUILD || ENV_GUILD;

if (argGuildRaw && !ARG_GUILD) {
  console.error(`! Ignoring invalid --guild "${argGuildRaw}" (expected a 17-20 digit server id). Falling back to DISCORD_GUILD_ID env.`);
}

if (!TOKEN) {
  console.error('FATAL: DISCORD_BOT_TOKEN not set. Copy .env.example to .env and paste the token.');
  process.exit(1);
}

// ─── tiny REST helper ────────────────────────────────────────────
async function api(method, path, body, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'BaseicBrawlersSetup (https://baseicbrawlers.com, 1.0)',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429) {
    const j = await res.json();
    const wait = Math.ceil((j.retry_after || 1) * 1000);
    console.log(`  rate-limited; waiting ${wait}ms`);
    await new Promise((r) => setTimeout(r, wait));
    return api(method, path, body, opts);
  }
  const text = await res.text();
  if (!res.ok) {
    if (opts.softFail) return { __error: true, status: res.status, text };
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

function permsFor(spec) {
  if (spec === 'ADMINISTRATOR') return String(PERM.ADMINISTRATOR);
  if (Array.isArray(spec)) {
    return String(spec.reduce((acc, name) => acc | (PERM[name] || 0n), 0n));
  }
  return '0';
}

function hexToInt(hex) {
  return parseInt(hex.replace('#', ''), 16);
}

function pngToDataUri(filePath) {
  const bytes = readFileSync(filePath);
  const ext = filePath.toLowerCase().endsWith('.jpg') || filePath.toLowerCase().endsWith('.jpeg') ? 'jpeg' : 'png';
  return `data:image/${ext};base64,${bytes.toString('base64')}`;
}

// ─── permission overwrite builders ───────────────────────────────
function categoryOverwrites(cat, guildId, roleByName) {
  const out = [];
  if (cat.private) {
    // Hidden from @everyone, only viewerRoles see it.
    out.push({ id: guildId, type: 0, allow: '0', deny: String(PERM.VIEW_CHANNEL) });
    for (const roleName of cat.viewerRoles || []) {
      const r = roleByName.get(roleName);
      if (r) out.push({ id: r.id, type: 0, allow: String(PERM.VIEW_CHANNEL), deny: '0' });
    }
  } else if (cat.verifiedOnly) {
    // Hidden from @everyone, Verified can see it. Bot/Admin/Mod inherit
    // through their role-level perms (Admin has ADMINISTRATOR, Mod has
    // MANAGE_CHANNELS which doesn't grant VIEW_CHANNEL — explicit).
    out.push({ id: guildId, type: 0, allow: '0', deny: String(PERM.VIEW_CHANNEL) });
    const verified = roleByName.get('Verified');
    if (verified) {
      out.push({
        id: verified.id,
        type: 0,
        allow: String(PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES | PERM.READ_MESSAGE_HISTORY | PERM.ADD_REACTIONS | PERM.EMBED_LINKS | PERM.ATTACH_FILES),
        deny: '0',
      });
    }
    const mod = roleByName.get('Mod');
    if (mod) out.push({ id: mod.id, type: 0, allow: String(PERM.VIEW_CHANNEL), deny: '0' });
  }
  return out;
}

function channelOverwrites(ch, parentCat, guildId, roleByName) {
  const out = [...categoryOverwrites(parentCat || {}, guildId, roleByName)];

  // Visibility for INFO category public channels: explicitly allow @everyone.
  // (Even though category isn't verifiedOnly, this guarantees no inherited deny.)
  if (ch.everyoneCanRead) {
    // Find @everyone overwrite, ensure it allows VIEW.
    const ev = out.find((o) => o.id === guildId);
    if (ev) {
      ev.allow = String(BigInt(ev.allow) | PERM.VIEW_CHANNEL);
      ev.deny = String(BigInt(ev.deny) & ~PERM.VIEW_CHANNEL);
    } else {
      out.push({ id: guildId, type: 0, allow: String(PERM.VIEW_CHANNEL | PERM.READ_MESSAGE_HISTORY), deny: '0' });
    }
  }

  // SEND restrictions on otherwise-readable channels.
  if (ch.everyoneCanSend === false || ch.moderatorPostOnly) {
    let ev = out.find((o) => o.id === guildId);
    if (!ev) {
      ev = { id: guildId, type: 0, allow: '0', deny: '0' };
      out.push(ev);
    }
    ev.deny = String(BigInt(ev.deny) | PERM.SEND_MESSAGES);
  }
  if (ch.moderatorPostOnly) {
    for (const roleName of ['Admin', 'Mod']) {
      const r = roleByName.get(roleName);
      if (!r) continue;
      const existing = out.find((o) => o.id === r.id);
      if (existing) {
        existing.allow = String(BigInt(existing.allow) | PERM.SEND_MESSAGES);
      } else {
        out.push({ id: r.id, type: 0, allow: String(PERM.SEND_MESSAGES), deny: '0' });
      }
    }
  }

  // Special: verification gate channel allows @everyone to ADD_REACTIONS so
  // they can react ⚔ to verify. SEND_MESSAGES stays denied.
  if (ch.verificationGate) {
    let ev = out.find((o) => o.id === guildId);
    if (!ev) {
      ev = { id: guildId, type: 0, allow: '0', deny: '0' };
      out.push(ev);
    }
    ev.allow = String(BigInt(ev.allow) | PERM.ADD_REACTIONS | PERM.READ_MESSAGE_HISTORY | PERM.VIEW_CHANNEL);
    ev.deny = String(BigInt(ev.deny) | PERM.SEND_MESSAGES);
  }

  return out;
}

// ─── flow ────────────────────────────────────────────────────────
async function main() {
  const tpl = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8'));

  console.log('▶ Verifying bot token...');
  const me = await api('GET', '/users/@me');
  console.log(`  bot: ${me.username}#${me.discriminator || '0'} (${me.id})`);

  let guild;
  if (GUILD_ID) {
    console.log(`▶ Using existing guild ${GUILD_ID}`);
    guild = await api('GET', `/guilds/${GUILD_ID}`);
    console.log(`  guild: ${guild.name} (owner ${guild.owner_id})`);
  } else {
    if (DRY) {
      console.log('▶ DRY: --guild not set. Would attempt POST /guilds (fails for bots, error 20001).');
      return;
    }
    console.error('');
    console.error('Discord no longer permits bots to create servers. Run with --guild <serverId>.');
    console.error('');
    console.error('  1. In your Discord client, click + in the server list → Create My Own → name it.');
    console.error('  2. User Settings → Advanced → enable Developer Mode.');
    console.error('  3. Right-click the server icon → Copy Server ID.');
    console.error('  4. Invite this bot with admin perms via:');
    console.error(`       https://discord.com/api/oauth2/authorize?client_id=${me.id}&permissions=8&scope=bot%20applications.commands`);
    console.error('  5. Re-run: docker compose run --rm discord-setup --guild <serverId>');
    process.exit(2);
  }

  const existingRoles = await api('GET', `/guilds/${guild.id}/roles`);
  const existingChannels = await api('GET', `/guilds/${guild.id}/channels`);
  const roleByName = new Map(existingRoles.map((r) => [r.name, r]));
  const channelByName = new Map(existingChannels.map((c) => [c.name, c]));
  const justCreated = new Set();

  // ── roles ──
  console.log(`▶ Roles (${tpl.roles.length})`);
  for (const r of tpl.roles) {
    if (roleByName.has(r.name)) {
      console.log(`  = ${r.name} (exists)`);
      continue;
    }
    if (DRY) {
      console.log(`  + ${r.name} (DRY)`);
      continue;
    }
    const created = await api('POST', `/guilds/${guild.id}/roles`, {
      name: r.name,
      color: hexToInt(r.colour),
      hoist: !!r.hoist,
      mentionable: !!r.mentionable,
      permissions: permsFor(r.permissions),
    });
    roleByName.set(r.name, created);
    console.log(`  + ${r.name}`);
  }

  // ── categories + channels ──
  for (const cat of tpl.categories) {
    let category = channelByName.get(cat.name);
    const catOverwrites = categoryOverwrites(cat, guild.id, roleByName);

    if (!category) {
      if (DRY) {
        console.log(`▶ Category "${cat.name}" (DRY)`);
      } else {
        category = await api('POST', `/guilds/${guild.id}/channels`, {
          name: cat.name,
          type: CHANNEL_TYPE.category,
          permission_overwrites: catOverwrites,
        });
        channelByName.set(cat.name, category);
        justCreated.add(category.id);
        console.log(`▶ Category "${cat.name}"`);
      }
    } else {
      console.log(`▶ Category "${cat.name}" (exists; reapplying perms)`);
      if (!DRY) {
        await api('PATCH', `/channels/${category.id}`, { permission_overwrites: catOverwrites });
      }
    }

    for (const ch of cat.channels) {
      const chOverwrites = channelOverwrites(ch, cat, guild.id, roleByName);
      let channel = channelByName.get(ch.name);

      if (!channel) {
        if (DRY) {
          console.log(`  + #${ch.name} (DRY)`);
          continue;
        }
        channel = await api('POST', `/guilds/${guild.id}/channels`, {
          name: ch.name,
          type: CHANNEL_TYPE[ch.type] ?? CHANNEL_TYPE.text,
          topic: ch.topic || '',
          parent_id: category ? category.id : undefined,
          permission_overwrites: chOverwrites,
          rate_limit_per_user: ch.slowModeSeconds || 0,
        });
        channelByName.set(ch.name, channel);
        justCreated.add(channel.id);
        console.log(`  + #${ch.name}`);
      } else {
        if (DRY) {
          console.log(`  ~ #${ch.name} (would PATCH perms + slow-mode)`);
        } else {
          await api('PATCH', `/channels/${channel.id}`, {
            topic: ch.topic || '',
            permission_overwrites: chOverwrites,
            rate_limit_per_user: ch.slowModeSeconds || 0,
            parent_id: category ? category.id : null,
          });
          console.log(`  ~ #${ch.name} (perms + slow-mode reapplied)`);
        }
      }

      // Pin (only when channel was just created — no double-pin on re-runs).
      if (!DRY && ch.pinFile && justCreated.has(channel.id)) {
        const fp = join(HERE, ch.pinFile);
        if (existsSync(fp)) {
          const content = readFileSync(fp, 'utf8');
          const msg = await api('POST', `/channels/${channel.id}/messages`, { content });
          await api('PUT', `/channels/${channel.id}/pins/${msg.id}`);
          console.log(`    ↳ pinned ${ch.pinFile}`);
          if (ch.verificationGate && tpl.verification && tpl.verification.reaction) {
            const emoji = encodeURIComponent(tpl.verification.reaction);
            await api('PUT', `/channels/${channel.id}/messages/${msg.id}/reactions/${emoji}/@me`);
            console.log(`    ↳ seeded verification reaction ${tpl.verification.reaction}`);
          }
        }
      }

      // Seed message (only if channel is empty — safe to re-run).
      if (!DRY && ch.seedFile) {
        const fp = join(HERE, ch.seedFile);
        if (existsSync(fp)) {
          const recent = await api('GET', `/channels/${channel.id}/messages?limit=1`);
          if (Array.isArray(recent) && recent.length === 0) {
            const content = readFileSync(fp, 'utf8');
            await api('POST', `/channels/${channel.id}/messages`, { content });
            console.log(`    ↳ seeded ${ch.seedFile}`);
          }
        }
      }
    }
  }

  // ── guild pointers (rules / system / public-updates channels) ──
  if (!DRY && tpl.guildPointers) {
    const patch = {};
    const ptr = tpl.guildPointers;
    if (ptr.rulesChannel && channelByName.has(ptr.rulesChannel)) {
      patch.rules_channel_id = channelByName.get(ptr.rulesChannel).id;
    }
    if (ptr.publicUpdatesChannel && channelByName.has(ptr.publicUpdatesChannel)) {
      patch.public_updates_channel_id = channelByName.get(ptr.publicUpdatesChannel).id;
    }
    if (ptr.systemChannel && channelByName.has(ptr.systemChannel)) {
      patch.system_channel_id = channelByName.get(ptr.systemChannel).id;
    }
    if (Object.keys(patch).length > 0) {
      const res = await api('PATCH', `/guilds/${guild.id}`, patch, { softFail: true });
      if (res && res.__error) {
        console.log(`! Guild pointers PATCH soft-failed (${res.status}). Often this needs Community feature; continuing.`);
      } else {
        console.log('▶ Guild pointers set (rules / public-updates / system channels).');
      }
    }
  }

  // ── art uploads (icon / banner / splash) ──
  if (!DRY && tpl.art) {
    const artPatch = {};
    const resolveArt = (paths) => {
      // Accept legacy single-path string OR new paths array. First file
      // that exists on disk wins.
      const list = Array.isArray(paths) ? paths : paths ? [paths] : [];
      for (const rel of list) {
        const fp = join(HERE, rel);
        if (existsSync(fp) && statSync(fp).isFile()) return fp;
      }
      return null;
    };
    const slots = [
      { key: 'icon',   paths: tpl.art.iconPaths   ?? tpl.art.iconPath },
      { key: 'banner', paths: tpl.art.bannerPaths ?? tpl.art.bannerPath },
      { key: 'splash', paths: tpl.art.splashPaths ?? tpl.art.splashPath },
    ];
    for (const slot of slots) {
      const fp = resolveArt(slot.paths);
      if (fp) artPatch[slot.key] = pngToDataUri(fp);
    }
    if (Object.keys(artPatch).length > 0) {
      console.log(`▶ Art uploads: ${Object.keys(artPatch).join(', ')}`);
      const res = await api('PATCH', `/guilds/${guild.id}`, artPatch, { softFail: true });
      if (res && res.__error) {
        // Banner/splash require boost level; degrade gracefully.
        if (artPatch.banner || artPatch.splash) {
          console.log(`  ! banner/splash upload failed (${res.status}); retrying icon-only.`);
          if (artPatch.icon) {
            const res2 = await api('PATCH', `/guilds/${guild.id}`, { icon: artPatch.icon }, { softFail: true });
            if (res2 && res2.__error) {
              console.log(`  ! icon upload also failed (${res2.status}). See art/README.md.`);
            } else {
              console.log('  + icon set');
            }
          }
        } else {
          console.log(`  ! art upload failed (${res.status}). See art/README.md for size/format limits.`);
        }
      } else {
        console.log(`  + art applied: ${Object.keys(artPatch).join(', ')}`);
      }
    } else {
      console.log('▶ Art: no files in art/ — skipping (drop icon.png / banner.png to enable).');
    }
  }

  // ── automod ──
  const existingRules = await api('GET', `/guilds/${guild.id}/auto-moderation/rules`, undefined, { softFail: true });
  const ruleByName = new Map();
  if (Array.isArray(existingRules)) {
    for (const r of existingRules) ruleByName.set(r.name, r);
  }

  if (Array.isArray(tpl.automod) && tpl.automod.length > 0) {
    console.log('▶ AutoMod rules');
    for (const rule of tpl.automod) {
      if (DRY) {
        console.log(`  + ${rule.name} (DRY)`);
        continue;
      }
      if (ruleByName.has(rule.name)) {
        console.log(`  = ${rule.name} (exists)`);
        continue;
      }
      // Build action. SEND_ALERT_MESSAGE (type 2) requires channel_id.
      let actions;
      if (rule.action === 'block') {
        actions = [{ type: 1 }];
      } else if (rule.action === 'alert') {
        const alertCh = channelByName.get(rule.alertChannel || 'mod-chat');
        if (!alertCh) {
          console.log(`  ! ${rule.name} skipped (alert channel "${rule.alertChannel || 'mod-chat'}" not found)`);
          continue;
        }
        actions = [{ type: 2, metadata: { channel_id: alertCh.id } }];
      } else {
        actions = [{ type: 1 }];
      }
      const body = {
        name: rule.name,
        event_type: 1,
        trigger_type: rule.type === 'mentions' ? 5 : 1,
        trigger_metadata:
          rule.type === 'mentions'
            ? { mention_total_limit: rule.limit }
            : { keyword_filter: rule.patterns },
        actions,
        enabled: true,
      };
      const res = await api('POST', `/guilds/${guild.id}/auto-moderation/rules`, body, { softFail: true });
      if (res && res.__error) {
        console.log(`  ! ${rule.name} failed: ${res.text.slice(0, 120)}`);
      } else {
        console.log(`  + ${rule.name}`);
      }
    }
  }

  // ── welcome screen (Community feature required) ──
  if (!DRY && tpl.welcomeScreen) {
    const wsChannels = (tpl.welcomeScreen.channels || [])
      .filter((c) => channelByName.has(c.channel))
      .slice(0, 5)
      .map((c) => ({
        channel_id: channelByName.get(c.channel).id,
        description: c.description,
        emoji_id: null,
        emoji_name: c.emoji || null,
      }));
    const res = await api(
      'PATCH',
      `/guilds/${guild.id}/welcome-screen`,
      { enabled: true, description: tpl.welcomeScreen.description, welcome_channels: wsChannels },
      { softFail: true },
    );
    if (res && res.__error) {
      console.log(`▶ Welcome Screen: skipped (${res.status} — needs Community feature; see post-run notes).`);
    } else {
      console.log('▶ Welcome Screen applied.');
    }
  }

  // ── onboarding (Community feature required) ──
  if (!DRY && tpl.onboarding) {
    const defaultIds = (tpl.onboarding.defaultChannels || [])
      .filter((n) => channelByName.has(n))
      .map((n) => channelByName.get(n).id);
    const prompts = (tpl.onboarding.prompts || []).map((p, idx) => ({
      id: String(idx),
      type: p.type === 'multiple_choice' ? 0 : 0,
      title: p.title,
      single_select: !!p.singleSelect,
      required: !!p.required,
      in_onboarding: p.inOnboarding !== false,
      options: (p.options || []).map((o, j) => ({
        id: String(j),
        title: o.title,
        description: o.description || '',
        emoji: o.emoji ? { name: o.emoji, id: null, animated: false } : null,
        channel_ids: (o.channels || [])
          .filter((n) => channelByName.has(n))
          .map((n) => channelByName.get(n).id),
        role_ids: [],
      })),
    }));
    const res = await api(
      'PUT',
      `/guilds/${guild.id}/onboarding`,
      {
        prompts,
        default_channel_ids: defaultIds,
        enabled: true,
        mode: tpl.onboarding.mode ?? 0,
      },
      { softFail: true },
    );
    if (res && res.__error) {
      console.log(`▶ Onboarding: skipped (${res.status} — needs Community feature; see post-run notes).`);
    } else {
      console.log('▶ Onboarding applied.');
    }
  }

  // ── invite ──
  if (!DRY) {
    const general = channelByName.get('general');
    if (general) {
      const inv = await api('POST', `/channels/${general.id}/invites`, { max_age: 0, max_uses: 0, unique: false });
      console.log(`\n✓ Server ready. Invite URL: https://discord.gg/${inv.code}`);
    }
  }

  // ── post-run notes ──
  console.log('\nPost-run notes:');
  console.log('  • If Welcome Screen / Onboarding skipped: enable Community in Server Settings → Enable');
  console.log('    Community in the Discord client (it is a multi-step wizard; bots cannot do this part).');
  console.log('  • Server icon / banner not showing? Drop the PNG into marketing/discord/art/ and re-run.');
  console.log('  • Verification reactions only grant the Verified role while the discord-bot service is up.');
  console.log('    Start it with:  docker compose up -d discord-bot');
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
