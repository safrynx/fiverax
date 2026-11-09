import { Client, Events, GatewayIntentBits, type Guild, type GuildMember, type PartialGuildMember } from "discord.js";
import { indexGuildMembers, memberChanged, setAntiraidConfig, setupAntiraid } from "./antiraid";
import { setupActions } from "./actions";
import { onMessage } from "./messages";
import { siteConfig, sitePost } from "./api";
import { playtimeSources, readPlaytimeTotals, type PlaytimeSource } from "./playtime";
import { applyPresence, type PresenceSetting } from "./presence";

/**
 * One bot for every server of the panel. It watches the Discord guilds registered on the site
 * (asked to the site at startup, then every few minutes), and ignores any other guild it may be in.
 */

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("DISCORD_BOT_TOKEN is required. Copy .env.example to .env and fill it in.");
  process.exit(1);
}
let sources: PlaytimeSource[];
try {
  siteConfig();
  sources = playtimeSources();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const HEARTBEAT_MS = 60_000;
const PLAYTIME_MS = 2 * 60_000;
const TICK_MS = 10 * 60_000;
const FULL_SYNC_MS = 30 * 60_000;
const SERVERS_MS = 5 * 60_000;

const client = new Client({
  // GuildModeration: audit log entries and bans, read by the anti-raid.
  // GuildMessages: message protection (flood, mentions). MessageContent (privileged, opt-in): invites and links.
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildMessages,
    ...(process.env.BOT_MESSAGE_CONTENT === "1" ? [GatewayIntentBits.MessageContent] : [])
  ]
});

/** Guild ids of the servers registered on the site. */
let watched = new Set<string>();
/** Guilds already fully synced once since they became watched (newly registered ones are synced right away). */
const synced = new Set<string>();

const roleIdsOf = (member: GuildMember | PartialGuildMember) => [...member.roles.cache.keys()];

function memberPayload(member: GuildMember | PartialGuildMember, present = true) {
  return {
    discordId: member.id,
    username: member.user.globalName || member.user.username,
    avatarUrl: member.user.displayAvatarURL({ extension: "png", size: 128 }),
    roleIds: roleIdsOf(member),
    joinedAt: member.joinedAt?.toISOString() ?? null,
    present
  };
}

/** Watched guilds the bot is actually in. */
const activeGuilds = (): Guild[] => [...client.guilds.cache.values()].filter((g) => watched.has(g.id));

/** Ask the site which guilds to watch. Keeps the previous list when the site is unreachable. */
async function refreshServers(): Promise<boolean> {
  const result = await sitePost<{ guilds: { guildId: string; serverId: string; name: string; antiraid?: unknown }[] }>("servers", {}, 1);
  if (!result) return false;
  for (const g of result.guilds) setAntiraidConfig(g.guildId, g.antiraid);
  const next = new Set(result.guilds.map((g) => g.guildId));
  for (const id of synced) if (!next.has(id)) synced.delete(id);
  const added = [...next].filter((id) => !watched.has(id));
  watched = next;
  const missing = result.guilds.filter((g) => !client.guilds.cache.has(g.guildId));
  if (added.length || missing.length) {
    console.log(`[servers] watching ${watched.size} guild(s)${missing.length ? ` · bot not invited on: ${missing.map((g) => `${g.name} (${g.guildId})`).join(", ")}` : ""}`);
  }
  return true;
}

/** Send the whole picture of one guild (roles, members, who is in voice) so the site can reconcile its database. */
async function fullSync(guild: Guild): Promise<boolean> {
  const [roles, members] = await Promise.all([guild.roles.fetch(), guild.members.fetch()]);
  indexGuildMembers(guild, members.values());
  const payload = {
    guildId: guild.id,
    roles: [...roles.values()].filter((r) => r.id !== guild.id).map((r) => ({ id: r.id, name: r.name, position: r.position, color: r.color })),
    members: [...members.values()].filter((m) => !m.user.bot).map((m) => memberPayload(m)),
    voice: [...guild.voiceStates.cache.values()]
      .filter((v) => v.channelId && v.member && !v.member.user.bot)
      .map((v) => ({ discordId: v.id, channelId: v.channelId as string, roleIds: roleIdsOf(v.member!) })),
    topRolePosition: guild.members.me?.roles.highest.position ?? null
  };
  const result = await sitePost<{ members?: { inserted: number; updated: number; markedLeft: number; total: number }; voice?: { closed: number; opened: number } }>("sync", payload);
  if (!result) return false;
  if (result.members && result.voice) {
    console.log(`[sync] ${guild.name}: members=${result.members.total} +${result.members.inserted} ~${result.members.updated} -${result.members.markedLeft} · voice closed=${result.voice.closed} opened=${result.voice.opened}`);
  }
  synced.add(guild.id);
  return true;
}

async function syncAll(onlyNew = false): Promise<boolean> {
  let ok = true;
  for (const guild of activeGuilds()) {
    if (onlyNew && synced.has(guild.id)) continue;
    try {
      ok = (await fullSync(guild)) && ok;
    } catch (error) {
      ok = false;
      console.error(`[sync] ${guild.name} failed:`, error instanceof Error ? error.message : error);
    }
  }
  return ok;
}

