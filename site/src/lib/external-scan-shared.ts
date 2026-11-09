import { RULES, score, type Artifacts, type Category, type CategoryScore, type Finding, type Severity } from "./audit-rules";

/**
 * Free public scan (/scan): what any visitor learns about a FiveM server from its public endpoints only
 * (info.json, players.json, or the Cfx.re server list for a cfx.re/join code). No code, no agent, no account.
 *
 * Pure (no DB, no network): the target parsing, the address checks used against SSRF, and the analysis. The fetching
 * lives in lib/external-scan.ts. Player data is only counted, never kept: names, IPs and identifiers are dropped.
 */

export type ScanTarget = { kind: "cfx"; code: string } | { kind: "host"; host: string; port: number };

export const DEFAULT_PORT = 30120;

/** Pure: a cfx.re/join link (or its code), or an address (ip, ip:port, host:port). Null when unusable. */
export function parseTarget(raw: string): ScanTarget | null {
  const s = raw.trim().replace(/^(?:connect\s+|fivem:\/\/connect\/)/i, "").replace(/\/+$/, "");
  if (!s || s.length > 200) return null;
  const cfx = /^(?:(?:https?:\/\/)?(?:www\.)?cfx\.re\/join\/)?([a-z0-9]{4,8})$/i.exec(s);
  if (cfx && (s.includes("cfx.re") || !/^\d+$/.test(cfx[1]))) return { kind: "cfx", code: cfx[1].toLowerCase() };
  const bare = s.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  const v6 = /^\[([0-9a-f:]{2,39})\](?::(\d{2,5}))?$/i.exec(bare);
  const other = v6 ? null : /^([a-z0-9.-]{3,253})(?::(\d{2,5}))?$/i.exec(bare);
  const m = v6 ?? other;
  if (!m) return null;
  const host = m[1].toLowerCase();
  if (!v6 && (!host.includes(".") || host.startsWith(".") || host.endsWith(".") || host.includes(".."))) return null;
  const port = m[2] ? Number(m[2]) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
  return { kind: "host", host, port };
}

/**
 * Pure: the address ("ip:port") of a server from the official list's answer for its cfx.re code
 * ({ Data: { connectEndPoints: ["1.2.3.4:30120", …] } }). Proxy URLs and anything parseTarget refuses are skipped.
 */
export function endpointFromListing(json: unknown): string | null {
  const data = (json as { Data?: { connectEndPoints?: unknown } } | null)?.Data;
  const list = Array.isArray(data?.connectEndPoints) ? data.connectEndPoints : [];
  for (const e of list) {
    if (typeof e !== "string" || /^https?:\/\//i.test(e)) continue;
    const t = parseTarget(e);
    if (t?.kind === "host") return targetLabel(t);
  }
  return null;
}

/** Pure: the key two scans of the same server share (cache, history). */
export const targetKey = (t: ScanTarget) => (t.kind === "cfx" ? `cfx:${t.code}` : `${t.host}:${t.port}`);

/** Pure: how a target is shown back. */
export const targetLabel = (t: ScanTarget) => (t.kind === "cfx" ? `cfx.re/join/${t.code}` : t.host.includes(":") ? `[${t.host}]:${t.port}` : `${t.host}:${t.port}`);

function v4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const n = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return n.every((x) => x >= 0 && x <= 255) ? n : null;
}

/**
 * Pure: true only for a globally routable unicast address. Everything else (private, loopback, link-local, CGNAT,
 * documentation, multicast, reserved, IPv4-mapped IPv6) is refused: the panel must never be used to reach a network
 * that is not the public Internet (SSRF).
 */
