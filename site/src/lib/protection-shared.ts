import { RULES, type Finding, type Severity } from "./audit-rules";

/**
 * "Protégé par Fiverax": what the pages, the badge and the server share (no server imports here).
 *
 * A server earns a level from what Fiverax can verify itself (never from what the owner declares):
 *   Protégé    → agent connected this week, full scan of less than 30 days with no critical problem, anticheat on.
 *   Renforcé   → + score ≥ 80, no high problem, Discord anti-raid on, anticheat alerts sent to Discord.
 *   Forteresse → + score ≥ 92, continuous scan, a scan this week, member of the shared bans.
 * Each level needs every check of the levels below it.
 */

export const LEVELS = [
  { key: "none", label: "Non vérifié", short: "—", color: "#9b907b" },
  { key: "protected", label: "Protégé", short: "Protégé", color: "#4ade80" },
  { key: "reinforced", label: "Renforcé", short: "Renforcé", color: "#d4b06a" },
  { key: "fortress", label: "Forteresse", short: "Forteresse", color: "#f2ecdf" }
] as const;
export type LevelKey = (typeof LEVELS)[number]["key"];
export const levelOf = (key: LevelKey) => LEVELS.find((l) => l.key === key)!;
export const levelRank = (key: LevelKey) => LEVELS.findIndex((l) => l.key === key);

export type ProtectionInput = {
  agentSeenAt: string | null;
  lastScan: { at: string; score: number; critical: number; high: number } | null;
  continuous: boolean;
  anticheatEnabled: boolean;
  alertsWebhook: boolean;
  guildLinked: boolean;
  antiraidEnabled: boolean;
  network: boolean;
};

/** Panel page (under /s/<id>/) that fixes a check. */
export type FixPage = "server" | "settings" | "scanner" | "anticheat" | "antiraid" | "network";

export type ProtectionCheck = {
  key: string;
  level: Exclude<LevelKey, "none">;
  label: string;
  done: boolean;
  /** Why it is not done yet, and how to do it. */
  hint: string;
  page: FixPage;
  /** Shown on the public page when done (what visitors may know). */
  publicLabel: string;
};

const DAY = 86_400_000;

