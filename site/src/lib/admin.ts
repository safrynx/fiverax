import { ONLINE_MS } from "./agent";
import { resetServerAiUsage, serverAiUsage } from "./ai-quota";
import { audit } from "./audit";
import { HEARTBEAT_MAX_AGE_MS } from "./bot-status";
import { getPlatformOwnerIds, invalidateConfig, isPlatformOwner } from "./config";
import { db, stmt } from "./db";
import { moderateReview } from "./directory";
import { moderateItem } from "./library";
import { adminAuditStmt, listAdminAudit, toPlatformUser, type AdminAuditRow, type PlatformUser } from "./platform";
import { addServerOwner, deleteServer, getServer, LEGACY_SERVER_ID, listServerOwners, removeServerOwner, setServerSuspended, type Server } from "./servers";
import { listUserSessions, revokeSession, revokeUserSessions, type SessionRow } from "./session";

/**
 * Platform administration (/admin, platform owners = PANEL_OWNER_IDS): what runs on the platform, and the actions
 * on accounts and servers. Every action is written to admin_audit; the ones on a server also go to that server's
 * own logs, so its owners can see what happened to it.
 */

type Actor = { discordId: string; username?: string | null };

export class AdminError extends Error {}

const isoAgo = (ms: number, now = Date.now()) => new Date(now - ms).toISOString();
const num = (v: unknown) => Number(v ?? 0);

// ---- system ----

export type SystemCheck = { key: string; label: string; ok: boolean; level: "error" | "warn" | "info"; hint: string };
export type SystemReport = {
  ok: boolean;
  database: "ok" | string;
  missingEnv: string[];
  checks: SystemCheck[];
  warnings: SystemCheck[];
  migrations: { name: string; appliedAt: string }[];
};

