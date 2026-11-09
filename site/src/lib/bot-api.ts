import { z } from "zod";
import { clearBotHeartbeat, setServerStatus } from "./bot-status";
import { storePlaytimeTotals } from "./playtime";
import { storeGuildRoles } from "./roles";
import { invalidateConfig } from "./config";
import { db, stmt } from "./db";
import { getPlatformSettings } from "./platform";
import { getSecuritySettings, recordIncident } from "./security";
import { activeServerByGuild, listServers, type Server } from "./servers";
import { syncStaffMembers, upsertStaffMember } from "./sync";
import { closeAllVoiceSessions, closeVoiceSession, moveVoiceSession, openVoiceSession, reconcileVoiceSessions } from "./voice";

/**
 * Operations the Discord bot (a separate project, hosted elsewhere) asks the site to perform.
 * One bot serves every server: each message names the Discord guild it is about, and the site maps it to the
 * registered server. Messages about a guild no server uses are ignored.
 * The bot never touches the database: it reports what it sees on Discord (and in the game databases),
 * the site stores it.
 */

const snowflake = z.string().regex(/^\d{17,20}$/);
const roleIds = z.array(snowflake).max(250);

export const memberSchema = z.object({
  guildId: snowflake,
  discordId: snowflake,
  username: z.string().max(200),
  avatarUrl: z.string().max(500).nullable(),
  roleIds,
  joinedAt: z.string().max(40).nullable(),
  /** false when the member left the guild */
  present: z.boolean().default(true)
});

const memberOfSync = memberSchema.omit({ guildId: true });

export const syncSchema = z.object({
  guildId: snowflake,
  roles: z.array(z.object({ id: snowflake, name: z.string().max(200), position: z.number().int(), color: z.number().int() })).max(1000),
  members: z.array(memberOfSync).max(100_000),
  /** Everyone currently in a voice channel */
  voice: z.array(z.object({ discordId: snowflake, channelId: snowflake, roleIds })).max(10_000),
  topRolePosition: z.number().int().nullable().optional()
});

export const voiceEventSchema = z.object({
  guildId: snowflake,
  action: z.enum(["join", "leave", "move"]),
  discordId: snowflake,
  channelId: snowflake.optional(),
  roleIds: roleIds.default([]),
  at: z.string().datetime().optional()
});

/** The guilds the bot is connected to, with its highest role position in each. */
export const heartbeatSchema = z.object({
  guilds: z.array(z.object({ guildId: snowflake, topRolePosition: z.number().int().nullable().optional() })).max(1000)
});

/** Lifetime playtime per Discord id, read by the bot from one server's game database. */
export const playtimeSchema = z.object({
  guildId: snowflake,
  totals: z.array(z.object({ discordId: snowflake, seconds: z.number().int().min(0).max(10_000_000_000) })).max(100_000)
});

/** Something the anti-raid did on Discord (see bot/src/antiraid.ts). */
export const incidentSchema = z.object({
  guildId: snowflake,
  kind: z.string().regex(/^[a-z_]{2,40}$/),
  actorId: snowflake.nullable(),
  actorName: z.string().max(200).nullable(),
  actorBot: z.boolean().default(false),
  summary: z.string().max(500),
  details: z.record(z.string(), z.unknown()).default({}),
  actions: z.array(z.object({ type: z.string().max(60), ok: z.boolean(), detail: z.string().max(300).optional() })).max(200).default([]),
  /** Roles taken from the actor (derank), so the panel can give them back. */
  removedRoles: z.array(snowflake).max(250).default([])
});

type Sync = z.infer<typeof syncSchema>;
type Member = z.infer<typeof memberOfSync>;
type MemberEvent = z.infer<typeof memberSchema>;
type VoiceEvent = z.infer<typeof voiceEventSchema>;
type Heartbeat = z.infer<typeof heartbeatSchema>;
type Playtime = z.infer<typeof playtimeSchema>;

const IGNORED = { ignored: "unknown_guild" } as const;

const toSynced = (m: Member) => ({
  discordId: m.discordId,
  username: m.username,
  avatarUrl: m.avatarUrl,
  roleIds: m.roleIds,
  joinedAt: m.joinedAt,
  presentInGuild: m.present
});

async function markAlive(server: Server, topRolePosition?: number | null): Promise<void> {
  await setServerStatus(server.id, "heartbeat", new Date().toISOString()); // site clock: the bot's clock does not matter
  if (typeof topRolePosition === "number") await setServerStatus(server.id, "top_role_position", String(topRolePosition));
}

