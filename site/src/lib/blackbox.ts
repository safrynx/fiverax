import { gunzipSync, gzipSync } from "node:zlib";
import { auditStmt } from "./audit";
import { sendReportAlert } from "./alerts";
import { db, stmt } from "./db";
import { getSecuritySettings } from "./security";
import { getServer } from "./servers";
import {
  REPORT_KINDS, REPORT_OUTCOMES, type Capture, type CaptureEvent, type CaptureEventKind, type CapturePlayer, type Frame, type FramePlayer,
  type ReportKind, type ReportOutcome, type ReportStatus, type ReportSummary
} from "./blackbox-shared";

/**
 * Black box (agent blackbox.lua): reports made in game with /report, captures asked by the staff from the panel, and
 * anticheat kicks / bans, each with the replay of the minutes before (positions every 2 s, hits and deaths between
 * players, who talks). Replays are kept gzipped for CAPTURE_DAYS, the reports themselves stay.
 */

export class ReportError extends Error {}
type Actor = { discordId: string; username?: string | null };

const iso = (d = new Date()) => d.toISOString();
export const CAPTURE_DAYS = 30;
const MAX_FRAMES = 600;
const MAX_PLAYERS_PER_FRAME = 256;
const MAX_EVENTS = 3000;
const EVENT_KINDS: readonly CaptureEventKind[] = ["hit", "death", "join", "leave", "detection", "report"];

// ---- what the agent sends ----

const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const int = (v: unknown, fallback = 0) => Math.round(num(v, fallback));
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, "").slice(0, max) : "");
/** Lua encodes an empty table as {}: read it as an empty list. */
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

type Party = { id: number; name: string; session: string | null };

export type Upload = {
  ref: string;
  kind: ReportKind;
  command: number | null;
  reason: string;
  detection: string | null;
  at: number;
  reporter: Party | null;
  target: Party | null;
  center: number | null;
  players: Party[];
  frames: Frame[];
  events: CaptureEvent[];
};

function party(v: unknown): Party | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = int(o.id, -1);
  if (id < 0) return null;
  const session = str(o.session, 128);
  return { id, name: str(o.name, 100) || "?", session: session || null };
}

/** Validate and clean an upload of the agent (null when unusable). Frames are trimmed, never trusted for size. */
export function parseUpload(raw: unknown): Upload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const ref = str(o.ref, 64);
  const kind = REPORT_KINDS.find((k) => k === o.kind);
  if (!/^[\w-]{6,64}$/.test(ref) || !kind) return null;
  const at = int(o.at);
  if (at <= 1_500_000_000) return null;

  const frames: Frame[] = [];
  for (const f of arr(o.frames).slice(-MAX_FRAMES)) {
    if (!f || typeof f !== "object") continue;
    const t = int((f as Record<string, unknown>).t);
    if (t <= 0) continue;
    const players: FramePlayer[] = [];
    for (const p of arr((f as Record<string, unknown>).p).slice(0, MAX_PLAYERS_PER_FRAME)) {
      const a = arr(p);
      if (a.length < 8) continue;
      players.push([
        int(a[0]), int(a[1]), int(a[2]), int(a[3]), int(a[4]) % 360, Math.max(0, int(a[5])), Math.max(0, int(a[6])), int(a[7]) & 7,
        Math.max(0, num(a[8])), Math.max(0, int(a[9])), str(a[10], 40)
      ]);
    }
    frames.push({ t, p: players });
  }
  frames.sort((a, b) => a.t - b.t);

  const events: CaptureEvent[] = [];
  for (const e of arr(o.events).slice(-MAX_EVENTS)) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const k = EVENT_KINDS.find((x) => x === r.k);
    const t = int(r.t);
    if (!k || t <= 0) continue;
    const ev: CaptureEvent = { t, k };
    if (r.a !== undefined) ev.a = int(r.a);
    if (r.b !== undefined) ev.b = int(r.b);
    if (r.w !== undefined) ev.w = int(r.w);
    if (r.d !== undefined) ev.d = Math.max(0, int(r.d));
    if (typeof r.x === "string") ev.x = str(r.x, 80);
    events.push(ev);
  }
  events.sort((a, b) => a.t - b.t);

  const players = arr(o.players).map(party).filter((p): p is Party => Boolean(p)).slice(0, 512);
  const command = int(o.command, 0);
  return {
    ref, kind, command: command > 0 ? command : null,
    reason: str(o.reason, 500).trim() || (kind === "manual" ? "Capture demandée depuis le panel" : "Sans raison"),
    detection: /^[a-z_]{2,40}$/.test(str(o.detection, 40)) ? str(o.detection, 40) : null,
    at, reporter: party(o.reporter), target: party(o.target), center: o.center !== undefined && int(o.center, -1) >= 0 ? int(o.center) : null, players, frames, events
  };
}

