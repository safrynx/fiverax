import { auditStmt } from "./audit";
import { db, stmt, type Stmt } from "./db";
import { banKeysStmt, networkKeys } from "./network-keys";
import {
  isBanCategory, networkSettingsSchema, networkVerdict, sortRecords,
  type NetworkRecord, type NetworkSettings, type Reputation, type Verdict
} from "./network-shared";
import { bumpRevStmt } from "./security";

/**
 * Fiverax network (see network-shared.ts). A server joins from its "Réseau" page (owners only). From then on:
 * - its shared bans count for every other member (a ban can be kept private, see bans.shared);
 * - it sees the network reputation of its players, and acts on it at connection (mode off / alert / block);
 * - it appears in the members directory (unless unlisted).
 * Seeing the network requires being part of it: a server that shares nothing sees nothing.
 */

type Actor = { discordId: string; username?: string | null };
const iso = (d: Date) => d.toISOString();

export type Membership = { joinedAt: string; settings: NetworkSettings };

function parseSettings(raw: string | null | undefined): NetworkSettings {
  try {
    const parsed = networkSettingsSchema.safeParse(raw ? JSON.parse(raw) : {});
    if (parsed.success) return parsed.data;
  } catch {
    /* fall through */
  }
  return networkSettingsSchema.parse({});
}

export async function getMembership(serverId: string): Promise<Membership | null> {
  const row = await db.get<{ joined_at: string; settings_json: string }>("SELECT joined_at, settings_json FROM network_members WHERE server_id = ?", [serverId]);
  return row ? { joinedAt: row.joined_at, settings: parseSettings(row.settings_json) } : null;
}

