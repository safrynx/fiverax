import { createHash } from "node:crypto";
import { z } from "zod";
import { aiConfigured, chatJson } from "./ai";
import { auditStmt } from "./audit";
import { db, stmt } from "./db";
import {
  analyzeFile, ANALYZABLE, buildReport, ENGINE, fileKey, SEVERITY_LABEL,
  type AIReview, type Artifacts, type FileResult, type Finding, type Inventory, type Report
} from "./audit-rules";
import { getSecuritySettings } from "./security";
import { getServer } from "./servers";

/**
 * Server audit, shown as "Scanner" (Sécurité > Scanner).
 *
 * 1. The agent (audit.js) lists every resource and file, hashes the code (SHA-256) and sends the inventory
 *    (names, sizes, hashes, manifests, a redacted server.cfg) — no code.
 * 2. The panel answers with the hashes it does not know yet. A file already analysed for any server (same content,
 *    same role) is not sent again: popular resources are analysed once for everyone (reputation by hash).
 * 3. The agent sends only those files; each is checked against its hash, analysed by the rules and dropped: the code
 *    is never stored, only the findings with 3 lines around each problem.
 * 4. The report is built (score /100 per category), compared with the previous one (alert on new critical
 *    problems), and the AI can explain any finding from its 3 lines.
 *
 * `set fiverax_audit_code 0` on the FiveM server: no file is ever sent, only the inventory (known files are still
 * judged by their reputation).
 */

const KEEP_SCANS = 30;
const STALE_MS = 20 * 60_000;
const MAX_FILE = 3 * 1024 * 1024;
const iso = (d = new Date()) => d.toISOString();

export type Actor = { discordId: string; username?: string | null };
export type ScanStatus = "pending" | "collecting" | "done" | "failed";
export type ScanSummary = {
  id: number; status: ScanStatus; trigger: "manual" | "auto"; createdAt: string; finishedAt: string | null;
  score: number | null; counts: { critical: number; high: number; medium: number; info: number }; error: string | null; progress: string | null;
};
export type Scan = ScanSummary & { report: Report | null };
export type AuditSettings = { continuous: boolean; alert: boolean };

type ScanRow = {
  id: number; status: ScanStatus; trigger: "manual" | "auto"; created_at: string; finished_at: string | null; score: number | null;
  critical: number; high: number; medium: number; info: number; error: string | null; progress: string | null; report_json?: string | null;
};

const SCAN_COLUMNS = "id, status, trigger, created_at, finished_at, score, critical, high, medium, info, error, progress";

function summary(r: ScanRow, now = Date.now()): ScanSummary {
  const stale = (r.status === "pending" || r.status === "collecting") && now - new Date(r.created_at).getTime() > STALE_MS;
  return {
    id: Number(r.id), status: stale ? "failed" : r.status, trigger: r.trigger, createdAt: r.created_at, finishedAt: r.finished_at, score: r.score,
    counts: { critical: Number(r.critical), high: Number(r.high), medium: Number(r.medium), info: Number(r.info) },
    error: stale ? "Le serveur FiveM n'a pas terminé le scan (agent arrêté, ou fiverax_agent trop ancien : version 3.3 requise)." : r.error,
    progress: r.progress
  };
}

// ---- settings ----

export async function getAuditSettings(serverId: string): Promise<AuditSettings> {
  const row = await db.get<{ continuous: number; alert: number }>("SELECT continuous, alert FROM audit_settings WHERE server_id = ?", [serverId]);
  return { continuous: Boolean(row?.continuous), alert: row ? Boolean(row.alert) : true };
}

export async function saveAuditSettings(serverId: string, actor: Actor, settings: AuditSettings): Promise<void> {
  await db.batch([
    stmt(
      `INSERT INTO audit_settings (server_id, continuous, alert, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (server_id) DO UPDATE SET continuous = excluded.continuous, alert = excluded.alert, updated_at = excluded.updated_at`,
      [serverId, settings.continuous ? 1 : 0, settings.alert ? 1 : 0, iso()]
    ),
    auditStmt(serverId, actor, "audit_settings", null, settings)
  ]);
}

// ---- scans ----

