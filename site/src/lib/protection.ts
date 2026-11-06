import { randomBytes } from "node:crypto";
import { aiConfigured, chatJson } from "./ai";
import { auditStmt } from "./audit";
import { SEVERITY_LABEL, type Finding } from "./audit-rules";
import { db, stmt } from "./db";
import { getMembership } from "./network";
import {
  KIT, levelOf, nextStep, parsePlan, protectionChecks, protectionLevel, PUBLIC_ID_RE, rulesPlan,
  type KitKey, type LevelKey, type ProtectionCheck, type ProtectionInput, type ProtectionPlan
} from "./protection-shared";
import { KIT_FILES } from "./protection-kit";
import { getSecuritySettings } from "./security";
import { getAuditSettings, latestReport } from "./server-audit";
import { getServer, slugify, type Server } from "./servers";
import { createCreation, saveCreation } from "./studio";

/**
 * "Protégé par Fiverax": the level a server earns from what Fiverax verifies (lib/protection-shared), its public badge
 * (opt-in, off until an owner turns it on), the action plan (rules, rewritten by the AI on demand) and the protection
 * kit installed in the server's Studio.
 *
 * The public page and the badge only say what is achieved (level, score, protections in place, date of the last
 * check): never the problems, the resources or anything an attacker could use.
 */

export class ProtectionError extends Error {}
type Actor = { discordId: string; username?: string | null };
const iso = (d = new Date()) => d.toISOString();

export type Badge = { publicId: string; enabled: boolean; views: number };

/** The server's badge row, created (off) the first time it is asked for. */
export async function ensureBadge(server: Pick<Server, "id" | "name">, now = new Date()): Promise<Badge> {
  const row = await db.get<{ public_id: string; enabled: number; views: number }>("SELECT public_id, enabled, views FROM protection_badges WHERE server_id = ?", [server.id]);
  if (row) return { publicId: row.public_id, enabled: Boolean(row.enabled), views: Number(row.views) };
  for (let attempt = 0; attempt < 4; attempt++) {
    const base = slugify(server.name).slice(0, 30).replace(/-+$/, "") || "serveur";
    const publicId = `${base}-${randomBytes(2).toString("hex")}`;
    if (!PUBLIC_ID_RE.test(publicId)) continue;
    const { changes } = await db.run(
      "INSERT OR IGNORE INTO protection_badges (server_id, public_id, enabled, created_at, updated_at) VALUES (?, ?, 0, ?, ?)",
      [server.id, publicId, iso(now), iso(now)]
    );
    if (changes) return { publicId, enabled: false, views: 0 };
    const again = await db.get<{ public_id: string; enabled: number; views: number }>("SELECT public_id, enabled, views FROM protection_badges WHERE server_id = ?", [server.id]);
    if (again) return { publicId: again.public_id, enabled: Boolean(again.enabled), views: Number(again.views) };
  }
  throw new ProtectionError("badge_id");
}

export async function setBadgeEnabled(server: Pick<Server, "id" | "name">, actor: Actor, enabled: boolean, now = new Date()): Promise<Badge> {
  const badge = await ensureBadge(server, now);
  levelCache.delete(server.id);
  await db.batch([
    stmt("UPDATE protection_badges SET enabled = ?, updated_at = ? WHERE server_id = ?", [enabled ? 1 : 0, iso(now), server.id]),
    auditStmt(server.id, actor, enabled ? "badge_enable" : "badge_disable", null, { publicId: badge.publicId })
  ]);
  return { ...badge, enabled };
}

// ---- status ----

export type ProtectionStatus = {
  level: LevelKey;
  checks: ProtectionCheck[];
  next: ReturnType<typeof nextStep>;
  score: number | null;
  lastScanAt: string | null;
  scanId: number | null;
  findings: Finding[];
};

/** What Fiverax verifies about a server right now. */
export async function protectionStatus(serverId: string, now = new Date()): Promise<ProtectionStatus> {
  const [server, agent, scan, audit, security, network] = await Promise.all([
    getServer(serverId),
    db.get<{ seen_at: string }>("SELECT seen_at FROM fivem_state WHERE server_id = ?", [serverId]),
    latestReport(serverId),
    getAuditSettings(serverId),
    getSecuritySettings(serverId),
    getMembership(serverId)
  ]);
  const input: ProtectionInput = {
    agentSeenAt: agent?.seen_at ?? null,
    lastScan: scan?.report && scan.score !== null ? { at: scan.createdAt, score: scan.score, critical: scan.counts.critical, high: scan.counts.high } : null,
    continuous: audit.continuous,
    anticheatEnabled: security.anticheat.enabled,
    alertsWebhook: Boolean(security.anticheat.alerts?.webhookUrl),
    guildLinked: Boolean(server?.guildId),
    antiraidEnabled: security.antiraid.enabled,
    network: Boolean(network)
  };
  const checks = protectionChecks(input, now);
  return {
    level: protectionLevel(checks),
    checks,
    next: nextStep(checks),
    score: input.lastScan?.score ?? null,
    lastScanAt: input.lastScan?.at ?? null,
    scanId: scan?.id ?? null,
    findings: scan?.report?.findings ?? []
  };
}

