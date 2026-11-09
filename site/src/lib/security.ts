import { auditStmt } from "./audit";
import { db, stmt, type Stmt } from "./db";
import { latestBanKeysStmt } from "./network-keys";
import { isBanCategory, type BanCategory } from "./network-shared";
import { anticheatSchema, antiraidSchema, detectionLabel, type AnticheatSettings, type AntiraidSettings } from "./security-config";
import { riskScore, topKinds, type KindStats } from "./security-insights";

/**
 * Security of a server: anticheat settings and bans (enforced by the FiveM agent), anticheat detections and
 * screenshots (with the AI verdict), and the incidents the Discord bot handled (anti-raid).
 *
 * `security_settings.rev` changes whenever the agent must reload (settings or bans): the agent sends the rev it
 * knows on each call and gets the new settings and ban list when it differs.
 */

const iso = (d: Date) => d.toISOString();
/** Who acted, when it was not a person: shown as is on the Logs page. */
export const SYSTEM_ACTOR = { discordId: "fiverax", username: "Fiverax" };

type SettingsRow = { anticheat_json: string | null; antiraid_json: string | null; rev: number };

function parseJson(raw: string | null): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Stored settings merged with the defaults (a setting added later starts with its default). */
export async function getSecuritySettings(serverId: string): Promise<{ anticheat: AnticheatSettings; antiraid: AntiraidSettings; rev: number }> {
  const row = await db.get<SettingsRow>("SELECT anticheat_json, antiraid_json, rev FROM security_settings WHERE server_id = ?", [serverId]);
  const anticheat = anticheatSchema.safeParse(parseJson(row?.anticheat_json ?? null));
  const antiraid = antiraidSchema.safeParse(parseJson(row?.antiraid_json ?? null));
  return {
    anticheat: anticheat.success ? anticheat.data : anticheatSchema.parse({}),
    antiraid: antiraid.success ? antiraid.data : antiraidSchema.parse({}),
    rev: row?.rev ?? 1
  };
}

/** Bump the rev so the agent reloads settings and bans on its next call. */
export const bumpRevStmt = (serverId: string, now = new Date()): Stmt =>
  stmt(
    `INSERT INTO security_settings (server_id, rev, updated_at) VALUES (?, 2, ?)
     ON CONFLICT (server_id) DO UPDATE SET rev = security_settings.rev + 1, updated_at = excluded.updated_at`,
    [serverId, iso(now)]
  );

type Actor = { discordId: string; username?: string | null };

export async function saveSecuritySettings(serverId: string, actor: Actor, part: "anticheat" | "antiraid", value: AnticheatSettings | AntiraidSettings): Promise<void> {
  const column = part === "anticheat" ? "anticheat_json" : "antiraid_json";
  await db.batch([
    bumpRevStmt(serverId),
    stmt(`UPDATE security_settings SET ${column} = ? WHERE server_id = ?`, [JSON.stringify(value), serverId]),
    auditStmt(serverId, actor, part === "anticheat" ? "anticheat_config" : "antiraid_config", null, {})
  ]);
}

// ---- bans ----

export type Ban = {
  id: number;
  playerId: number | null;
  name: string;
  identifiers: string[];
  tokens: string[];
  reason: string;
  source: "manual" | "anticheat" | "ai";
  /** Category shown to the Fiverax network. */
  category: BanCategory;
  /** Visible to the other servers of the network (when this server is a member). */
  shared: boolean;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
};

type BanRow = {
  id: number; player_id: number | null; name: string; identifiers_json: string; tokens_json: string; reason: string; source: Ban["source"]; category: string; shared: number;
  author_discord_id: string | null; author_name: string | null; created_at: string; expires_at: string | null; revoked_at: string | null; revoked_by: string | null;
};

const list = (raw: string): string[] => {
  const value = parseJson(raw);
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
};

const toBan = (r: BanRow): Ban => ({
  id: r.id, playerId: r.player_id, name: r.name, identifiers: list(r.identifiers_json), tokens: list(r.tokens_json), reason: r.reason,
  source: r.source, category: isBanCategory(r.category) ? r.category : "other", shared: Boolean(r.shared), authorId: r.author_discord_id, authorName: r.author_name, createdAt: r.created_at, expiresAt: r.expires_at, revokedAt: r.revoked_at, revokedBy: r.revoked_by
});