/** Player rows of the agent sessions (`<server>:<session>`), with their Discord account. */
async function playersOfSessions(serverId: string, sessions: string[]): Promise<Map<string, { playerId: number; discordId: string | null }>> {
  const out = new Map<string, { playerId: number; discordId: string | null }>();
  const unique = [...new Set(sessions)].slice(0, 500);
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const rows = await db.all<{ external_id: string; player_id: number; discord_id: string | null }>(
      `SELECT s.external_id, s.player_id, p.discord_id FROM player_sessions s JOIN players p ON p.id = s.player_id
       WHERE s.external_id IN (${chunk.map(() => "?").join(", ")})`,
      chunk.map((s) => `${serverId}:${s}`)
    );
    for (const r of rows) out.set(r.external_id.slice(serverId.length + 1), { playerId: Number(r.player_id), discordId: r.discord_id });
  }
  return out;
}

/**
 * Store an upload of the agent as a report with its replay. Idempotent on `ref` (the agent retries when the panel
 * did not answer): the second upload returns the same report.
 */
export async function ingestCapture(serverId: string, up: Upload, now = new Date()): Promise<{ id: number; created: boolean }> {
  const existing = await db.get<{ id: number }>("SELECT id FROM player_reports WHERE server_id = ? AND ref = ?", [serverId, up.ref]);
  if (existing) return { id: Number(existing.id), created: false };

  const sessions = [up.reporter?.session, up.target?.session, ...up.players.map((p) => p.session)].filter((s): s is string => Boolean(s));
  const known = await playersOfSessions(serverId, sessions);
  const link = (p: Party | null) => (p?.session ? known.get(p.session) ?? null : null);

  let requestedBy: string | null = null;
  if (up.kind === "manual" && up.command) {
    const cmd = await db.get<{ actor_discord_id: string }>("SELECT actor_discord_id FROM fivem_commands WHERE server_id = ? AND id = ? AND kind = 'blackbox'", [serverId, up.command]);
    requestedBy = cmd?.actor_discord_id ?? null;
  }

  const players: CapturePlayer[] = up.players.map((p) => ({ id: p.id, name: p.name, playerId: link(p)?.playerId ?? null }));
  const capture: Capture = {
    from: up.frames[0]?.t ?? up.at,
    to: up.frames[up.frames.length - 1]?.t ?? up.at,
    at: up.at,
    reporter: up.reporter?.id ?? null,
    target: up.target?.id ?? null,
    center: up.center,
    players,
    frames: up.frames,
    events: up.events
  };
  const data = gzipSync(Buffer.from(JSON.stringify(capture)));
  const reporter = link(up.reporter);
  const target = link(up.target);

  const row = await db.get<{ id: number }>(
    `INSERT INTO player_reports (server_id, ref, kind, reason, reporter_player_id, reporter_name, reporter_discord_id, target_player_id, target_name,
       detection, requested_by, created_at, capture_from, capture_to, capture_players, capture_events)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (server_id, ref) DO NOTHING RETURNING id`,
    [
      serverId, up.ref, up.kind, up.reason, reporter?.playerId ?? null, up.reporter?.name ?? null, reporter?.discordId ?? null,
      target?.playerId ?? null, up.target?.name ?? null, up.detection, requestedBy, iso(new Date(up.at * 1000)),
      up.frames.length ? iso(new Date(capture.from * 1000)) : null, up.frames.length ? iso(new Date(capture.to * 1000)) : null,
      players.length, up.events.length
    ]
  );
  if (!row) {
    const again = await db.get<{ id: number }>("SELECT id FROM player_reports WHERE server_id = ? AND ref = ?", [serverId, up.ref]);
    return { id: Number(again?.id ?? 0), created: false };
  }
  const id = Number(row.id);
  if (up.frames.length) await db.run("INSERT OR REPLACE INTO report_captures (report_id, data, bytes, created_at) VALUES (?, ?, ?, ?)", [id, data, data.length, iso(now)]);

  if (up.kind === "report") {
    const [{ anticheat }, server] = await Promise.all([getSecuritySettings(serverId), getServer(serverId)]);
    await sendReportAlert(anticheat, server?.name ?? serverId, {
      title: `📣 Report #${id}`,
      lines: [
        `**${up.reporter?.name ?? "?"}**${up.target ? ` signale **${up.target.name}** (#${up.target.id})` : ""}`,
        up.reason,
        up.frames.length ? `Replay de ${Math.max(1, Math.round((capture.to - capture.from) / 60))} min, ${players.length} joueur${players.length > 1 ? "s" : ""}` : "Pas de replay"
      ],
      url: `${(process.env.APP_URL || "").replace(/\/+$/, "")}/s/${serverId}/reports/${id}`
    });
  }
  return { id, created: true };
}

// ---- what the panel shows ----

type ReportRow = {
  id: number; kind: ReportKind; status: ReportStatus; reason: string; reporter_name: string | null; reporter_player_id: number | null;
  target_name: string | null; target_player_id: number | null; detection: string | null; created_at: string; capture_from: string | null;
  capture_to: string | null; capture_players: number; capture_events: number; claimed_name: string | null; closed_name: string | null;
  closed_at: string | null; outcome: ReportOutcome | null; verdict: string | null; has_capture: number;
};

const COLUMNS = `r.id, r.kind, r.status, r.reason, r.reporter_name, r.reporter_player_id, r.target_name, r.target_player_id, r.detection, r.created_at,
  r.capture_from, r.capture_to, r.capture_players, r.capture_events, r.claimed_name, r.closed_name, r.closed_at, r.outcome, r.verdict,
  (SELECT COUNT(*) FROM report_captures c WHERE c.report_id = r.id) AS has_capture`;

const toSummary = (r: ReportRow): ReportSummary => ({
  id: Number(r.id), kind: r.kind, status: r.status, reason: r.reason, reporterName: r.reporter_name, reporterPlayerId: r.reporter_player_id,
  targetName: r.target_name, targetPlayerId: r.target_player_id, detection: r.detection, createdAt: r.created_at, hasCapture: Number(r.has_capture) > 0,
  captureFrom: r.capture_from, captureTo: r.capture_to, capturePlayers: Number(r.capture_players), captureEvents: Number(r.capture_events),
  claimedName: r.claimed_name, closedName: r.closed_name, closedAt: r.closed_at, outcome: r.outcome, verdict: r.verdict
});

export async function listReports(serverId: string, opts: { status?: ReportStatus | "active"; kind?: ReportKind; playerId?: number; limit?: number } = {}): Promise<ReportSummary[]> {
  const where = ["r.server_id = ?"];
  const args: (string | number)[] = [serverId];
  if (opts.status === "active") where.push("r.status != 'closed'");
  else if (opts.status) {
    where.push("r.status = ?");
    args.push(opts.status);
  }
  if (opts.kind) {
    where.push("r.kind = ?");
    args.push(opts.kind);
  }
  if (opts.playerId) {
    where.push("(r.reporter_player_id = ? OR r.target_player_id = ?)");
    args.push(opts.playerId, opts.playerId);
  }
  const rows = await db.all<ReportRow>(`SELECT ${COLUMNS} FROM player_reports r WHERE ${where.join(" AND ")} ORDER BY r.id DESC LIMIT ?`, [...args, opts.limit ?? 100]);
  return rows.map(toSummary);
}

export async function countOpenReports(serverId: string): Promise<{ open: number; claimed: number }> {
  const rows = await db.all<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM player_reports WHERE server_id = ? AND status != 'closed' GROUP BY status", [serverId]);
  return { open: Number(rows.find((r) => r.status === "open")?.n ?? 0), claimed: Number(rows.find((r) => r.status === "claimed")?.n ?? 0) };
}

export async function getReport(serverId: string, id: number): Promise<ReportSummary | null> {
  const row = await db.get<ReportRow>(`SELECT ${COLUMNS} FROM player_reports r WHERE r.server_id = ? AND r.id = ?`, [serverId, id]);
  return row ? toSummary(row) : null;
}

export async function getCapture(serverId: string, id: number): Promise<Capture | null> {
  const row = await db.get<{ data: ArrayBuffer | Uint8Array }>(
    "SELECT c.data FROM report_captures c JOIN player_reports r ON r.id = c.report_id WHERE r.server_id = ? AND r.id = ?",
    [serverId, id]
  );
  if (!row?.data) return null;
  try {
    const bytes = row.data instanceof Uint8Array ? row.data : new Uint8Array(row.data);
    return JSON.parse(gunzipSync(bytes).toString("utf8")) as Capture;
  } catch {
    return null;
  }
}

/** Take a report (the others see who handles it), drop it back, close it with an outcome, or reopen it. */
export async function updateReport(
  serverId: string,
  actor: Actor,
  id: number,
  change: { action: "claim" | "unclaim" | "reopen" } | { action: "close"; outcome: ReportOutcome; verdict: string | null },
  now = new Date()
): Promise<ReportSummary> {
  const report = await getReport(serverId, id);
  if (!report) throw new ReportError("unknown_report");
  const name = actor.username ?? actor.discordId;
  let update;
  switch (change.action) {
    case "claim":
      update = stmt("UPDATE player_reports SET status = 'claimed', claimed_by = ?, claimed_name = ?, claimed_at = ? WHERE server_id = ? AND id = ? AND status != 'closed'", [actor.discordId, name, iso(now), serverId, id]);
      break;
    case "unclaim":
      update = stmt("UPDATE player_reports SET status = 'open', claimed_by = NULL, claimed_name = NULL, claimed_at = NULL WHERE server_id = ? AND id = ? AND status = 'claimed'", [serverId, id]);
      break;
    case "reopen":
      update = stmt("UPDATE player_reports SET status = 'open', closed_by = NULL, closed_name = NULL, closed_at = NULL, outcome = NULL WHERE server_id = ? AND id = ? AND status = 'closed'", [serverId, id]);
      break;
    case "close": {
      if (!REPORT_OUTCOMES.includes(change.outcome)) throw new ReportError("validation");
      const verdict = change.verdict?.trim().slice(0, 1000) || null;
      update = stmt(
        `UPDATE player_reports SET status = 'closed', closed_by = ?, closed_name = ?, closed_at = ?, outcome = ?, verdict = ?,
           claimed_by = COALESCE(claimed_by, ?), claimed_name = COALESCE(claimed_name, ?) WHERE server_id = ? AND id = ?`,
        [actor.discordId, name, iso(now), change.outcome, verdict, actor.discordId, name, serverId, id]
      );
      break;
    }
  }
  await db.batch([update, auditStmt(serverId, actor, `report_${change.action}`, null, { report: id, ...(change.action === "close" ? { outcome: change.outcome } : {}) })]);
  return (await getReport(serverId, id))!;
}

/** Reports a Discord account made in game, on every server (player portal): never the replay itself. */
export async function reportsMadeBy(discordId: string, limit = 50) {
  const rows = await db.all<{ id: number; server_id: string; status: ReportStatus; reason: string; target_name: string | null; created_at: string; outcome: ReportOutcome | null; verdict: string | null; closed_at: string | null }>(
    `SELECT id, server_id, status, reason, target_name, created_at, outcome, verdict, closed_at FROM player_reports
     WHERE reporter_discord_id = ? AND kind = 'report' ORDER BY id DESC LIMIT ?`,
    [discordId, limit]
  );
  return rows.map((r) => ({
    id: Number(r.id), serverId: r.server_id, status: r.status, reason: r.reason, targetName: r.target_name, createdAt: r.created_at,
    outcome: r.outcome, verdict: r.verdict, closedAt: r.closed_at
  }));
}

/** Replays older than CAPTURE_DAYS are deleted (the reports stay). Called by the maintenance. */
export async function pruneCaptures(now = new Date()): Promise<number> {
  const { changes } = await db.run("DELETE FROM report_captures WHERE created_at < ?", [iso(new Date(now.getTime() - CAPTURE_DAYS * 86_400_000))]);
  return changes;
}
