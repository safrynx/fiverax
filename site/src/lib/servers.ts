import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db, stmt } from "./db";

/**
 * Servers (tenants). One server = one Discord guild + (optionally) one FiveM server.
 * Every piece of data in the panel belongs to exactly one server (`server_id` column).
 *
 * - Anyone logged in can register a Discord guild they manage (owner, Administrator or Manage Server) as a server,
 *   up to MAX_SERVERS_PER_USER (default 5). Platform owners (env PANEL_OWNER_IDS) see and manage every server,
 *   and may register any guild.
 * - Server owners (table server_owners) have every permission on their server and manage its access page.
 * - The FiveM agent of a server authenticates with that server's own token (only its hash is stored).
 */

/** The server that received the data of the single-server version. Env fallbacks (grade mapping…) apply to it only. */
export const LEGACY_SERVER_ID = "default";

export const SERVER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;

export type Server = {
  id: string;
  name: string;
  guildId: string | null;
  timezone: string | null;
  reviewHour: number | null;
  iconUrl: string | null;
  hasFivemToken: boolean;
  createdAt: string;
};

type ServerRow = {
  id: string;
  name: string;
  guild_id: string | null;
  timezone: string | null;
  review_hour: number | null;
  icon_url: string | null;
  fivem_token_hash: string | null;
  created_at: string;
};

const COLUMNS = "id, name, guild_id, timezone, review_hour, icon_url, fivem_token_hash, created_at";

const toServer = (r: ServerRow): Server => ({
  id: r.id,
  name: r.name,
  guildId: r.guild_id,
  timezone: r.timezone,
  reviewHour: r.review_hour,
  iconUrl: r.icon_url,
  hasFivemToken: Boolean(r.fivem_token_hash),
  createdAt: r.created_at
});

export async function listServers(): Promise<Server[]> {
  return (await db.all<ServerRow>(`SELECT ${COLUMNS} FROM servers ORDER BY name COLLATE NOCASE`)).map(toServer);
}

export async function getServer(id: string): Promise<Server | null> {
  if (!SERVER_ID_PATTERN.test(id)) return null;
  const row = await db.get<ServerRow>(`SELECT ${COLUMNS} FROM servers WHERE id = ?`, [id]);
  return row ? toServer(row) : null;
}

export async function getServerByGuild(guildId: string): Promise<Server | null> {
  const row = await db.get<ServerRow>(`SELECT ${COLUMNS} FROM servers WHERE guild_id = ?`, [guildId]);
  return row ? toServer(row) : null;
}

/** Community time zone of a server: its own setting, else APP_TIMEZONE, else Europe/Paris. */
export function serverTimeZone(server: Pick<Server, "timezone"> | null | undefined): string {
  return server?.timezone || process.env.APP_TIMEZONE || "Europe/Paris";
}

/** Hour (community time) from which the Sunday AI summary runs. */
export function serverReviewHour(server: Pick<Server, "reviewHour"> | null | undefined): number {
  return server?.reviewHour ?? Number(process.env.REVIEW_HOUR ?? 20);
}

/** Pure: a readable, URL-safe id from a name ("GTA Sun RP" -> "gta-sun-rp"). */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return slug.length >= 2 ? slug : `srv-${randomBytes(3).toString("hex")}`;
}

export type CreateServerResult = { ok: true; server: Server } | { ok: false; error: "guild_taken" };

/** Register a server; its creator becomes its first owner. No permission check: see createServerFor. */
export async function createServer(input: { name: string; guildId: string | null; createdBy: string; iconUrl?: string | null }): Promise<CreateServerResult> {
  if (input.guildId && (await getServerByGuild(input.guildId))) return { ok: false, error: "guild_taken" };
  let id = slugify(input.name);
  if (id === LEGACY_SERVER_ID || (await getServer(id))) id = `${id.slice(0, 32)}-${randomBytes(2).toString("hex")}`;
  await db.batch([
    stmt("INSERT INTO servers (id, name, guild_id, icon_url, created_by) VALUES (?, ?, ?, ?, ?)", [id, input.name, input.guildId, input.iconUrl ?? null, input.createdBy]),
    stmt("INSERT OR IGNORE INTO server_owners (server_id, discord_id, added_by) VALUES (?, ?, ?)", [id, input.createdBy, input.createdBy])
  ]);
  return { ok: true, server: (await getServer(id)) as Server };
}

// ---- self-service ----

export type ManagedGuild = { guildId: string; name: string; iconUrl: string | null; serverId: string | null };

/** Guilds the user can manage (as read at their last login), with the server already using each one, if any. */
export async function listManageableGuilds(discordId: string): Promise<ManagedGuild[]> {
  const rows = await db.all<{ guild_id: string; name: string; icon_url: string | null; server_id: string | null }>(
    `SELECT g.guild_id, g.name, g.icon_url, s.id AS server_id FROM user_guilds g LEFT JOIN servers s ON s.guild_id = g.guild_id
     WHERE g.discord_id = ? AND g.can_manage = 1 ORDER BY g.name COLLATE NOCASE`,
    [discordId]
  );
  return rows.map((r) => ({ guildId: r.guild_id, name: r.name, iconUrl: r.icon_url, serverId: r.server_id }));
}

/** True when the user could manage this guild at their last login. */
export async function managesGuild(discordId: string, guildId: string): Promise<boolean> {
  return Boolean(await db.get("SELECT 1 AS x FROM user_guilds WHERE discord_id = ? AND guild_id = ? AND can_manage = 1", [discordId, guildId]));
}

export const maxServersPerUser = () => Number(process.env.MAX_SERVERS_PER_USER ?? 5);

