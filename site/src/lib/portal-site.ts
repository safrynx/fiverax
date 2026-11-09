import { randomInt } from "node:crypto";
import { enqueueCommand, getLiveState, ONLINE_MS } from "./agent";
import { auditStmt } from "./audit";
import { db, stmt } from "./db";
import { playtimeOn } from "./directory";
import {
  checkAnswers, cleanDesign, formQuestions, giveawayOpen, giveawayReward, PORTAL_SLUG_RE, starterDesign,
  type FormView, type GiveawayView, type PortalBlock, type PortalContext, type PortalDesign, type ResponseStatus, type ViewerStats
} from "./portal-site-shared";
import { isBanActive } from "./security";
import { getServer, slugify, type Server } from "./servers";
import type { VoteReward } from "./votes-shared";

/**
 * Server player portal (/joueur/<slug>), built from blocks in the panel (rules and catalogue in
 * lib/portal-site-shared.ts). The staff edits a draft and publishes it; players log in with Discord to answer the
 * forms and enter the giveaways. Giveaways are drawn at their end date (tick) or by the staff; an in-game reward goes
 * to each winner through the agent once they are in game, like the rewards of votes.
 */

export class PortalSiteError extends Error {}
type Actor = { discordId: string; username?: string | null };
export type Viewer = { discordId: string; username: string; avatarUrl: string | null };
const iso = (d = new Date()) => d.toISOString();
const RESERVED = new Set(["admin", "api", "login", "serveur", "serveurs", "joueur", "fiverax", "annuaire", "scan"]);
const REWARD_WAIT_DAYS = 7;
const MAX_ATTEMPTS = 5;
const SETTLE_MS = 60_000;
export const GIVEAWAY_ACTOR = { discordId: "fiverax", username: "Giveaways Fiverax" };

export type PortalSite = { slug: string; draft: PortalDesign; published: PortalDesign | null; publishedAt: string | null; updatedAt: string; dirty: boolean };
type SiteRow = { server_id: string; slug: string; draft_json: string; published_json: string | null; published_at: string | null; updated_at: string };

const parse = (raw: string | null, name: string) => {
  if (!raw) return null;
  try {
    return cleanDesign(JSON.parse(raw), name);
  } catch {
    return null;
  }
};

function toSite(row: SiteRow, name: string): PortalSite {
  const draft = parse(row.draft_json, name) ?? starterDesign(name);
  const published = parse(row.published_json, name);
  return { slug: row.slug, draft, published, publishedAt: row.published_at, updatedAt: row.updated_at, dirty: JSON.stringify(draft) !== JSON.stringify(published) };
}

const SITE_COLUMNS = "server_id, slug, draft_json, published_json, published_at, updated_at";

export const isPortalSlug = (slug: string) => PORTAL_SLUG_RE.test(slug) && !RESERVED.has(slug) && !slug.includes("--");

/** The server's portal, created (unpublished, from the starter page) the first time it is opened. */
export async function ensureSite(server: Pick<Server, "id" | "name">, now = new Date()): Promise<PortalSite> {
  const row = await db.get<SiteRow>(`SELECT ${SITE_COLUMNS} FROM portal_sites WHERE server_id = ?`, [server.id]);
  if (row) return toSite(row, server.name);
  let slug = slugify(server.name).slice(0, 36).replace(/-+$/, "");
  if (!isPortalSlug(slug) || (await db.get("SELECT 1 FROM portal_sites WHERE slug = ?", [slug]))) slug = `${slug.slice(0, 30) || "serveur"}-${randomInt(1000, 9999)}`;
  await db.run("INSERT OR IGNORE INTO portal_sites (server_id, slug, draft_json, updated_at) VALUES (?, ?, ?, ?)", [server.id, slug, JSON.stringify(starterDesign(server.name)), iso(now)]);
  const created = await db.get<SiteRow>(`SELECT ${SITE_COLUMNS} FROM portal_sites WHERE server_id = ?`, [server.id]);
  return toSite(created!, server.name);
}

export async function saveDraft(server: Pick<Server, "id" | "name">, actor: Actor, design: unknown, now = new Date()): Promise<PortalSite> {
  await ensureSite(server, now);
  const clean = cleanDesign(design, server.name);
  await db.run("UPDATE portal_sites SET draft_json = ?, updated_at = ?, updated_by = ? WHERE server_id = ?", [JSON.stringify(clean), iso(now), actor.discordId, server.id]);
  return ensureSite(server, now);
}