const REQUIRED_ENV = ["SESSION_SECRET", "APP_URL", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_REDIRECT_URI", "DISCORD_BOT_TOKEN", "BOT_API_TOKEN"];

/** Configuration and database health: what /api/health answers, in detail for /admin/system. Never shows a value. */
export async function systemChecks(): Promise<SystemReport> {
  const env = process.env;
  const production = Boolean(env.VERCEL) || env.NODE_ENV === "production";
  const missingEnv = REQUIRED_ENV.filter((name) => !env[name]);
  if (production) for (const name of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"]) if (!env[name]) missingEnv.push(name);

  let database: "ok" | string = "ok";
  let migrations: SystemReport["migrations"] = [];
  try {
    migrations = (await db.all<{ name: string; applied_at: string }>("SELECT name, applied_at FROM schema_migrations ORDER BY id DESC")).map((r) => ({ name: r.name, appliedAt: r.applied_at }));
  } catch (error) {
    database = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 200);
  }

  let appUrl: URL | null = null;
  try { appUrl = env.APP_URL ? new URL(env.APP_URL) : null; } catch { /* reported below */ }
  const expectedRedirect = appUrl ? `${appUrl.origin}/api/auth/discord/callback` : null;
  const secret = env.SESSION_SECRET ?? "";
  const checks: SystemCheck[] = [
    { key: "session_secret", label: "SESSION_SECRET : 32 caractères ou plus", ok: secret.length >= 32, level: "error", hint: "Il signe les sessions : génère-le avec node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"." },
    { key: "bot_token", label: "BOT_API_TOKEN : 32 caractères ou plus", ok: (env.BOT_API_TOKEN ?? "").length >= 32, level: "warn", hint: "Le bot s'authentifie avec : un secret court se devine. Même valeur côté bot." },
    { key: "app_url", label: "APP_URL valide" + (production ? " et en https" : ""), ok: Boolean(appUrl) && (!production || appUrl?.protocol === "https:"), level: "error", hint: "Adresse publique du site, par exemple https://fiverax.com (sans / final)." },
    {
      key: "redirect", label: "DISCORD_REDIRECT_URI = APP_URL + /api/auth/discord/callback",
      ok: !expectedRedirect || env.DISCORD_REDIRECT_URI === expectedRedirect, level: "warn",
      hint: `Attendu : ${expectedRedirect ?? "APP_URL/api/auth/discord/callback"} (et la même adresse dans le portail développeur Discord).`
    },
    { key: "owners", label: "PANEL_OWNER_IDS : au moins un administrateur", ok: getPlatformOwnerIds().length > 0, level: "warn", hint: "Identifiants Discord des administrateurs de la plateforme, séparés par des virgules." },
    {
      key: "legacy_token", label: "Pas d'ancien token FiveM partagé (FIVEM_AGENT_TOKEN)", ok: !env.FIVEM_AGENT_TOKEN || env.FIVEM_AGENT_TOKEN.length >= 32, level: "warn",
      hint: "Chaque serveur a son propre token (Accès & rôles). Garde l'ancien seulement s'il est long et encore utilisé, sinon retire-le."
    },
    {
      key: "tebex_key", label: "TEBEX_ENCRYPTION_KEY distinct de SESSION_SECRET", ok: Boolean(env.TEBEX_ENCRYPTION_KEY) && env.TEBEX_ENCRYPTION_KEY !== secret, level: "info",
      hint: "Sans lui, changer SESSION_SECRET rend illisibles les clés Tebex enregistrées (il faudra les retaper)."
    },
    { key: "ai", label: "IA configurée (AI_API_KEY)", ok: Boolean(env.AI_API_KEY), level: "info", hint: "Studio, assistant, bilans, captures : désactivés sans clé." },
    { key: "database", label: "Base de données joignable", ok: database === "ok", level: "error", hint: database === "ok" ? "" : database }
  ];
  const warnings = checks.filter((c) => !c.ok && c.level !== "info");
  return { ok: missingEnv.length === 0 && database === "ok", database, missingEnv, checks, warnings, migrations };
}

// ---- overview ----

export type AdminOverview = {
  users: { total: number; new7d: number; active24h: number; banned: number };
  servers: { total: number; new7d: number; suspended: number; withAgent: number; agentsOnline: number; botAlive: number };
  sessions: { open: number };
  scans: { last24h: number; last7d: number };
  moderation: { reviews: number; library: number };
  recentServers: { id: string; name: string; iconUrl: string | null; createdAt: string; createdBy: string | null; creatorName: string | null; suspended: boolean }[];
  recentUsers: PlatformUser[];
};

export async function adminOverview(now = Date.now()): Promise<AdminOverview> {
  const day = isoAgo(86_400_000, now);
  const week = isoAgo(7 * 86_400_000, now);
  const nowIso = new Date(now).toISOString();
  const [users, servers, active, sessions, scans, moderation, agents, beats, recentServers, recentUsers] = await db.batch(
    [
      stmt("SELECT COUNT(*) AS total, SUM(CASE WHEN first_login_at >= ? THEN 1 ELSE 0 END) AS new7d, SUM(CASE WHEN banned_at IS NOT NULL THEN 1 ELSE 0 END) AS banned FROM platform_users", [week]),
      stmt(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS new7d,
                SUM(CASE WHEN suspended_at IS NOT NULL THEN 1 ELSE 0 END) AS suspended, SUM(CASE WHEN fivem_token_hash IS NOT NULL THEN 1 ELSE 0 END) AS with_agent
         FROM servers`
      ),
      stmt("SELECT COUNT(DISTINCT discord_id) AS n FROM auth_sessions WHERE last_seen_at >= ?", [day]),
      stmt("SELECT COUNT(*) AS n FROM auth_sessions WHERE revoked_at IS NULL AND expires_at > ?", [nowIso]),
      stmt("SELECT SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS d1, COUNT(*) AS d7 FROM public_scans WHERE created_at >= ?", [day, week]),
      stmt("SELECT (SELECT COUNT(*) FROM directory_reviews WHERE status = 'hidden') AS reviews, (SELECT COUNT(*) FROM library_items WHERE status = 'hidden') AS library"),
      stmt("SELECT seen_at FROM fivem_state"),
      stmt("SELECT value FROM bot_status WHERE key LIKE '%:heartbeat'"),
      stmt(
        `SELECT s.id, s.name, s.icon_url, s.created_at, s.created_by, s.suspended_at, u.username AS creator_name
         FROM servers s LEFT JOIN platform_users u ON u.discord_id = s.created_by ORDER BY s.created_at DESC LIMIT 8`
      ),
      stmt("SELECT * FROM platform_users ORDER BY first_login_at DESC LIMIT 8")
    ],
    "read"
  );
  const fresh = (raw: unknown, maxAge: number) => {
    const at = Date.parse(String(raw ?? ""));
    return Number.isFinite(at) && now - at < maxAge;
  };
  return {
    users: { total: num(users.rows[0]?.total), new7d: num(users.rows[0]?.new7d), active24h: num(active.rows[0]?.n), banned: num(users.rows[0]?.banned) },
    servers: {
      total: num(servers.rows[0]?.total), new7d: num(servers.rows[0]?.new7d), suspended: num(servers.rows[0]?.suspended), withAgent: num(servers.rows[0]?.with_agent),
      agentsOnline: agents.rows.filter((r) => fresh(r.seen_at, ONLINE_MS)).length,
      botAlive: beats.rows.filter((r) => fresh(r.value, HEARTBEAT_MAX_AGE_MS)).length
    },
    sessions: { open: num(sessions.rows[0]?.n) },
    scans: { last24h: num(scans.rows[0]?.d1), last7d: num(scans.rows[0]?.d7) },
    moderation: { reviews: num(moderation.rows[0]?.reviews), library: num(moderation.rows[0]?.library) },
    recentServers: recentServers.rows.map((r) => ({
      id: String(r.id), name: String(r.name), iconUrl: (r.icon_url as string | null) ?? null, createdAt: String(r.created_at),
      createdBy: (r.created_by as string | null) ?? null, creatorName: (r.creator_name as string | null) ?? null, suspended: Boolean(r.suspended_at)
    })),
    recentUsers: recentUsers.rows.map((r) => toPlatformUser(r as never))
  };
}

// ---- servers ----

export type AdminServerRow = {
  id: string;
  name: string;
  guildId: string | null;
  iconUrl: string | null;
  createdAt: string;
  createdBy: string | null;
  creatorName: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  hasFivemToken: boolean;
  owners: number;
  staff: number;
  players: number;
  agentSeenAt: string | null;
  agentOnline: boolean;
  botAlive: boolean;
  aiToday: number;
};

export type ServerFilter = "all" | "suspended" | "online" | "no_agent";

export async function adminListServers(
  opts: { id?: string; q?: string; filter?: ServerFilter; limit?: number; offset?: number } = {},
  now = Date.now()
): Promise<{ rows: AdminServerRow[]; total: number }> {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.id) {
    where.push("s.id = ?");
    args.push(opts.id);
  }
  const q = opts.q?.trim();
  if (q) {
    where.push("(LOWER(s.name) LIKE ? OR s.id LIKE ? OR s.guild_id = ? OR s.created_by = ?)");
    args.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`, q, q);
  }
  if (opts.filter === "suspended") where.push("s.suspended_at IS NOT NULL");
  if (opts.filter === "no_agent") where.push("f.seen_at IS NULL");
  if (opts.filter === "online") {
    where.push("f.seen_at >= ?");
    args.push(isoAgo(ONLINE_MS, now));
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const from = `FROM servers s LEFT JOIN platform_users u ON u.discord_id = s.created_by LEFT JOIN fivem_state f ON f.server_id = s.id
    LEFT JOIN bot_status b ON b.key = s.id || ':heartbeat' ${clause}`;
  const today = new Date(now).toISOString().slice(0, 10);
  const [count, rows] = await db.batch(
    [
      stmt(`SELECT COUNT(*) AS n ${from}`, args),
      stmt(
        `SELECT s.id, s.name, s.guild_id, s.icon_url, s.created_at, s.created_by, s.suspended_at, s.suspended_reason,
                s.fivem_token_hash IS NOT NULL AS has_token, u.username AS creator_name, f.seen_at AS agent_seen_at, b.value AS heartbeat,
                (SELECT COUNT(*) FROM server_owners o WHERE o.server_id = s.id) AS owners,
                (SELECT COUNT(*) FROM staff_members m WHERE m.server_id = s.id AND m.left_guild_at IS NULL) AS staff,
                (SELECT COUNT(*) FROM players p WHERE p.server_id = s.id) AS players,
                (SELECT COALESCE(SUM(a.count), 0) FROM ai_usage a WHERE a.scope = 'server:' || s.id AND a.day = ?) AS ai_today
         ${from} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
        [today, ...args, opts.limit ?? 50, opts.offset ?? 0]
      )
    ],
    "read"
  );
  const fresh = (raw: unknown, maxAge: number) => {
    const at = Date.parse(String(raw ?? ""));
    return Number.isFinite(at) && now - at < maxAge;
  };
  return {
    total: num(count.rows[0]?.n),
    rows: rows.rows.map((r) => ({
      id: String(r.id), name: String(r.name), guildId: (r.guild_id as string | null) ?? null, iconUrl: (r.icon_url as string | null) ?? null,
      createdAt: String(r.created_at), createdBy: (r.created_by as string | null) ?? null, creatorName: (r.creator_name as string | null) ?? null,
      suspendedAt: (r.suspended_at as string | null) ?? null, suspendedReason: (r.suspended_reason as string | null) ?? null, hasFivemToken: Boolean(r.has_token),
      owners: num(r.owners), staff: num(r.staff), players: num(r.players), agentSeenAt: (r.agent_seen_at as string | null) ?? null,
      agentOnline: fresh(r.agent_seen_at, ONLINE_MS), botAlive: fresh(r.heartbeat, HEARTBEAT_MAX_AGE_MS), aiToday: num(r.ai_today)
    }))
  };
}

export type AdminServerDetail = {
  server: Server;
  row: AdminServerRow;
  owners: { discordId: string; username: string | null; banned: boolean }[];
  ai: { today: number; refusedToday: number; last30: number };
  logs: { createdAt: string; actor: string; action: string }[];
  journal: AdminAuditRow[];
};

export async function adminServerDetail(id: string): Promise<AdminServerDetail | null> {
  const server = await getServer(id);
  if (!server) return null;
  const [list, ownerRows, ai, logs, journal] = await Promise.all([
    adminListServers({ id: server.id, limit: 1 }),
    db.all<{ discord_id: string; username: string | null; banned_at: string | null }>(
      `SELECT o.discord_id, u.username, u.banned_at FROM server_owners o LEFT JOIN platform_users u ON u.discord_id = o.discord_id
       WHERE o.server_id = ? ORDER BY o.created_at`,
      [id]
    ),
    serverAiUsage(id),
    db.all<{ created_at: string; actor: string; action: string }>(
      "SELECT created_at, COALESCE(actor_name, actor_discord_id) AS actor, action FROM audit_log WHERE server_id = ? ORDER BY id DESC LIMIT 15",
      [id]
    ),
    listAdminAudit({ targetKind: "server", targetId: id, limit: 20 })
  ]);
  const row = list.rows[0];
  if (!row) return null;
  return {
    server,
    row,
    owners: ownerRows.map((o) => ({ discordId: o.discord_id, username: o.username, banned: Boolean(o.banned_at) })),
    ai,
    logs: logs.map((l) => ({ createdAt: l.created_at, actor: l.actor, action: l.action })),
    journal: journal.rows
  };
}

// ---- accounts ----

export type AdminUserRow = PlatformUser & { owned: number; lastSeenAt: string | null; openSessions: number; platformAdmin: boolean };
export type UserFilter = "all" | "banned" | "active" | "partners";

export async function adminListUsers(opts: { q?: string; filter?: UserFilter; limit?: number; offset?: number } = {}, now = Date.now()): Promise<{ rows: AdminUserRow[]; total: number }> {
  const where: string[] = [];
  const args: (string | number)[] = [];
  const q = opts.q?.trim();
  if (q) {
    where.push("(LOWER(u.username) LIKE ? OR u.discord_id = ?)");
    args.push(`%${q.toLowerCase()}%`, q);
  }
  if (opts.filter === "banned") where.push("u.banned_at IS NOT NULL");
  if (opts.filter === "partners") where.push("u.partner_at IS NOT NULL");
  if (opts.filter === "active") {
    where.push("EXISTS (SELECT 1 FROM auth_sessions a WHERE a.discord_id = u.discord_id AND a.last_seen_at >= ?)");
    args.push(isoAgo(86_400_000, now));
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const nowIso = new Date(now).toISOString();
  const [count, rows] = await db.batch(
    [
      stmt(`SELECT COUNT(*) AS n FROM platform_users u ${clause}`, args),
      stmt(
        `SELECT u.*, (SELECT COUNT(*) FROM server_owners o WHERE o.discord_id = u.discord_id) AS owned,
                (SELECT MAX(a.last_seen_at) FROM auth_sessions a WHERE a.discord_id = u.discord_id) AS last_seen_at,
                (SELECT COUNT(*) FROM auth_sessions a WHERE a.discord_id = u.discord_id AND a.revoked_at IS NULL AND a.expires_at > ?) AS open_sessions
         FROM platform_users u ${clause} ORDER BY u.last_login_at DESC LIMIT ? OFFSET ?`,
        [nowIso, ...args, opts.limit ?? 50, opts.offset ?? 0]
      )
    ],
    "read"
  );
  return {
    total: num(count.rows[0]?.n),
    rows: rows.rows.map((r) => ({
      ...toPlatformUser(r as never),
      owned: num(r.owned),
      lastSeenAt: (r.last_seen_at as string | null) ?? null,
      openSessions: num(r.open_sessions),
      platformAdmin: isPlatformOwner(String(r.discord_id))
    }))
  };
}

export type AdminUserDetail = {
  discordId: string;
  user: PlatformUser | null;
  platformAdmin: boolean;
  owned: { id: string; name: string; suspended: boolean }[];
  created: { id: string; name: string; suspended: boolean }[];
  access: { id: string; name: string }[];
  sessions: SessionRow[];
  journal: AdminAuditRow[];
};

export async function adminUserDetail(discordId: string): Promise<AdminUserDetail> {
  const [userRow, owned, created, access, sessions, journal] = await Promise.all([
    db.get("SELECT * FROM platform_users WHERE discord_id = ?", [discordId]),
    db.all<{ id: string; name: string; suspended_at: string | null }>(
      "SELECT s.id, s.name, s.suspended_at FROM server_owners o JOIN servers s ON s.id = o.server_id WHERE o.discord_id = ? ORDER BY s.name COLLATE NOCASE",
      [discordId]
    ),
    db.all<{ id: string; name: string; suspended_at: string | null }>("SELECT id, name, suspended_at FROM servers WHERE created_by = ? ORDER BY created_at DESC", [discordId]),
    db.all<{ id: string; name: string }>(
      "SELECT DISTINCT s.id, s.name FROM panel_access p JOIN servers s ON s.id = p.server_id WHERE p.kind = 'user' AND p.discord_id = ? ORDER BY s.name COLLATE NOCASE",
      [discordId]
    ),
    listUserSessions(discordId),
    listAdminAudit({ targetKind: "user", targetId: discordId, limit: 20 })
  ]);
  return {
    discordId,
    user: userRow ? toPlatformUser(userRow as never) : null,
    platformAdmin: isPlatformOwner(discordId),
    owned: owned.map((s) => ({ id: s.id, name: s.name, suspended: Boolean(s.suspended_at) })),
    created: created.map((s) => ({ id: s.id, name: s.name, suspended: Boolean(s.suspended_at) })),
    access,
    sessions,
    journal: journal.rows
  };
}

// ---- actions ----

async function requireServer(id: string): Promise<Server> {
  const server = await getServer(id);
  if (!server) throw new AdminError("unknown_server");
  return server;
}

export async function adminSuspendServer(actor: Actor, serverId: string, reason: string): Promise<void> {
  const server = await requireServer(serverId);
  await setServerSuspended(server.id, { reason, by: actor.discordId });
  await db.batch([adminAuditStmt(actor, "server_suspend", "server", server.id, { name: server.name, reason })]);
  await audit(server.id, actor, "server_suspended", null, { reason });
  invalidateConfig(server.id);
}

export async function adminUnsuspendServer(actor: Actor, serverId: string): Promise<void> {
  const server = await requireServer(serverId);
  await setServerSuspended(server.id, null);
  await db.batch([adminAuditStmt(actor, "server_unsuspend", "server", server.id, { name: server.name })]);
  await audit(server.id, actor, "server_unsuspended", null, {});
  invalidateConfig(server.id);
}

/** Irreversible: every piece of the server's data goes. `confirm` must be the server's id (typed by the admin). */
export async function adminDeleteServer(actor: Actor, serverId: string, confirm: string): Promise<void> {
  const server = await requireServer(serverId);
  if (confirm.trim() !== server.id) throw new AdminError("confirm_mismatch");
  if (server.id === LEGACY_SERVER_ID) throw new AdminError("legacy_server");
  await deleteServer(server.id);
  invalidateConfig(server.id);
  await db.batch([adminAuditStmt(actor, "server_delete", "server", server.id, { name: server.name, guildId: server.guildId })]);
  console.log(`[admin] server ${server.id} (${server.name}) deleted by ${actor.discordId}`);
}

export async function adminAddOwner(actor: Actor, serverId: string, discordId: string): Promise<void> {
  const server = await requireServer(serverId);
  if (!(await addServerOwner(server.id, discordId, actor.discordId))) throw new AdminError("already_exists");
  invalidateConfig(server.id);
  await db.batch([adminAuditStmt(actor, "server_owner_add", "server", server.id, { discordId })]);
  await audit(server.id, actor, "owner_add", discordId, { discordId, par: "administration Fiverax" });
}

export async function adminRemoveOwner(actor: Actor, serverId: string, discordId: string): Promise<void> {
  const server = await requireServer(serverId);
  const owners = await listServerOwners(server.id);
  if (owners.length <= 1 && owners.includes(discordId)) throw new AdminError("last_owner");
  if (!(await removeServerOwner(server.id, discordId))) throw new AdminError("not_found");
  invalidateConfig(server.id);
  await db.batch([adminAuditStmt(actor, "server_owner_remove", "server", server.id, { discordId })]);
  await audit(server.id, actor, "owner_remove", discordId, { discordId, par: "administration Fiverax" });
}

export async function adminResetAi(actor: Actor, serverId: string): Promise<void> {
  const server = await requireServer(serverId);
  await resetServerAiUsage(server.id);
  await db.batch([adminAuditStmt(actor, "server_ai_reset", "server", server.id, {})]);
}

/**
 * Ban an account from the platform: no more login, every open session ends (within seconds on every instance).
 * Works for an account that never logged in (by id). Platform admins cannot be banned, nor can one ban oneself.
 */
export async function adminBanUser(actor: Actor, discordId: string, reason: string, now = new Date()): Promise<number> {
  if (discordId === actor.discordId) throw new AdminError("cannot_ban_self");
  if (isPlatformOwner(discordId)) throw new AdminError("cannot_ban_admin");
  const at = now.toISOString();
  await db.batch([
    stmt(
      "INSERT OR IGNORE INTO platform_users (discord_id, username, first_login_at, last_login_at, login_count) VALUES (?, ?, ?, ?, 0)",
      [discordId, discordId, at, at]
    ),
    stmt("UPDATE platform_users SET banned_at = ?, banned_by = ?, ban_reason = ? WHERE discord_id = ?", [at, actor.discordId, reason.slice(0, 300), discordId]),
    adminAuditStmt(actor, "user_ban", "user", discordId, { reason }, now)
  ]);
  return revokeUserSessions(discordId, "ban", now);
}

export async function adminUnbanUser(actor: Actor, discordId: string): Promise<void> {
  const { changes } = await db.run("UPDATE platform_users SET banned_at = NULL, banned_by = NULL, ban_reason = NULL WHERE discord_id = ? AND banned_at IS NOT NULL", [discordId]);
  if (!changes) throw new AdminError("not_banned");
  await db.batch([adminAuditStmt(actor, "user_unban", "user", discordId, {})]);
}

export async function adminRevokeUserSessions(actor: Actor, discordId: string): Promise<number> {
  const count = await revokeUserSessions(discordId, "admin");
  await db.batch([adminAuditStmt(actor, "user_sessions_revoke", "user", discordId, { sessions: count })]);
  return count;
}

export async function adminRevokeSession(actor: Actor, sessionId: string): Promise<void> {
  const row = await db.get<{ discord_id: string }>("SELECT discord_id FROM auth_sessions WHERE id = ?", [sessionId]);
  if (!row) throw new AdminError("unknown_session");
  await revokeSession(sessionId, "admin");
  await db.batch([adminAuditStmt(actor, "session_revoke", "user", row.discord_id, { session: sessionId.slice(0, 6) })]);
}

export async function adminModerateReview(actor: Actor, reviewId: number, status: "published" | "removed"): Promise<void> {
  if (!(await moderateReview(reviewId, status))) throw new AdminError("unknown_review");
  await db.batch([adminAuditStmt(actor, "review_moderate", "review", String(reviewId), { status })]);
}

export async function adminModerateLibrary(actor: Actor, itemId: number, status: "published" | "removed"): Promise<void> {
  if (!(await moderateItem(itemId, status))) throw new AdminError("unknown_item");
  await db.batch([adminAuditStmt(actor, "library_moderate", "library", String(itemId), { status })]);
}