/** Levels already computed for the directory, per instance (a level changes with scans and settings, not per second). */
const levelCache = new Map<string, { level: LevelKey; at: number }>();
const LEVEL_CACHE_MS = 5 * 60_000;

/** Levels of several servers at once (directory cards): only the servers whose badge is on. */
export async function publicLevels(serverIds: string[], now = new Date()): Promise<Map<string, LevelKey>> {
  const out = new Map<string, LevelKey>();
  if (!serverIds.length) return out;
  const rows = await db.all<{ server_id: string }>(
    `SELECT server_id FROM protection_badges WHERE enabled = 1 AND server_id IN (${serverIds.map(() => "?").join(", ")})`,
    serverIds
  );
  await Promise.all(rows.map(async (r) => {
    const hit = levelCache.get(r.server_id);
    const fresh = hit && Math.abs(now.getTime() - hit.at) < LEVEL_CACHE_MS;
    const level = fresh ? hit.level : (await protectionStatus(r.server_id, now)).level;
    if (!fresh) levelCache.set(r.server_id, { level, at: now.getTime() });
    if (level !== "none") out.set(r.server_id, level);
  }));
  return out;
}

export type PublicProtection = {
  serverId: string;
  name: string;
  iconUrl: string | null;
  publicId: string;
  level: LevelKey;
  score: number | null;
  lastScanAt: string | null;
  protections: string[];
  listingSlug: string | null;
};

/** The public face of a badge (null when unknown or turned off). */
export async function publicProtection(publicId: string, opts: { countView?: boolean } = {}, now = new Date()): Promise<PublicProtection | null> {
  if (!PUBLIC_ID_RE.test(publicId)) return null;
  const row = await db.get<{ server_id: string; enabled: number }>("SELECT server_id, enabled FROM protection_badges WHERE public_id = ?", [publicId]);
  if (!row?.enabled) return null;
  const server = await getServer(row.server_id);
  if (!server) return null;
  const [status, listing] = await Promise.all([
    protectionStatus(server.id, now),
    db.get<{ slug: string; data_json: string }>("SELECT slug, data_json FROM directory_listings WHERE server_id = ? AND published = 1", [server.id])
  ]);
  if (opts.countView) await db.run("UPDATE protection_badges SET views = views + 1 WHERE server_id = ?", [server.id]);
  let listedName: string | undefined;
  try {
    listedName = listing ? (JSON.parse(listing.data_json) as { name?: string }).name : undefined;
  } catch { /* corrupt listing: the server's name */ }
  return {
    serverId: server.id,
    name: listedName || server.name,
    iconUrl: server.iconUrl?.startsWith("https://") ? server.iconUrl : null,
    publicId,
    level: status.level,
    score: status.level === "none" ? null : status.score,
    lastScanAt: status.lastScanAt,
    protections: status.checks.filter((c) => c.done).map((c) => c.publicLabel),
    listingSlug: listing?.slug ?? null
  };
}

/** The public badge of a server, by its id (directory listing). Null when off. */
export async function publicProtectionOf(serverId: string, now = new Date()): Promise<PublicProtection | null> {
  const row = await db.get<{ public_id: string }>("SELECT public_id FROM protection_badges WHERE server_id = ? AND enabled = 1", [serverId]);
  return row ? publicProtection(row.public_id, {}, now) : null;
}

// ---- action plan ----

const PLAN_PROMPT = `Tu es un expert en sécurité des serveurs FiveM qui conseille le propriétaire d'un serveur RP (pas forcément développeur).
Tu reçois : son niveau de protection Fiverax, les vérifications qui manquent, les problèmes trouvés par le scanner (règle, gravité, nombre, ressources) et les ressources du kit Fiverax disponibles.
Écris son plan d'action, du plus important au plus simple : d'abord ce qui peut faire pirater le serveur (backdoors, permissions, événements qui donnent de l'argent), puis ce qui fait monter de niveau.
Réponds UNIQUEMENT par un objet JSON :
{"summary":"2 phrases en français, directes, tutoiement","steps":[{"title":"action courte","why":"pourquoi, avec les ressources concernées","how":"étapes concrètes (lignes server.cfg, code Lua court si utile)","impact":"high|medium|low","effort":"5 min|30 min|1 h|plus","page":"scanner|anticheat|antiraid|network|settings|server|null","kit":"fvx_event_guard|fvx_webhooks|fvx_join_guard|null"}]}
- 3 à 8 étapes, jamais d'invention : n'utilise que les problèmes et vérifications reçus.
- "kit" seulement si la ressource du kit répond vraiment au problème. "page" : la page du panel où le faire.`;

