import { db } from "./db";

/** Every player seen on a server's FiveM (reported by the agent), with totals computed from their sessions. */

export type PlayerRow = {
  id: number;
  name: string;
  license: string;
  discordId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  connections: number;
  playSeconds: number;
  online: boolean;
  staff: { username: string; grade: string } | null;
};

type Raw = {
  id: number; name: string; license: string; discord_id: string | null; first_seen_at: string; last_seen_at: string;
  connections: number; play_seconds: number; online: number; staff_name: string | null; staff_grade: string | null; identifiers_json: string; tokens_json?: string;
};

const SELECT = `SELECT p.id, p.name, p.license, p.discord_id, p.first_seen_at, p.last_seen_at, p.identifiers_json, p.tokens_json,
    (SELECT COUNT(*) FROM player_sessions s WHERE s.player_id = p.id) AS connections,
    (SELECT COALESCE(SUM(s.seconds), 0) FROM player_sessions s WHERE s.player_id = p.id) AS play_seconds,
    EXISTS (SELECT 1 FROM player_sessions s WHERE s.player_id = p.id AND s.ended_at IS NULL) AS online,
    st.username AS staff_name, st.grade AS staff_grade
  FROM players p
  LEFT JOIN staff_members st ON st.server_id = p.server_id AND st.discord_id = p.discord_id AND st.left_guild_at IS NULL`;

const toRow = (r: Raw): PlayerRow => ({
  id: r.id,
  name: r.name,
  license: r.license,
  discordId: r.discord_id,
  firstSeenAt: r.first_seen_at,
  lastSeenAt: r.last_seen_at,
  connections: r.connections,
  playSeconds: r.play_seconds,
  online: Boolean(r.online),
  staff: r.staff_name ? { username: r.staff_name, grade: r.staff_grade ?? "" } : null
});

/** Search by name, license, Discord id or any identifier (steam, fivem, xbl…); most recently seen first. */
export async function listPlayers(serverId: string, opts: { q?: string; limit?: number; offset?: number } = {}): Promise<{ rows: PlayerRow[]; total: number }> {
  const q = opts.q?.trim().toLowerCase();
  const where = q ? "WHERE p.server_id = @server AND (LOWER(p.name) LIKE @q OR p.license LIKE @q OR p.discord_id LIKE @q OR LOWER(p.identifiers_json) LIKE @q)" : "WHERE p.server_id = @server";
  const params = { server: serverId, q: `%${q ?? ""}%` };
  const [count, rows] = await Promise.all([
    db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM players p ${where}`, params),
    db.all<Raw>(`${SELECT} ${where} ORDER BY p.last_seen_at DESC, p.id DESC LIMIT @limit OFFSET @offset`, { ...params, limit: opts.limit ?? 50, offset: opts.offset ?? 0 })
  ]);
  return { total: count?.n ?? 0, rows: rows.map(toRow) };
}

export type PlayerSession = { id: number; startedAt: string; endedAt: string | null; seconds: number; leaveReason: string | null };

/** `tokens`: hardware tokens as last seen (never shown, used to match bans and the Fiverax network). */
export type PlayerDetail = PlayerRow & { identifiers: string[]; tokens: string[]; sessions: PlayerSession[] };

export async function getPlayer(serverId: string, id: number): Promise<PlayerDetail | null> {
  const raw = await db.get<Raw>(`${SELECT} WHERE p.server_id = ? AND p.id = ?`, [serverId, id]);
  if (!raw) return null;
  const sessions = await db.all<{ id: number; started_at: string; ended_at: string | null; seconds: number; leave_reason: string | null }>(
    "SELECT id, started_at, ended_at, seconds, leave_reason FROM player_sessions WHERE player_id = ? ORDER BY id DESC LIMIT 50",
    [id]
  );
  let identifiers: string[] = [];
  try { identifiers = JSON.parse(raw.identifiers_json) as string[]; } catch { /* keep empty */ }
  let tokens: string[] = [];
  try { tokens = JSON.parse(raw.tokens_json ?? "[]") as string[]; } catch { /* keep empty */ }
  return {
    ...toRow(raw),
    identifiers,
    tokens,
    sessions: sessions.map((s) => ({ id: s.id, startedAt: s.started_at, endedAt: s.ended_at, seconds: s.seconds, leaveReason: s.leave_reason }))
  };
}

/** Distinct players, sessions and play time on the server since a date. */
export async function countPlayersSince(serverId: string, since: Date): Promise<{ unique: number; sessions: number; seconds: number }> {
  const row = await db.get<{ unique_players: number; sessions: number; seconds: number }>(
    `SELECT COUNT(DISTINCT player_id) AS unique_players, COUNT(*) AS sessions, COALESCE(SUM(seconds), 0) AS seconds
     FROM player_sessions WHERE server_id = ? AND started_at >= ?`,
    [serverId, since.toISOString()]
  );
  return { unique: row?.unique_players ?? 0, sessions: row?.sessions ?? 0, seconds: row?.seconds ?? 0 };
}
