import { db, stmt } from "./db";
import { AiQuotaError, consumeAi } from "./ai-quota";
import { audit } from "./audit";
import { releaseLock, tryAcquireLock } from "./bot-status";
import { isRating, RATINGS, type Rating } from "./ratings";
import { getServer, serverTimeZone } from "./servers";
import { toSqlUtc, weekKey, weekRange } from "./week";

/**
 * Weekly appreciation: during the week the managers write comments (staff_notes); on Sunday a free AI
 * summarises each member's comments and picks a rating, stored as a review and as a badge (pastille).
 *
 * Any OpenAI-compatible chat API works. Free options:
 *   Groq   AI_BASE_URL=https://api.groq.com/openai/v1                        AI_MODEL=llama-3.3-70b-versatile
 *   Gemini AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai  AI_MODEL=gemini-2.0-flash
 */

const SYSTEM_PROMPT = `Tu aides à rédiger le bilan hebdomadaire d'un membre du staff d'un serveur de jeu.
Tu reçois les commentaires que ses responsables ont écrits sur lui cette semaine.
Réponds UNIQUEMENT par un objet JSON : {"rating":"red|yellow|green|blue","summary":"..."}.
- rating : red = nul (problèmes sérieux), yellow = moyen (mitigé), green = bien, blue = parfait (excellent).
- summary : 1 à 2 phrases en français, factuelles, fondées uniquement sur les commentaires. N'invente rien.`;

export function aiConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY);
}