export async function countServersCreatedBy(discordId: string): Promise<number> {
  return (await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM servers WHERE created_by = ?", [discordId]))?.n ?? 0;
}

export type CreateForResult = CreateServerResult | { ok: false; error: "guild_required" | "guild_not_managed" | "too_many_servers" };

/**
 * Self-service creation: anyone may register a guild they manage, up to the per-user limit.
 * Platform owners may register any guild (or none) without limit.
 */
export async function createServerFor(
  actor: { discordId: string; platformOwner: boolean },
  input: { name: string; guildId: string | null }
): Promise<CreateForResult> {
  if (!actor.platformOwner) {
    if (!input.guildId) return { ok: false, error: "guild_required" };
    if (!(await managesGuild(actor.discordId, input.guildId))) return { ok: false, error: "guild_not_managed" };
    if ((await countServersCreatedBy(actor.discordId)) >= maxServersPerUser()) return { ok: false, error: "too_many_servers" };
  }
  const icon = input.guildId
    ? (await db.get<{ icon_url: string | null }>("SELECT icon_url FROM user_guilds WHERE guild_id = ? AND icon_url IS NOT NULL LIMIT 1", [input.guildId]))?.icon_url
    : null;
  return createServer({ name: input.name, guildId: input.guildId, createdBy: actor.discordId, iconUrl: icon ?? null });
}

/** Tables holding a server's data (deleted with it). */
const SERVER_TABLES = [
  "staff_members", "activity_sessions", "staff_badges", "staff_notes", "grade_history", "audit_log", "voice_sessions",
  "warnings", "playtime_snapshots", "playtime_totals", "discord_roles", "grade_roles", "panel_access", "warn_roles",
  "weekly_reviews", "server_owners", "member_roles", "fivem_state", "fivem_commands", "players", "player_sessions", "fivem_console",
  "security_settings", "bans", "ac_detections", "ac_screenshots", "security_incidents",
  "screen_frames", "bot_actions", "discord_backups",
  "tebex_settings", "tebex_events", "tebex_disabled_packages", "store_sites", "store_versions"
];

/** Delete a server and every piece of its data, atomically. Irreversible. */
export async function deleteServer(id: string): Promise<boolean> {
  if (!(await getServer(id))) return false;
  await db.batch([
    ...SERVER_TABLES.map((table) => stmt(`DELETE FROM ${table} WHERE server_id = ?`, [id])),
    stmt("DELETE FROM bot_status WHERE key LIKE ? OR key = ?", [`${id}:%`, `lock:review:${id}`]),
    stmt("DELETE FROM servers WHERE id = ?", [id])
  ]);
  return true;
}

export type ServerSettings = { name?: string; guildId?: string | null; timezone?: string | null; reviewHour?: number | null };

export async function updateServer(id: string, settings: ServerSettings): Promise<{ ok: true } | { ok: false; error: "guild_taken" }> {
  if (settings.guildId) {
    const other = await getServerByGuild(settings.guildId);
    if (other && other.id !== id) return { ok: false, error: "guild_taken" };
  }
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  const map: [keyof ServerSettings, string][] = [["name", "name"], ["guildId", "guild_id"], ["timezone", "timezone"], ["reviewHour", "review_hour"]];
  for (const [key, column] of map) {
    if (settings[key] === undefined) continue;
    sets.push(`${column} = ?`);
    args.push(settings[key] as string | number | null);
  }
  if (sets.length) await db.run(`UPDATE servers SET ${sets.join(", ")} WHERE id = ?`, [...args, id]);
  return { ok: true };
}

/** True when `tz` is an IANA time zone this runtime knows ("Europe/Paris", "America/Montreal"…). */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ---- owners ----

export async function listServerOwners(serverId: string): Promise<string[]> {
  return (await db.all<{ discord_id: string }>("SELECT discord_id FROM server_owners WHERE server_id = ? ORDER BY created_at", [serverId])).map((r) => r.discord_id);
}

export async function addServerOwner(serverId: string, discordId: string, addedBy: string): Promise<boolean> {
  const { changes } = await db.run("INSERT OR IGNORE INTO server_owners (server_id, discord_id, added_by) VALUES (?, ?, ?)", [serverId, discordId, addedBy]);
  return changes > 0;
}

export async function removeServerOwner(serverId: string, discordId: string): Promise<boolean> {
  const { changes } = await db.run("DELETE FROM server_owners WHERE server_id = ? AND discord_id = ?", [serverId, discordId]);
  return changes > 0;
}

// ---- FiveM agent token ----

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Create (or replace) the FiveM agent token of a server. The clear value is returned once and never stored. */
export async function rotateFivemToken(serverId: string): Promise<string> {
  const token = `fvm_${randomBytes(24).toString("base64url")}`;
  await db.run("UPDATE servers SET fivem_token_hash = ? WHERE id = ?", [hashToken(token), serverId]);
  return token;
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * The server a FiveM agent token belongs to, or null.
 * The old shared FIVEM_AGENT_TOKEN (env) still works and maps to the legacy server.
 */
export async function serverForFivemToken(token: string | null): Promise<Server | null> {
  if (!token) return null;
  const legacy = process.env.FIVEM_AGENT_TOKEN;
  if (legacy && sameSecret(token, legacy)) return getServer(LEGACY_SERVER_ID);
  // A sha256 lookup: comparing hashes leaks nothing useful about the token itself.
  const row = await db.get<ServerRow>(`SELECT ${COLUMNS} FROM servers WHERE fivem_token_hash = ?`, [hashToken(token)]);
  return row ? toServer(row) : null;
}