/** A new scan waiting for the agent (the "audit" command that starts it is logged by the agent queue). */
export async function createScan(serverId: string, actorId: string | null, trigger: "manual" | "auto"): Promise<number> {
  const row = await db.get<{ id: number }>(
    "INSERT INTO audit_scans (server_id, status, trigger, actor_discord_id, created_at) VALUES (?, 'pending', ?, ?, ?) RETURNING id",
    [serverId, trigger, actorId, iso()]
  );
  return Number(row?.id);
}

/** A scan still running (not stale), if any. */
export async function runningScan(serverId: string, now = new Date()): Promise<ScanSummary | null> {
  const row = await db.get<ScanRow>(
    `SELECT ${SCAN_COLUMNS} FROM audit_scans WHERE server_id = ? AND status IN ('pending', 'collecting') AND created_at > ? ORDER BY id DESC LIMIT 1`,
    [serverId, iso(new Date(now.getTime() - STALE_MS))]
  );
  return row ? summary(row) : null;
}

export async function listScans(serverId: string, limit = KEEP_SCANS): Promise<ScanSummary[]> {
  const rows = await db.all<ScanRow>(`SELECT ${SCAN_COLUMNS} FROM audit_scans WHERE server_id = ? ORDER BY id DESC LIMIT ?`, [serverId, limit]);
  return rows.map((r) => summary(r));
}

export async function getScan(serverId: string, id: number): Promise<Scan | null> {
  const row = await db.get<ScanRow>(`SELECT ${SCAN_COLUMNS}, report_json FROM audit_scans WHERE server_id = ? AND id = ?`, [serverId, id]);
  if (!row) return null;
  return { ...summary(row), report: row.report_json ? (JSON.parse(row.report_json) as Report) : null };
}

export async function latestReport(serverId: string): Promise<Scan | null> {
  const row = await db.get<{ id: number }>("SELECT id FROM audit_scans WHERE server_id = ? AND status = 'done' ORDER BY id DESC LIMIT 1", [serverId]);
  return row ? getScan(serverId, Number(row.id)) : null;
}

/** Continuous audit: the agent asks before collecting (a resource was started, or the periodic check). */
export async function shouldAutoScan(serverId: string, now = new Date()): Promise<boolean> {
  if (!(await getAuditSettings(serverId)).continuous) return false;
  const last = await db.get<{ created_at: string }>("SELECT created_at FROM audit_scans WHERE server_id = ? ORDER BY id DESC LIMIT 1", [serverId]);
  return !last || now.getTime() - new Date(last.created_at).getTime() > STALE_MS;
}

// ---- what the agent sends ----

const role = z.enum(["client", "server", "shared", "ui", "other"]);
export const inventorySchema = z.object({
  scanId: z.number().int().positive().nullable().optional(),
  auto: z.boolean().optional(),
  agent: z.string().max(20).optional(),
  confidential: z.boolean().optional(),
  convars: z.record(z.string(), z.string().max(300)).default({}),
  rcon: z.boolean().optional(),
  cfg: z.array(z.object({ path: z.string().max(300), content: z.string().max(200_000) })).max(10).default([]),
  resources: z.array(z.object({
    name: z.string().max(100),
    state: z.string().max(20),
    meta: z.object({
      fx_version: z.string().max(40).optional(),
      lua54: z.string().max(10).optional(),
      dependencies: z.array(z.string().max(120)).max(100).optional(),
      legacy: z.boolean().optional(),
      version: z.string().max(40).optional()
    }).default({}),
    protected: z.boolean().optional(),
    truncated: z.boolean().optional(),
    files: z.array(z.object({
      p: z.string().max(400),
      size: z.number().int().nonnegative(),
      hash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
      role,
      kind: z.enum(["code", "stream", "other"]),
      enc: z.boolean().optional()
    })).max(5000)
  })).max(3000)
});

