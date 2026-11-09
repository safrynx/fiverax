import { db } from "./db";

/**
 * Fixed-window rate limiter shared by every instance (database row per key): serverless instances do not share
 * memory, so an in-memory counter would let a script spread its calls over instances.
 * Returns true when the call is allowed. Old rows are pruned by the maintenance tick.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number, now = Date.now()): Promise<boolean> {
  const windowStart = Math.floor(now / 1000 / windowSeconds) * windowSeconds;
  const row = await db.get<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
       window_start = excluded.window_start
     RETURNING count`,
    [key.slice(0, 200), windowStart]
  );
  return Number(row?.count ?? 1) <= limit;
}

/** Drop the counters of windows that ended more than a day ago. */
export async function pruneRateLimits(now = Date.now()): Promise<number> {
  const { changes } = await db.run("DELETE FROM rate_limits WHERE window_start < ?", [Math.floor(now / 1000) - 86_400 * 2]);
  return changes;
}