export async function publishSite(server: Pick<Server, "id" | "name">, actor: Actor, now = new Date()): Promise<PortalSite> {
  const site = await ensureSite(server, now);
  await db.batch([
    stmt("UPDATE portal_sites SET published_json = draft_json, published_at = ? WHERE server_id = ?", [iso(now), server.id]),
    // Giveaways known by their block, so that the staff page and the draw find them even if the block changes later.
    ...site.draft.blocks.filter((b) => b.type === "giveaway").map((b) =>
      stmt("INSERT INTO portal_giveaways (server_id, block_id, title) VALUES (?, ?, ?) ON CONFLICT (server_id, block_id) DO UPDATE SET title = excluded.title", [server.id, b.id, String(b.p.title).slice(0, 120)])
    ),
    auditStmt(server.id, actor, "portal_publish", null, { slug: site.slug, blocs: site.draft.blocks.length })
  ]);
  return ensureSite(server, now);
}

export async function unpublishSite(server: Pick<Server, "id" | "name">, actor: Actor): Promise<PortalSite> {
  await db.batch([
    stmt("UPDATE portal_sites SET published_json = NULL WHERE server_id = ?", [server.id]),
    auditStmt(server.id, actor, "portal_unpublish", null, {})
  ]);
  return ensureSite(server);
}

export async function setSlug(server: Pick<Server, "id" | "name">, actor: Actor, slug: string): Promise<PortalSite> {
  const clean = slug.trim().toLowerCase();
  if (!isPortalSlug(clean)) throw new PortalSiteError("invalid_slug");
  await ensureSite(server);
  const taken = await db.get("SELECT 1 FROM portal_sites WHERE slug = ? AND server_id != ?", [clean, server.id]);
  if (taken) throw new PortalSiteError("slug_taken");
  await db.batch([stmt("UPDATE portal_sites SET slug = ? WHERE server_id = ?", [clean, server.id]), auditStmt(server.id, actor, "portal_slug", null, { slug: clean })]);
  return ensureSite(server);
}

/** Published portals' slugs per server (player portal, directory listing). */
export async function publishedSlug(serverId: string): Promise<string | null> {
  const row = await db.get<{ slug: string }>("SELECT slug FROM portal_sites WHERE server_id = ? AND published_json IS NOT NULL", [serverId]);
  return row?.slug ?? null;
}

// ---- the public page ----

async function siteBySlug(slug: string): Promise<{ server: Server; row: SiteRow } | null> {
  if (!PORTAL_SLUG_RE.test(slug)) return null;
  const row = await db.get<SiteRow>(`SELECT ${SITE_COLUMNS} FROM portal_sites WHERE slug = ?`, [slug]);
  if (!row) return null;
  const server = await getServer(row.server_id);
  return server && !server.suspended ? { server, row } : null;
}

async function viewerStats(serverId: string, discordId: string, now: Date): Promise<ViewerStats> {
  const players = await db.all<{ id: number; first_seen_at: string }>("SELECT id, first_seen_at FROM players WHERE server_id = ? AND discord_id = ?", [serverId, discordId]);
  if (!players.length) return { linked: false, playSeconds: 0, sessions: 0, firstSeenAt: null, inGame: false, banned: false };
  const ids = players.map((p) => p.id);
  const marks = ids.map(() => "?").join(", ");
  const [sessions, bans] = await db.batch(
    [
      stmt(`SELECT COUNT(*) AS n, SUM(CASE WHEN ended_at IS NULL THEN 1 ELSE 0 END) AS open FROM player_sessions WHERE server_id = ? AND player_id IN (${marks})`, [serverId, ...ids]),
      stmt(`SELECT revoked_at, expires_at FROM bans WHERE server_id = ? AND player_id IN (${marks})`, [serverId, ...ids])
    ],
    "read"
  );
  return {
    linked: true,
    playSeconds: await playtimeOn(serverId, discordId, now),
    sessions: Number(sessions.rows[0]?.n ?? 0),
    firstSeenAt: players.map((p) => p.first_seen_at).sort()[0] ?? null,
    inGame: Number(sessions.rows[0]?.open ?? 0) > 0,
    banned: bans.rows.some((b) => isBanActive({ revokedAt: (b.revoked_at as string | null) ?? null, expiresAt: (b.expires_at as string | null) ?? null }, now))
  };
}