/** Guilds the bot should watch: those of the registered servers, with their anti-raid settings. */
export async function registeredGuilds() {
  // A suspended server's guild is not watched any more: the bot neither reports nor acts there (anti-raid included).
  const servers = (await listServers()).filter((s) => s.guildId && !s.suspended);
  const guilds = [];
  for (const s of servers) {
    guilds.push({ guildId: s.guildId as string, serverId: s.id, name: s.name, antiraid: (await getSecuritySettings(s.id)).antiraid });
  }
  return { guilds };
}

/** The answer carries the anti-raid settings, so a change made on the panel reaches the bot within a minute. */
export async function recordHeartbeat(data: Heartbeat) {
  const antiraid: Record<string, unknown> = {};
  for (const guild of data.guilds) {
    const server = await activeServerByGuild(guild.guildId);
    if (!server) continue;
    await markAlive(server, guild.topRolePosition);
    antiraid[guild.guildId] = (await getSecuritySettings(server.id)).antiraid;
  }
  // The bot's status / activity chosen in /admin/bot: applied by the bot within a heartbeat.
  return { servers: Object.keys(antiraid).length, antiraid, presence: (await getPlatformSettings()).bot };
}

export async function applyIncident(data: z.infer<typeof incidentSchema>) {
  const server = await activeServerByGuild(data.guildId);
  if (!server) return IGNORED;
  const { guildId: _guild, ...incident } = data;
  void _guild;
  // Deleted roles were recreated: they have new ids, which the grades, averts and access rules must follow.
  const remaps = Array.isArray(incident.details.remaps) ? (incident.details.remaps as { from?: unknown; to?: unknown }[]) : [];
  const valid = remaps.filter((r): r is { from: string; to: string } => typeof r.from === "string" && typeof r.to === "string" && /^\d{17,20}$/.test(r.from) && /^\d{17,20}$/.test(r.to));
  if (valid.length) {
    await db.batch(valid.flatMap(({ from, to }) => [
      stmt("UPDATE grade_roles SET role_id = ? WHERE server_id = ? AND role_id = ?", [to, server.id, from]),
      stmt("UPDATE warn_roles SET role_id = ? WHERE server_id = ? AND role_id = ?", [to, server.id, from]),
      stmt("UPDATE OR IGNORE panel_access SET discord_id = ? WHERE server_id = ? AND kind = 'role' AND discord_id = ?", [to, server.id, from])
    ]));
    invalidateConfig(server.id);
  }
  return { id: await recordIncident(server.id, incident) };
}

/** Full snapshot of one guild: roles, all members, and who is in voice right now. */
export async function applySync(data: Sync) {
  const server = await activeServerByGuild(data.guildId);
  if (!server) return IGNORED;
  await storeGuildRoles(server.id, data.roles.filter((r) => r.name !== "@everyone"));
  const members = await syncStaffMembers(server.id, data.members.map(toSynced), "bot");
  const voice = await reconcileVoiceSessions(server.id, data.voice, new Date());
  await markAlive(server, data.topRolePosition);
  return { serverId: server.id, members, voice };
}

export async function applyMember(data: MemberEvent) {
  const server = await activeServerByGuild(data.guildId);
  if (!server) return IGNORED;
  return { result: await upsertStaffMember(server.id, toSynced(data)) };
}

export async function applyVoice(data: VoiceEvent) {
  const server = await activeServerByGuild(data.guildId);
  if (!server) return IGNORED;
  const at = data.at ? new Date(data.at) : new Date();
  if (data.action === "leave") await closeVoiceSession(server.id, data.discordId, at);
  else if (!data.channelId) throw new Error("channelId required");
  else if (data.action === "join") await openVoiceSession(server.id, data.discordId, data.roleIds, data.channelId, at);
  else await moveVoiceSession(server.id, data.discordId, data.roleIds, data.channelId, at);
  return { ok: true };
}

export async function applyPlaytime(data: Playtime) {
  const server = await activeServerByGuild(data.guildId);
  if (!server) return IGNORED;
  return storePlaytimeTotals(server.id, data.totals);
}

/** The bot is going down cleanly: close every open voice session (all servers) and drop the heartbeats. */
export async function applyShutdown() {
  const closed = await closeAllVoiceSessions(new Date());
  await clearBotHeartbeat();
  return { closed };
}
