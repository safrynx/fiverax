import { isPlatformOwner } from "./config";
import { db, stmt } from "./db";
import { adminAuditStmt, getPlatformSettings } from "./platform";
import { FEEDBACK_KINDS, type FeedbackKind } from "./platform-shared";
import { LEGACY_SERVER_ID } from "./servers";

/**
 * Private beta. Partners are accounts chosen by the platform admins (/admin/beta). While the beta is on:
 * - only partners (and platform admins) may register a server;
 * - a server's panel opens only when one of its owners or its creator is a partner (or an admin); the legacy server
 *   (the original install) always does. Its staff then use it normally: partners bring their team.
 * Public pages for players, the bot and the FiveM agents are never gated. Anyone else may ask for access.
 */

type Actor = { discordId: string; username?: string | null };
const iso = (d = new Date()) => d.toISOString();
const cacheMs = () => Number(process.env.CONFIG_CACHE_MS ?? 10_000);

export class BetaError extends Error {}

export async function betaActive(): Promise<boolean> {
  return (await getPlatformSettings()).beta.active;
}

export async function isPartner(discordId: string): Promise<boolean> {
  if (isPlatformOwner(discordId)) return true;
  return Boolean(await db.get("SELECT 1 AS x FROM platform_users WHERE discord_id = ? AND partner_at IS NOT NULL", [discordId]));
}

const g = globalThis as unknown as { fvxBetaServers?: Map<string, { ok: boolean; at: number }> };
const serverCache = (g.fvxBetaServers ??= new Map());

/** Is this server's panel open during the beta (a partner or an admin among its owners / its creator)? */
export async function serverInBeta(serverId: string, now = Date.now()): Promise<boolean> {
  if (serverId === LEGACY_SERVER_ID) return true;
  const hit = serverCache.get(serverId);
  if (hit && now - hit.at < cacheMs()) return hit.ok;
  const people = await db.all<{ id: string; partner: number }>(
    `SELECT s.created_by AS id, (SELECT COUNT(*) FROM platform_users u WHERE u.discord_id = s.created_by AND u.partner_at IS NOT NULL) AS partner
       FROM servers s WHERE s.id = ?
     UNION ALL
     SELECT o.discord_id AS id, (SELECT COUNT(*) FROM platform_users u WHERE u.discord_id = o.discord_id AND u.partner_at IS NOT NULL) AS partner
       FROM server_owners o WHERE o.server_id = ?`,
    [serverId, serverId]
  );
  const ok = people.some((p) => Number(p.partner) > 0 || isPlatformOwner(String(p.id)));
  serverCache.set(serverId, { ok, at: now });
  return ok;
}

/** May this account open this server's panel right now (beta-wise)? Platform admins always may. */
export async function betaAllows(discordId: string, serverId: string): Promise<boolean> {
  if (isPlatformOwner(discordId) || !(await betaActive())) return true;
  return serverInBeta(serverId);
}

// ---- partners ----

export type Partner = { discordId: string; username: string; avatarUrl: string | null; partnerAt: string; partnerBy: string | null; servers: number };

export async function listPartners(): Promise<Partner[]> {
  const rows = await db.all<{ discord_id: string; username: string; avatar_url: string | null; partner_at: string; partner_by: string | null; servers: number }>(
    `SELECT u.discord_id, u.username, u.avatar_url, u.partner_at, u.partner_by,
            (SELECT COUNT(*) FROM server_owners o WHERE o.discord_id = u.discord_id) AS servers
     FROM platform_users u WHERE u.partner_at IS NOT NULL ORDER BY u.partner_at DESC`
  );
  return rows.map((r) => ({ discordId: r.discord_id, username: r.username, avatarUrl: r.avatar_url, partnerAt: r.partner_at, partnerBy: r.partner_by, servers: Number(r.servers) }));
}