/** Keys (hash:role:ext) of the inventory's files that have to be analysed (unknown to the reputation base). */
async function unknownKeys(inv: Inventory): Promise<{ key: string; hash: string }[]> {
  const wanted = new Map<string, string>();
  for (const r of inv.resources) {
    for (const f of r.files) {
      if (f.kind === "code" && f.hash && !f.enc && f.size <= MAX_FILE && ANALYZABLE.test(f.p)) wanted.set(fileKey(f), f.hash);
    }
  }
  const keys = [...wanted.keys()];
  const known = new Set<string>();
  for (let i = 0; i < keys.length; i += 400) {
    const chunk = keys.slice(i, i + 400);
    const rows = await db.all<{ key: string }>(`SELECT key FROM audit_files WHERE engine = ? AND key IN (${chunk.map(() => "?").join(",")})`, [ENGINE, ...chunk]);
    for (const r of rows) known.add(r.key);
  }
  return keys.filter((k) => !known.has(k)).map((key) => ({ key, hash: wanted.get(key) as string }));
}

export class AuditError extends Error {}

/** Phase 1: the inventory. Answers the scan id and the files to send (none in confidential mode). */
export async function receiveInventory(serverId: string, body: z.infer<typeof inventorySchema>): Promise<{ scanId: number; need: { key: string; hash: string }[] }> {
  let scanId = body.scanId ?? null;
  if (scanId) {
    const row = await db.get<{ status: string }>("SELECT status FROM audit_scans WHERE server_id = ? AND id = ?", [serverId, scanId]);
    if (!row || (row.status !== "pending" && row.status !== "collecting")) throw new AuditError("unknown_scan");
  } else {
    scanId = await createScan(serverId, null, body.auto ? "auto" : "manual");
  }
  const { scanId: _s, auto: _a, ...inventory } = body;
  const need = await unknownKeys(inventory as Inventory);
  await db.run("UPDATE audit_scans SET status = 'collecting', inventory_json = ?, progress = ? WHERE server_id = ? AND id = ?", [
    JSON.stringify(inventory), body.confidential ? "Mode confidentiel : aucun fichier envoyé" : `${need.length} fichier(s) à analyser`, serverId, scanId
  ]);
  return { scanId, need: body.confidential ? [] : need };
}

export const filesSchema = z.object({
  scanId: z.number().int().positive(),
  files: z.array(z.object({ key: z.string().max(200), path: z.string().max(400), content: z.string().max(MAX_FILE) })).max(2000)
});

/**
 * Phase 2: files the panel asked for. Each content must match the hash of its key: nobody can teach the shared base
 * that a file is clean by sending other content. Analysed, then forgotten.
 */
export async function receiveFiles(serverId: string, body: z.infer<typeof filesSchema>): Promise<number> {
  const scan = await db.get<{ status: string }>("SELECT status FROM audit_scans WHERE server_id = ? AND id = ?", [serverId, body.scanId]);
  if (scan?.status !== "collecting") throw new AuditError("unknown_scan");
  const writes = [];
  for (const f of body.files) {
    const [hash, fileRole] = f.key.split(":");
    if (createHash("sha256").update(f.content, "utf8").digest("hex") !== hash) continue;
    const result = analyzeFile(f.path, f.content, fileRole as Parameters<typeof analyzeFile>[2]);
    writes.push(stmt(
      `INSERT INTO audit_files (key, engine, size, findings_json, events_json, analyzed_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET engine = excluded.engine, findings_json = excluded.findings_json, events_json = excluded.events_json, analyzed_at = excluded.analyzed_at`,
      [f.key, ENGINE, f.content.length, JSON.stringify(result.findings), JSON.stringify(result.events), iso()]
    ));
  }
  writes.push(stmt("UPDATE audit_scans SET progress = ? WHERE server_id = ? AND id = ?", [`${writes.length} fichier(s) analysé(s)…`, serverId, body.scanId]));
  for (let i = 0; i < writes.length; i += 200) await db.batch(writes.slice(i, i + 200));
  return writes.length - 1;
}

// ---- artifacts ----

let artifactsCache: { at: number; platform: string; data: { recommended: number; critical: number } | null } | null = null;

/** The build of the server against the builds Cfx.re recommends (null when unknown: the check is skipped). */
export async function checkArtifacts(version: string | undefined): Promise<Artifacts> {
  const build = Number(/v1\.0\.0\.(\d+)/.exec(version ?? "")?.[1]);
  if (!build) return null;
  const platform = /linux/i.test(version ?? "") ? "linux" : "win32";
  if (!artifactsCache || artifactsCache.platform !== platform || Date.now() - artifactsCache.at > 3_600_000) {
    let data: { recommended: number; critical: number } | null = null;
    try {
      const res = await fetch(`https://changelogs-live.fivem.net/api/changelog/versions/${platform}/server`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const json = (await res.json()) as Record<string, unknown>;
        data = { recommended: Number(json.recommended) || 0, critical: Number(json.critical) || 0 };
      }
    } catch { /* offline: no artifacts check */ }
    artifactsCache = { at: Date.now(), platform, data };
  }
  return artifactsCache.data ? { build, ...artifactsCache.data } : null;
}

