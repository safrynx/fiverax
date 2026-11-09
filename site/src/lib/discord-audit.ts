import { db } from "./db";
import { analyzeDiscord, discordSnapshotSchema, type DiscordReport, type DiscordSnapshot } from "./discord-audit-shared";
import { getSecuritySettings } from "./security";
import { lastBackupAt } from "./security-live";

/**
 * Discord security audits of a server: the bot's snapshots (bot/src/discord-audit.ts), scored by
 * lib/discord-audit-shared.ts. The snapshot is kept, the report is computed again when read, so it always reflects
 * the current anti-raid settings and backups. The 10 latest audits of each server are kept.
 */

const KEPT = 10;
const iso = (d = new Date()) => d.toISOString();

/** Context of the audit the site knows itself (anti-raid, backups, alert channel). */
async function contextOf(serverId: string) {
  const [{ antiraid }, backupAt] = await Promise.all([getSecuritySettings(serverId), lastBackupAt(serverId)]);
  return {
    antiraidEnabled: antiraid.enabled,
    observe: antiraid.mode === "observe",
    lastBackupAt: backupAt,
    alertChannel: Boolean(antiraid.alertChannelId),
    messageProtection: antiraid.messages.enabled
  };
}

export async function storeDiscordAudit(serverId: string, snapshot: DiscordSnapshot, now = new Date()): Promise<{ id: number; score: number }> {
  const report = analyzeDiscord(snapshot, await contextOf(serverId), now);
  const row = await db.get<{ id: number }>(
    "INSERT INTO discord_audits (server_id, created_at, score, critical, high, medium, snapshot_json) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    [serverId, iso(now), report.score, report.counts.critical, report.counts.high, report.counts.medium, JSON.stringify(snapshot)]
  );
  await db.run(
    `DELETE FROM discord_audits WHERE server_id = ? AND id NOT IN (SELECT id FROM discord_audits WHERE server_id = ? ORDER BY id DESC LIMIT ${KEPT})`,
    [serverId, serverId]
  );
  return { id: Number(row?.id), score: report.score };
}

export async function lastDiscordAuditAt(serverId: string): Promise<string | null> {
  return (await db.get<{ at: string | null }>("SELECT MAX(created_at) AS at FROM discord_audits WHERE server_id = ?", [serverId]))?.at ?? null;
}

export type DiscordAudit = { id: number; createdAt: string; report: DiscordReport; history: { id: number; createdAt: string; score: number }[] };

/** The latest audit, scored with today's context, and the scores of the previous ones. */
export async function latestDiscordAudit(serverId: string, now = new Date()): Promise<DiscordAudit | null> {
  const rows = await db.all<{ id: number; created_at: string; score: number; snapshot_json: string }>(
    "SELECT id, created_at, score, snapshot_json FROM discord_audits WHERE server_id = ? ORDER BY id DESC LIMIT ?",
    [serverId, KEPT]
  );
  if (!rows.length) return null;
  const parsed = discordSnapshotSchema.safeParse(JSON.parse(rows[0].snapshot_json));
  if (!parsed.success) return null;
  return {
    id: Number(rows[0].id),
    createdAt: rows[0].created_at,
    report: analyzeDiscord(parsed.data, await contextOf(serverId), now),
    history: rows.map((r) => ({ id: Number(r.id), createdAt: r.created_at, score: Number(r.score) })).reverse()
  };
}
