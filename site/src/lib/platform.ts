import { db, stmt, type Stmt } from "./db";
import { DEFAULT_PLATFORM_SETTINGS, platformSettingsSchema, type PlatformSettings } from "./platform-shared";

/**
 * Platform level (above the servers): settings changed from /admin, the journal of the admins' actions, and the
 * registry of every account that ever logged in (with platform bans). Kept free of imports from servers/auth so
 * that low-level modules (servers, ai, auth) can read the settings without import cycles.
 */

type Actor = { discordId: string; username?: string | null };

// ---- settings ----

const SETTINGS_KEY = "settings";
const cacheMs = () => Number(process.env.CONFIG_CACHE_MS ?? 10_000);
const g = globalThis as unknown as { fvxPlatformSettings?: { value: PlatformSettings; at: number } };

/** Pure: stored JSON -> settings (anything unreadable or missing falls back to the defaults). */
export function parsePlatformSettings(raw: string | null | undefined): PlatformSettings {
  if (!raw) return DEFAULT_PLATFORM_SETTINGS;
  try {
    const parsed = platformSettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_PLATFORM_SETTINGS;
  } catch {
    return DEFAULT_PLATFORM_SETTINGS;
  }
}

/** The platform settings, cached a few seconds per instance (read on every panel request). */
export async function getPlatformSettings(): Promise<PlatformSettings> {
  const hit = g.fvxPlatformSettings;
  if (hit && Date.now() - hit.at < cacheMs()) return hit.value;
  const row = await db.get<{ value_json: string }>("SELECT value_json FROM platform_settings WHERE key = ?", [SETTINGS_KEY]);
  const value = parsePlatformSettings(row?.value_json);
  g.fvxPlatformSettings = { value, at: Date.now() };
  return value;
}

export async function savePlatformSettings(actor: Actor, input: unknown, now = new Date()): Promise<PlatformSettings> {
  const value = platformSettingsSchema.parse(input);
  await db.batch([
    stmt(
      `INSERT INTO platform_settings (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      [SETTINGS_KEY, JSON.stringify(value), now.toISOString(), actor.discordId]
    ),
    adminAuditStmt(actor, "settings_save", null, null, value, now)
  ]);
  g.fvxPlatformSettings = { value, at: Date.now() };
  return value;
}

/** Only the bot's status / activity (the rest of the settings is kept as it is). */
export async function saveBotPresence(actor: Actor, presence: unknown, now = new Date()): Promise<PlatformSettings> {
  const current = await getPlatformSettings();
  const value = platformSettingsSchema.parse({ ...current, bot: presence });
  await db.batch([
    stmt(
      `INSERT INTO platform_settings (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      [SETTINGS_KEY, JSON.stringify(value), now.toISOString(), actor.discordId]
    ),
    adminAuditStmt(actor, "bot_presence", null, null, value.bot, now)
  ]);
  g.fvxPlatformSettings = { value, at: Date.now() };
  return value;
}

// ---- journal of the admins ----

/** The statement that records an admin action (add it to the batch of the change itself). */
export function adminAuditStmt(actor: Actor, action: string, targetKind: string | null, targetId: string | null, details: unknown, now = new Date()): Stmt {
  return stmt(
    "INSERT INTO admin_audit (created_at, actor_discord_id, actor_name, action, target_kind, target_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [now.toISOString(), actor.discordId, actor.username ?? null, action, targetKind, targetId, JSON.stringify(details ?? {})]
  );
}

export async function adminAudit(actor: Actor, action: string, targetKind: string | null, targetId: string | null, details: unknown): Promise<void> {
  const s = adminAuditStmt(actor, action, targetKind, targetId, details);
  await db.run(s.sql, s.args);
}

export type AdminAuditRow = {
  id: number;
  createdAt: string;
  actorId: string;
  actorName: string | null;
  action: string;
  targetKind: string | null;
  targetId: string | null;
  details: Record<string, unknown>;
};

export async function listAdminAudit(opts: { targetKind?: string; targetId?: string; limit?: number; offset?: number } = {}): Promise<{ rows: AdminAuditRow[]; total: number }> {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.targetKind) {
    where.push("target_kind = ?");
    args.push(opts.targetKind);
  }
  if (opts.targetId) {
    where.push("target_id = ?");
    args.push(opts.targetId);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [count, rows] = await db.batch(
    [
      stmt(`SELECT COUNT(*) AS n FROM admin_audit ${clause}`, args),
      stmt(`SELECT * FROM admin_audit ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`, [...args, opts.limit ?? 50, opts.offset ?? 0])
    ],
    "read"
  );
  return {
    total: Number(count.rows[0]?.n ?? 0),
    rows: rows.rows.map((r) => {
      let details: Record<string, unknown> = {};
      try { details = JSON.parse(String(r.details ?? "{}")) as Record<string, unknown>; } catch { /* keep empty */ }
      return {
        id: Number(r.id), createdAt: String(r.created_at), actorId: String(r.actor_discord_id), actorName: (r.actor_name as string | null) ?? null,
        action: String(r.action), targetKind: (r.target_kind as string | null) ?? null, targetId: (r.target_id as string | null) ?? null, details
      };
    })
  };
}

// ---- accounts ----

export type PlatformUser = {
  discordId: string;
  username: string;
  avatarUrl: string | null;
  firstLoginAt: string;
  lastLoginAt: string;
  loginCount: number;
  bannedAt: string | null;
  bannedBy: string | null;
  banReason: string | null;
  /** Partner of the private beta (lib/beta.ts). */
  partnerAt: string | null;
};

type UserRow = {
  discord_id: string; username: string; avatar_url: string | null; first_login_at: string; last_login_at: string; login_count: number;
  banned_at: string | null; banned_by: string | null; ban_reason: string | null; partner_at?: string | null;
};

export const toPlatformUser = (r: UserRow): PlatformUser => ({
  discordId: r.discord_id, username: r.username, avatarUrl: r.avatar_url, firstLoginAt: r.first_login_at, lastLoginAt: r.last_login_at,
  loginCount: Number(r.login_count), bannedAt: r.banned_at, bannedBy: r.banned_by, banReason: r.ban_reason, partnerAt: r.partner_at ?? null
});

/** At each login: the account's name, avatar and login count. */
export async function recordLogin(identity: { discordId: string; username: string; avatarUrl: string | null }, now = new Date()): Promise<void> {
  const at = now.toISOString();
  await db.run(
    `INSERT INTO platform_users (discord_id, username, avatar_url, first_login_at, last_login_at, login_count) VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(discord_id) DO UPDATE SET username = excluded.username, avatar_url = excluded.avatar_url,
       last_login_at = excluded.last_login_at, login_count = platform_users.login_count + 1`,
    [identity.discordId, identity.username.slice(0, 100), identity.avatarUrl, at, at]
  );
}

export async function getPlatformUser(discordId: string): Promise<PlatformUser | null> {
  const row = await db.get<UserRow>("SELECT * FROM platform_users WHERE discord_id = ?", [discordId]);
  return row ? toPlatformUser(row) : null;
}

/** Banned from the platform: no login, every session refused (see session.ts). */
export async function isUserBanned(discordId: string): Promise<boolean> {
  return Boolean(await db.get("SELECT 1 AS x FROM platform_users WHERE discord_id = ? AND banned_at IS NOT NULL", [discordId]));
}
