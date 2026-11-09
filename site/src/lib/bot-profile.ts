import { auditStmt } from "./audit";
import { db, stmt } from "./db";
import { adminAuditStmt } from "./platform";
import { BOT_BIO_MAX, BOT_IMAGE_MAX_BYTES, BOT_NICK_MAX } from "./platform-shared";

/**
 * The shared bot's look:
 * - on one server's Discord (owners, /s/<id>/bot): name, avatar, banner and bio through Modify Current Member
 *   (PATCH /guilds/{guild}/members/@me), visible on that Discord only;
 * - everywhere (platform admins, /admin/bot): username, avatar and banner (PATCH /users/@me) and the "About me"
 *   (the application's description, PATCH /applications/@me).
 * Calls go straight to Discord with DISCORD_BOT_TOKEN, so the owner gets Discord's answer at once.
 */

/** DISCORD_API_BASE: tests / local previews only (a fake Discord); never set in production. */
const api = () => (process.env.DISCORD_API_BASE || "https://discord.com/api/v10").replace(/\/+$/, "");
const CDN = "https://cdn.discordapp.com";
type Actor = { discordId: string; username?: string | null };

export type DiscordFailure = { ok: false; error: string; message?: string; retryAfter?: number };

const token = () => process.env.DISCORD_BOT_TOKEN;
const ext = (hash: string) => (hash.startsWith("a_") ? "gif" : "png");

// ---- pure helpers (tested) ----

/** A data URI of an accepted image within the size limit, or null. */
export function cleanImage(dataUri: unknown, maxBytes = BOT_IMAGE_MAX_BYTES): string | null {
  if (typeof dataUri !== "string") return null;
  const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUri);
  if (!match) return null;
  const bytes = Math.floor((match[2].length * 3) / 4) - (match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0);
  return bytes > 0 && bytes <= maxBytes ? dataUri : null;
}

export const userAvatarUrl = (userId: string, hash: string | null, size = 256) =>
  hash ? `${CDN}/avatars/${userId}/${hash}.${ext(hash)}?size=${size}` : `${CDN}/embed/avatars/${Number((BigInt(userId) >> BigInt(22)) % BigInt(6))}.png`;
export const userBannerUrl = (userId: string, hash: string | null, size = 600) => (hash ? `${CDN}/banners/${userId}/${hash}.${ext(hash)}?size=${size}` : null);
export const memberAvatarUrl = (guildId: string, userId: string, hash: string | null, size = 256) =>
  hash ? `${CDN}/guilds/${guildId}/users/${userId}/avatars/${hash}.${ext(hash)}?size=${size}` : null;
export const memberBannerUrl = (guildId: string, userId: string, hash: string | null, size = 600) =>
  hash ? `${CDN}/guilds/${guildId}/users/${userId}/banners/${hash}.${ext(hash)}?size=${size}` : null;

/** Pure: Discord's answer -> an error code the panel translates (and Discord's own words when they help). */
export function discordFailure(status: number, body: { code?: number; message?: string; retry_after?: number; errors?: unknown } | null): DiscordFailure {
  if (status === 429) return { ok: false, error: "discord_rate_limited", retryAfter: Math.ceil(Number(body?.retry_after ?? 60)) };
  if (status === 401) return { ok: false, error: "bot_unavailable" };
  if (status === 404 || body?.code === 10004 || body?.code === 10007) return { ok: false, error: "bot_not_in_guild" };
  if (status === 403) return { ok: false, error: "bot_forbidden" };
  // 50035 Invalid Form Body: Discord says which field (image too big, name refused…).
  const detail = JSON.stringify(body?.errors ?? {}).match(/"message":"([^"]{3,200})"/)?.[1] ?? body?.message;
  return { ok: false, error: "discord_rejected", message: detail?.slice(0, 200) };
}

