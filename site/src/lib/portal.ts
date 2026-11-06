import { auditStmt } from "./audit";
import { sendReportAlert } from "./alerts";
import { reportsMadeBy } from "./blackbox";
import { db, stmt } from "./db";
import { getSecuritySettings, isBanActive, revokeBan } from "./security";
import { getServer } from "./servers";
import { votesBy } from "./votes";
import { VOTE_COOLDOWN_HOURS } from "./votes-shared";

/**
 * Player portal (/joueur): a player logs in with Discord and sees, on every Fiverax server where their Discord is
 * linked in FiveM, their play time, their sanctions (and contests a ban), the reports they made in game and what the
 * staff answered, their votes and rewards. Never the identifiers, detections or notes of the staff.
 */

export class PortalError extends Error {}
type Actor = { discordId: string; username?: string | null };
type Identity = { discordId: string; username: string };

const iso = (d = new Date()) => d.toISOString();
export const APPEAL_MIN = 30;
export const APPEAL_MAX = 2000;
/** After a refused appeal, the player waits this long before contesting the same ban again. */
export const APPEAL_RETRY_DAYS = 7;

export type AppealStatus = "open" | "accepted" | "rejected";
export type PortalAppeal = { id: number; status: AppealStatus; body: string; response: string | null; createdAt: string; decidedAt: string | null };
export type PortalBan = {
  id: number; reason: string; createdAt: string; expiresAt: string | null; active: boolean; revoked: boolean;
  appeals: PortalAppeal[];
  /** Whether a (new) appeal may be sent now, and when otherwise. */
  canAppeal: boolean; appealAfter: string | null;
};
export type PortalServer = {
  serverId: string;
  name: string;
  iconUrl: string | null;
  slug: string | null;
  logoUrl: string | null;
  characterNames: string[];
  playSeconds: number;
  sessions: number;
  firstSeenAt: string;
  lastSeenAt: string;
  inGame: boolean;
  bans: PortalBan[];
  nextVoteAt: string | null;
  /** The server's own player portal (/joueur/<slug>), when published. */
  portalSlug: string | null;
};

export type Portal = {
  servers: PortalServer[];
  reports: (Awaited<ReturnType<typeof reportsMadeBy>>[number] & { serverName: string })[];
  votes: (Awaited<ReturnType<typeof votesBy>>[number] & { serverName: string; slug: string | null })[];
  totals: { servers: number; playSeconds: number; votesThisMonth: number };
};

type PlayerRow = { id: number; server_id: string; name: string; first_seen_at: string; last_seen_at: string };