// ---- report ----

async function resultsFor(inv: Inventory): Promise<Map<string, FileResult>> {
  const keys = [...new Set(inv.resources.flatMap((r) => r.files.filter((f) => f.kind === "code" && f.hash).map((f) => fileKey(f))))];
  const map = new Map<string, FileResult>();
  for (let i = 0; i < keys.length; i += 400) {
    const chunk = keys.slice(i, i + 400);
    const rows = await db.all<{ key: string; findings_json: string; events_json: string }>(
      `SELECT key, findings_json, events_json FROM audit_files WHERE engine = ? AND key IN (${chunk.map(() => "?").join(",")})`,
      [ENGINE, ...chunk]
    );
    for (const r of rows) map.set(r.key, { findings: JSON.parse(r.findings_json), events: JSON.parse(r.events_json) });
  }
  return map;
}

const findingId = (f: Finding) => `${f.rule}|${f.resource ?? ""}|${f.file ?? ""}`;

/** Phase 3: build the report, keep the 30 latest scans, alert on new serious problems. */
export async function finishScan(serverId: string, scanId: number, opts: { artifacts?: Artifacts } = {}): Promise<Report> {
  const row = await db.get<{ inventory_json: string | null; status: string }>("SELECT inventory_json, status FROM audit_scans WHERE server_id = ? AND id = ?", [serverId, scanId]);
  if (!row?.inventory_json || row.status !== "collecting") throw new AuditError("unknown_scan");
  const inv = JSON.parse(row.inventory_json) as Inventory;
  const artifacts = opts.artifacts !== undefined ? opts.artifacts : await checkArtifacts(inv.convars.version);
  const report = buildReport(inv, await resultsFor(inv), artifacts);
  const counts = { critical: 0, high: 0, medium: 0, info: 0 };
  for (const f of report.findings) counts[f.severity]++;

  const previous = await latestReport(serverId);
  await db.batch([
    stmt(
      `UPDATE audit_scans SET status = 'done', finished_at = ?, report_json = ?, inventory_json = NULL, score = ?, critical = ?, high = ?, medium = ?, info = ?, progress = NULL
       WHERE server_id = ? AND id = ?`,
      [iso(), JSON.stringify(report), report.score, counts.critical, counts.high, counts.medium, counts.info, serverId, scanId]
    ),
    stmt(`DELETE FROM audit_scans WHERE server_id = ? AND id <= (SELECT id FROM audit_scans WHERE server_id = ? ORDER BY id DESC LIMIT 1 OFFSET ${KEEP_SCANS})`, [serverId, serverId])
  ]);

  const before = new Set((previous?.report?.findings ?? []).map(findingId));
  const fresh = report.findings.filter((f) => (f.severity === "critical" || f.severity === "high") && !before.has(findingId(f)));
  if (fresh.length && previous) await alertNew(serverId, scanId, report, fresh);
  return report;
}

export async function failScan(serverId: string, scanId: number, error: string): Promise<void> {
  await db.run("UPDATE audit_scans SET status = 'failed', error = ?, inventory_json = NULL, finished_at = ? WHERE server_id = ? AND id = ? AND status IN ('pending', 'collecting')", [
    error.slice(0, 300), iso(), serverId, scanId
  ]);
}