/** Pure: extract {rating, summary} from the model's reply (tolerates code fences or surrounding text). */
export function parseReview(text: string): { rating: Rating; summary: string } | null {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return null;
  try {
    const data = JSON.parse(match[0]) as { rating?: unknown; summary?: unknown };
    const rating = typeof data.rating === "string" ? data.rating.toLowerCase().trim() : "";
    const summary = typeof data.summary === "string" ? data.summary.trim() : "";
    if (!isRating(rating) || !summary) return null;
    return { rating, summary: summary.slice(0, 600) };
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function askAI(serverId: string, username: string, comments: { author: string; body: string }[], userId: string | null): Promise<string> {
  await consumeAi({ serverId, userId, kind: "review" });
  const base = (process.env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const model = process.env.AI_MODEL || "llama-3.3-70b-versatile";
  const list = comments.map((c) => `- (${c.author}) ${c.body}`).join("\n").slice(0, 6000);

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Membre : ${username}\nCommentaires de la semaine :\n${list}` }
        ]
      })
    });
    if (res.status === 429 && attempt < 2) {
      await sleep(12_000); // free tiers are rate limited: wait and retry
      continue;
    }
    if (!res.ok) throw new Error(`AI HTTP ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? "";
  }
  throw new Error("AI rate limited");
}

export type Review = { rating: Rating; summary: string };

/** Reviews of one week on a server, keyed by Discord id. */
export async function getReviews(serverId: string, key: string): Promise<Map<string, Review>> {
  const rows = await db.all<{ discord_id: string; rating: string; summary: string }>(
    "SELECT discord_id, rating, summary FROM weekly_reviews WHERE server_id = ? AND week_start = ?",
    [serverId, key]
  );
  return new Map(rows.filter((r) => isRating(r.rating)).map((r) => [r.discord_id, { rating: r.rating as Rating, summary: r.summary }]));
}

export type ReviewRun =
  | { ok: true; generated: number; skipped: number; failed: number; remaining: number; errors: string[] }
  | { ok: false; error: "ai_not_configured" | "already_running" };

const lockName = (serverId: string) => `review:${serverId}`;
const LOCK_TTL_MS = 6 * 60_000;

/**
 * Generate the reviews of a week for every active member of a server who received at least one comment.
 * Members already reviewed are skipped unless `force`. Each success also replaces the member's
 * previous AI badge with the new pastille.
 *
 * Work is done in bounded batches (`maxMembers` AI calls per run, default 25) so that a run fits in a
 * serverless time limit; `remaining` says how many members are still waiting for the next run.
 * A database lock (per server) prevents two instances of the site from running it at the same time.
 */
export async function generateWeeklyReviews(
  serverId: string,
  offset = 0,
  opts: { force?: boolean; delayMs?: number; maxMembers?: number; actor?: { discordId: string; username?: string } } = {}
): Promise<ReviewRun> {
  if (!aiConfigured()) return { ok: false, error: "ai_not_configured" };
  if (!(await tryAcquireLock(lockName(serverId), LOCK_TTL_MS))) return { ok: false, error: "already_running" };

  try {
    const range = weekRange(offset, new Date(), serverTimeZone(await getServer(serverId)));
    const key = weekKey(range);
    const from = toSqlUtc(range.start);
    const to = toSqlUtc(range.end);

    const [members, comments, done] = await Promise.all([
      db.all<{ discord_id: string; username: string }>(
        `SELECT s.discord_id, s.username FROM staff_members s
         WHERE s.server_id = ? AND s.left_guild_at IS NULL AND EXISTS (
           SELECT 1 FROM staff_notes n WHERE n.server_id = s.server_id AND n.discord_id = s.discord_id AND n.created_at >= ? AND n.created_at <= ?)
         ORDER BY s.grade_level DESC, s.username`,
        [serverId, from, to]
      ),
      db.all<{ discord_id: string; body: string; author: string }>(
        `SELECT n.discord_id, n.body, COALESCE(n.author_name, sa.username, n.author_discord_id) AS author
         FROM staff_notes n LEFT JOIN staff_members sa ON sa.server_id = n.server_id AND sa.discord_id = n.author_discord_id
         WHERE n.server_id = ? AND n.created_at >= ? AND n.created_at <= ? ORDER BY n.id`,
        [serverId, from, to]
      ),
      getReviews(serverId, key)
    ]);
    const commentsOf = new Map<string, { body: string; author: string }[]>();
    for (const c of comments) commentsOf.set(c.discord_id, [...(commentsOf.get(c.discord_id) ?? []), c]);

    const budget = opts.maxMembers ?? 25;
    let generated = 0;
    let skipped = 0;
    let failed = 0;
    let remaining = 0;
    const errors: string[] = [];
    /** AI quota reached or AI turned off: the other members wait for a later run (no call, no wait). */
    let quotaHit = false;

    for (const member of members) {
      if (done.has(member.discord_id) && !opts.force) {
        skipped++;
        continue;
      }
      if (quotaHit || generated + failed >= budget) {
        remaining++;
        continue;
      }
      const list = commentsOf.get(member.discord_id) ?? [];
      try {
        const review = parseReview(await askAI(serverId, member.username, list, opts.actor?.discordId ?? null));
        if (!review) throw new Error("réponse IA illisible");
        await db.batch([
          stmt(
            `INSERT INTO weekly_reviews (server_id, week_start, discord_id, rating, summary, comments_count) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(server_id, week_start, discord_id) DO UPDATE SET rating = excluded.rating, summary = excluded.summary,
               comments_count = excluded.comments_count, created_at = CURRENT_TIMESTAMP`,
            [serverId, key, member.discord_id, review.rating, review.summary, list.length]
          ),
          // One AI pastille at a time: the new week replaces the previous one.
          stmt("UPDATE staff_badges SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP WHERE server_id = ? AND discord_id = ? AND status = 'active' AND author_discord_id = 'ia'", [serverId, member.discord_id]),
          stmt("INSERT INTO staff_badges (server_id, discord_id, color, reason, author_discord_id) VALUES (?, ?, ?, ?, 'ia')", [
            serverId, member.discord_id, review.rating, `Bilan IA · ${RATINGS[review.rating].label} : ${review.summary}`
          ])
        ]);
        generated++;
      } catch (error) {
        if (error instanceof AiQuotaError) {
          quotaHit = true;
          remaining++;
          errors.push(error.message);
          continue;
        }
        failed++;
        errors.push(`${member.username}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (opts.delayMs !== 0) await sleep(opts.delayMs ?? 2200);
    }

    await audit(serverId, opts.actor ?? "ia", "review_generate", null, { week: key, generated, skipped, failed, remaining });
    return { ok: true, generated, skipped, failed, remaining, errors };
  } finally {
    await releaseLock(lockName(serverId));
  }
}
