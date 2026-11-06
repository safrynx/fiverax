import { closeStalePlayerSessions } from "./agent";
import { pruneCaptures } from "./blackbox";
import { pruneSecurityData } from "./security";
import { pruneShopEvents } from "./tebex";
import { qualifyPending } from "./referrals";
import { drawDueGiveaways } from "./portal-site";
import { closeStaleFivemSessions } from "./fivem";
import { getServerStatus, setServerStatus } from "./bot-status";
import { aiConfigured, generateWeeklyReviews } from "./review";
import { listServers, serverReviewHour, serverTimeZone, type Server } from "./servers";
import { isSundayFrom, weekKey, weekRange } from "./week";

const FIVEM_STALE_SECONDS = 12 * 3600;
/** AI calls per run: keeps one run well inside a serverless time limit; the next tick continues. */
const REVIEWS_PER_RUN = 15;

/** Sunday evening (the server's community time zone), once per week: is its AI summary of the week still to be done? */
export async function reviewDue(server: Server, now = new Date()): Promise<boolean> {
  const tz = serverTimeZone(server);
  if (!aiConfigured() || !isSundayFrom(serverReviewHour(server), now, tz)) return false;
  return (await getServerStatus(server.id, "review_done")) !== weekKey(weekRange(0, now, tz));
}

/**
 * Generate (part of) a server's AI summaries of the week. Safe to call repeatedly: a database lock prevents overlapping
 * runs, members already reviewed are skipped, and the week is marked done only when nobody is left and nothing failed.
 */
export async function runReviewBatch(server: Server): Promise<void> {
  const key = weekKey(weekRange(0, new Date(), serverTimeZone(server)));
  const result = await generateWeeklyReviews(server.id, 0, { maxMembers: REVIEWS_PER_RUN });
  if (!result.ok) return;
  console.log(`[review] ${server.id} week ${key}: generated=${result.generated} skipped=${result.skipped} failed=${result.failed} remaining=${result.remaining}`);
  if (result.failed === 0 && result.remaining === 0) await setServerStatus(server.id, "review_done", key);
  else if (result.errors.length) console.error(`[review] ${server.id} errors:`, result.errors.join(" | "));
}

/** Periodic housekeeping, triggered by the bot's tick (or any cron hitting POST /api/bot/tick). */
export async function runMaintenance() {
  const staleFivemClosed = await closeStaleFivemSessions(FIVEM_STALE_SECONDS);
  const stalePlayersClosed = await closeStalePlayerSessions(FIVEM_STALE_SECONDS);
  const screenshotsPruned = await pruneSecurityData();
  const shopEventsPruned = await pruneShopEvents();
  const capturesPruned = await pruneCaptures();
  const giveawaysDrawn = await drawDueGiveaways().catch((e) => {
    console.error("[portal] giveaway draw failed:", e instanceof Error ? e.message : e);
    return 0;
  });
  const referralsQualified = await qualifyPending().catch((e) => {
    console.error("[referrals] qualify failed:", e instanceof Error ? e.message : e);
    return 0;
  });
  const due: Server[] = [];
  for (const server of await listServers()) if (await reviewDue(server)) due.push(server);
  return { staleFivemClosed, stalePlayersClosed, screenshotsPruned, shopEventsPruned, capturesPruned, referralsQualified, giveawaysDrawn, reviewDue: due };
}