/** Discord alert (the anticheat's webhook) when a scan finds critical / high problems the previous one did not have. */
async function alertNew(serverId: string, scanId: number, report: Report, fresh: Finding[]): Promise<void> {
  if (!(await getAuditSettings(serverId)).alert) return;
  const { anticheat } = await getSecuritySettings(serverId);
  if (!anticheat.alerts.webhookUrl) return;
  const server = await getServer(serverId);
  const url = `${(process.env.APP_URL || "").replace(/\/+$/, "")}/s/${serverId}/scanner?scan=${scanId}`;
  const lines = fresh.slice(0, 10).map((f) => `**${SEVERITY_LABEL[f.severity]}** · ${f.title}${f.resource ? ` — \`${f.resource}${f.file ? `/${f.file}` : ""}\`` : ""}`);
  try {
    await fetch(anticheat.alerts.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Fiverax Scanner",
        allowed_mentions: { parse: [] },
        embeds: [{
          title: `🔎 ${fresh.length} nouveau(x) problème(s) grave(s)`,
          url: process.env.APP_URL ? url : undefined,
          color: fresh.some((f) => f.severity === "critical") ? 0xfb7185 : 0xf59e3b,
          description: [...lines, fresh.length > 10 ? `… et ${fresh.length - 10} autre(s)` : "", `Score : **${report.score}/100**`].filter(Boolean).join("\n").slice(0, 3500),
          footer: { text: server?.name ?? serverId },
          timestamp: iso()
        }]
      }),
      signal: AbortSignal.timeout(5000)
    });
  } catch { /* a down webhook must not fail the scan */ }
}

// ---- AI ----

const EXPLAIN_PROMPT = `Tu es un expert en sécurité et en performance des serveurs FiveM (Lua, JavaScript, server.cfg).
Un analyseur automatique a signalé un problème. Tu reçois la règle, le fichier et un extrait de 3 lignes (seulement).
Juge si c'est un vrai problème, explique-le simplement à un admin de serveur RP, et propose un correctif concret.
Réponds UNIQUEMENT par un objet JSON :
{"verdict":"confirmed|false_positive|uncertain","explanation":"2 à 4 phrases claires en français","fix":"code corrigé prêt à copier ou étapes précises, ou null"}
- false_positive seulement si l'extrait montre clairement que le code est sûr.
- uncertain si 3 lignes ne suffisent pas pour trancher (dis ce qu'il faut vérifier).`;

/** Pure: read the model's verdict. */
export function parseExplanation(text: string): AIReview | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    const d = JSON.parse(m[0]) as Record<string, unknown>;
    const verdict = String(d.verdict ?? "").toLowerCase();
    if (!["confirmed", "false_positive", "uncertain"].includes(verdict) || typeof d.explanation !== "string") return null;
    return { verdict: verdict as AIReview["verdict"], explanation: d.explanation.trim().slice(0, 1500), fix: typeof d.fix === "string" && d.fix.trim() ? d.fix.trim().slice(0, 4000) : null };
  } catch {
    return null;
  }
}

/** Ask the AI about one finding of a report (only its 3 lines are sent); the answer is kept in the report. */
export async function explainFinding(serverId: string, scanId: number, index: number, actorId: string | null = null): Promise<AIReview> {
  if (!aiConfigured()) throw new AuditError("ai_not_configured");
  const scan = await getScan(serverId, scanId);
  const finding = scan?.report?.findings[index];
  if (!scan?.report || !finding) throw new AuditError("unknown_finding");
  const user = [
    `Règle : ${finding.title} (${SEVERITY_LABEL[finding.severity]})`,
    `Détail : ${finding.detail}`,
    finding.resource ? `Ressource : ${finding.resource}` : "",
    finding.file ? `Fichier : ${finding.file}${finding.line ? `, ligne ${finding.line}` : ""}` : "",
    finding.snippet ? `Extrait :\n${finding.snippet}` : "Pas d'extrait (problème de configuration ou d'organisation).",
    `Correctif générique : ${finding.fix}`
  ].filter(Boolean).join("\n");
  let review: AIReview | null;
  try {
    review = parseExplanation(await chatJson(EXPLAIN_PROMPT, user, { quota: { serverId, userId: actorId, kind: "explain" }, maxTokens: 1500, temperature: 0.2, timeoutMs: 50_000 }));
  } catch (error) {
    throw new AuditError(error instanceof Error ? error.message : "ai_error");
  }
  if (!review) throw new AuditError("ai_unreadable");
  scan.report.findings[index] = { ...finding, ai: review };
  await db.run("UPDATE audit_scans SET report_json = ? WHERE server_id = ? AND id = ?", [JSON.stringify(scan.report), serverId, scanId]);
  return review;
}