/** Make an account a partner (works before its first login: the row is created). */
export async function addPartner(actor: Actor, discordId: string, now = new Date()): Promise<void> {
  const at = iso(now);
  await db.batch([
    stmt("INSERT OR IGNORE INTO platform_users (discord_id, username, first_login_at, last_login_at, login_count) VALUES (?, ?, ?, ?, 0)", [discordId, discordId, at, at]),
    stmt("UPDATE platform_users SET partner_at = COALESCE(partner_at, ?), partner_by = COALESCE(partner_by, ?) WHERE discord_id = ?", [at, actor.discordId, discordId]),
    stmt("UPDATE beta_requests SET status = 'approved', decided_at = ?, decided_by = ? WHERE discord_id = ? AND status = 'pending'", [at, actor.discordId, discordId]),
    adminAuditStmt(actor, "partner_add", "user", discordId, {}, now)
  ]);
  serverCache.clear();
}

export async function removePartner(actor: Actor, discordId: string): Promise<void> {
  const { changes } = await db.run("UPDATE platform_users SET partner_at = NULL, partner_by = NULL WHERE discord_id = ? AND partner_at IS NOT NULL", [discordId]);
  if (!changes) throw new BetaError("not_partner");
  await db.batch([adminAuditStmt(actor, "partner_remove", "user", discordId, {})]);
  serverCache.clear();
}

// ---- access requests ----

export type BetaRequest = {
  discordId: string; username: string; createdAt: string; updatedAt: string; serverName: string; link: string | null; players: string | null;
  message: string | null; status: "pending" | "approved" | "refused"; decidedAt: string | null;
};

type RequestRow = {
  discord_id: string; username: string; created_at: string; updated_at: string; server_name: string; link: string | null; players: string | null;
  message: string | null; status: BetaRequest["status"]; decided_at: string | null;
};
const toRequest = (r: RequestRow): BetaRequest => ({
  discordId: r.discord_id, username: r.username, createdAt: r.created_at, updatedAt: r.updated_at, serverName: r.server_name, link: r.link,
  players: r.players, message: r.message, status: r.status, decidedAt: r.decided_at
});

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Ask to join the beta (one request per account; sending again updates it, and reopens a refused one after 7 days). */
export async function requestAccess(who: { discordId: string; username: string }, input: { serverName?: unknown; link?: unknown; players?: unknown; message?: unknown }, now = new Date()): Promise<BetaRequest> {
  const serverName = clean(input.serverName, 80);
  if (serverName.length < 2) throw new BetaError("invalid_request");
  const link = clean(input.link, 200) || null;
  if (link && !/^(https:\/\/|cfx\.re\/join\/|discord\.gg\/)/i.test(link)) throw new BetaError("invalid_link");
  const existing = await db.get<RequestRow>("SELECT * FROM beta_requests WHERE discord_id = ?", [who.discordId]);
  if (existing?.status === "approved") throw new BetaError("already_partner");
  if (existing?.status === "refused" && existing.decided_at && now.getTime() - Date.parse(existing.decided_at) < 7 * 86_400_000) throw new BetaError("request_refused_recently");
  const at = iso(now);
  await db.run(
    `INSERT INTO beta_requests (discord_id, username, created_at, updated_at, server_name, link, players, message, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
     ON CONFLICT(discord_id) DO UPDATE SET username = excluded.username, updated_at = excluded.updated_at, server_name = excluded.server_name,
       link = excluded.link, players = excluded.players, message = excluded.message, status = 'pending', decided_at = NULL, decided_by = NULL`,
    [who.discordId, who.username.slice(0, 100), at, at, serverName, link, clean(input.players, 40) || null, clean(input.message, 1000) || null]
  );
  return toRequest((await db.get<RequestRow>("SELECT * FROM beta_requests WHERE discord_id = ?", [who.discordId]))!);
}

export async function myRequest(discordId: string): Promise<BetaRequest | null> {
  const row = await db.get<RequestRow>("SELECT * FROM beta_requests WHERE discord_id = ?", [discordId]);
  return row ? toRequest(row) : null;
}

export async function listRequests(status: "pending" | "all" = "pending", limit = 200): Promise<BetaRequest[]> {
  const rows = status === "pending"
    ? await db.all<RequestRow>("SELECT * FROM beta_requests WHERE status = 'pending' ORDER BY updated_at DESC LIMIT ?", [limit])
    : await db.all<RequestRow>("SELECT * FROM beta_requests ORDER BY updated_at DESC LIMIT ?", [limit]);
  return rows.map(toRequest);
}

