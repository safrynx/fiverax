import { db } from "./db";
import { detectionLabel } from "./security-config";

/**
 * For the "Écrans en direct" tab of the anticheat page: how suspicious each online player looks (anticheat detections
 * of the last hours, false positives excluded), so the staff watch the right screens first.
 */
export async function recentDetectionsByPlayer(
  serverId: string,
  playerIds: number[],
  hours = 24,
  now = new Date()
): Promise<Map<number, { count: number; lastKind: string | null }>> {
  const out = new Map<number, { count: number; lastKind: string | null }>();
  const ids = [...new Set(playerIds.filter((id) => Number.isInteger(id) && id > 0))].slice(0, 500);
  if (!ids.length) return out;
  const rows = await db.all<{ player_id: number; n: number; last_kind: string | null }>(
    `SELECT player_id, COUNT(*) AS n,
            (SELECT d2.kind FROM ac_detections d2 WHERE d2.server_id = d.server_id AND d2.player_id = d.player_id ORDER BY d2.id DESC LIMIT 1) AS last_kind
     FROM ac_detections d
     WHERE d.server_id = ? AND d.status != 'dismissed' AND d.at >= ? AND d.player_id IN (${ids.map(() => "?").join(",")})
     GROUP BY d.player_id`,
    [serverId, new Date(now.getTime() - hours * 3_600_000).toISOString(), ...ids]
  );
  for (const r of rows) out.set(Number(r.player_id), { count: Number(r.n), lastKind: r.last_kind ? detectionLabel(r.last_kind) : null });
  return out;
}