async function discord<T>(method: "GET" | "PATCH", path: string, body?: unknown, reason?: string): Promise<{ ok: true; data: T } | DiscordFailure> {
  const bot = token();
  if (!bot) return { ok: false, error: "bot_unavailable" };
  const headers: Record<string, string> = { Authorization: `Bot ${bot}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (reason) headers["X-Audit-Log-Reason"] = encodeURIComponent(reason.slice(0, 400));
  const res = await fetch(`${api()}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!res) return { ok: false, error: "discord_unreachable" };
  const data = await res.json().catch(() => null);
  return res.ok ? { ok: true, data: data as T } : discordFailure(res.status, data);
}

// ---- the bot itself ----

type ApiUser = { id: string; username: string; global_name?: string | null; avatar: string | null; banner?: string | null };
export type BotIdentity = { id: string; username: string; avatarUrl: string; bannerUrl: string | null; description: string };

const g = globalThis as unknown as { fvxBotIdentity?: { value: BotIdentity; at: number } };

/** Who the bot is everywhere (cached 5 minutes); null when the token is missing or Discord does not answer. */
export async function getBotIdentity(fresh = false): Promise<BotIdentity | null> {
  const hit = g.fvxBotIdentity;
  if (!fresh && hit && Date.now() - hit.at < 300_000) return hit.value;
  const [user, app] = await Promise.all([discord<ApiUser>("GET", "/users/@me"), discord<{ description?: string }>("GET", "/applications/@me")]);
  if (!user.ok) return null;
  const value: BotIdentity = {
    id: user.data.id,
    username: user.data.username,
    avatarUrl: userAvatarUrl(user.data.id, user.data.avatar),
    bannerUrl: userBannerUrl(user.data.id, user.data.banner ?? null),
    description: app.ok ? app.data.description ?? "" : ""
  };
  g.fvxBotIdentity = { value, at: Date.now() };
  return value;
}

export type IdentityInput = { username?: string; avatar?: string | null; banner?: string | null; description?: string };

/** Platform admins: change the bot everywhere. Only the given fields change; null removes an image. */
export async function updateBotIdentity(actor: Actor, input: IdentityInput): Promise<{ ok: true; identity: BotIdentity } | DiscordFailure> {
  const userPatch: Record<string, unknown> = {};
  if (input.username !== undefined) userPatch.username = input.username;
  for (const key of ["avatar", "banner"] as const) {
    if (input[key] === undefined) continue;
    if (input[key] !== null && !cleanImage(input[key])) return { ok: false, error: "invalid_image" };
    userPatch[key] = input[key];
  }
  if (Object.keys(userPatch).length) {
    const res = await discord<ApiUser>("PATCH", "/users/@me", userPatch);
    if (!res.ok) return res;
  }
  if (input.description !== undefined) {
    const res = await discord("PATCH", "/applications/@me", { description: input.description });
    if (!res.ok) return res;
  }
  await db.batch([adminAuditStmt(actor, "bot_identity", null, null, {
    username: input.username, description: input.description !== undefined ? "modifié" : undefined,
    avatar: input.avatar === undefined ? undefined : input.avatar === null ? "retiré" : "changé",
    banner: input.banner === undefined ? undefined : input.banner === null ? "retiré" : "changé"
  })]);
  const identity = await getBotIdentity(true);
  return identity ? { ok: true, identity } : { ok: false, error: "bot_unavailable" };
}

// ---- the bot on one server's Discord ----

type ApiMember = { nick?: string | null; avatar?: string | null; banner?: string | null; bio?: string | null; user?: ApiUser };
export type GuildBotProfile = {
  /** What the server set (null: the bot's own). */
  nick: string | null;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  updatedAt: string | null;
  /** The bot's own look, shown where the server set nothing. */
  base: BotIdentity | null;
  /** The bot could be read on this Discord (false: not invited, or token problem). */
  present: boolean;
};

