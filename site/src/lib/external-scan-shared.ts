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
  pure_level: {
    category: "security", severity: "medium", title: "Fichiers du jeu modifiés autorisés (sv_pureLevel)",
    fix: "Ajoute sv_pureLevel 1 dans server.cfg : les joueurs ne peuvent plus charger d'archives du jeu modifiées (menus, textures et sons de triche). Le niveau 2 bloque aussi les mods graphiques."
  },
  no_onesync: {
    category: "config", severity: "medium", title: "OneSync désactivé",
    fix: "Ajoute set onesync on : sans OneSync, le serveur ne voit pas les entités des joueurs, donc aucun anticheat ne peut contrôler les objets, véhicules et explosions créés par un cheater."
  },
  no_anticheat: {
    category: "security", severity: "medium", title: "Aucun anticheat visible",
    fix: "Aucune ressource d'anticheat connue dans la liste publique (certains se cachent sous un nom aléatoire). Fiverax en inclut un : événements piégés, entités, explosions, armes, godmode, téléportation, réglable depuis le panel."
  },
  legacy_framework: {
    category: "security", severity: "high", title: "Framework abandonné (EssentialMode)",
    fix: "EssentialMode et es_admin2 ne sont plus maintenus depuis 2020 et ont des failles connues : migre vers ESX Legacy, QBCore ou Qbox."
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
};

export type ExternalReport = {
  score: number;
  categories: Record<Category, CategoryScore>;
  findings: Finding[];
  facts: ExternalFacts;
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

const truthy = (v: string | undefined) => ["1", "true", "on", "yes"].includes((v ?? "").trim().toLowerCase());
const varOf = (vars: Record<string, string>, name: string) => {
  const key = Object.keys(vars).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? String(vars[key]) : undefined;
};

/** Pure: the public scan's report, scored like the full scan but on what can be seen from outside. */
export function analyzeExternal(data: ExternalData, artifacts: Artifacts): ExternalReport {
  const findings: Finding[] = [];
  const push = (rule: string, detail: string) => {
    const r = EXTERNAL_RULES[rule];
    findings.push({ rule, category: r.category, severity: r.severity, title: r.title, detail, fix: r.fix });
  };
  const vars = data.vars ?? {};
  const resources = data.resources?.map((r) => r.trim()).filter(Boolean) ?? null;
  const lower = new Set((resources ?? []).map((r) => r.toLowerCase()));
  const version = data.server ?? varOf(vars, "version") ?? "";
  const build = Number(/v1\.0\.0\.(\d+)/.exec(version)?.[1]) || null;
  const platform = /linux/i.test(version) ? "linux" : /win32|windows/i.test(version) ? "win32" : null;

  const known = !data.varsHidden;
  if (known && truthy(varOf(vars, "sv_scriptHookAllowed"))) push("scripthook", "sv_scriptHookAllowed vaut 1 (visible dans les infos publiques du serveur).");
  const pure = Number(varOf(vars, "sv_pureLevel") ?? 0) || 0;
  if (known && pure < 1) push("pure_level", varOf(vars, "sv_pureLevel") === undefined ? "sv_pureLevel n'est pas défini (0 par défaut)." : `sv_pureLevel vaut ${pure}.`);
  const onesyncVar = varOf(vars, "onesync_enabled") ?? varOf(vars, "onesync");
  const onesync = truthy(onesyncVar) || /^(legacy|on)$/i.test(onesyncVar ?? "");
  if (known && !onesync) push("no_onesync", "onesync n'est pas activé.");
  const gameBuild = varOf(vars, "sv_enforceGameBuild") ?? null;
  if (known && !gameBuild) push("game_build", "");
  if (artifacts) {
    if (artifacts.critical && artifacts.build < artifacts.critical) push("critical_artifacts", `Build ${artifacts.build}, minimum sûr ${artifacts.critical}.`);
    else if (artifacts.recommended && artifacts.build < artifacts.recommended) push("old_artifacts", `Build ${artifacts.build}, recommandé ${artifacts.recommended}.`);
  }

  if (data.players?.length) {
    const leaked = data.players.filter((p) => {
      const ep = p.endpoint ? addressOf(p.endpoint) : "";
      return (ep && isPublicIp(ep)) || (p.identifiers ?? []).some((i) => i.startsWith("ip:") && isPublicIp(i.slice(3)));
    }).length;
    if (leaked) push("public_endpoints", `${leaked} joueur${leaked > 1 ? "s" : ""} sur ${data.players.length} avec une adresse IP lisible publiquement.`);
  }

  const anticheats = [...new Set((resources ?? []).flatMap((r) => ANTICHEATS.filter(([re]) => re.test(r)).slice(0, 1).map(([, label]) => label)))];
  if (resources === null || resources.length === 0) push("hidden_resources", "");
  else {
    if (!anticheats.length) push("no_anticheat", `${resources.length} ressources publiques, aucune ne correspond à un anticheat connu.`);
    const oldSql = ["mysql-async", "ghmattimysql"].filter((r) => lower.has(r));
    if (oldSql.length) push("old_mysql", `Ressource${oldSql.length > 1 ? "s" : ""} ${oldSql.join(", ")} démarrée${oldSql.length > 1 ? "s" : ""}.`);
    const legacy = ["essentialmode", "es_admin2", "es_admin", "esplugin_mysql"].filter((r) => lower.has(r));
    if (legacy.length) push("legacy_framework", `${legacy.join(", ")} démarré${legacy.length > 1 ? "s" : ""}.`);
    if (resources.length > 250) push("many_resources", `${resources.length} ressources démarrées.`);
  }
  push("code_not_scanned", "");

  const framework = FRAMEWORKS.find(([name]) => lower.has(name))?.[1] ?? null;
  const name = cleanServerName(data.projectName || varOf(vars, "sv_projectName") || data.hostname || varOf(vars, "sv_hostname")) || "Serveur FiveM";
  // Few checks per category from outside: without a cap, one critical setting (ScriptHook, vulnerable artifacts)
  // would still read as "good". Any critical problem caps the score at 35, any high one at 70.
  const scored = score(findings);
  if (findings.some((f) => f.severity === "critical")) scored.score = Math.min(scored.score, 35);
  else if (findings.some((f) => f.severity === "high")) scored.score = Math.min(scored.score, 70);
  return {
    ...scored,
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
      recommendedBuild: artifacts?.recommended || null
    }
  };
}

/** What a visitor without an account sees of a report: the score and the headlines, without the details and fixes. */
export type PublicFinding = Pick<Finding, "rule" | "severity" | "title" | "category">;
export const lockFindings = (findings: Finding[]): PublicFinding[] => findings.map(({ rule, severity, title, category }) => ({ rule, severity, title, category }));