export async function getPlan(serverId: string): Promise<ProtectionPlan | null> {
  const [row, status] = await Promise.all([
    db.get<{ scan_id: number | null; plan_json: string }>("SELECT scan_id, plan_json FROM protection_plans WHERE server_id = ?", [serverId]),
    db.get<{ id: number }>("SELECT id FROM audit_scans WHERE server_id = ? AND status = 'done' ORDER BY id DESC LIMIT 1", [serverId])
  ]);
  if (!row || (row.scan_id ?? null) !== (status?.id ?? null)) return null; // a newer scan: the plan is outdated
  try {
    return JSON.parse(row.plan_json) as ProtectionPlan;
  } catch {
    return null;
  }
}

/** The AI's plan for the latest scan (kept until the next scan). Only rule names, counts and resource names are sent. */
export async function generatePlan(serverId: string, actor: Actor, now = new Date()): Promise<ProtectionPlan> {
  if (!aiConfigured()) throw new ProtectionError("ai_not_configured");
  const status = await protectionStatus(serverId, now);
  const groups = new Map<string, { title: string; severity: string; n: number; resources: Set<string> }>();
  for (const f of status.findings) {
    if (f.severity === "info") continue;
    const g = groups.get(f.rule) ?? { title: f.title, severity: SEVERITY_LABEL[f.severity], n: 0, resources: new Set<string>() };
    g.n++;
    if (f.resource) g.resources.add(f.resource);
    groups.set(f.rule, g);
  }
  const user = [
    `Niveau actuel : ${levelOf(status.level).label}. Score du dernier scan : ${status.score ?? "aucun scan"}.`,
    `Vérifications manquantes :\n${status.checks.filter((c) => !c.done).map((c) => `- [${levelOf(c.level).label}] ${c.label} : ${c.hint}`).join("\n") || "- aucune"}`,
    `Problèmes du scanner :\n${[...groups.entries()].slice(0, 25).map(([rule, g]) => `- ${g.title} (${rule}, ${g.severity}, ${g.n} fois${g.resources.size ? `, ressources : ${[...g.resources].slice(0, 6).join(", ")}` : ""})`).join("\n") || "- aucun"}`,
    `Kit Fiverax :\n${KIT.map((k) => `- ${k.key} : ${k.title}. ${k.text}`).join("\n")}`
  ].join("\n\n");
  let plan: ProtectionPlan | null;
  try {
    plan = parsePlan(await chatJson(PLAN_PROMPT, user, { maxTokens: 2500, temperature: 0.25, timeoutMs: 55_000 }), now);
  } catch (error) {
    throw new ProtectionError(error instanceof Error ? error.message : "ai_error");
  }
  if (!plan) throw new ProtectionError("ai_unreadable");
  await db.batch([
    stmt(
      `INSERT INTO protection_plans (server_id, scan_id, plan_json, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (server_id) DO UPDATE SET scan_id = excluded.scan_id, plan_json = excluded.plan_json, created_at = excluded.created_at`,
      [serverId, status.scanId, JSON.stringify(plan), iso(now)]
    ),
    auditStmt(serverId, actor, "protection_plan", null, { steps: plan.steps.length })
  ]);
  return plan;
}

/** The plan to show: the AI's one for the latest scan, else the rules' one. */
export async function currentPlan(serverId: string, status?: ProtectionStatus): Promise<ProtectionPlan> {
  const saved = await getPlan(serverId);
  if (saved) return saved;
  const s = status ?? (await protectionStatus(serverId));
  return rulesPlan(s.findings, s.checks);
}

// ---- kit ----

/** Copy a kit resource into the server's Studio (or update the copy already there). Answers the creation id. */
export async function installKit(serverId: string, actor: Actor, key: KitKey): Promise<{ creationId: number; created: boolean }> {
  const kit = KIT_FILES[key];
  if (!kit) throw new ProtectionError("unknown_kit");
  const existing = await db.get<{ id: number }>("SELECT id FROM studio_creations WHERE server_id = ? AND resource = ?", [serverId, key]);
  const id = existing ? Number(existing.id) : await createCreation(serverId, actor, { kind: "script", name: kit.name, resource: key, framework: "standalone" });
  await saveCreation(serverId, actor, id, { files: kit.files, data: { mode: "code" } }, { source: "library", summary: existing ? "Kit Fiverax mis à jour" : "Kit de protection Fiverax" });
  return { creationId: id, created: !existing };
}