export function isPublicIp(ip: string): boolean {
  const a = v4(ip);
  if (a) {
    const [x, y, z] = a;
    if (x === 0 || x === 10 || x === 127 || x >= 224) return false;
    if (x === 100 && y >= 64 && y <= 127) return false;
    if (x === 169 && y === 254) return false;
    if (x === 172 && y >= 16 && y <= 31) return false;
    if (x === 192 && y === 168) return false;
    if (x === 192 && y === 0 && (z === 0 || z === 2)) return false;
    if (x === 198 && (y === 18 || y === 19)) return false;
    if (x === 198 && y === 51 && z === 100) return false;
    if (x === 203 && y === 0 && z === 113) return false;
    return true;
  }
  const s = ip.toLowerCase();
  if (!/^[0-9a-f:]+$/.test(s) || !s.includes(":")) return false;
  const first = s.startsWith("::") ? 0 : parseInt(s.split(":")[0] || "0", 16);
  // Global unicast is 2000::/3; documentation 2001:db8::/32 and 6to4 / Teredo / NAT64 tunnels are refused.
  if (first < 0x2000 || first > 0x3fff) return false;
  if (/^2001:0?db8:/.test(s) || /^2002:/.test(s) || /^2001:0{0,4}:/.test(s) || /^64:ff9b:/.test(s)) return false;
  return true;
}

/** Pure: "1.2.3.4:5678", "[2a01::1]:30120" or a bare address → the address part. */
export function addressOf(endpoint: string): string {
  const e = endpoint.trim();
  const v6 = /^\[([^\]]+)\]/.exec(e);
  if (v6) return v6[1];
  return e.split(":").length === 2 ? e.split(":")[0] : e;
}