/** Retry the initial sync every minute until the site answers, then keep syncing every 30 minutes. */
function scheduleSync(delay: number) {
  setTimeout(async () => {
    const ok = (await refreshServers()) && (await syncAll());
    scheduleSync(ok ? FULL_SYNC_MS : 60_000);
  }, delay);
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Staff bot connected as ${readyClient.user.tag} (${readyClient.guilds.cache.size} guild(s)) -> site ${siteConfig().url}`);
  scheduleSync(0);
  setupAntiraid(readyClient, (guildId) => watched.has(guildId));
  setupActions(readyClient, (guildId) => watched.has(guildId));

  // A server registered on the site is picked up within a few minutes, without restarting the bot.
  setInterval(async () => {
    if (await refreshServers()) await syncAll(true);
  }, SERVERS_MS);

  const heartbeat = async () => {
    const guilds = activeGuilds().map((g) => ({ guildId: g.id, topRolePosition: g.members.me?.roles.highest.position ?? null }));
    // The answer carries the anti-raid settings and the bot's status: a change made on the panel applies within a minute.
    const result = await sitePost<{ antiraid?: Record<string, unknown>; presence?: PresenceSetting }>("heartbeat", { guilds }, 1);
    for (const [guildId, config] of Object.entries(result?.antiraid ?? {})) setAntiraidConfig(guildId, config);
    applyPresence(readyClient, result?.presence, guilds.length);
  };
  void heartbeat();
  setInterval(() => void heartbeat(), HEARTBEAT_MS);

  // FiveM playtime: read each game database here and push the totals to the site.
  if (sources.length) {
    const logged = new Set<string>();
    const pushPlaytime = async () => {
      for (const source of sources) {
        if (!watched.has(source.guildId)) continue;
        try {
          const totals = await readPlaytimeTotals(source);
          const result = await sitePost<{ stored: number; snapshot: boolean }>("playtime", { guildId: source.guildId, totals }, 2);
          if (result && !logged.has(source.guildId)) {
            console.log(`[playtime] guild ${source.guildId}: ${totals.length} players read, ${result.stored} staff stored`);
            logged.add(source.guildId);
          }
        } catch (error) {
          console.error(`[playtime] guild ${source.guildId} failed:`, error instanceof Error ? error.message : error);
        }
      }
    };
    void pushPlaytime();
    setInterval(() => void pushPlaytime(), PLAYTIME_MS);
  } else {
    console.log("[playtime] no game database configured: FiveM time will come from the FiveM agents only");
  }

  const tick = async () => {
    const result = await sitePost<Record<string, unknown>>("tick", {}, 1);
    if (result) console.log("[tick]", JSON.stringify(result));
  };
  setInterval(() => void tick(), TICK_MS);
});

// The bot was just invited to a guild: if a server uses it, sync it now rather than at the next cycle.
client.on(Events.GuildCreate, (guild) => {
  if (watched.has(guild.id)) void fullSync(guild).catch((e) => console.error(`[sync] ${guild.name} failed:`, e instanceof Error ? e.message : e));
});

client.on(Events.GuildMemberAdd, (m) => {
  if (watched.has(m.guild.id)) memberChanged(m);
  if (watched.has(m.guild.id) && !m.user.bot) void sitePost("member", { guildId: m.guild.id, ...memberPayload(m) });
});
client.on(Events.GuildMemberUpdate, (_old, m) => {
  if (watched.has(m.guild.id)) memberChanged(m);
  if (watched.has(m.guild.id) && !m.user.bot) void sitePost("member", { guildId: m.guild.id, ...memberPayload(m) });
});
client.on(Events.GuildMemberRemove, (m) => {
  if (watched.has(m.guild.id) && !m.partial) memberChanged(m, false);
  if (!watched.has(m.guild.id) || m.user.bot) return;
  void sitePost("member", { guildId: m.guild.id, ...memberPayload(m, false) });
  void sitePost("voice", { guildId: m.guild.id, action: "leave", discordId: m.id, roleIds: [], at: new Date().toISOString() });
});

client.on(Events.MessageCreate, (message) => {
  if (message.guildId && watched.has(message.guildId)) void onMessage(message).catch((e) => console.error("[messages] check failed:", e instanceof Error ? e.message : e));
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const guildId = newState.guild.id;
  if (!watched.has(guildId)) return;
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return;
  const from = oldState.channelId;
  const to = newState.channelId;
  if (from === to) return; // mute / deafen / stream changes, not a channel change

  const base = { guildId, discordId: member.id, roleIds: roleIdsOf(member), at: new Date().toISOString() };
  if (!to) void sitePost("voice", { ...base, action: "leave" });
  else void sitePost("voice", { ...base, action: from ? "move" : "join", channelId: to });
});

client.on(Events.Error, (error) => console.error("[discord] client error:", error.message));
process.on("unhandledRejection", (reason) => console.error("[process] unhandled rejection:", reason));

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  // Tell the site to close open voice sessions so nobody keeps "counting" while the bot is down.
  const result = await Promise.race([sitePost<{ closed: number }>("shutdown", {}, 1), new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
  console.log(`[bot] stopping${result ? `, ${result.closed} voice session(s) closed` : ""}`);
  await client.destroy();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

void client.login(token);
