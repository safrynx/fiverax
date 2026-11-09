import { db } from "./db";

/**
 * Small key/value store (table bot_status). Server-specific values are stored under `<serverId>:<key>`;
 * locks under `lock:<name>`.
 */

/** The bot reports every 60 s; three missed beats and it is considered offline. */
export const HEARTBEAT_MAX_AGE_MS = 180_000;

const serverKey = (serverId: string, key: string) => `${serverId}:${key}`;

export async function setStatusValue(key: string, value: string): Promise<void> {
  await db.run(
    `INSERT INTO bot_status (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, new Date().toISOString()]
  );
}

export async function getStatusValue(key: string): Promise<string | null> {
  const row = await db.get<{ value: string }>("SELECT value FROM bot_status WHERE key = ?", [key]);
  return row?.value ?? null;
}

export function setServerStatus(serverId: string, key: string, value: string): Promise<void> {
  return setStatusValue(serverKey(serverId, key), value);
}

export function getServerStatus(serverId: string, key: string): Promise<string | null> {
  return getStatusValue(serverKey(serverId, key));
}

/** Forget the bot heartbeat of one server, or of every server (bot shutting down). */
export async function clearBotHeartbeat(serverId?: string): Promise<void> {
  if (serverId) await db.run("DELETE FROM bot_status WHERE key = ?", [serverKey(serverId, "heartbeat")]);
  else await db.run("DELETE FROM bot_status WHERE key LIKE '%:heartbeat'");
}

export type BotStatus = {
  /** True when the bot sent a heartbeat for this server's guild recently (it is running AND it is in the guild). */
  alive: boolean;
  heartbeatAt: string | null;
  /** Position of the bot's highest role in the guild: it can only manage roles below this position. */
  topRolePosition: number | null;
};

export async function getBotStatus(serverId: string): Promise<BotStatus> {
  const rows = await db.all<{ key: string; value: string }>("SELECT key, value FROM bot_status WHERE key IN (?, ?)", [
    serverKey(serverId, "heartbeat"),
    serverKey(serverId, "top_role_position")
  ]);
  const map = new Map(rows.map((r) => [r.key.slice(serverId.length + 1), r.value]));
  const heartbeatAt = map.get("heartbeat") ?? null;
  const top = map.get("top_role_position");
  return {
    alive: heartbeatAt !== null && Date.now() - new Date(heartbeatAt).getTime() < HEARTBEAT_MAX_AGE_MS,
    heartbeatAt,
    topRolePosition: top === undefined ? null : Number(top)
  };
}

/**
 * Take a named lock that expires by itself (serverless instances share no memory, so the database is
 * the only place to coordinate). Returns true when the lock was obtained.
 */
export async function tryAcquireLock(name: string, ttlMs: number): Promise<boolean> {
  const now = new Date();
  const expired = new Date(now.getTime() - ttlMs).toISOString();
  const { changes } = await db.run(
    `INSERT INTO bot_status (key, value, updated_at) VALUES (@key, @now, @now)
     ON CONFLICT(key) DO UPDATE SET value = @now, updated_at = @now WHERE bot_status.value < @expired`,
    { key: `lock:${name}`, now: now.toISOString(), expired }
  );
  return changes > 0;
}

export async function releaseLock(name: string): Promise<void> {
  await db.run("DELETE FROM bot_status WHERE key = ?", [`lock:${name}`]);
}