/** Pure: a server name without FiveM color codes (^1, ~r~) nor control characters. */
export function cleanServerName(raw: string | undefined | null): string {
  return (raw ?? "")
    .replace(/\^\d/g, "")
    .replace(/~[a-zA-Z]~/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

// ---- analysis ----

/** Bump when the analysis changes: older reports stay readable (their extra fields are optional). */
export const REPORT_VERSION = 2;

type ExtRule = { category: Category; severity: Severity; title: string; fix: string };

export const EXTERNAL_RULES: Record<string, ExtRule> = {
  scripthook: RULES.scripthook,
  critical_artifacts: RULES.critical_artifacts,
  old_artifacts: RULES.old_artifacts,
  game_build: RULES.game_build,
  old_mysql: RULES.old_mysql,
  public_endpoints: {
    category: "security", severity: "high", title: "Adresse IP des joueurs publique",
    fix: "Ajoute sv_endpointprivacy true dans server.cfg : aujourd'hui n'importe qui peut lire l'adresse IP de tes joueurs sur /players.json (attaques DDoS, doxxing)."
  },
  public_identifiers: {
    category: "security", severity: "medium", title: "Identifiants des joueurs publics (Discord, Steam…)",
    fix: "Retire set sv_exposePlayerIdentifiersInHttpEndpoint true de server.cfg (et mets à jour les artifacts) : /players.json donne l'identifiant Discord ou Steam de chaque joueur connecté, de quoi les retrouver, les harceler ou repérer ton staff."
  },
  pure_level: {
    category: "security", severity: "medium", title: "Fichiers du jeu modifiés autorisés (sv_pureLevel)",
    fix: "Ajoute sv_pureLevel 1 dans server.cfg : les joueurs ne peuvent plus charger d'archives du jeu modifiées (menus, textures et sons de triche). Le niveau 2 bloque aussi les mods graphiques."
  },
  no_onesync: {
    category: "config", severity: "medium", title: "OneSync désactivé",
    fix: "Ajoute set onesync on : sans OneSync, le serveur ne voit pas les entités des joueurs, donc aucun anticheat ne peut contrôler les objets, véhicules et explosions créés par un cheater."
  },
  onesync_legacy: {
    category: "config", severity: "medium", title: "OneSync Legacy (mode obsolète)",
    fix: "Remplace set onesync legacy par set onesync on : le mode Legacy n'est plus maintenu, il limite le nombre de joueurs et ce que le serveur (donc l'anticheat) voit des entités."
  },
  no_anticheat: {
    category: "security", severity: "medium", title: "Aucun anticheat visible",
    fix: "Aucune ressource d'anticheat connue dans la liste publique (certains se cachent sous un nom aléatoire). Fiverax en inclut un : événements piégés, entités, explosions, armes, godmode, noclip, téléportation, réglable depuis le panel."
  },
  exploitable_resources: {
    category: "security", severity: "high", title: "Ressources ciblées par les menus de triche",
    fix: "Ces anciennes ressources ESX / vRP ont des événements serveur que les menus de triche déclenchent en un clic (argent à l'infini, prison ou menottes pour tout le serveur). Remplace-les par une version maintenue, ou protège chaque événement au début du code (kit fvx_event_guard : distance, délai, montant). L'anticheat Fiverax les piège aussi."
  },
  leaked_resource: {
    category: "security", severity: "high", title: "Ressource au nom typique d'un leak",
    fix: "Les ressources « leak », « nulled » ou « cracked » sont le premier vecteur de backdoors (cipher-panel et compagnie) : supprime-la, récupère l'original chez son auteur, puis lance un scan complet pour chercher du code injecté dans tes autres ressources (les backdoors se recopient)."
  },
  dev_resource: {
    category: "security", severity: "medium", title: "Ressource d'exécution de code démarrée (runcode)",
    fix: "runcode exécute du Lua ou du JavaScript arbitraire sur le serveur et chez les joueurs : retire « ensure runcode » en production. Avec, un accès console ou RCON volé devient une prise de contrôle totale."
  },
  legacy_framework: {
    category: "security", severity: "high", title: "Framework abandonné (EssentialMode)",
    fix: "EssentialMode et es_admin2 ne sont plus maintenus depuis 2020 et ont des failles connues : migre vers ESX Legacy, QBCore ou Qbox."
  },
  framework_conflict: {
    category: "maintenance", severity: "medium", title: "Plusieurs frameworks démarrés en même temps",
    fix: "Deux frameworks (ESX, QBCore, Qbox, vRP…) qui tournent ensemble se disputent l'argent, les jobs et l'inventaire : bugs de duplication et événements exposés en double. Garde-en un seul (les bridges type qb-core → Qbox s'appellent par provide, pas en le démarrant)."
  },
  sql_conflict: {
    category: "maintenance", severity: "medium", title: "Plusieurs librairies SQL démarrées",
    fix: "oxmysql fournit déjà l'interface de mysql-async et ghmattimysql : garde seulement oxmysql, sinon chaque requête peut passer par une connexion différente (lenteurs, données incohérentes)."
  },
  many_resources: {
    category: "performance", severity: "info", title: "Beaucoup de ressources démarrées",
    fix: "Au-delà de 250 ressources, le temps de connexion et la mémoire des joueurs augmentent : regroupe les petites ressources et retire celles qui ne servent plus."
  },
  hidden_resources: {
    category: "maintenance", severity: "info", title: "Liste des ressources non publique",
    fix: "Le serveur ne publie pas ses ressources : le scan rapide ne peut vérifier ni l'anticheat ni les librairies. Le scan complet (agent Fiverax) les voit toutes."
  },
  code_not_scanned: {
    category: "security", severity: "info", title: "Code des ressources non analysé",
    fix: "Le scan rapide ne lit que les informations publiques. Le scan complet de Fiverax analyse chaque fichier : backdoors, événements exploitables, injections SQL, webhooks et clés exposés."
  }
};

export type ExternalData = {
  hostname?: string | null;
  projectName?: string | null;
  /** "FXServer-master SERVER v1.0.0.7290 win32" */
  server?: string | null;
  vars: Record<string, string>;
  /** True when the server hides its convars (no info.json): the checks that read them are skipped. */
  varsHidden?: boolean;
  /** Null: the server did not publish them. */
  resources: string[] | null;
  /** Null: players.json not reachable. Only endpoint / identifiers are read, and only to count. */
  players: { endpoint?: string; identifiers?: string[] }[] | null;
  clients?: number | null;
  maxClients?: number | null;
};

export type ExternalFacts = {
  name: string;
  build: number | null;
  platform: "linux" | "win32" | null;
  players: number | null;
  maxClients: number | null;
  resources: number | null;
  onesync: boolean;
  fiverax: boolean;
  anticheats: string[];
  framework: string | null;
  gameBuild: string | null;
  locale: string | null;
  recommendedBuild: number | null;
  /** Version 2 */
  onesyncMode?: "off" | "legacy" | "on" | null;
  pureLevel?: number | null;
  txAdmin?: string | null;
  sqlLib?: string | null;
  tags?: string[];
};

/** One line of the checklist: passed, failed (a finding), unknown (hidden from outside) or locked (full scan only). */
export type CheckStatus = "pass" | "fail" | "unknown" | "locked";
export type ScanCheck = { key: string; group: "config" | "players" | "resources" | "code"; label: string; status: CheckStatus; rule?: string; note?: string };

/** What anyone (a cheater first) learns about the server from outside. Counts only: no player data is kept. */
export type ExternalExposure = {
  resources: number | null;
  exploitable: { name: string; why: string }[];
  leaked: string[];
  /** Players currently connected whose IP address is readable. */
  playerIps: number;
  /** Players whose Discord / Steam / license identifiers are readable. */
  playerIdentifiers: number;
  identifierKinds: string[];
  playersSampled: number;
  versionVisible: boolean;
  txAdmin: string | null;
};

export type ExternalReport = {
  version?: number;
  score: number;
  /** A+ to F, from the score (version 2). */
  grade?: string;
  categories: Record<Category, CategoryScore>;
  findings: Finding[];
  facts: ExternalFacts;
  checks?: ScanCheck[];
  exposure?: ExternalExposure;
};

const ANTICHEATS: [RegExp, string][] = [
  [/^fiverax_agent$/i, "Fiverax"],
  [/fiveguard/i, "FiveGuard"],
  [/^fini(ac|_ac|-ac)?$/i, "FiniAC"],
  [/waveshield/i, "WaveShield"],
  [/fireac/i, "FIREAC"],
  [/^electron[-_]?(ac|anticheat)?$/i, "Electron"],
  [/phoenix[-_]?(ac|anticheat)/i, "Phoenix"],
  [/reaper[-_]?(ac|anticheat)?$/i, "Reaper"],
  [/anti[-_ ]?cheat/i, "Anticheat"],
  [/(^|[-_])ac$|^ac[-_]/i, "Anticheat"]
];

const FRAMEWORKS: [string, string][] = [["qbx_core", "Qbox"], ["qb-core", "QBCore"], ["es_extended", "ESX"], ["ox_core", "Ox Core"], ["vrp", "vRP"], ["essentialmode", "EssentialMode"]];
const SQL_LIBS = ["oxmysql", "mysql-async", "ghmattimysql"];

/**
 * Old ESX / vRP resources whose server events cheat menus fire blindly (the same names the anticheat's honeypots use):
 * name → what a cheater gets. Original versions (2018-2020); a patched fork may be safe, hence "ciblées".
 */
export const EXPLOITABLE_RESOURCES: Record<string, string> = {
  esx_truckerjob: "paie de livraison déclenchable à volonté",
  esx_fueldelivery: "paie de livraison déclenchable à volonté",
  esx_carthief: "paie de vol de voiture déclenchable à volonté",
  esx_godirtyjob: "paie de mission déclenchable à volonté",
  esx_pizza: "paie de livraison déclenchable à volonté",
  esx_ranger: "paie de mission déclenchable à volonté",
  esx_garbagejob: "paie d'éboueur déclenchable à volonté",
  esx_gopostaljob: "paie de facteur déclenchable à volonté",
  esx_banksecurity: "paie de convoyeur déclenchable à volonté",
  esx_jobs: "caution remboursée à l'infini",
  esx_mugging: "argent de braquage à volonté",
  esx_slotmachine: "gains de machine à sous truqués",
  vrp_slotmachine: "gains de machine à sous truqués",
  lscustoms: "paiement du garage contourné",
  esx_dmvschool: "permis obtenus sans payer",
  esx_jailer: "n'importe quel joueur envoyé en prison",
  "esx-qalle-jail": "n'importe quel joueur envoyé en prison",
  mellotrainer: "commandes admin (kick, ban) ouvertes à tous"
};

const LEAKED = /(^|[-_ .[(])(leak|leaked|leaks|nulled|cracked|crack|deobf|deobfuscated|decrypted)([-_ .\])]|$)/i;
const DEV_RESOURCES = ["runcode"];

const truthy = (v: string | undefined) => ["1", "true", "on", "yes"].includes((v ?? "").trim().toLowerCase());
const varOf = (vars: Record<string, string>, name: string) => {
  const key = Object.keys(vars).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? String(vars[key]) : undefined;
};
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

/** Pure: A+ to F, like the security graders people already know. */
export function gradeOf(score: number): string {
  return score >= 95 ? "A+" : score >= 88 ? "A" : score >= 78 ? "B" : score >= 65 ? "C" : score >= 50 ? "D" : score >= 35 ? "E" : "F";
}

/** Pure: the public scan's report, scored like the full scan but on what can be seen from outside. */
export function analyzeExternal(data: ExternalData, artifacts: Artifacts): ExternalReport {
  const findings: Finding[] = [];
  const checks: ScanCheck[] = [];
  const push = (rule: string, detail: string) => {
    const r = EXTERNAL_RULES[rule];
    findings.push({ rule, category: r.category, severity: r.severity, title: r.title, detail, fix: r.fix });
  };
  /** One check: `failed` null = cannot be seen from outside; true = a finding of `rule`. */
  const verdict = (key: string, group: ScanCheck["group"], label: string, failed: boolean | null, rule: string, detail: string, note?: string) => {
    if (failed === null) checks.push({ key, group, label, status: "unknown" });
    else if (failed) {
      push(rule, detail);
      checks.push({ key, group, label, status: "fail", rule });
    } else checks.push({ key, group, label, status: "pass", ...(note ? { note } : {}) });
  };

  const vars = data.vars ?? {};
  const resources = data.resources?.map((r) => r.trim()).filter(Boolean) ?? null;
  const listed = resources && resources.length ? resources : null;
  const lower = new Set((resources ?? []).map((r) => r.toLowerCase()));
  const version = data.server ?? varOf(vars, "version") ?? "";
  const build = Number(/v1\.0\.0\.(\d+)/.exec(version)?.[1]) || null;
  const platform = /linux/i.test(version) ? "linux" : /win32|windows/i.test(version) ? "win32" : null;
  const known = !data.varsHidden;

  // ---- configuration (convars published in info.json) ----
  verdict("scripthook", "config", "ScriptHook interdit", known ? truthy(varOf(vars, "sv_scriptHookAllowed")) : null, "scripthook",
    "sv_scriptHookAllowed vaut 1 (visible dans les infos publiques du serveur).");
  const pureRaw = varOf(vars, "sv_pureLevel");
  const pure = Number(pureRaw ?? 0) || 0;
  verdict("pure_level", "config", "Fichiers du jeu modifiés refusés", known ? pure < 1 : null, "pure_level",
    pureRaw === undefined ? "sv_pureLevel n'est pas défini (0 par défaut)." : `sv_pureLevel vaut ${pure}.`, `sv_pureLevel ${pure}`);
  const onesyncVar = varOf(vars, "onesync_enabled") ?? varOf(vars, "onesync");
  const legacy = /^legacy$/i.test((onesyncVar ?? "").trim());
  const onesync = truthy(onesyncVar) || /^(legacy|on)$/i.test((onesyncVar ?? "").trim());
  verdict("onesync", "config", "OneSync activé", known ? !onesync : null, "no_onesync", "onesync n'est pas activé.");
  verdict("onesync_mode", "config", "OneSync à jour (pas Legacy)", known && onesync ? legacy : null, "onesync_legacy", "onesync vaut legacy.");
  const gameBuild = varOf(vars, "sv_enforceGameBuild") ?? null;
  verdict("game_build", "config", "Build du jeu fixé", known ? !gameBuild : null, "game_build", "", gameBuild ? `build ${gameBuild}` : undefined);
  if (artifacts) {
    const critical = Boolean(artifacts.critical && artifacts.build < artifacts.critical);
    const old = !critical && Boolean(artifacts.recommended && artifacts.build < artifacts.recommended);
    if (critical) push("critical_artifacts", `Build ${artifacts.build}, minimum sûr ${artifacts.critical}.`);
    else if (old) push("old_artifacts", `Build ${artifacts.build}, recommandé ${artifacts.recommended}.`);
    checks.push(critical || old
      ? { key: "artifacts", group: "config", label: "FXServer à jour", status: "fail", rule: critical ? "critical_artifacts" : "old_artifacts" }
      : { key: "artifacts", group: "config", label: "FXServer à jour", status: "pass", note: `build ${artifacts.build}` });
  } else checks.push({ key: "artifacts", group: "config", label: "FXServer à jour", status: "unknown" });

  // ---- players (players.json): counted, never kept ----
  const sampled = data.players && data.players.length ? data.players : null;
  const leakedIps = (sampled ?? []).filter((p) => {
    const ep = p.endpoint ? addressOf(p.endpoint) : "";
    return (ep && isPublicIp(ep)) || (p.identifiers ?? []).some((i) => i.startsWith("ip:") && isPublicIp(i.slice(3)));
  }).length;
  const kinds = new Set<string>();
  const withIds = (sampled ?? []).filter((p) => {
    const ids = (p.identifiers ?? []).map((i) => i.split(":")[0].toLowerCase()).filter((k) => ["discord", "steam", "license", "license2", "xbl", "live", "fivem"].includes(k));
    for (const k of ids) kinds.add(k.replace(/2$/, ""));
    return ids.length > 0;
  }).length;
  const total = sampled?.length ?? 0;
  verdict("player_ips", "players", "Adresse IP des joueurs cachée", sampled ? leakedIps > 0 : null, "public_endpoints",
    `${plural(leakedIps, "joueur")} sur ${total} avec une adresse IP lisible publiquement.`);
  verdict("player_ids", "players", "Identifiants des joueurs cachés", sampled ? withIds > 0 : null, "public_identifiers",
    `${plural(withIds, "joueur")} sur ${total} avec ${[...kinds].join(", ")} lisible${withIds > 1 ? "s" : ""} sur /players.json.`);

  // ---- resources (info.json) ----
  const anticheats = [...new Set((resources ?? []).flatMap((r) => ANTICHEATS.filter(([re]) => re.test(r)).slice(0, 1).map(([, label]) => label)))];
  const exploitable = (listed ?? []).filter((r) => EXPLOITABLE_RESOURCES[r.toLowerCase()]).map((r) => ({ name: r, why: EXPLOITABLE_RESOURCES[r.toLowerCase()] }));
  const leaked = (listed ?? []).filter((r) => LEAKED.test(r));
  const dev = DEV_RESOURCES.filter((r) => lower.has(r));
  const sqlLibs = SQL_LIBS.filter((r) => lower.has(r));
  const oldSql = sqlLibs.filter((r) => r !== "oxmysql");
  const legacyFw = ["essentialmode", "es_admin2", "es_admin", "esplugin_mysql"].filter((r) => lower.has(r));
  const frameworks = FRAMEWORKS.filter(([name]) => name !== "essentialmode" && lower.has(name)).map(([, label]) => label);

  verdict("anticheat", "resources", "Anticheat en place", listed ? !anticheats.length : null, "no_anticheat",
    `${listed?.length ?? 0} ressources publiques, aucune ne correspond à un anticheat connu.`, anticheats.join(", ") || undefined);
  verdict("exploitable", "resources", "Aucune ressource ciblée par les menus de triche", listed ? exploitable.length > 0 : null, "exploitable_resources",
    exploitable.map((e) => `${e.name} (${e.why})`).join(" · "));
  verdict("leaked", "resources", "Aucune ressource « leak »", listed ? leaked.length > 0 : null, "leaked_resource", `${leaked.slice(0, 6).join(", ")}${leaked.length > 6 ? ` et ${leaked.length - 6} autre(s)` : ""}.`);
  verdict("dev_resources", "resources", "Pas d'exécution de code à distance (runcode)", listed ? dev.length > 0 : null, "dev_resource", `${dev.join(", ")} démarrée.`);
  verdict("sql", "resources", "Librairie SQL moderne", listed ? oldSql.length > 0 : null, "old_mysql",
    `Ressource${oldSql.length > 1 ? "s" : ""} ${oldSql.join(", ")} démarrée${oldSql.length > 1 ? "s" : ""}.`, sqlLibs[0]);
  verdict("sql_conflict", "resources", "Une seule librairie SQL", listed ? sqlLibs.length > 1 : null, "sql_conflict", `${sqlLibs.join(" + ")} démarrées ensemble.`);
  verdict("framework", "resources", "Framework maintenu", listed ? legacyFw.length > 0 : null, "legacy_framework",
    `${legacyFw.join(", ")} démarré${legacyFw.length > 1 ? "s" : ""}.`);
  verdict("framework_conflict", "resources", "Un seul framework", listed ? frameworks.length > 1 : null, "framework_conflict", `${frameworks.join(" + ")} démarrés ensemble.`);
  verdict("resource_count", "resources", "Nombre de ressources raisonnable", listed ? listed.length > 250 : null, "many_resources", `${listed?.length ?? 0} ressources démarrées.`);
  if (!listed) push("hidden_resources", "");

  // ---- code: only the full scan reads it ----
  checks.push({ key: "code", group: "code", label: "Code des ressources (backdoors, événements exploitables, webhooks, injections SQL)", status: "locked" });
  push("code_not_scanned", "");

  const framework = FRAMEWORKS.find(([name]) => lower.has(name))?.[1] ?? null;
  const name = cleanServerName(data.projectName || varOf(vars, "sv_projectName") || data.hostname || varOf(vars, "sv_hostname")) || "Serveur FiveM";
  // Few checks per category from outside: without a cap, one critical setting (ScriptHook, vulnerable artifacts)
  // would still read as "good". Any critical problem caps the score at 35, any high one at 70.
  const scored = score(findings);
  if (findings.some((f) => f.severity === "critical")) scored.score = Math.min(scored.score, 35);
  else if (findings.some((f) => f.severity === "high")) scored.score = Math.min(scored.score, 70);
  const txAdmin = varOf(vars, "txAdmin-version")?.slice(0, 20) ?? null;
  const tags = (varOf(vars, "tags") ?? "").split(",").map((t) => cleanServerName(t).slice(0, 24)).filter(Boolean).slice(0, 8);
  return {
    version: REPORT_VERSION,
    ...scored,
    grade: gradeOf(scored.score),
    facts: {
      name,
      build,
      platform,
      players: data.players ? data.players.length : data.clients ?? null,
      maxClients: data.maxClients ?? (Number(varOf(vars, "sv_maxClients")) || null),
      resources: resources ? resources.length : null,
      onesync,
      fiverax: lower.has("fiverax_agent"),
      anticheats,
      framework,
      gameBuild,
      locale: varOf(vars, "locale") ?? null,
      recommendedBuild: artifacts?.recommended || null,
      onesyncMode: known ? (legacy ? "legacy" : onesync ? "on" : "off") : null,
      pureLevel: known ? pure : null,
      txAdmin,
      sqlLib: sqlLibs[0] ?? null,
      tags
    },
    checks,
    exposure: {
      resources: listed ? listed.length : null,
      exploitable,
      leaked,
      playerIps: leakedIps,
      playerIdentifiers: withIds,
      identifierKinds: [...kinds],
      playersSampled: total,
      versionVisible: Boolean(build),
      txAdmin
    }
  };
}

/** What a visitor without an account sees of a report: the score and the headlines, without the details and fixes. */
export type PublicFinding = Pick<Finding, "rule" | "severity" | "title" | "category">;
export const lockFindings = (findings: Finding[]): PublicFinding[] => findings.map(({ rule, severity, title, category }) => ({ rule, severity, title, category }));

/** Pure: the place of a score among the scans of the last 30 days ("better than N %"), null under 20 scans. */
export function percentileOf(below: number, total: number): number | null {
  if (total < 20) return null;
  return Math.max(1, Math.min(99, Math.round((below / total) * 100)));
}

/** The steps of a scan as the visitor sees them (streamed by /api/scan). */
export const SCAN_STEPS = [
  { key: "resolve", label: "Adresse du serveur" },
  { key: "info", label: "Informations publiques" },
  { key: "players", label: "Joueurs connectés" },
  { key: "resources", label: "Ressources publiques" },
  { key: "artifacts", label: "Version de FXServer" },
  { key: "analysis", label: "Score de sécurité" }
] as const;
export type ScanStepKey = (typeof SCAN_STEPS)[number]["key"];
