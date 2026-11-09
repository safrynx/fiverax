import { auditStmt } from "./audit";
import { db, stmt } from "./db";

/**
 * Live security tools: a player's screen streamed to the panel, actions the panel asks the Discord bot to perform
 * (lockdown, backups), backups of each guild's roles and channels, accounts linked by their hardware.
 */

const iso = (d: Date) => d.toISOString();
type Actor = { discordId: string; username?: string | null };

// ---- live screen ----

/** The agent keeps streaming while someone looked at the screen less than this long ago. */
export const SCREEN_WATCH_MS = 15_000;

/** Ask for a player's screen (the agent starts streaming on the "screen" command). */
export async function watchScreen(serverId: string, target: number, playerName: string, now = new Date()): Promise<void> {
  await db.run(
    `INSERT INTO screen_frames (server_id, target, player_name, watched_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (server_id, target) DO UPDATE SET watched_at = excluded.watched_at, player_name = excluded.player_name`,
    [serverId, target, playerName.slice(0, 100), iso(now)]
  );
}

/** A frame from the agent. Returns whether someone still watches (the agent stops otherwise). */
export async function storeFrame(serverId: string, target: number, playerName: string, image: Uint8Array, mime: string, now = new Date()): Promise<boolean> {
  const row = await db.get<{ watched_at: string }>(
    `INSERT INTO screen_frames (server_id, target, player_name, image, mime, at, watched_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (server_id, target) DO UPDATE SET image = excluded.image, mime = excluded.mime, at = excluded.at, player_name = excluded.player_name
     RETURNING watched_at`,
    [serverId, target, playerName.slice(0, 100), image, mime, iso(now), iso(new Date(0))]
  );
  return Boolean(row && now.getTime() - new Date(row.watched_at).getTime() < SCREEN_WATCH_MS);
}

/** Latest frame of a player's screen; reading it keeps the stream going. */
export async function readFrame(serverId: string, target: number, now = new Date()): Promise<{ image: Uint8Array; mime: string; at: string } | null> {
  const row = await db.get<{ image: ArrayBuffer | Uint8Array | null; mime: string | null; at: string | null; watched_at: string }>(
    "SELECT image, mime, at, watched_at FROM screen_frames WHERE server_id = ? AND target = ?",
    [serverId, target]
  );
  if (!row) return null;
  // Throttled: one write every 5 s per viewer is plenty for a 15 s window.
  if (now.getTime() - new Date(row.watched_at).getTime() > 5_000) {
    await db.run("UPDATE screen_frames SET watched_at = ? WHERE server_id = ? AND target = ?", [iso(now), serverId, target]);
  }
  if (!row.image || !row.mime || !row.at) return null;
  return { image: row.image instanceof Uint8Array ? row.image : new Uint8Array(row.image), mime: row.mime, at: row.at };
}

// ---- actions for the Discord bot ----

export const BOT_ACTIONS = ["lockdown", "unlock", "backup", "restore", "audit"] as const;
export type BotActionKind = (typeof BOT_ACTIONS)[number];
const PENDING_TTL_MS = 5 * 60_000;

export async function enqueueBotAction(serverId: string, actor: Actor, kind: BotActionKind, payload: Record<string, unknown>, now = new Date()): Promise<number> {
  const [insert] = await db.batch([
    stmt("INSERT INTO bot_actions (server_id, kind, payload, actor_discord_id, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id", [serverId, kind, JSON.stringify(payload), actor.discordId, iso(now)]),
    auditStmt(serverId, actor, `discord_${kind}`, null, payload)
  ]);
  return Number(insert.rows[0].id);
}

export type BotAction = { id: number; guildId: string; kind: BotActionKind; payload: Record<string, unknown> };

/**
 * The bot's poll: store the results it reports, then hand it the pending actions of the guilds it serves.
 * Actions older than 5 min are dropped (the bot was down: a lockdown must not start hours later).
 */
export async function exchangeBotActions(results: { id: number; ok: boolean; message?: string }[], now = new Date()): Promise<BotAction[]> {
  const out = await db.batch([
    ...results.map((r) => stmt("UPDATE bot_actions SET status = ?, result = ?, done_at = ? WHERE id = ? AND status = 'sent'", [r.ok ? "done" : "failed", r.message ?? null, iso(now), r.id])),
    stmt("UPDATE bot_actions SET status = 'expired' WHERE status = 'pending' AND created_at < ?", [iso(new Date(now.getTime() - PENDING_TTL_MS))]),
    stmt(
      `UPDATE bot_actions SET status = 'sent', sent_at = ? WHERE status = 'pending'
       AND server_id IN (SELECT id FROM servers WHERE guild_id IS NOT NULL AND suspended_at IS NULL)
       RETURNING id, server_id, kind, payload`,
      [iso(now)]
    )
  ]);
  const claimed = out[out.length - 1].rows;
  if (!claimed.length) return [];
  const guilds = new Map((await db.all<{ id: string; guild_id: string }>("SELECT id, guild_id FROM servers WHERE guild_id IS NOT NULL")).map((s) => [s.id, s.guild_id]));
  return claimed
    .map((r) => ({ id: Number(r.id), guildId: guilds.get(String(r.server_id)) ?? "", kind: r.kind as BotActionKind, payload: JSON.parse(String(r.payload)) as Record<string, unknown> }))
    .filter((a) => a.guildId)
    .sort((a, b) => a.id - b.id);
}

export async function listBotActions(serverId: string, limit = 20) {
  return db.all<{ id: number; kind: string; status: string; result: string | null; created_at: string; actor_discord_id: string }>(
    "SELECT id, kind, status, result, created_at, actor_discord_id FROM bot_actions WHERE server_id = ? ORDER BY id DESC LIMIT ?",
    [serverId, limit]
  );
}