/** Pure: every check, done or not. */
export function protectionChecks(i: ProtectionInput, now = new Date()): ProtectionCheck[] {
  const age = (at: string | null | undefined) => (at ? now.getTime() - new Date(at).getTime() : Infinity);
  const scan = i.lastScan;
  const scanAge = age(scan?.at);
  return [
    {
      key: "agent", level: "protected", label: "Agent FiveM connecté cette semaine", done: age(i.agentSeenAt) < 7 * DAY, page: "settings",
      hint: "Installe la ressource fiverax_agent (Configuration > FiveM) : sans elle, rien ne peut être vérifié en jeu.",
      publicLabel: "Serveur FiveM relié et surveillé"
    },
    {
      key: "scan_recent", level: "protected", label: "Scan complet de moins de 30 jours", done: scanAge < 30 * DAY, page: "scanner",
      hint: scan ? "Le dernier scan date de plus de 30 jours : relance-le." : "Lance ton premier scan : il analyse le code de toutes tes ressources.",
      publicLabel: "Code des ressources analysé"
    },
    {
      key: "no_critical", level: "protected", label: "Aucun problème critique", done: Boolean(scan && scanAge < 30 * DAY && scan.critical === 0), page: "scanner",
      hint: scan?.critical ? `${scan.critical} problème${scan.critical > 1 ? "s" : ""} critique${scan.critical > 1 ? "s" : ""} (backdoor, ScriptHook, permission ouverte…) : corrige-les puis relance un scan.` : "Lance un scan pour le vérifier.",
      publicLabel: "Aucune faille critique (backdoor, permission ouverte)"
    },
    {
      key: "anticheat", level: "protected", label: "Anticheat activé", done: i.anticheatEnabled, page: "anticheat",
      hint: "Active l'anticheat (Sécurité > Anticheat).",
      publicLabel: "Anticheat actif"
    },
    {
      key: "score80", level: "reinforced", label: "Score de sécurité ≥ 80", done: Boolean(scan && scanAge < 30 * DAY && scan.score >= 80), page: "scanner",
      hint: scan ? `Score actuel ${scan.score}/100 : corrige les problèmes hauts et moyens du scanner.` : "Lance un scan.",
      publicLabel: "Score de sécurité élevé"
    },
    {
      key: "no_high", level: "reinforced", label: "Aucun problème de gravité haute", done: Boolean(scan && scanAge < 30 * DAY && scan.critical === 0 && scan.high === 0), page: "scanner",
      hint: scan?.high ? `${scan.high} problème${scan.high > 1 ? "s" : ""} haut${scan.high > 1 ? "s" : ""} (événements exploitables, webhooks exposés, injections SQL…).` : "Lance un scan.",
      publicLabel: "Aucun événement exploitable connu"
    },
    {
      key: "antiraid", level: "reinforced", label: "Anti-raid Discord activé", done: i.guildLinked && i.antiraidEnabled, page: "antiraid",
      hint: i.guildLinked ? "Active l'anti-raid (Sécurité > Anti-raid Discord) : il annule un nuke et sanctionne son auteur." : "Relie ton serveur Discord (Configuration), puis active l'anti-raid.",
      publicLabel: "Discord protégé contre les raids"
    },
    {
      key: "alerts", level: "reinforced", label: "Alertes de sécurité envoyées sur Discord", done: i.alertsWebhook, page: "anticheat",
      hint: "Renseigne un webhook d'alertes (Sécurité > Anticheat > Alertes) : ton staff est prévenu à chaque détection.",
      publicLabel: "Staff alerté en temps réel"
    },
    {
      key: "score92", level: "fortress", label: "Score de sécurité ≥ 92", done: Boolean(scan && scanAge < 30 * DAY && scan.score >= 92), page: "scanner",
      hint: scan ? `Score actuel ${scan.score}/100 : il reste quelques problèmes moyens à corriger.` : "Lance un scan.",
      publicLabel: "Score de sécurité excellent"
    },
    {
      key: "continuous", level: "fortress", label: "Scan continu activé", done: i.continuous, page: "scanner",
      hint: "Coche « Scan continu » dans le Scanner : chaque ressource démarrée est analysée.",
      publicLabel: "Chaque nouvelle ressource est analysée"
    },
    {
      key: "scan_week", level: "fortress", label: "Scan de moins de 7 jours", done: scanAge < 7 * DAY, page: "scanner",
      hint: "Relance un scan (ou active le scan continu, qui en refait deux par jour).",
      publicLabel: "Vérifié cette semaine"
    },
    {
      key: "network", level: "fortress", label: "Membre des bans partagés", done: i.network, page: "network",
      hint: "Rejoins les bans partagés (Réseau Fiverax) : un cheater banni ailleurs est repéré à sa connexion.",
      publicLabel: "Cheaters connus du réseau bloqués"
    }
  ];
}

/** Pure: the highest level whose checks (and those of every level below) are all done. */
export function protectionLevel(checks: ProtectionCheck[]): LevelKey {
  let level: LevelKey = "none";
  for (const l of LEVELS.slice(1)) {
    if (checks.filter((c) => levelRank(c.level) <= levelRank(l.key)).every((c) => c.done)) level = l.key;
    else break;
  }
  return level;
}

/** Pure: the next level and what is still missing for it. */
export function nextStep(checks: ProtectionCheck[]): { level: LevelKey; missing: ProtectionCheck[] } | null {
  const current = protectionLevel(checks);
  const next = LEVELS[levelRank(current) + 1];
  if (!next) return null;
  return { level: next.key, missing: checks.filter((c) => !c.done && levelRank(c.level) <= levelRank(next.key)) };
}

// ---- kit: resources Fiverax hands to the server ----

export type KitKey = "fvx_event_guard" | "fvx_webhooks" | "fvx_join_guard";

