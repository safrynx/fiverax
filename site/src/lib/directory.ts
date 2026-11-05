import { auditStmt } from "./audit";
import { hasPanelAccess } from "./config";
import { ONLINE_MS } from "./agent";
import { db, stmt } from "./db";
import {
  listingSchema, MIN_REVIEW_SECONDS, publishProblems, REVIEW_HIDE_REPORTS, reviewSchema, sortCards, STAT_KINDS,
  type DirectoryCard, type DirectorySort, type ListingInput, type LiveSummary, type PublicReview, type RatingSummary, type StatKind
} from "./directory-shared";
import { getServer, slugify, type Server } from "./servers";
import { monthlyVotes } from "./votes";

export { publishProblems };

/**
 * Public directory of the servers using Fiverax (/annuaire), and an acquisition channel for Fiverax itself.
 *
 * - Listing: a showcase page per server (/annuaire/<slug>), written by its staff (permission `directory_edit`) and
 *   published when they want. Live data comes from the agent: online, players now, unique players this week.
 * - Reviews: only from players who really played there (their Discord account is linked to sessions recorded by the
 *   agent, MIN_REVIEW_SECONDS in total) and who are not staff of that server. One per account, editable; the server
 *   may answer. Three reports from different accounts hide a review until the platform checks it.
 * - Featured: time slots set by the platform owners (no payment yet: `source` = "manual").
 * - Stats: daily views and clicks (join, Discord, store, website) per server.
 */

export class DirectoryError extends Error {}
export type Actor = { discordId: string; username?: string | null };
export type Viewer = { discordId: string; username: string; avatarUrl: string | null };

const iso = (d = new Date()) => d.toISOString();
const day = (d = new Date()) => d.toISOString().slice(0, 10);

// ---- listings ----

export type Listing = ListingInput & { serverId: string; published: boolean; publishedAt: string | null; updatedAt: string | null };
type ListingRow = { server_id: string; slug: string; data_json: string; published: number; published_at: string | null; updated_at: string };

function defaults(server: Server): ListingInput {
  return {
    slug: slugify(server.name).slice(0, 40).replace(/-+$/, "") || server.id,
    name: server.name.slice(0, 60),
    tagline: "",
    description: "",
    logoUrl: server.iconUrl?.startsWith("https://") ? server.iconUrl : "",
    bannerUrl: "",
    gallery: [],
    connect: "",
    discord: "",
    website: "",
    tags: [],
    framework: "standalone",
    language: "fr",
    minAge: 0,
    showPlayers: true
  };
}

function toListing(row: ListingRow, server: Server | null): Listing {
  let data: Partial<ListingInput> = {};
  try {
    data = JSON.parse(row.data_json) as Partial<ListingInput>;
  } catch { /* corrupt: defaults */ }
  const base = server ? defaults(server) : ({} as ListingInput);
  return { ...base, ...data, slug: row.slug, serverId: row.server_id, published: Boolean(row.published), publishedAt: row.published_at, updatedAt: row.updated_at };
}

/** The server's listing, or a draft built from the server (not saved) when it never wrote one. */
export async function getListing(serverId: string): Promise<Listing> {
  const server = await getServer(serverId);
  if (!server) throw new DirectoryError("unknown_server");
  const row = await db.get<ListingRow>("SELECT server_id, slug, data_json, published, published_at, updated_at FROM directory_listings WHERE server_id = ?", [serverId]);
  return row ? toListing(row, server) : { ...defaults(server), serverId, published: false, publishedAt: null, updatedAt: null };
}