export async function portalFor(identity: Identity, now = new Date()): Promise<Portal> {
  const players = await db.all<PlayerRow>("SELECT id, server_id, name, first_seen_at, last_seen_at FROM players WHERE discord_id = ? ORDER BY last_seen_at DESC LIMIT 100", [identity.discordId]);
  const ids = players.map((p) => p.id);
  const marks = ids.map(() => "?").join(", ");
  const [sessions, bans, appeals, lastVotes] = ids.length
    ? await db.batch(
        [
          stmt(
            `SELECT player_id, COUNT(*) AS n, SUM(CASE WHEN ended_at IS NOT NULL THEN seconds ELSE 0 END) AS closed,
               MIN(CASE WHEN ended_at IS NULL THEN started_at END) AS open_start
             FROM player_sessions WHERE player_id IN (${marks}) GROUP BY player_id`,
            ids
          ),
          stmt(`SELECT id, server_id, player_id, reason, created_at, expires_at, revoked_at FROM bans WHERE player_id IN (${marks}) ORDER BY id DESC LIMIT 100`, ids),
          stmt("SELECT id, ban_id, status, body, response, created_at, decided_at FROM ban_appeals WHERE discord_id = ? ORDER BY id DESC LIMIT 200", [identity.discordId]),
          stmt("SELECT server_id, MAX(voted_at) AS last FROM directory_votes WHERE discord_id = ? GROUP BY server_id", [identity.discordId])
        ],
        "read"
      )
    : [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }];

  const sessionBy = new Map(sessions.rows.map((r) => [Number(r.player_id), r]));
  const appealsBy = new Map<number, PortalAppeal[]>();
  for (const a of appeals.rows) {
    const list = appealsBy.get(Number(a.ban_id)) ?? [];
    list.push({ id: Number(a.id), status: a.status as AppealStatus, body: String(a.body), response: (a.response as string | null) ?? null, createdAt: String(a.created_at), decidedAt: (a.decided_at as string | null) ?? null });
    appealsBy.set(Number(a.ban_id), list);
  }
  const voteBy = new Map(lastVotes.rows.map((r) => [String(r.server_id), String(r.last)]));

  // One entry per server (a player may have several rows: one per Rockstar license).
  const byServer = new Map<string, PortalServer>();
  for (const p of players) {
    const s = sessionBy.get(p.id);
    const open = s?.open_start ? Math.min(12 * 3600, Math.max(0, Math.floor((now.getTime() - new Date(String(s.open_start)).getTime()) / 1000))) : 0;
    let entry = byServer.get(p.server_id);
    if (!entry) {
      const server = await getServer(p.server_id);
      if (!server) continue;
      const listing = await db.get<{ slug: string; data_json: string; published: number }>("SELECT slug, data_json, published FROM directory_listings WHERE server_id = ?", [p.server_id]);
      let logo: string | null = null, name = server.name;
      if (listing?.published) {
        try {
          const data = JSON.parse(listing.data_json) as { logoUrl?: string; name?: string };
          logo = data.logoUrl || null;
          name = data.name || name;
        } catch { /* defaults */ }
      }
      const portal = await db.get<{ slug: string }>("SELECT slug FROM portal_sites WHERE server_id = ? AND published_json IS NOT NULL", [p.server_id]);
      const last = voteBy.get(p.server_id);
      const next = last ? new Date(new Date(last).getTime() + VOTE_COOLDOWN_HOURS * 3600_000) : null;
      entry = {
        serverId: p.server_id, name, iconUrl: server.iconUrl, slug: listing?.published ? listing.slug : null, logoUrl: logo,
        characterNames: [], playSeconds: 0, sessions: 0, firstSeenAt: p.first_seen_at, lastSeenAt: p.last_seen_at, inGame: false, bans: [],
        nextVoteAt: next && next > now ? iso(next) : null, portalSlug: portal?.slug ?? null
      };
      byServer.set(p.server_id, entry);
    }
    if (!entry.characterNames.includes(p.name)) entry.characterNames.push(p.name);
    entry.playSeconds += Number(s?.closed ?? 0) + open;
    entry.sessions += Number(s?.n ?? 0);
    entry.inGame ||= Boolean(s?.open_start);
    if (p.first_seen_at < entry.firstSeenAt) entry.firstSeenAt = p.first_seen_at;
    if (p.last_seen_at > entry.lastSeenAt) entry.lastSeenAt = p.last_seen_at;
  }
  for (const b of bans.rows) {
    const entry = byServer.get(String(b.server_id));
    if (!entry) continue;
    const ban = { revokedAt: (b.revoked_at as string | null) ?? null, expiresAt: (b.expires_at as string | null) ?? null };
    const active = isBanActive(ban, now);
    const list = appealsBy.get(Number(b.id)) ?? [];
    const lastRejected = list.find((a) => a.status === "rejected");
    const retry = lastRejected?.decidedAt ? new Date(new Date(lastRejected.decidedAt).getTime() + APPEAL_RETRY_DAYS * 86_400_000) : null;
    const blocked = list.some((a) => a.status === "open") || (retry !== null && retry > now);
    entry.bans.push({
      id: Number(b.id), reason: String(b.reason), createdAt: String(b.created_at), expiresAt: ban.expiresAt, active, revoked: Boolean(ban.revokedAt),
      appeals: list, canAppeal: active && !blocked, appealAfter: active && !list.some((a) => a.status === "open") && retry && retry > now ? iso(retry) : null
    });
  }

  const servers = [...byServer.values()];
  const names = new Map(servers.map((s) => [s.serverId, s]));
  const nameOf = async (id: string) => names.get(id)?.name ?? (await getServer(id))?.name ?? id;
  const [reports, votes] = await Promise.all([reportsMadeBy(identity.discordId), votesBy(identity.discordId)]);
  const slugs = new Map<string, string | null>();
  for (const v of votes) {
    if (!slugs.has(v.serverId)) {
      const row = await db.get<{ slug: string }>("SELECT slug FROM directory_listings WHERE server_id = ? AND published = 1", [v.serverId]);
      slugs.set(v.serverId, row?.slug ?? null);
    }
  }
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  return {
    servers,
    reports: await Promise.all(reports.map(async (r) => ({ ...r, serverName: await nameOf(r.serverId) }))),
    votes: await Promise.all(votes.map(async (v) => ({ ...v, serverName: await nameOf(v.serverId), slug: slugs.get(v.serverId) ?? null }))),
    totals: { servers: servers.length, playSeconds: servers.reduce((a, s) => a + s.playSeconds, 0), votesThisMonth: votes.filter((v) => v.votedAt >= month).length }
  };
}

// ---- ban appeals ----