async function formView(serverId: string, block: PortalBlock, viewer: Viewer | null, hours: number): Promise<FormView> {
  const min = Number(block.p.minHours) || 0;
  const responses = viewer
    ? (await db.all<{ id: number; status: ResponseStatus; reply: string | null; created_at: string }>(
        "SELECT id, status, reply, created_at FROM portal_form_responses WHERE server_id = ? AND block_id = ? AND discord_id = ? ORDER BY id DESC LIMIT 10",
        [serverId, block.id, viewer.discordId]
      )).map((r) => ({ id: Number(r.id), status: r.status, reply: r.reply, createdAt: r.created_at }))
    : [];
  const reason: FormView["reason"] = !viewer ? "login" : block.p.open !== true ? "closed" : block.p.once === true && responses.length ? "once" : hours < min ? "playtime" : null;
  return { responses, canSubmit: reason === null, reason, playHours: Math.floor(hours) };
}

async function giveawayView(serverId: string, block: PortalBlock, viewer: Viewer | null, hours: number, now: Date): Promise<GiveawayView> {
  const [count, mine, state, winners] = await db.batch(
    [
      stmt("SELECT COUNT(*) AS n FROM portal_giveaway_entries WHERE server_id = ? AND block_id = ?", [serverId, block.id]),
      stmt("SELECT 1 FROM portal_giveaway_entries WHERE server_id = ? AND block_id = ? AND discord_id = ?", [serverId, block.id, viewer?.discordId ?? ""]),
      stmt("SELECT drawn_at FROM portal_giveaways WHERE server_id = ? AND block_id = ?", [serverId, block.id]),
      stmt("SELECT discord_id, username FROM portal_giveaway_winners WHERE server_id = ? AND block_id = ? ORDER BY id", [serverId, block.id])
    ],
    "read"
  );
  const drawn = Boolean(state.rows[0]?.drawn_at);
  const open = giveawayOpen(block, drawn, now);
  const min = Number(block.p.minHours) || 0;
  return {
    entries: Number(count.rows[0]?.n ?? 0),
    entered: mine.rows.length > 0,
    open,
    drawn,
    winners: winners.rows.map((w) => String(w.username)),
    won: Boolean(viewer && winners.rows.some((w) => w.discord_id === viewer.discordId)),
    reason: !open ? "closed" : !viewer ? "login" : hours < min ? "playtime" : null,
    playHours: Math.floor(hours)
  };
}

export type PublicPortal = { server: Server; design: PortalDesign; ctx: PortalContext; draft: boolean };

/** The published page with what its visitor may see and do (or the draft, for the staff: `draft`). */
export async function getPublicPortal(slug: string, viewer: Viewer | null, opts: { draft?: boolean } = {}, now = new Date()): Promise<PublicPortal | null> {
  const found = await siteBySlug(slug);
  if (!found) return null;
  const { server, row } = found;
  const site = toSite(row, server.name);
  const design = opts.draft ? site.draft : site.published;
  if (!design) return null;
  const blocks = design.blocks.filter((b) => !b.hidden);

  const [state, listing, stats] = await Promise.all([
    db.get<{ seen_at: string; state_json: string | null }>("SELECT seen_at, state_json FROM fivem_state WHERE server_id = ?", [server.id]),
    db.get<{ data_json: string }>("SELECT data_json FROM directory_listings WHERE server_id = ?", [server.id]),
    viewer ? viewerStats(server.id, viewer.discordId, now) : Promise.resolve(null)
  ]);
  let live: PortalContext["live"] = null;
  if (state) {
    const online = now.getTime() - new Date(state.seen_at).getTime() < ONLINE_MS;
    let players = 0, maxClients = 0;
    try {
      const s = JSON.parse(state.state_json ?? "null") as { players?: unknown[]; maxClients?: number } | null;
      players = s?.players?.length ?? 0;
      maxClients = s?.maxClients ?? 0;
    } catch { /* no snapshot */ }
    live = { online, players: online ? players : 0, maxClients };
  }
  let connect: string | null = null;
  try {
    connect = (JSON.parse(listing?.data_json ?? "{}") as { connect?: string }).connect || null;
  } catch { /* none */ }

  const hours = (stats?.playSeconds ?? 0) / 3600;
  const forms: Record<string, FormView> = {};
  const giveaways: Record<string, GiveawayView> = {};
  for (const b of blocks) {
    if (b.type === "form") forms[b.id] = await formView(server.id, b, viewer, hours);
    if (b.type === "giveaway") giveaways[b.id] = await giveawayView(server.id, b, viewer, hours, now);
  }
  return {
    server,
    design: { ...design, blocks },
    draft: Boolean(opts.draft),
    ctx: {
      serverName: design.title || server.name, slug: site.slug, live, connect,
      viewer: viewer ? { username: viewer.username, avatarUrl: viewer.avatarUrl } : null,
      stats, forms, giveaways
    }
  };
}