export async function saveListing(serverId: string, actor: Actor, input: unknown, now = new Date()): Promise<Listing> {
  const parsed = listingSchema.safeParse(input);
  if (!parsed.success) throw new DirectoryError(`invalid_${parsed.error.issues[0]?.path[0] ?? "listing"}`);
  const data = parsed.data;
  const taken = await db.get<{ server_id: string }>("SELECT server_id FROM directory_listings WHERE slug = ? AND server_id != ?", [data.slug, serverId]);
  if (taken) throw new DirectoryError("slug_taken");
  const { slug, ...rest } = data;
  await db.batch([
    stmt(
      `INSERT INTO directory_listings (server_id, slug, data_json, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (server_id) DO UPDATE SET slug = excluded.slug, data_json = excluded.data_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      [serverId, slug, JSON.stringify(rest), iso(now), actor.discordId]
    ),
    auditStmt(serverId, actor, "directory_listing", null, { slug })
  ]);
  return getListing(serverId);
}

export async function setPublished(serverId: string, actor: Actor, published: boolean, now = new Date()): Promise<Listing> {
  const listing = await getListing(serverId);
  if (!listing.updatedAt) throw new DirectoryError("listing_not_saved");
  if (published && publishProblems(listing).length) throw new DirectoryError("listing_incomplete");
  await db.batch([
    stmt("UPDATE directory_listings SET published = ?, published_at = CASE WHEN ? = 1 THEN COALESCE(published_at, ?) ELSE published_at END WHERE server_id = ?", [
      published ? 1 : 0, published ? 1 : 0, iso(now), serverId
    ]),
    auditStmt(serverId, actor, published ? "directory_publish" : "directory_unpublish", null, { slug: listing.slug })
  ]);
  return getListing(serverId);
}

// ---- live data and ratings ----

async function liveSummaries(serverIds: string[], now = new Date()): Promise<Map<string, LiveSummary>> {
  const out = new Map<string, LiveSummary>();
  if (!serverIds.length) return out;
  const marks = serverIds.map(() => "?").join(", ");
  const [states, week] = await db.batch(
    [
      stmt(`SELECT server_id, seen_at, state_json FROM fivem_state WHERE server_id IN (${marks})`, serverIds),
      stmt(`SELECT server_id, COUNT(DISTINCT player_id) AS n FROM player_sessions WHERE server_id IN (${marks}) AND started_at >= ? GROUP BY server_id`, [
        ...serverIds, iso(new Date(now.getTime() - 7 * 86_400_000))
      ])
    ],
    "read"
  );
  const weekly = new Map(week.rows.map((r) => [String(r.server_id), Number(r.n)]));
  for (const id of serverIds) out.set(id, { online: false, players: 0, maxClients: 0, weekPlayers: weekly.get(id) ?? 0 });
  for (const r of states.rows) {
    const id = String(r.server_id);
    let players = 0, maxClients = 0;
    try {
      const s = JSON.parse(String(r.state_json ?? "null")) as { players?: unknown[]; maxClients?: number } | null;
      players = s?.players?.length ?? 0;
      maxClients = s?.maxClients ?? 0;
    } catch { /* no snapshot */ }
    const online = now.getTime() - new Date(String(r.seen_at)).getTime() < ONLINE_MS;
    out.set(id, { online, players: online ? players : 0, maxClients, weekPlayers: weekly.get(id) ?? 0 });
  }
  return out;
}

async function ratingSummaries(serverIds: string[]): Promise<Map<string, RatingSummary>> {
  const out = new Map<string, RatingSummary>();
  if (!serverIds.length) return out;
  const rows = await db.all<{ server_id: string; rating: number; n: number }>(
    `SELECT server_id, rating, COUNT(*) AS n FROM directory_reviews WHERE status = 'published' AND server_id IN (${serverIds.map(() => "?").join(", ")}) GROUP BY server_id, rating`,
    serverIds
  );
  for (const id of serverIds) out.set(id, { average: null, count: 0, distribution: [0, 0, 0, 0, 0] });
  for (const r of rows) {
    const s = out.get(r.server_id)!;
    s.distribution[Number(r.rating) - 1] = Number(r.n);
  }
  for (const s of out.values()) {
    s.count = s.distribution.reduce((a, b) => a + b, 0);
    s.average = s.count ? Math.round((s.distribution.reduce((a, n, i) => a + n * (i + 1), 0) / s.count) * 10) / 10 : null;
  }
  return out;
}

async function featuredIds(now = new Date()): Promise<Set<string>> {
  const rows = await db.all<{ server_id: string }>("SELECT DISTINCT server_id FROM directory_featured WHERE starts_at <= ? AND ends_at > ?", [iso(now), iso(now)]);
  return new Set(rows.map((r) => r.server_id));
}

// ---- the public directory ----

export type DirectoryQuery = { q?: string; tag?: string; framework?: string; language?: string; online?: boolean; sort?: DirectorySort };

export async function listDirectory(query: DirectoryQuery = {}, now = new Date()): Promise<{ cards: DirectoryCard[]; featured: DirectoryCard[]; total: number }> {
  const rows = await db.all<ListingRow>("SELECT server_id, slug, data_json, published, published_at, updated_at FROM directory_listings WHERE published = 1");
  const ids = rows.map((r) => r.server_id);
  const [live, ratings, featured, votes] = await Promise.all([liveSummaries(ids, now), ratingSummaries(ids), featuredIds(now), monthlyVotes(now)]);
  const all: DirectoryCard[] = rows.map((row) => {
    const l = toListing(row, null);
    return {
      serverId: l.serverId, slug: l.slug, name: l.name, tagline: l.tagline, logoUrl: l.logoUrl || null, bannerUrl: l.bannerUrl || null,
      tags: l.tags ?? [], framework: l.framework, language: l.language, minAge: l.minAge, featured: featured.has(l.serverId),
      live: l.showPlayers === false ? null : live.get(l.serverId) ?? { online: false, players: 0, maxClients: 0, weekPlayers: 0 },
      rating: ratings.get(l.serverId)!, publishedAt: l.publishedAt, votes: votes.get(l.serverId) ?? 0
    };
  });
  const needle = query.q?.trim().toLowerCase();
  const cards = all.filter((c) =>
    (!needle || c.name.toLowerCase().includes(needle) || c.tagline.toLowerCase().includes(needle)) &&
    (!query.tag || c.tags.includes(query.tag)) &&
    (!query.framework || c.framework === query.framework) &&
    (!query.language || c.language === query.language) &&
    (!query.online || c.live?.online)
  );
  return {
    cards: sortCards(cards, query.sort ?? "relevance"),
    featured: sortCards(all.filter((c) => c.featured), "relevance").slice(0, 6),
    total: all.length
  };
}

export type PublicListing = {
  listing: Listing;
  live: LiveSummary | null;
  rating: RatingSummary;
  featured: boolean;
  storeSlug: string | null;
  reviews: PublicReview[];
};

/** A published listing (or any, for its staff: `preview`). */
export async function getPublicListing(slug: string, opts: { viewer?: Viewer | null; preview?: boolean } = {}, now = new Date()): Promise<PublicListing | null> {
  const row = await db.get<ListingRow>("SELECT server_id, slug, data_json, published, published_at, updated_at FROM directory_listings WHERE slug = ?", [slug]);
  if (!row || (!row.published && !opts.preview)) return null;
  const server = await getServer(row.server_id);
  if (!server) return null;
  const listing = toListing(row, server);
  const [live, ratings, featured, store, reviews] = await Promise.all([
    liveSummaries([row.server_id], now),
    ratingSummaries([row.server_id]),
    featuredIds(now),
    db.get<{ slug: string }>("SELECT slug FROM store_sites WHERE server_id = ? AND published_json IS NOT NULL", [row.server_id]),
    listReviews(row.server_id, opts.viewer?.discordId ?? null)
  ]);
  return {
    listing,
    live: listing.showPlayers ? live.get(row.server_id) ?? { online: false, players: 0, maxClients: 0, weekPlayers: 0 } : null,
    rating: ratings.get(row.server_id)!,
    featured: featured.has(row.server_id),
    storeSlug: store?.slug ?? null,
    reviews
  };
}

export async function sitemapListings(): Promise<{ slug: string; updatedAt: string }[]> {
  const rows = await db.all<{ slug: string; updated_at: string }>("SELECT slug, updated_at FROM directory_listings WHERE published = 1");
  return rows.map((r) => ({ slug: r.slug, updatedAt: r.updated_at }));
}

// ---- reviews ----

type ReviewRow = {
  id: number; discord_id: string; username: string; avatar_url: string | null; rating: number; body: string; playtime_seconds: number;
  status: PublicReview["status"]; reply: string | null; reply_at: string | null; created_at: string; updated_at: string; reports?: number;
};
const REVIEW_COLUMNS = "id, discord_id, username, avatar_url, rating, body, playtime_seconds, status, reply, reply_at, created_at, updated_at, reports";

const toReview = (r: ReviewRow, viewer: string | null): PublicReview => ({
  id: Number(r.id), author: r.username, avatarUrl: r.avatar_url, rating: Number(r.rating), body: r.body,
  playtimeHours: Math.max(1, Math.round(Number(r.playtime_seconds) / 3600)), reply: r.reply, replyAt: r.reply_at,
  createdAt: r.created_at, updatedAt: r.updated_at, mine: viewer === r.discord_id, status: r.status
});

/** Published reviews, newest first, plus the viewer's own one whatever its status. */
export async function listReviews(serverId: string, viewer: string | null, limit = 60): Promise<PublicReview[]> {
  const rows = await db.all<ReviewRow>(
    `SELECT ${REVIEW_COLUMNS} FROM directory_reviews WHERE server_id = ? AND (status = 'published' OR discord_id = ?) ORDER BY id DESC LIMIT ?`,
    [serverId, viewer ?? "", limit]
  );
  return rows.map((r) => toReview(r, viewer));
}

/** For the server's staff: every review, with its reports. */
export async function reviewsForStaff(serverId: string): Promise<(PublicReview & { reports: number })[]> {
  const rows = await db.all<ReviewRow>(`SELECT ${REVIEW_COLUMNS} FROM directory_reviews WHERE server_id = ? AND status != 'removed' ORDER BY id DESC LIMIT 200`, [serverId]);
  return rows.map((r) => ({ ...toReview(r, null), reports: Number(r.reports ?? 0) }));
}

/** How long this Discord account played on the server, from the agent's sessions (closed + the one running). */
export async function playtimeOn(serverId: string, discordId: string, now = new Date()): Promise<number> {
  const row = await db.get<{ closed: number | null; open_start: string | null }>(
    `SELECT SUM(CASE WHEN s.ended_at IS NOT NULL THEN s.seconds ELSE 0 END) AS closed,
            MIN(CASE WHEN s.ended_at IS NULL THEN s.started_at END) AS open_start
     FROM player_sessions s JOIN players p ON p.id = s.player_id
     WHERE s.server_id = ? AND p.server_id = ? AND p.discord_id = ?`,
    [serverId, serverId, discordId]
  );
  const open = row?.open_start ? Math.max(0, Math.floor((now.getTime() - new Date(row.open_start).getTime()) / 1000)) : 0;
  return Number(row?.closed ?? 0) + Math.min(open, 12 * 3600);
}

export type Eligibility =
  | { ok: true; playtime: number }
  | { ok: false; reason: "login" | "not_played" | "staff"; playtime: number; needed: number };

/** Staff of a server do not review it: owners, staff members, and anyone given access to its panel (by user or role). */
async function isStaffOf(serverId: string, discordId: string): Promise<boolean> {
  const [staff, roles] = await db.batch(
    [
      stmt("SELECT 1 FROM staff_members WHERE server_id = ? AND discord_id = ? AND left_guild_at IS NULL", [serverId, discordId]),
      stmt("SELECT roles_json FROM member_roles WHERE server_id = ? AND discord_id = ?", [serverId, discordId])
    ],
    "read"
  );
  if (staff.rows.length) return true;
  let roleIds: string[] = [];
  try {
    roleIds = JSON.parse(String(roles.rows[0]?.roles_json ?? "[]")) as string[];
  } catch { /* none */ }
  return hasPanelAccess(serverId, discordId, roleIds);
}

export async function reviewEligibility(serverId: string, viewer: Viewer | null, now = new Date()): Promise<Eligibility> {
  if (!viewer) return { ok: false, reason: "login", playtime: 0, needed: MIN_REVIEW_SECONDS };
  if (await isStaffOf(serverId, viewer.discordId)) return { ok: false, reason: "staff", playtime: 0, needed: MIN_REVIEW_SECONDS };
  const playtime = await playtimeOn(serverId, viewer.discordId, now);
  if (playtime < MIN_REVIEW_SECONDS) return { ok: false, reason: "not_played", playtime, needed: MIN_REVIEW_SECONDS };
  return { ok: true, playtime };
}

async function publishedServer(slug: string): Promise<string> {
  const row = await db.get<{ server_id: string }>("SELECT server_id FROM directory_listings WHERE slug = ? AND published = 1", [slug]);
  if (!row) throw new DirectoryError("unknown_listing");
  return row.server_id;
}

/** Write (or rewrite) the viewer's review of a listed server. */
export async function upsertReview(slug: string, viewer: Viewer, input: unknown, now = new Date()): Promise<PublicReview> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) throw new DirectoryError("invalid_review");
  const serverId = await publishedServer(slug);
  const eligible = await reviewEligibility(serverId, viewer, now);
  if (!eligible.ok) throw new DirectoryError(`review_${eligible.reason}`);
  const existing = await db.get<{ status: string }>("SELECT status FROM directory_reviews WHERE server_id = ? AND discord_id = ?", [serverId, viewer.discordId]);
  if (existing?.status === "removed") throw new DirectoryError("review_removed");
  const row = await db.get<ReviewRow>(
    `INSERT INTO directory_reviews (server_id, discord_id, username, avatar_url, rating, body, playtime_seconds, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (server_id, discord_id) DO UPDATE SET username = excluded.username, avatar_url = excluded.avatar_url, rating = excluded.rating,
       body = excluded.body, playtime_seconds = excluded.playtime_seconds, updated_at = excluded.updated_at
     RETURNING ${REVIEW_COLUMNS}`,
    [serverId, viewer.discordId, viewer.username.slice(0, 80), viewer.avatarUrl, parsed.data.rating, parsed.data.body, eligible.playtime, iso(now), iso(now)]
  );
  return toReview(row!, viewer.discordId);
}

export async function deleteOwnReview(slug: string, viewer: Viewer): Promise<boolean> {
  const serverId = await publishedServer(slug);
  const { changes } = await db.run("DELETE FROM directory_reviews WHERE server_id = ? AND discord_id = ? AND status != 'removed'", [serverId, viewer.discordId]);
  return changes > 0;
}

/** Report a review; REVIEW_HIDE_REPORTS different accounts hide it until moderation. */
export async function reportReview(reviewId: number, viewer: Viewer, reason: string, now = new Date()): Promise<{ hidden: boolean }> {
  const text = reason.trim().slice(0, 500);
  if (text.length < 5) throw new DirectoryError("invalid_reason");
  const review = await db.get<{ discord_id: string; status: string }>("SELECT discord_id, status FROM directory_reviews WHERE id = ?", [reviewId]);
  if (!review || review.status !== "published") throw new DirectoryError("unknown_review");
  if (review.discord_id === viewer.discordId) throw new DirectoryError("own_review");
  const { changes } = await db.run("INSERT OR IGNORE INTO directory_review_reports (review_id, discord_id, reason, created_at) VALUES (?, ?, ?, ?)", [
    reviewId, viewer.discordId, text, iso(now)
  ]);
  if (!changes) return { hidden: false };
  const row = await db.get<{ reports: number }>(
    `UPDATE directory_reviews SET reports = reports + 1, status = CASE WHEN reports + 1 >= ? THEN 'hidden' ELSE status END WHERE id = ? RETURNING reports`,
    [REVIEW_HIDE_REPORTS, reviewId]
  );
  return { hidden: Number(row?.reports ?? 0) >= REVIEW_HIDE_REPORTS };
}

/** The server answers a review (null removes the answer). */
export async function replyReview(serverId: string, actor: Actor, reviewId: number, reply: string | null, now = new Date()): Promise<void> {
  const text = reply?.trim().slice(0, 1500) || null;
  const { changes } = await db.run("UPDATE directory_reviews SET reply = ?, reply_at = ?, reply_by = ? WHERE id = ? AND server_id = ?", [
    text, text ? iso(now) : null, text ? actor.discordId : null, reviewId, serverId
  ]);
  if (!changes) throw new DirectoryError("unknown_review");
  await db.batch([auditStmt(serverId, actor, "directory_reply", null, { reviewId, removed: !text })]);
}

/** Platform moderation: put back (reports cleared) or remove for good. */
export async function moderateReview(reviewId: number, status: "published" | "removed"): Promise<boolean> {
  const { changes } = await db.run("UPDATE directory_reviews SET status = ?, reports = CASE WHEN ? = 'published' THEN 0 ELSE reports END WHERE id = ?", [status, status, reviewId]);
  if (changes && status === "published") await db.run("DELETE FROM directory_review_reports WHERE review_id = ?", [reviewId]);
  return changes > 0;
}

export type ModerationItem = PublicReview & { serverName: string; slug: string; reports: number; reasons: string[] };

export async function reviewsToModerate(): Promise<ModerationItem[]> {
  const rows = await db.all<ReviewRow & { slug: string; server_id: string }>(
    `SELECT r.${REVIEW_COLUMNS.split(", ").join(", r.")}, l.slug, r.server_id FROM directory_reviews r JOIN directory_listings l ON l.server_id = r.server_id
     WHERE r.status = 'hidden' ORDER BY r.id DESC LIMIT 100`
  );
  const out: ModerationItem[] = [];
  for (const r of rows) {
    const reasons = await db.all<{ reason: string }>("SELECT reason FROM directory_review_reports WHERE review_id = ? ORDER BY created_at DESC LIMIT 5", [r.id]);
    const server = await getServer(r.server_id);
    out.push({ ...toReview(r, null), serverName: server?.name ?? r.server_id, slug: r.slug, reports: Number(r.reports ?? 0), reasons: reasons.map((x) => x.reason) });
  }
  return out;
}

// ---- featured ----

export type FeaturedSlot = { id: number; startsAt: string; endsAt: string; source: string; note: string | null };

export async function featuredSlots(serverId: string, now = new Date()): Promise<FeaturedSlot[]> {
  const rows = await db.all<{ id: number; starts_at: string; ends_at: string; source: string; note: string | null }>(
    "SELECT id, starts_at, ends_at, source, note FROM directory_featured WHERE server_id = ? AND ends_at > ? ORDER BY starts_at",
    [serverId, iso(now)]
  );
  return rows.map((r) => ({ id: Number(r.id), startsAt: r.starts_at, endsAt: r.ends_at, source: r.source, note: r.note }));
}

/** Platform owners only (checked by the API): put a server forward for some days, after its current slots. */
export async function addFeatured(serverId: string, actor: Actor, days: number, note: string | null, now = new Date()): Promise<FeaturedSlot[]> {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new DirectoryError("invalid_days");
  const listing = await db.get<{ published: number }>("SELECT published FROM directory_listings WHERE server_id = ?", [serverId]);
  if (!listing?.published) throw new DirectoryError("listing_not_published");
  const last = await db.get<{ ends_at: string | null }>("SELECT MAX(ends_at) AS ends_at FROM directory_featured WHERE server_id = ? AND ends_at > ?", [serverId, iso(now)]);
  const start = last?.ends_at ? new Date(last.ends_at) : now;
  const end = new Date(start.getTime() + days * 86_400_000);
  await db.batch([
    stmt("INSERT INTO directory_featured (server_id, starts_at, ends_at, source, note, created_by, created_at) VALUES (?, ?, ?, 'manual', ?, ?, ?)", [
      serverId, iso(start), iso(end), note?.slice(0, 200) || null, actor.discordId, iso(now)
    ]),
    auditStmt(serverId, actor, "directory_featured", null, { days, endsAt: iso(end) })
  ]);
  return featuredSlots(serverId, now);
}

export async function removeFeatured(serverId: string, actor: Actor, id: number): Promise<void> {
  await db.batch([
    stmt("DELETE FROM directory_featured WHERE server_id = ? AND id = ?", [serverId, id]),
    auditStmt(serverId, actor, "directory_unfeatured", null, { id })
  ]);
}

// ---- stats ----

/** Count a view or a click (public, no login). The key "_fiverax" counts clicks on the "add your server" call. */
export async function track(slug: string, kind: StatKind | "cta", now = new Date()): Promise<void> {
  if (kind === "cta") {
    await db.run("INSERT INTO directory_stats (server_id, day, kind, count) VALUES ('_fiverax', ?, 'cta', 1) ON CONFLICT (server_id, day, kind) DO UPDATE SET count = count + 1", [day(now)]);
    return;
  }
  if (!STAT_KINDS.includes(kind)) return;
  const row = await db.get<{ server_id: string }>("SELECT server_id FROM directory_listings WHERE slug = ? AND published = 1", [slug]);
  if (!row) return;
  await db.run("INSERT INTO directory_stats (server_id, day, kind, count) VALUES (?, ?, ?, 1) ON CONFLICT (server_id, day, kind) DO UPDATE SET count = count + 1", [
    row.server_id, day(now), kind
  ]);
}

export type DirectoryStats = { days: { day: string; view: number; join: number; discord: number; store: number; website: number }[]; totals: Record<StatKind, number> };

export async function statsFor(serverId: string, days = 30, now = new Date()): Promise<DirectoryStats> {
  const from = day(new Date(now.getTime() - (days - 1) * 86_400_000));
  const rows = await db.all<{ day: string; kind: StatKind; count: number }>("SELECT day, kind, count FROM directory_stats WHERE server_id = ? AND day >= ?", [serverId, from]);
  const list: DirectoryStats["days"] = [];
  for (let i = days - 1; i >= 0; i--) list.push({ day: day(new Date(now.getTime() - i * 86_400_000)), view: 0, join: 0, discord: 0, store: 0, website: 0 });
  const index = new Map(list.map((d, i) => [d.day, i]));
  const totals = { view: 0, join: 0, discord: 0, store: 0, website: 0 } as Record<StatKind, number>;
  for (const r of rows) {
    const i = index.get(r.day);
    if (i === undefined || !STAT_KINDS.includes(r.kind)) continue;
    list[i][r.kind] += Number(r.count);
    totals[r.kind] += Number(r.count);
  }
  return { days: list, totals };
}