/** The bot's look on a server's Discord: Discord's member (live) plus what the panel stored (bio, date). */
export async function getGuildBotProfile(serverId: string, guildId: string | null): Promise<GuildBotProfile> {
  const [base, stored] = await Promise.all([
    getBotIdentity(),
    db.get<{ nick: string | null; bio: string | null; avatar_hash: string | null; banner_hash: string | null; updated_at: string }>(
      "SELECT nick, bio, avatar_hash, banner_hash, updated_at FROM bot_profiles WHERE server_id = ?", [serverId]
    )
  ]);
  let member: ApiMember | null = null;
  if (guildId && base) {
    const res = await discord<ApiMember>("GET", `/guilds/${guildId}/members/${base.id}`);
    if (res.ok) member = res.data;
  }
  const botId = base?.id ?? "";
  const avatarHash = member ? member.avatar ?? null : stored?.avatar_hash ?? null;
  const bannerHash = member ? member.banner ?? null : stored?.banner_hash ?? null;
  return {
    nick: member ? member.nick ?? null : stored?.nick ?? null,
    bio: member?.bio ?? stored?.bio ?? null,
    avatarUrl: guildId && botId ? memberAvatarUrl(guildId, botId, avatarHash) : null,
    bannerUrl: guildId && botId ? memberBannerUrl(guildId, botId, bannerHash) : null,
    updatedAt: stored?.updated_at ?? null,
    base,
    present: Boolean(member)
  };
}

export type GuildProfileInput = { nick?: string | null; bio?: string | null; avatar?: string | null; banner?: string | null };

/** Pure: the Discord body for a server's bot profile (only the fields given; empty texts mean "back to the default"). */
export function guildProfileBody(input: GuildProfileInput): { body: Record<string, string | null> } | { error: string } {
  const body: Record<string, string | null> = {};
  if (input.nick !== undefined) {
    const nick = input.nick?.replace(/\s+/g, " ").trim() ?? "";
    if (nick.length > BOT_NICK_MAX) return { error: "invalid_nick" };
    body.nick = nick || null;
  }
  if (input.bio !== undefined) {
    const bio = input.bio?.trim() ?? "";
    if (bio.length > BOT_BIO_MAX) return { error: "invalid_bio" };
    body.bio = bio || null;
  }
  for (const key of ["avatar", "banner"] as const) {
    if (input[key] === undefined) continue;
    if (input[key] !== null && !cleanImage(input[key])) return { error: "invalid_image" };
    body[key] = input[key] ?? null;
  }
  return Object.keys(body).length ? { body } : { error: "nothing_to_change" };
}

/** Owners: apply the bot's look on their Discord, then remember it (and log it in the server's logs). */
export async function updateGuildBotProfile(
  server: { id: string; guildId: string | null },
  actor: Actor,
  input: GuildProfileInput,
  now = new Date()
): Promise<{ ok: true; profile: GuildBotProfile } | DiscordFailure> {
  if (!server.guildId) return { ok: false, error: "no_guild" };
  const built = guildProfileBody(input);
  if ("error" in built) return { ok: false, error: built.error };
  const res = await discord<ApiMember>("PATCH", `/guilds/${server.guildId}/members/@me`, built.body, `Profil du bot changé depuis Fiverax par ${actor.username ?? actor.discordId}`);
  if (!res.ok) return res;
  const m = res.data;
  const prev = await db.get<{ bio: string | null }>("SELECT bio FROM bot_profiles WHERE server_id = ?", [server.id]);
  const bio = built.body.bio !== undefined ? built.body.bio : m.bio ?? prev?.bio ?? null;
  await db.batch([
    stmt(
      `INSERT INTO bot_profiles (server_id, nick, bio, avatar_hash, banner_hash, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(server_id) DO UPDATE SET nick = excluded.nick, bio = excluded.bio, avatar_hash = excluded.avatar_hash,
         banner_hash = excluded.banner_hash, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      [server.id, m.nick ?? null, bio, m.avatar ?? null, m.banner ?? null, now.toISOString(), actor.discordId]
    ),
    auditStmt(server.id, actor, "bot_profile", null, {
      nom: built.body.nick === undefined ? undefined : built.body.nick ?? "par défaut",
      bio: built.body.bio === undefined ? undefined : built.body.bio ? "modifiée" : "retirée",
      avatar: built.body.avatar === undefined ? undefined : built.body.avatar ? "changé" : "retiré",
      bannière: built.body.banner === undefined ? undefined : built.body.banner ? "changée" : "retirée"
    })
  ]);
  return { ok: true, profile: await getGuildBotProfile(server.id, server.guildId) };
}