export const KIT: { key: KitKey; title: string; text: string; rules: string[]; usage: string }[] = [
  {
    key: "fvx_event_guard",
    title: "Garde des événements serveur",
    text: "Une fonction à appeler au début de tes événements : délai anti-spam par joueur, nombre d'appels par minute, distance au point et montant valide. Corrige les événements « exploitables » du scanner sans réécrire tes scripts.",
    rules: ["trusted_event", "unchecked_reward", "client_trust"],
    usage: "if not exports.fvx_event_guard:check(source, 'shop:buy', { cooldown = 1000, coords = vector3(25.7, -1347.3, 29.5), maxDistance = 10.0, amount = count, max = 50 }) then return end"
  },
  {
    key: "fvx_webhooks",
    title: "Relais de webhooks Discord",
    text: "Les URL de webhooks rangées dans server.cfg, jamais envoyées aux joueurs. Tes scripts serveur appellent exports.fvx_webhooks:send, et les scripts client passent par un relais limité (salons autorisés, anti-spam, pas de mentions).",
    rules: ["exposed_webhook", "server_webhook", "exposed_secret"],
    usage: "exports.fvx_webhooks:send('logs', { content = 'Achat : ' .. item })   -- côté serveur\nTriggerServerEvent('fvx_webhooks:client', 'reports', message)       -- côté client"
  },
  {
    key: "fvx_join_guard",
    title: "Anti-flood de connexion",
    text: "Limite les tentatives de connexion par adresse et par seconde (bots, attaques de file d'attente) et refuse les pseudos contenant du HTML, qui servent à injecter du code dans le chat et les menus NUI.",
    rules: ["no_anticheat", "public_endpoints"],
    usage: "set fvx_join_per_ip_minute 6\nset fvx_join_burst_10s 40"
  }
];

/** Pure: kit resources recommended by a report's findings (each with the problems it answers). */
export function recommendKit(findings: Pick<Finding, "rule">[]): { key: KitKey; count: number }[] {
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(f.rule, (counts.get(f.rule) ?? 0) + 1);
  return KIT.map((k) => ({ key: k.key, count: k.rules.reduce((n, r) => n + (counts.get(r) ?? 0), 0) })).filter((k) => k.count > 0 || k.key === "fvx_join_guard");
}

// ---- server.cfg ----

/** Pure: the server.cfg lines that answer the configuration findings (or every recommended line without findings). */
export function hardeningCfg(rules: Iterable<string> | null): string {
  const has = rules ? new Set(rules) : null;
  const want = (rule: string) => !has || has.has(rule);
  const lines = ["# --- Fiverax : durcissement du serveur ---"];
  if (want("scripthook")) lines.push("sv_scriptHookAllowed 0                # pas de ScriptHook (menus de triche)");
  if (want("endpoint_privacy") || want("public_endpoints")) lines.push("sv_endpointprivacy true               # IP des joueurs cachées");
  if (want("pure_level")) lines.push("sv_pureLevel 1                        # fichiers du jeu modifiés refusés");
  if (want("game_build")) lines.push("set sv_enforceGameBuild 3258          # même contenu (DLC) pour tout le monde");
  if (want("no_onesync")) lines.push("set onesync on                        # le serveur voit les entités (requis par l'anticheat)");
  if (want("rcon")) lines.push("# retire la ligne rcon_password : txAdmin et la console du panel la remplacent");
  if (!has || has.has("public_endpoints") || has.has("no_anticheat")) {
    lines.push("", "# Kit Fiverax (anti-flood de connexion)", "ensure fvx_join_guard");
  }
  if (lines.length === 1) lines.push("# Rien à ajouter : ta configuration publique est déjà propre.");
  return lines.join("\n");
}

// ---- action plan ----

export type PlanStep = {
  title: string;
  why: string;
  how: string;
  impact: "high" | "medium" | "low";
  effort: string;
  page: FixPage | null;
  kit: KitKey | null;
};
export type ProtectionPlan = { summary: string; steps: PlanStep[]; source: "rules" | "ai"; createdAt: string };

const IMPACT: Record<Severity, PlanStep["impact"]> = { critical: "high", high: "high", medium: "medium", info: "low" };
const SEV_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, info: 3 };

/**
 * Pure: the plan built from the rules, always available (the AI only rewrites and reorders it).
 * Problems first (most severe, most frequent), then the missing checks of the next level.
 */