// ---- Discord backups ----

export type BackupSummary = { id: number; createdAt: string; reason: string; roles: number; channels: number; members: number };
const BACKUPS_KEPT = 15;

export async function storeBackup(serverId: string, reason: string, data: { roles: unknown[]; channels: unknown[]; members: Record<string, unknown> }, now = new Date()): Promise<number> {
  const row = await db.get<{ id: number }>(
    `INSERT INTO discord_backups (server_id, created_at, reason, roles_count, channels_count, members_count, data_json)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [serverId, iso(now), reason.slice(0, 60), data.roles.length, data.channels.length, Object.keys(data.members).length, JSON.stringify(data)]
  );
  await db.run(
    `DELETE FROM discord_backups WHERE server_id = ? AND id NOT IN (SELECT id FROM discord_backups WHERE server_id = ? ORDER BY id DESC LIMIT ${BACKUPS_KEPT})`,
    [serverId, serverId]
  );
  return Number(row?.id);
}

export async function listBackups(serverId: string): Promise<BackupSummary[]> {
  const rows = await db.all<{ id: number; created_at: string; reason: string; roles_count: number; channels_count: number; members_count: number }>(
    "SELECT id, created_at, reason, roles_count, channels_count, members_count FROM discord_backups WHERE server_id = ? ORDER BY id DESC",
    [serverId]
  );
  return rows.map((r) => ({ id: r.id, createdAt: r.created_at, reason: r.reason, roles: r.roles_count, channels: r.channels_count, members: r.members_count }));
}

export async function getBackupData(serverId: string, id: number): Promise<unknown | null> {
  const row = await db.get<{ data_json: string }>("SELECT data_json FROM discord_backups WHERE server_id = ? AND id = ?", [serverId, id]);
  return row ? (JSON.parse(row.data_json) as unknown) : null;
}

export async function lastBackupAt(serverId: string): Promise<string | null> {
  return (await db.get<{ at: string }>("SELECT MAX(created_at) AS at FROM discord_backups WHERE server_id = ?", [serverId]))?.at ?? null;
}

// ---- linked accounts ----

export type LinkedAccount = { id: number; name: string; lastSeenAt: string; shared: string[]; banned: boolean };

/**
 * Other players sharing a hardware token or an identifier (Discord, Steam…) with this one: alt accounts, ban
 * evasion, shared PCs.
 */
export async function linkedAccounts(serverId: string, playerId: number, now = new Date()): Promise<LinkedAccount[]> {
  const rows = await db.all<{ id: number; name: string; last_seen_at: string; value: string; banned: number }>(
    `SELECT p2.id, p2.name, p2.last_seen_at, v1.value,
       EXISTS (SELECT 1 FROM bans b WHERE b.server_id = p2.server_id AND b.player_id = p2.id AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > ?)) AS banned
     FROM players p1
     JOIN json_each(p1.tokens_json) v1
     JOIN players p2 ON p2.server_id = p1.server_id AND p2.id <> p1.id
     JOIN json_each(p2.tokens_json) v2 ON v2.value = v1.value
     WHERE p1.server_id = ? AND p1.id = ?
     UNION ALL
     SELECT p2.id, p2.name, p2.last_seen_at, v1.value,
       EXISTS (SELECT 1 FROM bans b WHERE b.server_id = p2.server_id AND b.player_id = p2.id AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > ?)) AS banned
     FROM players p1
     JOIN json_each(p1.identifiers_json) v1
     JOIN players p2 ON p2.server_id = p1.server_id AND p2.id <> p1.id
     JOIN json_each(p2.identifiers_json) v2 ON v2.value = v1.value
     WHERE p1.server_id = ? AND p1.id = ? AND v1.value NOT LIKE 'license%'`,
    [iso(now), serverId, playerId, iso(now), serverId, playerId]
  );
  const byId = new Map<number, LinkedAccount>();
  for (const r of rows) {
    const entry = byId.get(r.id) ?? { id: r.id, name: r.name, lastSeenAt: r.last_seen_at, shared: [], banned: Boolean(r.banned) };
    const label = /^\d+:/.test(r.value) ? "matériel" : r.value.split(":")[0];
    if (!entry.shared.includes(label)) entry.shared.push(label);
    byId.set(r.id, entry);
  }
  return [...byId.values()].sort((a, b) => Number(b.banned) - Number(a.banned) || b.lastSeenAt.localeCompare(a.lastSeenAt));
}

// ---- detections on the map ----

export async function recentDetectionsWithPosition(serverId: string, minutes = 30, now = new Date()) {
  const rows = await db.all<{ id: number; player_id: number | null; player_name: string; kind: string; action: string; at: string; details_json: string }>(
    "SELECT id, player_id, player_name, kind, action, at, details_json FROM ac_detections WHERE server_id = ? AND at >= ? AND details_json LIKE '%\"pos\"%' ORDER BY id DESC LIMIT 200",
    [serverId, iso(new Date(now.getTime() - minutes * 60_000))]
  );
  return rows.flatMap((r) => {
    try {
      const pos = (JSON.parse(r.details_json) as { pos?: unknown }).pos;
      if (!Array.isArray(pos) || pos.length < 2 || !pos.every((v) => typeof v === "number")) return [];
      return [{ id: r.id, playerId: r.player_id, playerName: r.player_name, kind: r.kind, action: r.action, at: r.at, pos: pos as number[] }];
    } catch {
      return [];
    }
  });
}

export type MapDetection = Awaited<ReturnType<typeof recentDetectionsWithPosition>>[number];
