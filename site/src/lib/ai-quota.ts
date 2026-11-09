import { db, stmt } from "./db";
import { getPlatformSettings } from "./platform";
import type { AiKind } from "./platform-shared";

/**
 * Daily AI quotas. Every call to the AI API (lib/ai.ts, vision.ts, review.ts) is counted here first, per server and
 * per account (who asked), and refused once a limit of the platform settings is reached: anyone can register a
 * server, so without this one account could spend the whole AI budget of the platform (and make it fail for all).
 * Days are UTC. Rows: scope "server:<id>" / "user:<discord id>", one per day and kind of call.
 */

export type AiScope = { serverId: string; userId?: string | null; kind: AiKind };

export class AiQuotaError extends Error {}

const dayOf = (now: Date) => now.toISOString().slice(0, 10);
const n = (rows: { rows: Record<string, unknown>[] }) => Number(rows.rows[0]?.n ?? 0);

async function countRefused(scope: AiScope, day: string): Promise<void> {
  await db.run(
    `INSERT INTO ai_usage (scope, day, kind, count, refused) VALUES (?, ?, ?, 0, 1)
     ON CONFLICT(scope, day, kind) DO UPDATE SET refused = ai_usage.refused + 1`,
    [`server:${scope.serverId}`, day, scope.kind]
  ).catch(() => undefined);
}

/** Count one AI call, or throw AiQuotaError("ai_disabled" | "ai_quota_exceeded") without counting it. */
export async function consumeAi(scope: AiScope, now = new Date()): Promise<void> {
  const settings = (await getPlatformSettings()).ai;
  const day = dayOf(now);
  if (!settings.enabled) {
    await countRefused(scope, day);
    throw new AiQuotaError("ai_disabled");
  }
  const serverScope = `server:${scope.serverId}`;
  const userScope = scope.userId ? `user:${scope.userId}` : null;
  const [server, user, global] = await db.batch(
    [
      stmt("SELECT COALESCE(SUM(count), 0) AS n FROM ai_usage WHERE scope = ? AND day = ?", [serverScope, day]),
      stmt("SELECT COALESCE(SUM(count), 0) AS n FROM ai_usage WHERE scope = ? AND day = ?", [userScope ?? "", day]),
      stmt("SELECT COALESCE(SUM(count), 0) AS n FROM ai_usage WHERE day = ? AND scope LIKE 'server:%'", [day])
    ],
    "read"
  );
  const over = (limit: number, used: number) => limit > 0 && used >= limit;
  if (over(settings.perServerDaily, n(server)) || (userScope && over(settings.perUserDaily, n(user))) || over(settings.globalDaily, n(global))) {
    await countRefused(scope, day);
    throw new AiQuotaError("ai_quota_exceeded");
  }
  const upsert = (s: string) =>
    stmt(
      `INSERT INTO ai_usage (scope, day, kind, count) VALUES (?, ?, ?, 1)
       ON CONFLICT(scope, day, kind) DO UPDATE SET count = ai_usage.count + 1`,
      [s, day, scope.kind]
    );
  await db.batch([upsert(serverScope), ...(userScope ? [upsert(userScope)] : [])]);
}

// ---- statistics (/admin) ----

export type AiUsageSummary = {
  today: number;
  refusedToday: number;
  byKind: { kind: string; count: number }[];
  topServers: { serverId: string; count: number; refused: number }[];
  days: { day: string; count: number; refused: number }[];
};

export async function aiUsageSummary(days = 14, now = new Date()): Promise<AiUsageSummary> {
  const today = dayOf(now);
  const from = dayOf(new Date(now.getTime() - (days - 1) * 86_400_000));
  const [perDay, kinds, top] = await db.batch(
    [
      stmt("SELECT day, SUM(count) AS count, SUM(refused) AS refused FROM ai_usage WHERE scope LIKE 'server:%' AND day >= ? GROUP BY day", [from]),
      stmt("SELECT kind, SUM(count) AS count FROM ai_usage WHERE scope LIKE 'server:%' AND day = ? GROUP BY kind ORDER BY count DESC", [today]),
      stmt(
        `SELECT substr(scope, 8) AS server_id, SUM(count) AS count, SUM(refused) AS refused FROM ai_usage
         WHERE scope LIKE 'server:%' AND day = ? GROUP BY scope ORDER BY count DESC, refused DESC LIMIT 10`,
        [today]
      )
    ],
    "read"
  );
  const byDay = new Map(perDay.rows.map((r) => [String(r.day), { count: Number(r.count ?? 0), refused: Number(r.refused ?? 0) }]));
  const list: AiUsageSummary["days"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = dayOf(new Date(now.getTime() - i * 86_400_000));
    list.push({ day, ...(byDay.get(day) ?? { count: 0, refused: 0 }) });
  }
  return {
    today: byDay.get(today)?.count ?? 0,
    refusedToday: byDay.get(today)?.refused ?? 0,
    byKind: kinds.rows.map((r) => ({ kind: String(r.kind), count: Number(r.count ?? 0) })),
    topServers: top.rows.map((r) => ({ serverId: String(r.server_id), count: Number(r.count ?? 0), refused: Number(r.refused ?? 0) })),
    days: list
  };
}

/** One server's AI calls today and over 30 days. */
export async function serverAiUsage(serverId: string, now = new Date()): Promise<{ today: number; refusedToday: number; last30: number }> {
  const today = dayOf(now);
  const from = dayOf(new Date(now.getTime() - 29 * 86_400_000));
  const row = await db.get<{ today: number | null; refused: number | null; last30: number | null }>(
    `SELECT SUM(CASE WHEN day = ? THEN count ELSE 0 END) AS today, SUM(CASE WHEN day = ? THEN refused ELSE 0 END) AS refused, SUM(count) AS last30
     FROM ai_usage WHERE scope = ? AND day >= ?`,
    [today, today, `server:${serverId}`, from]
  );
  return { today: Number(row?.today ?? 0), refusedToday: Number(row?.refused ?? 0), last30: Number(row?.last30 ?? 0) };
}

/** Give a server its daily quota back (an admin, after a legitimate rush). The account quotas are left as they are. */
export async function resetServerAiUsage(serverId: string, now = new Date()): Promise<void> {
  await db.run("DELETE FROM ai_usage WHERE scope = ? AND day = ?", [`server:${serverId}`, dayOf(now)]);
}

/** Usage is kept 120 days. */
export async function pruneAiUsage(now = new Date()): Promise<number> {
  const { changes } = await db.run("DELETE FROM ai_usage WHERE day < ?", [dayOf(new Date(now.getTime() - 120 * 86_400_000))]);
  return changes;
}