export const isBanActive = (b: Pick<Ban, "revokedAt" | "expiresAt">, now = new Date()) => !b.revokedAt && (!b.expiresAt || new Date(b.expiresAt) > now);

/** Identifiers a ban matches on: everything but the IP (never stored) and names. */
const BANNABLE = /^(license2?|discord|steam|fivem|xbl|live2?):/;

type NewBan = {
  playerId: number;
  reason: string;
  source: Ban["source"];
  /** null: permanent */
  expiresAt: string | null;
  detectionId?: number | null;
  /** Default: "cheat" for the anticheat and the AI, "other" for a staff ban. */
  category?: BanCategory;
  /** Default: shared with the network. */
  shared?: boolean;
};

/** Statements banning a known player (their identifiers and hardware tokens as last seen). Null when unknown. */
async function banStatements(serverId: string, actor: Actor, ban: NewBan, now: Date): Promise<Stmt[] | null> {
  const player = await db.get<{ id: number; name: string; identifiers_json: string; tokens_json: string; discord_id: string | null }>(
    "SELECT id, name, identifiers_json, tokens_json, discord_id FROM players WHERE server_id = ? AND id = ?",
    [serverId, ban.playerId]
  );
  if (!player) return null;
  const identifiers = list(player.identifiers_json).filter((id) => BANNABLE.test(id));
  const category = ban.category ?? (ban.source === "manual" ? "other" : "cheat");
  const keys = latestBanKeysStmt(serverId, identifiers, list(player.tokens_json));
  return [
    stmt(
      `INSERT INTO bans (server_id, player_id, name, identifiers_json, tokens_json, reason, source, category, shared, detection_id, author_discord_id, author_name, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [serverId, player.id, player.name, JSON.stringify(identifiers), player.tokens_json, ban.reason, ban.source, category, ban.shared === false ? 0 : 1, ban.detectionId ?? null, actor.discordId, actor.username ?? null, iso(now), ban.expiresAt]
    ),
    // Hashed keys for the network, right after the insert (they point at the newest ban of the server).
    ...(keys ? [keys] : []),
    bumpRevStmt(serverId, now),
    auditStmt(serverId, actor, "player_ban", player.discord_id, { player: player.name, reason: ban.reason, expiresAt: ban.expiresAt, source: ban.source, category, shared: ban.shared !== false })
  ];
}

export async function banPlayer(serverId: string, actor: Actor, ban: NewBan, now = new Date()): Promise<boolean> {
  const statements = await banStatements(serverId, actor, ban, now);
  if (!statements) return false;
  await db.batch(statements);
  return true;
}

export async function revokeBan(serverId: string, actor: Actor, banId: number, now = new Date()): Promise<boolean> {
  const ban = await db.get<{ name: string; revoked_at: string | null }>("SELECT name, revoked_at FROM bans WHERE server_id = ? AND id = ?", [serverId, banId]);
  if (!ban || ban.revoked_at) return false;
  await db.batch([
    stmt("UPDATE bans SET revoked_at = ?, revoked_by = ? WHERE server_id = ? AND id = ?", [iso(now), actor.discordId, serverId, banId]),
    bumpRevStmt(serverId, now),
    auditStmt(serverId, actor, "player_unban", null, { player: ban.name })
  ]);
  return true;
}

/** Share a ban with the network or keep it to this server (and fix its category). */
export async function setBanSharing(serverId: string, actor: Actor, banId: number, change: { shared?: boolean; category?: BanCategory }): Promise<boolean> {
  const ban = await db.get<{ name: string; shared: number; category: string }>("SELECT name, shared, category FROM bans WHERE server_id = ? AND id = ?", [serverId, banId]);
  if (!ban) return false;
  const shared = change.shared ?? Boolean(ban.shared);
  const category = change.category ?? ban.category;
  await db.batch([
    stmt("UPDATE bans SET shared = ?, category = ? WHERE server_id = ? AND id = ?", [shared ? 1 : 0, category, serverId, banId]),
    auditStmt(serverId, actor, "ban_sharing", null, { player: ban.name, shared, category })
  ]);
  return true;
}

export async function listBans(serverId: string, opts: { q?: string; active?: boolean; playerId?: number; limit?: number } = {}, now = new Date()): Promise<Ban[]> {
  const where = ["server_id = ?"];
  const args: (string | number)[] = [serverId];
  if (opts.active) {
    where.push("revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)");
    args.push(iso(now));
  }
  if (opts.playerId) {
    where.push("player_id = ?");
    args.push(opts.playerId);
  }
  const q = opts.q?.trim();
  if (q) {
    where.push("(name LIKE ? OR identifiers_json LIKE ? OR reason LIKE ?)");
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const rows = await db.all<BanRow>(`SELECT * FROM bans WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`, [...args, opts.limit ?? 200]);
  return rows.map(toBan);
}

/** What the agent needs to refuse a connection: active bans with what they match on. */
export async function activeBansForAgent(serverId: string, now = new Date()) {
  const bans = await listBans(serverId, { active: true, limit: 20_000 }, now);
  return bans.map((b) => ({
    id: b.id,
    ids: b.identifiers,
    tokens: b.tokens,
    reason: b.reason,
    expires: b.expiresAt ? Math.floor(new Date(b.expiresAt).getTime() / 1000) : null
  }));
}

// ---- detections ----

export type Detection = {
  id: number;
  playerId: number | null;
  playerName: string;
  kind: string;
  details: Record<string, unknown>;
  action: string;
  screenshotId: number | null;
  at: string;
  status: "open" | "confirmed" | "dismissed";
};

type DetectionRow = { id: number; player_id: number | null; player_name: string; kind: string; details_json: string; action: string; screenshot_id: number | null; at: string; status: Detection["status"] };

const toDetection = (r: DetectionRow): Detection => ({
  id: r.id, playerId: r.player_id, playerName: r.player_name, kind: r.kind, details: (parseJson(r.details_json) ?? {}) as Record<string, unknown>,
  action: r.action, screenshotId: r.screenshot_id, at: r.at, status: r.status
});

/** Record what the agent detected; a "ban" detection bans the player at once (the agent already dropped them). */
export async function recordDetection(
  serverId: string,
  d: { playerId: number | null; playerName: string; kind: string; details: Record<string, unknown>; action: string; screenshotId?: number | null },
  now = new Date(),
  ban: { source: Ban["source"]; reason: string; expiresAt?: string | null } = { source: "anticheat", reason: `Anticheat : ${detectionLabel(d.kind)}` }
): Promise<number> {
  const row = await db.get<{ id: number }>(
    "INSERT INTO ac_detections (server_id, player_id, player_name, kind, details_json, action, screenshot_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    [serverId, d.playerId, d.playerName.slice(0, 100), d.kind, JSON.stringify(d.details).slice(0, 4000), d.action, d.screenshotId ?? null, iso(now)]
  );
  const id = Number(row?.id);
  // The agent uploads the screenshot right away but reports the detection on its next call: link it this way too.
  if (!d.screenshotId && d.playerId) {
    await db.run(
      `UPDATE ac_detections SET screenshot_id = (
         SELECT s.id FROM ac_screenshots s WHERE s.server_id = ? AND s.player_id = ? AND s.reason = ? AND s.created_at >= ?
           AND NOT EXISTS (SELECT 1 FROM ac_detections d WHERE d.screenshot_id = s.id) ORDER BY s.id DESC LIMIT 1)
       WHERE id = ?`,
      [serverId, d.playerId, d.kind, iso(new Date(now.getTime() - 3 * 60_000)), id]
    );
  }
  if (d.action === "ban" && d.playerId) {
    await banPlayer(serverId, SYSTEM_ACTOR, { playerId: d.playerId, reason: ban.reason.slice(0, 300), source: ban.source, expiresAt: ban.expiresAt ?? null, detectionId: id }, now);
  }
  return id;
}

export async function listDetections(serverId: string, opts: { playerId?: number; kind?: string; status?: string; beforeId?: number; limit?: number } = {}): Promise<Detection[]> {
  const where = ["server_id = ?"];
  const args: (string | number)[] = [serverId];
  if (opts.playerId) { where.push("player_id = ?"); args.push(opts.playerId); }
  if (opts.kind) { where.push("kind = ?"); args.push(opts.kind); }
  if (opts.status) { where.push("status = ?"); args.push(opts.status); }
  if (opts.beforeId) { where.push("id < ?"); args.push(opts.beforeId); }
  const rows = await db.all<DetectionRow>(`SELECT * FROM ac_detections WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`, [...args, opts.limit ?? 100]);
  return rows.map(toDetection);
}

/** Detections of a player in the last hours that count towards escalation (false positives excluded). */
export async function countStrikes(serverId: string, playerId: number, hours: number, now = new Date()): Promise<number> {
  const row = await db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM ac_detections WHERE server_id = ? AND player_id = ? AND status <> 'dismissed' AND kind <> 'connection_refused' AND at >= ?",
    [serverId, playerId, iso(new Date(now.getTime() - hours * 3600_000))]
  );
  return Number(row?.n ?? 0);
}

export async function hasActiveBan(serverId: string, playerId: number, now = new Date()): Promise<boolean> {
  return Boolean(await db.get("SELECT 1 FROM bans WHERE server_id = ? AND player_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)", [serverId, playerId, iso(now)]));
}

/** End of a ban of `hours` (0: permanent). */
export const banExpiry = (hours: number, now = new Date()) => (hours > 0 ? iso(new Date(now.getTime() + hours * 3600_000)) : null);

export async function reviewDetection(serverId: string, actor: Actor, id: number, status: "confirmed" | "dismissed" | "open"): Promise<boolean> {
  const res = await db.run("UPDATE ac_detections SET status = ?, reviewed_by = ? WHERE server_id = ? AND id = ?", [status, actor.discordId, serverId, id]);
  return res.changes > 0;
}

// ---- screenshots ----

export type Screenshot = {
  id: number;
  playerId: number | null;
  playerName: string;
  reason: string;
  verdict: "pending" | "clean" | "suspicious" | "cheat" | "error" | "skipped";
  score: number | null;
  summary: string | null;
  requestedBy: string | null;
  createdAt: string;
};

type ShotRow = { id: number; player_id: number | null; player_name: string; reason: string; ai_verdict: Screenshot["verdict"]; ai_score: number | null; ai_summary: string | null; requested_by: string | null; created_at: string };

const toShot = (r: ShotRow): Screenshot => ({
  id: r.id, playerId: r.player_id, playerName: r.player_name, reason: r.reason, verdict: r.ai_verdict, score: r.ai_score, summary: r.ai_summary,
  requestedBy: r.requested_by, createdAt: r.created_at
});

const SHOT_COLUMNS = "id, player_id, player_name, reason, ai_verdict, ai_score, ai_summary, requested_by, created_at";

export async function listScreenshots(serverId: string, opts: { playerId?: number; verdict?: string; limit?: number } = {}): Promise<Screenshot[]> {
  const where = ["server_id = ?"];
  const args: (string | number)[] = [serverId];
  if (opts.playerId) { where.push("player_id = ?"); args.push(opts.playerId); }
  if (opts.verdict) { where.push("ai_verdict = ?"); args.push(opts.verdict); }
  const rows = await db.all<ShotRow>(`SELECT ${SHOT_COLUMNS} FROM ac_screenshots WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`, [...args, opts.limit ?? 60]);
  return rows.map(toShot);
}

export async function getScreenshotImage(serverId: string, id: number): Promise<{ image: Uint8Array; mime: string } | null> {
  const row = await db.get<{ image: ArrayBuffer | Uint8Array; mime: string }>("SELECT image, mime FROM ac_screenshots WHERE server_id = ? AND id = ?", [serverId, id]);
  if (!row) return null;
  return { image: row.image instanceof Uint8Array ? row.image : new Uint8Array(row.image), mime: row.mime };
}

/** Pure: split a data URI ("data:image/jpeg;base64,…") into bytes. Null when it is not a JPEG/PNG/WebP image. */
export function decodeImage(dataUri: string): { bytes: Uint8Array; mime: string } | null {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUri);
  if (!match) return null;
  const bytes = new Uint8Array(Buffer.from(match[2], "base64"));
  return bytes.length > 0 ? { bytes, mime: match[1] } : null;
}

export async function storeScreenshot(
  serverId: string,
  s: { playerId: number | null; playerName: string; reason: string; bytes: Uint8Array; mime: string; requestedBy: string | null },
  now = new Date()
): Promise<number> {
  const row = await db.get<{ id: number }>(
    `INSERT INTO ac_screenshots (server_id, player_id, player_name, reason, image, mime, requested_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [serverId, s.playerId, s.playerName.slice(0, 100), s.reason.slice(0, 200), s.bytes, s.mime, s.requestedBy, iso(now)]
  );
  const id = Number(row?.id);
  // Attach it to the detection that asked for it (same player and kind, just before).
  if (s.playerId) {
    await db.run(
      `UPDATE ac_detections SET screenshot_id = ? WHERE id = (
         SELECT id FROM ac_detections WHERE server_id = ? AND player_id = ? AND kind = ? AND screenshot_id IS NULL AND at >= ? ORDER BY id DESC LIMIT 1)`,
      [id, serverId, s.playerId, s.reason, iso(new Date(now.getTime() - 3 * 60_000))]
    );
  }
  return id;
}

export async function setScreenshotVerdict(serverId: string, id: number, v: { verdict: Screenshot["verdict"]; score: number | null; summary: string | null }): Promise<void> {
  await db.run("UPDATE ac_screenshots SET ai_verdict = ?, ai_score = ?, ai_summary = ? WHERE server_id = ? AND id = ?", [v.verdict, v.score, v.summary, serverId, id]);
}

// ---- Discord incidents (anti-raid) ----

export type IncidentAction = { type: string; ok: boolean; detail?: string };

export type Incident = {
  id: number;
  kind: string;
  actorId: string | null;
  actorName: string | null;
  actorBot: boolean;
  summary: string;
  details: Record<string, unknown>;
  actions: IncidentAction[];
  removedRoles: string[];
  at: string;
  restoredAt: string | null;
  restoredBy: string | null;
};

type IncidentRow = {
  id: number; kind: string; actor_id: string | null; actor_name: string | null; actor_bot: number; summary: string; details_json: string; actions_json: string;
  removed_roles_json: string; at: string; restored_at: string | null; restored_by: string | null;
};

const toIncident = (r: IncidentRow): Incident => ({
  id: r.id, kind: r.kind, actorId: r.actor_id, actorName: r.actor_name, actorBot: Boolean(r.actor_bot), summary: r.summary,
  details: (parseJson(r.details_json) ?? {}) as Record<string, unknown>,
  actions: (Array.isArray(parseJson(r.actions_json)) ? parseJson(r.actions_json) : []) as IncidentAction[],
  removedRoles: list(r.removed_roles_json), at: r.at, restoredAt: r.restored_at, restoredBy: r.restored_by
});

export async function recordIncident(
  serverId: string,
  i: { kind: string; actorId: string | null; actorName: string | null; actorBot: boolean; summary: string; details: Record<string, unknown>; actions: IncidentAction[]; removedRoles: string[] },
  now = new Date()
): Promise<number> {
  const row = await db.get<{ id: number }>(
    `INSERT INTO security_incidents (server_id, kind, actor_id, actor_name, actor_bot, summary, details_json, actions_json, removed_roles_json, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    [serverId, i.kind, i.actorId, i.actorName, i.actorBot ? 1 : 0, i.summary, JSON.stringify(i.details), JSON.stringify(i.actions), JSON.stringify(i.removedRoles), iso(now)]
  );
  return Number(row?.id);
}

export async function listIncidents(serverId: string, limit = 100): Promise<Incident[]> {
  return (await db.all<IncidentRow>("SELECT * FROM security_incidents WHERE server_id = ? ORDER BY id DESC LIMIT ?", [serverId, limit])).map(toIncident);
}

export async function getIncident(serverId: string, id: number): Promise<Incident | null> {
  const row = await db.get<IncidentRow>("SELECT * FROM security_incidents WHERE server_id = ? AND id = ?", [serverId, id]);
  return row ? toIncident(row) : null;
}

export async function markIncidentRestored(serverId: string, actor: Actor, id: number, now = new Date()): Promise<void> {
  const incident = await getIncident(serverId, id);
  await db.batch([
    stmt("UPDATE security_incidents SET restored_at = ?, restored_by = ? WHERE server_id = ? AND id = ?", [iso(now), actor.discordId, serverId, id]),
    auditStmt(serverId, actor, "antiraid_restore", incident?.actorId ?? null, { roles: incident?.removedRoles.length ?? 0 })
  ]);
}

// ---- overview & retention ----

export async function securityOverview(serverId: string, now = new Date()) {
  const since = iso(new Date(now.getTime() - 24 * 3600_000));
  const [detections, bans, shots, incidents] = await db.batch(
    [
      stmt("SELECT COUNT(*) AS n FROM ac_detections WHERE server_id = ? AND at >= ?", [serverId, since]),
      stmt("SELECT COUNT(*) AS n FROM bans WHERE server_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)", [serverId, iso(now)]),
      stmt("SELECT COUNT(*) AS n FROM ac_screenshots WHERE server_id = ? AND ai_verdict IN ('cheat', 'suspicious') AND created_at >= ?", [serverId, since]),
      stmt("SELECT COUNT(*) AS n FROM security_incidents WHERE server_id = ? AND at >= ?", [serverId, since])
    ],
    "read"
  );
  const n = (r: { rows: Record<string, unknown>[] }) => Number(r.rows[0]?.n ?? 0);
  return { detections24h: n(detections), activeBans: n(bans), flaggedShots24h: n(shots), incidents24h: n(incidents) };
}

/** Screenshots are heavy: keep 30 days (and 500 per server at most); detections and incidents 180 days. */
export async function pruneSecurityData(now = new Date()): Promise<number> {
  const results = await db.batch([
    stmt("DELETE FROM ac_screenshots WHERE created_at < ?", [iso(new Date(now.getTime() - 30 * 86400_000))]),
    stmt(
      `DELETE FROM ac_screenshots WHERE id IN (SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (PARTITION BY server_id ORDER BY id DESC) AS n FROM ac_screenshots) WHERE n > 500)`
    ),
    stmt("UPDATE ac_detections SET screenshot_id = NULL WHERE screenshot_id IS NOT NULL AND screenshot_id NOT IN (SELECT id FROM ac_screenshots)"),
    stmt("DELETE FROM ac_detections WHERE at < ?", [iso(new Date(now.getTime() - 180 * 86400_000))]),
    stmt("DELETE FROM security_incidents WHERE at < ?", [iso(new Date(now.getTime() - 180 * 86400_000))]),
    // Live screens nobody watches any more, and old bot actions.
    stmt("DELETE FROM screen_frames WHERE watched_at < ?", [iso(new Date(now.getTime() - 3600_000))]),
    stmt("DELETE FROM bot_actions WHERE created_at < ?", [iso(new Date(now.getTime() - 30 * 86400_000))])
  ]);
  return results[0].changes + results[1].changes;
}

// ---- insights (security center, anticheat tuning) ----

/** Detections of the last days per kind: how many, how many reviewed each way, how many players. */
export async function detectionStats(serverId: string, days = 7, now = new Date()): Promise<KindStats[]> {
  const rows = await db.all<{ kind: string; total: number; dismissed: number | null; confirmed: number | null; players: number }>(
    `SELECT kind, COUNT(*) AS total, SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) AS dismissed,
            SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed, COUNT(DISTINCT COALESCE(player_id, player_name)) AS players
     FROM ac_detections WHERE server_id = ? AND at >= ? GROUP BY kind ORDER BY total DESC`,
    [serverId, iso(new Date(now.getTime() - days * 86400_000))]
  );
  return rows.map((r) => ({ kind: r.kind, total: Number(r.total), dismissed: Number(r.dismissed ?? 0), confirmed: Number(r.confirmed ?? 0), players: Number(r.players) }));
}

export type RiskPlayer = { playerId: number; name: string; score: number; kinds: string; detections: number; lastAt: string; banned: boolean };

/** Players of the last days ranked by risk (lib/security-insights riskScore), the riskiest first. */
export async function riskPlayers(serverId: string, days = 7, limit = 8, now = new Date()): Promise<RiskPlayer[]> {
  const since = iso(new Date(now.getTime() - days * 86400_000));
  const [detections, shots] = await db.batch(
    [
      stmt(
        `SELECT player_id, player_name, kind, status, at FROM ac_detections
         WHERE server_id = ? AND at >= ? AND player_id IS NOT NULL AND status <> 'dismissed' AND kind <> 'connection_refused' ORDER BY id DESC LIMIT 5000`,
        [serverId, since]
      ),
      stmt(
        `SELECT player_id, SUM(CASE WHEN ai_verdict = 'cheat' THEN 1 ELSE 0 END) AS cheat, SUM(CASE WHEN ai_verdict = 'suspicious' THEN 1 ELSE 0 END) AS suspicious
         FROM ac_screenshots WHERE server_id = ? AND created_at >= ? AND player_id IS NOT NULL GROUP BY player_id`,
        [serverId, since]
      )
    ],
    "read"
  );
  const byPlayer = new Map<number, { name: string; list: { kind: string; status: string }[]; lastAt: string; aiCheat: number; aiSuspicious: number }>();
  for (const r of detections.rows) {
    const id = Number(r.player_id);
    const entry = byPlayer.get(id) ?? { name: String(r.player_name), list: [], lastAt: String(r.at), aiCheat: 0, aiSuspicious: 0 };
    entry.list.push({ kind: String(r.kind), status: String(r.status) });
    byPlayer.set(id, entry);
  }
  for (const r of shots.rows) {
    const entry = byPlayer.get(Number(r.player_id));
    if (entry) {
      entry.aiCheat = Number(r.cheat ?? 0);
      entry.aiSuspicious = Number(r.suspicious ?? 0);
    }
  }
  const ranked = [...byPlayer.entries()]
    .map(([playerId, e]) => ({ playerId, name: e.name, score: riskScore({ detections: e.list, aiCheat: e.aiCheat, aiSuspicious: e.aiSuspicious }), kinds: topKinds(e.list), detections: e.list.length, lastAt: e.lastAt }))
    .sort((a, b) => b.score - a.score || b.lastAt.localeCompare(a.lastAt))
    .slice(0, limit);
  if (!ranked.length) return [];
  const banned = new Set(
    (await db.all<{ player_id: number }>(
      `SELECT DISTINCT player_id FROM bans WHERE server_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) AND player_id IN (${ranked.map(() => "?").join(", ")})`,
      [serverId, iso(now), ...ranked.map((r) => r.playerId)]
    )).map((r) => Number(r.player_id))
  );
  return ranked.map((r) => ({ ...r, banned: banned.has(r.playerId) }));
}

export type TimelineDay = { day: string; detections: number; refused: number; incidents: number; bans: number };

/** Security events per day (UTC) over the last days, oldest first, every day present. */
export async function securityTimeline(serverId: string, days = 7, now = new Date()): Promise<TimelineDay[]> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
  const since = iso(start);
  const [det, inc, bans] = await db.batch(
    [
      stmt(
        `SELECT substr(at, 1, 10) AS day, SUM(CASE WHEN kind = 'connection_refused' THEN 0 ELSE 1 END) AS detections,
                SUM(CASE WHEN kind = 'connection_refused' THEN 1 ELSE 0 END) AS refused
         FROM ac_detections WHERE server_id = ? AND at >= ? GROUP BY day`,
        [serverId, since]
      ),
      stmt("SELECT substr(at, 1, 10) AS day, COUNT(*) AS n FROM security_incidents WHERE server_id = ? AND at >= ? GROUP BY day", [serverId, since]),
      stmt("SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM bans WHERE server_id = ? AND created_at >= ? GROUP BY day", [serverId, since])
    ],
    "read"
  );
  const out: TimelineDay[] = [];
  for (let i = 0; i < days; i++) {
    const day = iso(new Date(start.getTime() + i * 86400_000)).slice(0, 10);
    const d = det.rows.find((r) => r.day === day);
    out.push({
      day,
      detections: Number(d?.detections ?? 0),
      refused: Number(d?.refused ?? 0),
      incidents: Number(inc.rows.find((r) => r.day === day)?.n ?? 0),
      bans: Number(bans.rows.find((r) => r.day === day)?.n ?? 0)
    });
  }
  return out;
}

export type SecurityEvent = { source: "detection" | "incident" | "ban"; id: number; kind: string; who: string | null; playerId: number | null; action: string | null; at: string };

/** The latest security events of every kind, newest first (security center feed). */
export async function recentSecurityEvents(serverId: string, limit = 12): Promise<SecurityEvent[]> {
  const rows = await db.all<{ source: SecurityEvent["source"]; id: number; kind: string; who: string | null; player_id: number | null; action: string | null; at: string }>(
    `SELECT * FROM (
       SELECT 'detection' AS source, id, kind, player_name AS who, player_id, action, at FROM ac_detections WHERE server_id = ? AND kind <> 'connection_refused'
       UNION ALL SELECT 'incident', id, kind, actor_name, NULL, NULL, at FROM security_incidents WHERE server_id = ?
       UNION ALL SELECT 'ban', id, source, name, player_id, reason, created_at FROM bans WHERE server_id = ?
     ) ORDER BY at DESC LIMIT ?`,
    [serverId, serverId, serverId, limit]
  );
  return rows.map((r) => ({ source: r.source, id: Number(r.id), kind: r.kind, who: r.who, playerId: r.player_id === null ? null : Number(r.player_id), action: r.action, at: r.at }));
}