async function publishedBlock(slug: string, blockId: string, type: PortalBlock["type"]): Promise<{ server: Server; block: PortalBlock }> {
  const found = await siteBySlug(slug);
  const design = found ? toSite(found.row, found.server.name).published : null;
  const block = design?.blocks.find((b) => b.id === blockId && b.type === type && !b.hidden);
  if (!found || !block) throw new PortalSiteError("unknown_block");
  return { server: found.server, block };
}

// ---- forms ----

export async function submitForm(slug: string, viewer: Viewer, blockId: string, answers: unknown, now = new Date()): Promise<number> {
  const { server, block } = await publishedBlock(slug, blockId, "form");
  const hours = (await playtimeOn(server.id, viewer.discordId, now)) / 3600;
  const view = await formView(server.id, block, viewer, hours);
  if (!view.canSubmit) throw new PortalSiteError(`form_${view.reason}`);
  const questions = formQuestions(block);
  let clean: string[];
  try {
    clean = checkAnswers(questions, answers);
  } catch (error) {
    throw new PortalSiteError(error instanceof Error ? error.message.split(":")[0] : "invalid_answers");
  }
  if (!clean.some(Boolean)) throw new PortalSiteError("answer_required");
  // Several answers allowed: still one every 10 minutes, and at most 3 waiting.
  const recent = await db.get<{ n: number; last: string | null }>(
    "SELECT SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS n, MAX(created_at) AS last FROM portal_form_responses WHERE server_id = ? AND block_id = ? AND discord_id = ?",
    [server.id, block.id, viewer.discordId]
  );
  if (recent?.last && now.getTime() - new Date(recent.last).getTime() < 10 * 60_000) throw new PortalSiteError("form_too_soon");
  if (Number(recent?.n ?? 0) >= 3) throw new PortalSiteError("form_too_many");
  const row = await db.get<{ id: number }>(
    `INSERT INTO portal_form_responses (server_id, block_id, form_title, discord_id, username, questions_json, answers_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [server.id, block.id, String(block.p.title).slice(0, 120), viewer.discordId, viewer.username.slice(0, 80), JSON.stringify(questions.map((q) => q.label)), JSON.stringify(clean), iso(now)]
  );
  return Number(row?.id);
}

export type StaffResponse = {
  id: number; blockId: string; formTitle: string; discordId: string; username: string; answers: { question: string; answer: string }[];
  status: ResponseStatus; reply: string | null; decidedName: string | null; createdAt: string; decidedAt: string | null; playSeconds: number | null;
};

export async function listResponses(serverId: string, filter: "open" | "all" = "open", limit = 200): Promise<StaffResponse[]> {
  const rows = await db.all<Record<string, unknown>>(
    `SELECT id, block_id, form_title, discord_id, username, questions_json, answers_json, status, reply, decided_name, created_at, decided_at
     FROM portal_form_responses WHERE server_id = ? ${filter === "open" ? "AND status IN ('new', 'seen')" : ""} ORDER BY id DESC LIMIT ?`,
    [serverId, limit]
  );
  const out: StaffResponse[] = [];
  for (const r of rows) {
    let questions: string[] = [], answers: string[] = [];
    try {
      questions = JSON.parse(String(r.questions_json));
      answers = JSON.parse(String(r.answers_json));
    } catch { /* corrupt: empty */ }
    out.push({
      id: Number(r.id), blockId: String(r.block_id), formTitle: String(r.form_title), discordId: String(r.discord_id), username: String(r.username),
      answers: questions.map((q, i) => ({ question: q, answer: answers[i] ?? "" })), status: r.status as ResponseStatus, reply: (r.reply as string | null) ?? null,
      decidedName: (r.decided_name as string | null) ?? null, createdAt: String(r.created_at), decidedAt: (r.decided_at as string | null) ?? null,
      playSeconds: await playtimeOn(serverId, String(r.discord_id)).catch(() => null)
    });
  }
  return out;
}

export async function countNewResponses(serverId: string): Promise<number> {
  return Number((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM portal_form_responses WHERE server_id = ? AND status = 'new'", [serverId]))?.n ?? 0);
}

/** The staff marks an answer seen, accepts or refuses it; the reply is shown to the player on the portal. */
export async function decideResponse(serverId: string, actor: Actor, id: number, status: ResponseStatus, reply: string | null, now = new Date()): Promise<void> {
  if (!["seen", "accepted", "refused"].includes(status)) throw new PortalSiteError("invalid_status");
  const text = reply?.trim().slice(0, 1500) || null;
  const { changes } = await db.run(
    "UPDATE portal_form_responses SET status = ?, reply = COALESCE(?, reply), decided_by = ?, decided_name = ?, decided_at = ? WHERE id = ? AND server_id = ?",
    [status, text, actor.discordId, actor.username ?? null, iso(now), id, serverId]
  );
  if (!changes) throw new PortalSiteError("unknown_response");
  await db.batch([auditStmt(serverId, actor, "portal_response", null, { id, status })]);
}

// ---- giveaways ----

export async function enterGiveaway(slug: string, viewer: Viewer, blockId: string, now = new Date()): Promise<GiveawayView> {
  const { server, block } = await publishedBlock(slug, blockId, "giveaway");
  const hours = (await playtimeOn(server.id, viewer.discordId, now)) / 3600;
  const view = await giveawayView(server.id, block, viewer, hours, now);
  if (view.reason) throw new PortalSiteError(`giveaway_${view.reason}`);
  await db.batch([
    stmt("INSERT INTO portal_giveaways (server_id, block_id, title) VALUES (?, ?, ?) ON CONFLICT (server_id, block_id) DO NOTHING", [server.id, block.id, String(block.p.title).slice(0, 120)]),
    stmt("INSERT OR IGNORE INTO portal_giveaway_entries (server_id, block_id, discord_id, username, created_at) VALUES (?, ?, ?, ?, ?)", [server.id, block.id, viewer.discordId, viewer.username.slice(0, 80), iso(now)])
  ]);
  return giveawayView(server.id, block, viewer, hours, now);
}

export async function leaveGiveaway(slug: string, viewer: Viewer, blockId: string, now = new Date()): Promise<void> {
  const { server, block } = await publishedBlock(slug, blockId, "giveaway");
  const drawn = await db.get("SELECT 1 FROM portal_giveaways WHERE server_id = ? AND block_id = ? AND drawn_at IS NOT NULL", [server.id, block.id]);
  if (drawn || !giveawayOpen(block, false, now)) throw new PortalSiteError("giveaway_closed");
  await db.run("DELETE FROM portal_giveaway_entries WHERE server_id = ? AND block_id = ? AND discord_id = ?", [server.id, block.id, viewer.discordId]);
}

/** Pure-ish: pick `n` different entries at random (crypto). */
export function pickWinners<T>(entries: T[], n: number): T[] {
  const list = [...entries];
  for (let i = list.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, Math.max(0, n));
}

async function linkedPlayer(serverId: string, discordId: string): Promise<number | null> {
  const row = await db.get<{ id: number }>("SELECT id FROM players WHERE server_id = ? AND discord_id = ? ORDER BY last_seen_at DESC LIMIT 1", [serverId, discordId]);
  return row ? Number(row.id) : null;
}

/** Draw a giveaway of the published page (once). Answers the winners' names. */
export async function drawGiveaway(serverId: string, actor: Actor, blockId: string, now = new Date()): Promise<string[]> {
  const site = await db.get<SiteRow>(`SELECT ${SITE_COLUMNS} FROM portal_sites WHERE server_id = ?`, [serverId]);
  const server = await getServer(serverId);
  const block = site && server ? toSite(site, server.name).published?.blocks.find((b) => b.id === blockId && b.type === "giveaway") : null;
  if (!block) throw new PortalSiteError("unknown_block");
  await db.run("INSERT INTO portal_giveaways (server_id, block_id, title) VALUES (?, ?, ?) ON CONFLICT (server_id, block_id) DO NOTHING", [serverId, blockId, String(block.p.title).slice(0, 120)]);
  // Claim the draw first: two clicks (or the tick and a click) never draw twice.
  const { changes } = await db.run("UPDATE portal_giveaways SET drawn_at = ?, drawn_by = ? WHERE server_id = ? AND block_id = ? AND drawn_at IS NULL", [iso(now), actor.discordId, serverId, blockId]);
  if (!changes) throw new PortalSiteError("giveaway_drawn");
  const entries = await db.all<{ discord_id: string; username: string }>("SELECT discord_id, username FROM portal_giveaway_entries WHERE server_id = ? AND block_id = ?", [serverId, blockId]);
  const winners = pickWinners(entries, Number(block.p.winners) || 1);
  const reward = giveawayReward(block);
  const writes = [];
  for (const w of winners) {
    const player = reward ? await linkedPlayer(serverId, w.discord_id) : null;
    writes.push(stmt(
      "INSERT OR IGNORE INTO portal_giveaway_winners (server_id, block_id, discord_id, username, reward_json, reward_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [serverId, blockId, w.discord_id, w.username, reward ? JSON.stringify(reward) : null, !reward ? "none" : player ? "pending" : "no_player", iso(now)]
    ));
  }
  writes.push(auditStmt(serverId, actor, "portal_giveaway_draw", null, { giveaway: block.p.title, inscrits: entries.length, gagnants: winners.map((w) => w.username) }));
  await db.batch(writes);
  if (reward) await deliverGiveawayRewards(serverId, now).catch(() => 0);
  return winners.map((w) => w.username);
}

/** Tick: draw the giveaways whose end date passed. */
export async function drawDueGiveaways(now = new Date()): Promise<number> {
  const rows = await db.all<SiteRow>(`SELECT ${SITE_COLUMNS} FROM portal_sites WHERE published_json IS NOT NULL`);
  let drawn = 0;
  for (const row of rows) {
    const design = parse(row.published_json, "");
    for (const b of design?.blocks ?? []) {
      if (b.type !== "giveaway" || !b.p.endsAt || new Date(String(b.p.endsAt)) > now) continue;
      const done = await db.get("SELECT 1 FROM portal_giveaways WHERE server_id = ? AND block_id = ? AND drawn_at IS NOT NULL", [row.server_id, b.id]);
      if (done) continue;
      try {
        await drawGiveaway(row.server_id, GIVEAWAY_ACTOR, b.id, now);
        drawn++;
      } catch { /* drawn meanwhile */ }
    }
  }
  return drawn;
}

/** Hand waiting rewards to winners in game (same rules as the votes: a minute in game, 5 attempts, 7 days). */
export async function deliverGiveawayRewards(serverId: string, now = new Date()): Promise<number> {
  await db.batch([
    stmt("UPDATE portal_giveaway_winners SET reward_status = 'expired' WHERE server_id = ? AND reward_status = 'pending' AND created_at < ?", [serverId, iso(new Date(now.getTime() - REWARD_WAIT_DAYS * 86_400_000))]),
    stmt(
      `UPDATE portal_giveaway_winners SET reward_status = CASE WHEN reward_attempts + 1 >= ? THEN 'failed' ELSE 'pending' END, reward_attempts = reward_attempts + 1,
         reward_command_id = NULL, reward_note = 'Le serveur FiveM n''a pas répondu'
       WHERE server_id = ? AND reward_status = 'sent' AND reward_command_id IN (SELECT id FROM fivem_commands WHERE server_id = ? AND (status = 'expired' OR (status = 'sent' AND sent_at < ?)))`,
      [MAX_ATTEMPTS, serverId, serverId, iso(new Date(now.getTime() - 3 * 60_000))]
    )
  ]);
  const pending = await db.all<{ id: number; discord_id: string; reward_json: string | null; block_id: string }>(
    "SELECT id, discord_id, reward_json, block_id FROM portal_giveaway_winners WHERE server_id = ? AND reward_status = 'pending' ORDER BY id LIMIT 30", [serverId]
  );
  if (!pending.length) return 0;
  const live = await getLiveState(serverId, {}, now);
  if (!live.online) return 0;
  let sent = 0;
  for (const w of pending) {
    const player = live.players.find((p) => p.discordId === w.discord_id && p.connectedAt && now.getTime() - new Date(p.connectedAt).getTime() >= SETTLE_MS);
    if (!player) continue;
    let reward: VoteReward | null = null;
    try {
      reward = w.reward_json ? (JSON.parse(w.reward_json) as VoteReward) : null;
    } catch { /* dropped below */ }
    if (!reward) {
      await db.run("UPDATE portal_giveaway_winners SET reward_status = 'failed', reward_note = 'Récompense illisible' WHERE id = ?", [w.id]);
      continue;
    }
    const commandId = await enqueueCommand(
      serverId, GIVEAWAY_ACTOR, "game",
      { op: "reward", target: player.id, message: "Bravo, tu as gagné le giveaway !", rewards: [reward.type === "item" ? { ...reward, label: reward.label || reward.item } : reward] },
      { playerName: player.name, targetDiscordId: player.discordId }
    );
    await db.run("UPDATE portal_giveaway_winners SET reward_status = 'sent', reward_command_id = ? WHERE id = ? AND reward_status = 'pending'", [commandId, w.id]);
    sent++;
  }
  return sent;
}

/** Statements recording the agent's answers to giveaway reward commands (run with the agent's other writes). */
export function giveawayResultStmts(serverId: string, results: { id: number; ok: boolean; message?: string }[], now = new Date()) {
  return results.map((r) =>
    stmt(
      `UPDATE portal_giveaway_winners SET
         reward_status = CASE WHEN ? = 1 THEN 'delivered' WHEN reward_attempts + 1 >= ? THEN 'failed' ELSE 'pending' END,
         reward_attempts = reward_attempts + 1, reward_note = ?, rewarded_at = CASE WHEN ? = 1 THEN ? ELSE rewarded_at END,
         reward_command_id = CASE WHEN ? = 1 THEN reward_command_id ELSE NULL END
       WHERE server_id = ? AND reward_command_id = ? AND reward_status = 'sent'`,
      [r.ok ? 1 : 0, MAX_ATTEMPTS, r.message?.slice(0, 300) ?? null, r.ok ? 1 : 0, iso(now), r.ok ? 1 : 0, serverId, r.id]
    )
  );
}

export type StaffGiveaway = {
  blockId: string; title: string; prize: string; endsAt: string | null; entries: number; drawnAt: string | null; published: boolean;
  winners: { username: string; reward: string; note: string | null }[];
};

export async function giveawaysForStaff(server: Pick<Server, "id" | "name">): Promise<StaffGiveaway[]> {
  const site = await ensureSite(server);
  const blocks = new Map((site.published?.blocks ?? []).filter((b) => b.type === "giveaway").map((b) => [b.id, b]));
  const known = await db.all<{ block_id: string; title: string; drawn_at: string | null }>("SELECT block_id, title, drawn_at FROM portal_giveaways WHERE server_id = ?", [server.id]);
  const ids = [...new Set([...blocks.keys(), ...known.map((k) => k.block_id)])];
  const out: StaffGiveaway[] = [];
  for (const id of ids) {
    const b = blocks.get(id);
    const k = known.find((x) => x.block_id === id);
    const [count, winners] = await db.batch(
      [
        stmt("SELECT COUNT(*) AS n FROM portal_giveaway_entries WHERE server_id = ? AND block_id = ?", [server.id, id]),
        stmt("SELECT username, reward_status, reward_note FROM portal_giveaway_winners WHERE server_id = ? AND block_id = ? ORDER BY id", [server.id, id])
      ],
      "read"
    );
    out.push({
      blockId: id, title: b ? String(b.p.title) : k?.title ?? id, prize: b ? String(b.p.prize) : "", endsAt: b && b.p.endsAt ? String(b.p.endsAt) : null,
      entries: Number(count.rows[0]?.n ?? 0), drawnAt: k?.drawn_at ?? null, published: Boolean(b),
      winners: winners.rows.map((w) => ({ username: String(w.username), reward: String(w.reward_status), note: (w.reward_note as string | null) ?? null }))
    });
  }
  return out.sort((a, b) => Number(Boolean(a.drawnAt)) - Number(Boolean(b.drawnAt)) || (b.endsAt ?? "").localeCompare(a.endsAt ?? ""));
}