export function rulesPlan(findings: Finding[], checks: ProtectionCheck[], now = new Date()): ProtectionPlan {
  const groups = new Map<string, { f: Finding; n: number; resources: Set<string> }>();
  for (const f of findings) {
    if (f.severity === "info") continue;
    const g = groups.get(f.rule) ?? { f, n: 0, resources: new Set<string>() };
    g.n++;
    if (f.resource) g.resources.add(f.resource);
    groups.set(f.rule, g);
  }
  const kitFor = (rule: string) => KIT.find((k) => k.rules.includes(rule))?.key ?? null;
  const steps: PlanStep[] = [...groups.values()]
    .sort((a, b) => SEV_ORDER[a.f.severity] - SEV_ORDER[b.f.severity] || b.n - a.n)
    .slice(0, 6)
    .map(({ f, n, resources }) => ({
      title: `${RULES[f.rule]?.title ?? f.title}${n > 1 ? ` (${n})` : ""}`,
      why: resources.size ? `Dans ${[...resources].slice(0, 4).join(", ")}${resources.size > 4 ? ` et ${resources.size - 4} autre(s)` : ""}.` : f.detail || "Signalé par le scanner.",
      how: f.fix,
      impact: IMPACT[f.severity],
      effort: f.severity === "critical" ? "Tout de suite" : f.category === "config" ? "5 min" : "30 min",
      page: f.category === "config" && !kitFor(f.rule) ? null : "scanner",
      kit: kitFor(f.rule)
    }));
  for (const c of checks) {
    // Score checks are already answered by the problems listed above.
    const scoreCheck = ["no_critical", "no_high", "score80", "score92"].includes(c.key);
    if (c.done || steps.length >= 9 || (scoreCheck && groups.size > 0)) continue;
    steps.push({ title: c.label, why: `Requis pour le niveau ${levelOf(c.level).label}.`, how: c.hint, impact: c.level === "protected" ? "high" : c.level === "reinforced" ? "medium" : "low", effort: "5 min", page: c.page, kit: null });
  }
  const crit = findings.filter((f) => f.severity === "critical").length;
  const summary = crit
    ? `${crit} problème${crit > 1 ? "s" : ""} critique${crit > 1 ? "s" : ""} à corriger en priorité : tant qu'il en reste, ton serveur ne peut pas être « Protégé ».`
    : steps.length
      ? `${steps.length} action${steps.length > 1 ? "s" : ""} pour monter de niveau, de la plus importante à la plus simple.`
      : "Rien à faire : ton serveur coche toutes les cases.";
  return { summary, steps, source: "rules", createdAt: now.toISOString() };
}

/** Pure: read the AI's plan; unknown pages and kit resources are dropped, at most 9 steps. */
export function parsePlan(text: string, now = new Date()): ProtectionPlan | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    const d = JSON.parse(m[0]) as { summary?: unknown; steps?: unknown };
    if (typeof d.summary !== "string" || !Array.isArray(d.steps)) return null;
    const pages: FixPage[] = ["server", "settings", "scanner", "anticheat", "antiraid", "network"];
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    const steps = d.steps
      .map((s: Record<string, unknown>) => ({
        title: str(s.title, 140),
        why: str(s.why, 500),
        how: str(s.how, 1500),
        impact: (["high", "medium", "low"].includes(String(s.impact)) ? s.impact : "medium") as PlanStep["impact"],
        effort: str(s.effort, 30) || "—",
        page: pages.includes(s.page as FixPage) ? (s.page as FixPage) : null,
        kit: KIT.some((k) => k.key === s.kit) ? (s.kit as KitKey) : null
      }))
      .filter((s) => s.title && s.how)
      .slice(0, 9);
    if (!steps.length) return null;
    return { summary: d.summary.trim().slice(0, 600), steps, source: "ai", createdAt: now.toISOString() };
  } catch {
    return null;
  }
}

// ---- badge ----

export const PUBLIC_ID_RE = /^[a-z0-9][a-z0-9-]{2,46}[a-z0-9]$/;

/** Pure: what to paste on a website, a forum, a README or Discord. */
export function embedCodes(appUrl: string, publicId: string): { key: string; label: string; code: string }[] {
  const base = appUrl.replace(/\/+$/, "");
  const page = `${base}/protection/${publicId}`;
  const img = `${base}/badge/${publicId}`;
  return [
    { key: "html", label: "Site web (HTML)", code: `<a href="${page}" target="_blank" rel="noopener"><img src="${img}.svg" alt="Protégé par Fiverax" width="244" height="56"></a>` },
    { key: "flat", label: "Petit badge (HTML)", code: `<a href="${page}" target="_blank" rel="noopener"><img src="${img}.svg?style=flat" alt="Protégé par Fiverax" height="20"></a>` },
    { key: "md", label: "Markdown (GitHub, Tebex)", code: `[![Protégé par Fiverax](${img}.svg)](${page})` },
    { key: "bbcode", label: "Forum (BBCode)", code: `[url=${page}][img]${img}.svg[/img][/url]` },
    { key: "link", label: "Lien (Discord)", code: `🛡️ Serveur vérifié par Fiverax : ${page}` }
  ];
}