/** Keys for the server's bans made before it had any (bans older than the network). */
async function backfillStatements(serverId: string): Promise<Stmt[]> {
  const rows = await db.all<{ id: number; identifiers_json: string; tokens_json: string }>(
    `SELECT id, identifiers_json, tokens_json FROM bans b WHERE server_id = ? AND revoked_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM network_ban_keys k WHERE k.ban_id = b.id) LIMIT 5000`,
    [serverId]
  );
  const list = (raw: string) => {
    try {
      const v = JSON.parse(raw) as unknown;
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  };
  return rows.map((r) => banKeysStmt(serverId, Number(r.id), list(r.identifiers_json), list(r.tokens_json))).filter((s): s is Stmt => s !== null);
}

/** Join (or change the settings). The agent reloads (rev) since the connection check depends on the mode. */
export async function saveMembership(serverId: string, actor: Actor, settings: NetworkSettings, now = new Date()): Promise<void> {
  const before = await getMembership(serverId);
  const clean = networkSettingsSchema.parse(settings);
  await db.batch([
    stmt(
      `INSERT INTO network_members (server_id, settings_json, joined_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (server_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at`,
      [serverId, JSON.stringify(clean), iso(now), iso(now)]
    ),
    bumpRevStmt(serverId, now),
    auditStmt(serverId, actor, before ? "network_settings" : "network_join", null, { mode: clean.mode, minServers: clean.minServers })
  ]);
  if (!before) {
    const backfill = await backfillStatements(serverId);
    for (let i = 0; i < backfill.length; i += 200) await db.batch(backfill.slice(i, i + 200));
  }
}

export async function leaveNetwork(serverId: string, actor: Actor, now = new Date()): Promise<boolean> {
  if (!(await getMembership(serverId))) return false;
  await db.batch([
    stmt("DELETE FROM network_members WHERE server_id = ?", [serverId]),
    bumpRevStmt(serverId, now),
    auditStmt(serverId, actor, "network_leave", null, {})
  ]);
  return true;
}

type RecordRow = {
  ban_id: number; server_id: string; server_name: string; icon_url: string | null; name: string; reason: string; category: string;
  created_at: string; expires_at: string | null; kinds: string;
};

/**
 * Active shared bans of the other members matching these identifiers / tokens. Null when the viewing server is not
 * a member (the network is reciprocal).
 */
export async function reputation(viewerId: string, identifiers: string[], tokens: string[], now = new Date()): Promise<Reputation | null> {
  if (!(await getMembership(viewerId))) return null;
  return reputationOf(viewerId, identifiers, tokens, now);
}

async function reputationOf(viewerId: string, identifiers: string[], tokens: string[], now: Date): Promise<Reputation> {
  const keys = networkKeys(identifiers, tokens).map(([key]) => key);
  if (keys.length === 0) return { servers: 0, records: [] };
  const rows = await db.all<RecordRow>(
    `SELECT b.id AS ban_id, b.server_id, s.name AS server_name, s.icon_url, b.name, b.reason, b.category, b.created_at, b.expires_at,
            GROUP_CONCAT(DISTINCT k.kind) AS kinds
     FROM network_ban_keys k
     JOIN bans b ON b.id = k.ban_id AND b.server_id = k.server_id
     JOIN network_members m ON m.server_id = b.server_id
     JOIN servers s ON s.id = b.server_id
     WHERE k.key IN (${keys.map(() => "?").join(",")}) AND b.server_id <> ? AND b.shared = 1
       AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > ?)
     GROUP BY b.id
     LIMIT 100`,
    [...keys, viewerId, iso(now)]
  );
  const records: NetworkRecord[] = rows.map((r) => ({
    banId: Number(r.ban_id),
    serverId: r.server_id,
    serverName: r.server_name,
    serverIcon: r.icon_url,
    playerName: r.name,
    reason: r.reason,
    category: isBanCategory(r.category) ? r.category : "other",
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    matchedOn: [...new Set(String(r.kinds ?? "").split(",").filter(Boolean).map((k) => (k === "license2" ? "license" : k === "live2" ? "live" : k)))]
  }));
  return { servers: new Set(records.map((r) => r.serverId)).size, records: sortRecords(records) };
}

/** What the server's agent must do with a player at connection (block mode only asks). */
export async function checkConnection(serverId: string, identifiers: string[], tokens: string[], now = new Date()): Promise<Verdict & { reputation: Reputation | null }> {
  const membership = await getMembership(serverId);
  if (!membership || membership.settings.mode === "off") return { flagged: false, blocked: false, blockingServers: 0, message: null, reputation: null };
  const rep = await reputationOf(serverId, identifiers, tokens, now);
  return { ...networkVerdict(rep, membership.settings), reputation: rep };
}

// ---- overview & directory ----

export type NetworkMember = {
  serverId: string;
  name: string;
  iconUrl: string | null;
  description: string;
  inviteUrl: string;
  joinedAt: string;
  sharedBans: number;
  libraryItems: number;
};

export async function networkOverview(now = new Date()): Promise<{ members: number; sharedBans: number; libraryItems: number; installs: number }> {
  const [members, bans, items] = await db.batch(
    [
      stmt("SELECT COUNT(*) AS n FROM network_members"),
      stmt(
        `SELECT COUNT(*) AS n FROM bans b JOIN network_members m ON m.server_id = b.server_id
         WHERE b.shared = 1 AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > ?)`,
        [iso(now)]
      ),
      stmt("SELECT COUNT(*) AS n, COALESCE(SUM(installs), 0) AS installs FROM library_items WHERE status = 'published'")
    ],
    "read"
  );
  const n = (r: { rows: Record<string, unknown>[] }, k = "n") => Number(r.rows[0]?.[k] ?? 0);
  return { members: n(members), sharedBans: n(bans), libraryItems: n(items), installs: n(items, "installs") };
}

export async function listMembers(now = new Date()): Promise<NetworkMember[]> {
  const rows = await db.all<{ server_id: string; name: string; icon_url: string | null; settings_json: string; joined_at: string; bans: number; items: number }>(
    `SELECT m.server_id, s.name, s.icon_url, m.settings_json, m.joined_at,
       (SELECT COUNT(*) FROM bans b WHERE b.server_id = m.server_id AND b.shared = 1 AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > ?)) AS bans,
       (SELECT COUNT(*) FROM library_items l WHERE l.server_id = m.server_id AND l.status = 'published') AS items
     FROM network_members m JOIN servers s ON s.id = m.server_id
     ORDER BY m.joined_at`,
    [iso(now)]
  );
  return rows
    .map((r) => ({ row: r, settings: parseSettings(r.settings_json) }))
    .filter(({ settings }) => settings.listed)
    .map(({ row, settings }) => ({
      serverId: row.server_id, name: row.name, iconUrl: row.icon_url, description: settings.description, inviteUrl: settings.inviteUrl,
      joinedAt: row.joined_at, sharedBans: Number(row.bans), libraryItems: Number(row.items)
    }));
}

export type NetworkBan = Omit<NetworkRecord, "matchedOn">;

/** Latest shared bans of the other members (what the network caught lately). */
export async function recentNetworkBans(viewerId: string, limit = 30, now = new Date()): Promise<NetworkBan[]> {
  const rows = await db.all<RecordRow>(
    `SELECT b.id AS ban_id, b.server_id, s.name AS server_name, s.icon_url, b.name, b.reason, b.category, b.created_at, b.expires_at, '' AS kinds
     FROM bans b JOIN network_members m ON m.server_id = b.server_id JOIN servers s ON s.id = b.server_id
     WHERE b.server_id <> ? AND b.shared = 1 AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > ?)
     ORDER BY b.id DESC LIMIT ?`,
    [viewerId, iso(now), limit]
  );
  return rows.map((r) => ({
    banId: Number(r.ban_id), serverId: r.server_id, serverName: r.server_name, serverIcon: r.icon_url, playerName: r.name, reason: r.reason,
    category: isBanCategory(r.category) ? r.category : "other", createdAt: r.created_at, expiresAt: r.expires_at
  }));
}

/** Pure: "license:abc", "discord:123", "steam:110000…" or a bare Discord id / license hash -> identifiers to look up. */
export function lookupIdentifiers(raw: string): string[] {
  const q = raw.trim();
  if (!q) return [];
  if (/^[a-z0-9]+:/i.test(q)) return [q];
  if (/^\d{17,20}$/.test(q)) return [`discord:${q}`];
  if (/^[a-f0-9]{40}$/i.test(q)) return [`license:${q}`, `license2:${q}`];
  if (/^1100001[a-f0-9]{8}$/i.test(q)) return [`steam:${q}`];
  return [];
}