export async function submitAppeal(identity: Identity, serverId: string, banId: number, body: string, now = new Date()): Promise<number> {
  const text = body.trim();
  if (text.length < APPEAL_MIN || text.length > APPEAL_MAX) throw new PortalError("invalid_appeal");
  const ban = await db.get<{ id: number; player_id: number; reason: string; name: string; expires_at: string | null; revoked_at: string | null }>(
    `SELECT b.id, b.player_id, b.reason, b.name, b.expires_at, b.revoked_at FROM bans b JOIN players p ON p.id = b.player_id
     WHERE b.server_id = ? AND b.id = ? AND p.discord_id = ?`,
    [serverId, banId, identity.discordId]
  );
  if (!ban) throw new PortalError("unknown_ban");
  if (!isBanActive({ revokedAt: ban.revoked_at, expiresAt: ban.expires_at }, now)) throw new PortalError("ban_not_active");
  const previous = await db.all<{ status: AppealStatus; decided_at: string | null }>("SELECT status, decided_at FROM ban_appeals WHERE server_id = ? AND ban_id = ? AND discord_id = ? ORDER BY id DESC", [serverId, banId, identity.discordId]);
  if (previous.some((a) => a.status === "open")) throw new PortalError("appeal_open");
  const rejected = previous.find((a) => a.status === "rejected");
  if (rejected?.decided_at && now.getTime() - new Date(rejected.decided_at).getTime() < APPEAL_RETRY_DAYS * 86_400_000) throw new PortalError("appeal_too_soon");

  const row = await db.get<{ id: number }>(
    "INSERT INTO ban_appeals (server_id, ban_id, player_id, discord_id, username, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    [serverId, banId, ban.player_id, identity.discordId, identity.username.slice(0, 80), text, iso(now)]
  );
  const [{ anticheat }, server] = await Promise.all([getSecuritySettings(serverId), getServer(serverId)]);
  await sendReportAlert(anticheat, server?.name ?? serverId, {
    title: "⚖️ Contestation de ban",
    lines: [`**${ban.name}** (Discord ${identity.username}) conteste son ban`, `Raison du ban : ${ban.reason}`, text.slice(0, 600)],
    url: `${(process.env.APP_URL || "").replace(/\/+$/, "")}/s/${serverId}/reports?tab=appeals`
  });
  return Number(row!.id);
}

export type StaffAppeal = PortalAppeal & {
  banId: number; playerId: number | null; playerName: string; username: string; banReason: string; banCreatedAt: string; banExpiresAt: string | null;
  banActive: boolean; decidedName: string | null;
};

export async function listAppeals(serverId: string, status: AppealStatus | "all" = "open", limit = 100): Promise<StaffAppeal[]> {
  const rows = await db.all<Record<string, unknown>>(
    `SELECT a.id, a.status, a.body, a.response, a.created_at, a.decided_at, a.decided_name, a.username, a.player_id, a.ban_id,
       b.name, b.reason, b.created_at AS ban_created_at, b.expires_at, b.revoked_at
     FROM ban_appeals a JOIN bans b ON b.id = a.ban_id
     WHERE a.server_id = ? ${status === "all" ? "" : "AND a.status = ?"} ORDER BY a.id DESC LIMIT ?`,
    status === "all" ? [serverId, limit] : [serverId, status, limit]
  );
  return rows.map((r) => ({
    id: Number(r.id), status: r.status as AppealStatus, body: String(r.body), response: (r.response as string | null) ?? null, createdAt: String(r.created_at),
    decidedAt: (r.decided_at as string | null) ?? null, decidedName: (r.decided_name as string | null) ?? null, username: String(r.username),
    playerId: (r.player_id as number | null) ?? null, banId: Number(r.ban_id), playerName: String(r.name), banReason: String(r.reason),
    banCreatedAt: String(r.ban_created_at), banExpiresAt: (r.expires_at as string | null) ?? null,
    banActive: isBanActive({ revokedAt: (r.revoked_at as string | null) ?? null, expiresAt: (r.expires_at as string | null) ?? null })
  }));
}

export async function countOpenAppeals(serverId: string): Promise<number> {
  const row = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM ban_appeals WHERE server_id = ? AND status = 'open'", [serverId]);
  return Number(row?.n ?? 0);
}

/** Accept (the ban is lifted) or refuse an appeal, with an answer the player reads on the portal. */
export async function decideAppeal(serverId: string, actor: Actor, id: number, accept: boolean, response: string | null, now = new Date()): Promise<void> {
  const appeal = await db.get<{ ban_id: number; status: string }>("SELECT ban_id, status FROM ban_appeals WHERE server_id = ? AND id = ?", [serverId, id]);
  if (!appeal) throw new PortalError("unknown_appeal");
  if (appeal.status !== "open") throw new PortalError("appeal_decided");
  if (accept) await revokeBan(serverId, actor, appeal.ban_id, now);
  await db.batch([
    stmt("UPDATE ban_appeals SET status = ?, response = ?, decided_by = ?, decided_name = ?, decided_at = ? WHERE id = ? AND status = 'open'", [
      accept ? "accepted" : "rejected", response?.trim().slice(0, 1500) || null, actor.discordId, actor.username ?? null, iso(now), id
    ]),
    auditStmt(serverId, actor, accept ? "appeal_accept" : "appeal_reject", null, { appeal: id, ban: appeal.ban_id })
  ]);
}