export async function countPendingRequests(): Promise<number> {
  return Number((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM beta_requests WHERE status = 'pending'"))?.n ?? 0);
}

export async function refuseRequest(actor: Actor, discordId: string, now = new Date()): Promise<void> {
  const { changes } = await db.run("UPDATE beta_requests SET status = 'refused', decided_at = ?, decided_by = ? WHERE discord_id = ? AND status = 'pending'", [iso(now), actor.discordId, discordId]);
  if (!changes) throw new BetaError("unknown_request");
  await db.batch([adminAuditStmt(actor, "beta_refuse", "user", discordId, {}, now)]);
}

export async function approveRequest(actor: Actor, discordId: string, now = new Date()): Promise<void> {
  if (!(await db.get("SELECT 1 AS x FROM beta_requests WHERE discord_id = ? AND status = 'pending'", [discordId]))) throw new BetaError("unknown_request");
  await addPartner(actor, discordId, now);
  await db.batch([adminAuditStmt(actor, "beta_approve", "user", discordId, {}, now)]);
}

// ---- bug reports & ideas sent from the panel ----

export type Feedback = {
  id: number; createdAt: string; discordId: string; username: string | null; serverId: string | null; page: string | null;
  kind: FeedbackKind; message: string; status: "new" | "seen" | "done"; adminNote: string | null;
};

export async function sendFeedback(
  who: { discordId: string; username: string },
  input: { kind?: unknown; message?: unknown; page?: unknown; serverId?: unknown },
  now = new Date()
): Promise<number> {
  const message = typeof input.message === "string" ? input.message.trim().slice(0, 3000) : "";
  if (message.length < 10) throw new BetaError("invalid_feedback");
  const kind = (typeof input.kind === "string" && input.kind in FEEDBACK_KINDS ? input.kind : "bug") as FeedbackKind;
  const page = typeof input.page === "string" && /^\/[\w\-/?=&.%]{0,200}$/.test(input.page) ? input.page : null;
  const serverId = typeof input.serverId === "string" && /^[a-z0-9][a-z0-9-]{1,39}$/.test(input.serverId) ? input.serverId : null;
  const row = await db.get<{ id: number }>(
    "INSERT INTO feedback (created_at, discord_id, username, server_id, page, kind, message) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    [iso(now), who.discordId, who.username.slice(0, 100), serverId, page, kind, message]
  );
  return Number(row?.id);
}

export async function listFeedback(status: "open" | "all" = "open", limit = 200): Promise<Feedback[]> {
  const rows = await db.all<{
    id: number; created_at: string; discord_id: string; username: string | null; server_id: string | null; page: string | null;
    kind: FeedbackKind; message: string; status: Feedback["status"]; admin_note: string | null;
  }>(
    status === "open" ? "SELECT * FROM feedback WHERE status != 'done' ORDER BY id DESC LIMIT ?" : "SELECT * FROM feedback ORDER BY id DESC LIMIT ?",
    [limit]
  );
  return rows.map((r) => ({
    id: Number(r.id), createdAt: r.created_at, discordId: r.discord_id, username: r.username, serverId: r.server_id, page: r.page,
    kind: r.kind, message: r.message, status: r.status, adminNote: r.admin_note
  }));
}

export async function countOpenFeedback(): Promise<number> {
  return Number((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM feedback WHERE status = 'new'"))?.n ?? 0);
}

export async function setFeedbackStatus(actor: Actor, id: number, status: Feedback["status"], note: string | null): Promise<void> {
  const { changes } = await db.run("UPDATE feedback SET status = ?, admin_note = COALESCE(?, admin_note) WHERE id = ?", [status, note?.trim().slice(0, 500) || null, id]);
  if (!changes) throw new BetaError("unknown_feedback");
  await db.batch([adminAuditStmt(actor, "feedback_status", "feedback", String(id), { status })]);
}
