import { stripLua } from "./studio-shared";

/**
 * Server audit: the static rules. Pure and deterministic (no DB, no network), so a file always gives the same result
 * and its result can be shared by every server having the same file (reputation by hash, see lib/audit.ts).
 *
 * Two levels:
 *  - analyzeFile: one file's content (backdoors, exploitable events, SQL injections, secrets, client-side logic,
 *    performance, old libraries). Its findings depend only on the content, its role and its extension.
 *  - buildReport: the whole server (manifests, dependencies, streamed assets, duplicates, server.cfg, convars,
 *    artifacts) plus the files' findings, scored out of 100.
 *
 * Bump ENGINE when a rule changes: files analysed by an older engine are analysed again.
 */
export const ENGINE = 1;

export type Severity = "critical" | "high" | "medium" | "info";
export type Category = "security" | "config" | "performance" | "maintenance";
export type Role = "client" | "server" | "shared" | "ui" | "other";

export const SEVERITIES: Severity[] = ["critical", "high", "medium", "info"];
export const CATEGORIES: { key: Category; label: string; weight: number }[] = [
  { key: "security", label: "Sécurité", weight: 0.45 },
  { key: "config", label: "Configuration", weight: 0.2 },
  { key: "performance", label: "Performance", weight: 0.2 },
  { key: "maintenance", label: "Maintenance", weight: 0.15 }
];
export const SEVERITY_LABEL: Record<Severity, string> = { critical: "Critique", high: "Haute", medium: "Moyenne", info: "Info" };

export type AIReview = { verdict: "confirmed" | "false_positive" | "uncertain"; explanation: string; fix: string | null };

export type Finding = {
  rule: string;
  category: Category;
  severity: Severity;
  title: string;
  /** What was found here, in plain French. */
  detail: string;
  /** Generic fix of the rule (the AI can write a precise one). */
  fix: string;
  resource?: string;
  file?: string;
  line?: number;
  /** The line and its neighbours (never more): what the report and the AI see of the code. */
  snippet?: string;
  ai?: AIReview;
};

type Rule = { category: Category; severity: Severity; title: string; fix: string };

export const RULES: Record<string, Rule> = {
  // ---- backdoors ----
  remote_code: {
    category: "security", severity: "critical", title: "Backdoor : télécharge et exécute du code",
    fix: "Supprime ce code (ou la ressource entière si tu ne sais pas d'où il vient), puis change le mot de passe RCON, la clé de licence et les mots de passe de la base : la personne a pu exécuter n'importe quoi sur ton serveur."
  },
  hidden_code: {
    category: "security", severity: "critical", title: "Backdoor : code caché (obfusqué) qui appelle des fonctions sensibles",
    fix: "Une ressource honnête n'a aucune raison de cacher PerformHttpRequest / load dans des \\x.. : supprime la ressource et réinstalle-la depuis sa source officielle."
  },
  known_backdoor: {
    category: "security", severity: "critical", title: "Backdoor connue (panel de triche)",
    fix: "Supprime la ressource infectée, cherche le même code dans les autres ressources (les backdoors se recopient), puis change tous tes mots de passe et ta clé de licence."
  },
  system_command: {
    category: "security", severity: "critical", title: "Exécute des commandes système (os.execute / io.popen / child_process)",
    fix: "Aucune ressource de jeu n'a besoin de lancer des commandes sur la machine : retire ces appels ou la ressource."
  },
  grant_admin: {
    category: "security", severity: "critical", title: "Donne des permissions admin (add_ace / add_principal) par le code",
    fix: "Les permissions se donnent dans server.cfg, jamais depuis un script : supprime cet ExecuteCommand et vérifie qui est dans group.admin."
  },
  secret_exfiltration: {
    category: "security", severity: "critical", title: "Lit des secrets du serveur et parle à un site externe",
    fix: "Ce code lit la clé de licence, le mot de passe RCON ou la connexion à la base et fait une requête HTTP : supprime-le et change ces secrets."
  },
  obfuscated: {
    category: "security", severity: "high", title: "Code obfusqué (illisible)",
    fix: "Un script volontairement illisible peut cacher n'importe quoi. Garde-le seulement s'il vient d'un vendeur de confiance (idéalement en escrow Tebex), sinon remplace-le."
  },
  dynamic_code: {
    category: "security", severity: "medium", title: "Exécute du texte comme du code (load / eval)",
    fix: "Évite load / eval : si le texte peut venir d'un joueur ou d'Internet, c'est une porte d'entrée. Utilise des tables de config ou JSON à la place."
  },
  // ---- exploitable events ----
  trusted_event: {
    category: "security", severity: "high", title: "Événement serveur exploitable : le montant ou l'objet vient du client",
    fix: "Ne prends jamais le montant / l'objet dans les paramètres de l'événement : calcule-le côté serveur (prix dans la config), vérifie la distance au point (GetEntityCoords(GetPlayerPed(source))), le job et un délai anti-spam par joueur."
  },
  unchecked_reward: {
    category: "security", severity: "medium", title: "Événement serveur qui donne une récompense sans aucune vérification",
    fix: "Un cheater peut déclencher cet événement en boucle (« trigger ») : ajoute au minimum une vérification de distance et un délai par joueur avant de payer."
  },
  sql_injection: {
    category: "security", severity: "high", title: "Injection SQL : requête construite par concaténation",
    fix: "Utilise des paramètres : MySQL.query('SELECT * FROM users WHERE identifier = ?', { identifier }) au lieu de coller la valeur dans le texte de la requête."
  },
  exposed_webhook: {
    category: "security", severity: "high", title: "Webhook Discord lisible par les joueurs",
    fix: "Les fichiers client, shared et NUI sont envoyés à chaque joueur : n'importe qui peut récupérer ce webhook et spammer ou supprimer ton salon. Envoie le message depuis le serveur et range l'URL dans une convar (set mon_webhook \"…\" + GetConvar)."
  },
  server_webhook: {
    category: "security", severity: "info", title: "Webhook Discord écrit en dur dans le code serveur",
    fix: "Range l'URL dans une convar (server.cfg) : elle ne finira pas sur GitHub ou dans un leak de la ressource."
  },
  exposed_secret: {
    category: "security", severity: "high", title: "Clé secrète lisible par les joueurs",
    fix: "Cette clé (API, token, mot de passe de base) est envoyée aux joueurs : révoque-la tout de suite, puis fais l'appel depuis le serveur avec la clé dans une convar."
  },
  server_secret: {
    category: "security", severity: "medium", title: "Clé secrète écrite en dur dans le code serveur",
    fix: "Range-la dans une convar du server.cfg et révoque celle-ci si la ressource a déjà été partagée."
  },
  client_trust: {
    category: "security", severity: "medium", title: "Logique de paiement ou de permission côté client",
    fix: "Le client peut être modifié par un cheater : la vérification (prix, argent, grade) doit être refaite côté serveur, le client ne doit envoyer que l'intention (« acheter l'objet X »)."
  },
  // ---- performance ----
  busy_loop: {
    category: "performance", severity: "medium", title: "Boucle Wait(0) inutile (consomme à chaque image)",
    fix: "Wait(0) n'est utile que pour dessiner ou lire des touches à chaque image. Ici, attends plus longtemps (Wait(500) ou plus), ou dors longtemps quand le joueur est loin et Wait(0) seulement quand il est proche."
  },
  sql_in_loop: {
    category: "performance", severity: "medium", title: "Requête SQL dans une boucle",
    fix: "Une requête par tour de boucle sature la base : fais une seule requête (WHERE id IN (…) ou un INSERT groupé) avant ou après la boucle."
  },
  distance_native: {
    category: "performance", severity: "info", title: "GetDistanceBetweenCoords (lent)",
    fix: "Remplace par #(coordsA - coordsB) avec des vector3 : même résultat, bien plus rapide."
  },
  oversized_asset: {
    category: "performance", severity: "high", title: "Fichier streamé trop lourd (textures qui disparaissent)",
    fix: "Au-delà de 16 Mo, GTA charge mal le fichier : textures invisibles ou qui clignotent. Réduis les textures (2048 px max, compression DXT) avec OpenIV / Texture Toolkit."
  },
  duplicate_asset: {
    category: "performance", severity: "medium", title: "Même fichier streamé par plusieurs ressources",
    fix: "Deux ressources streament un fichier du même nom : une seule version gagne, au hasard de l'ordre de chargement. Garde-le dans une seule ressource."
  },
  // ---- maintenance ----
  legacy_manifest: {
    category: "maintenance", severity: "medium", title: "__resource.lua (format abandonné)",
    fix: "Renomme le fichier en fxmanifest.lua et ajoute fx_version 'cerulean' et game 'gta5' en haut."
  },
  old_fx_version: {
    category: "maintenance", severity: "medium", title: "fx_version obsolète ou absent",
    fix: "Mets fx_version 'cerulean' dans fxmanifest.lua."
  },
  no_lua54: {
    category: "maintenance", severity: "info", title: "Lua 5.4 non activé",
    fix: "Ajoute lua54 'yes' dans fxmanifest.lua : Lua 5.4 est plus rapide et c'est le seul encore maintenu (teste la ressource après)."
  },
  old_mysql: {
    category: "maintenance", severity: "medium", title: "Ancienne librairie SQL (mysql-async / ghmattimysql)",
    fix: "Passe à oxmysql : il fournit une compatibilité mysql-async (MySQL.Async.*) et il est bien plus rapide et maintenu."
  },
  deprecated_native: {
    category: "maintenance", severity: "info", title: "Native dépréciée",
    fix: "GetPlayerPed(-1) → PlayerPedId()."
  },
  missing_dependency: {
    category: "maintenance", severity: "high", title: "Dépendance manquante",
    fix: "Installe la ressource requise (ou retire la dépendance du fxmanifest si elle n'est plus utilisée) : sans elle la ressource ne démarre pas."
  },
  stopped_dependency: {
    category: "maintenance", severity: "medium", title: "Dépendance arrêtée",
    fix: "Ajoute ensure de la dépendance dans server.cfg, avant la ressource qui l'utilise."
  },
  ensure_order: {
    category: "maintenance", severity: "info", title: "Ordre des ensure : une dépendance est démarrée après",
    fix: "Place l'ensure de la dépendance avant celui de la ressource (FiveM la démarre quand même, mais l'ordre rend les démarrages prévisibles)."
  },
  duplicate_resource: {
    category: "maintenance", severity: "medium", title: "Ressource en double",
    fix: "Les mêmes fichiers sont installés deux fois sous des noms différents : supprime la copie, sinon les deux tournent en même temps."
  },
  event_conflict: {
    category: "maintenance", severity: "info", title: "Même nom d'événement serveur dans plusieurs ressources",
    fix: "Préfixe les événements par le nom de la ressource (ma_ressource:acheter) : deux ressources qui écoutent le même nom s'exécutent toutes les deux."
  },
  protected: {
    category: "maintenance", severity: "info", title: "Ressource protégée (escrow), non analysable",
    fix: "Normal pour un script acheté sur Tebex : il est chiffré et vient d'une source vérifiée."
  },
  not_analyzed: {
    category: "maintenance", severity: "info", title: "Fichiers non analysés",
    fix: "Mode confidentiel (fiverax_audit_code 0) ou fichiers trop gros : seuls les fichiers déjà connus ont été évalués."
  },
  // ---- configuration ----
  scripthook: {
    category: "config", severity: "critical", title: "ScriptHook autorisé (sv_scriptHookAllowed 1)",
    fix: "Mets sv_scriptHookAllowed 0 dans server.cfg : ScriptHook laisse les joueurs charger des menus de triche."
  },
  open_ace: {
    category: "config", severity: "critical", title: "Permission ACE donnée à tout le monde",
    fix: "Retire cette ligne : builtin.everyone / group.user ne doivent jamais recevoir command ou une permission admin. Donne-les à group.admin et ajoute les admins un par un (add_principal identifier.fivem:… group.admin)."
  },
  wide_ace: {
    category: "config", severity: "medium", title: "Ressource autorisée à exécuter toutes les commandes",
    fix: "add_ace resource.X command allow donne à la ressource tout le pouvoir de la console. Réserve-le aux ressources qui en ont vraiment besoin (txAdmin, Fiverax…), ou limite à la commande nécessaire (command.ma_commande)."
  },
  rcon: {
    category: "config", severity: "medium", title: "RCON activé",
    fix: "Le RCON passe en clair sur le réseau : retire rcon_password (txAdmin et la console du panel le remplacent)."
  },
  endpoint_privacy: {
    category: "config", severity: "info", title: "Adresse IP des joueurs visible entre eux (sv_endpointprivacy)",
    fix: "Ajoute sv_endpointprivacy true dans server.cfg."
  },
  game_build: {
    category: "config", severity: "info", title: "Build du jeu non fixé (sv_enforceGameBuild)",
    fix: "Ajoute set sv_enforceGameBuild 3258 (ou plus récent) : tout le monde a le même contenu (véhicules, cartes) et les DLC récents."
  },
  old_artifacts: {
    category: "config", severity: "medium", title: "FXServer (artifacts) en retard",
    fix: "Mets à jour les artifacts du serveur (txAdmin > Mises à jour, ou télécharge le build recommandé) : chaque version corrige des failles et des crashs."
  },
  critical_artifacts: {
    category: "config", severity: "critical", title: "FXServer (artifacts) avec une faille connue",
    fix: "Cette version a une faille corrigée depuis : mets à jour les artifacts tout de suite."
  },
  no_cfg: {
    category: "config", severity: "info", title: "server.cfg introuvable",
    fix: "L'agent n'a pas trouvé server.cfg à côté du dossier resources : les permissions et convars n'ont pas pu être vérifiées."
  }
};

const PENALTY: Record<Severity, number> = { critical: 25, high: 10, medium: 4, info: 0 };

// ---- helpers ----

export type FileResult = { findings: Finding[]; events: string[] };

function lineFinder(code: string): (index: number) => number {
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === "\n") starts.push(i + 1);
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

function snippetAt(lines: string[], line: number): string {
  return lines
    .slice(Math.max(0, line - 2), Math.min(lines.length, line + 1))
    .map((l) => (l.length > 220 ? `${l.slice(0, 220)}…` : l))
    .join("\n");
}

/** Index just after the `end` closing the block opened at `from` (a function / do / if token). */
export function blockEnd(stripped: string, from: number): number {
  const re = /[\w.:]+/g;
  re.lastIndex = from;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped))) {
    const w = m[0];
    if (w === "function" || w === "if" || w === "do") depth++;
    else if (w === "end" && --depth === 0) return m.index + 3;
  }
  return stripped.length;
}

/** Text of the escape sequences (\x41, \65) of the string literals: what an obfuscated file hides. */
export function decodeEscapes(code: string): { decoded: string; count: number } {
  let count = 0;
  let decoded = "";
  for (const run of code.matchAll(/(?:\\x[0-9a-fA-F]{2}|\\\d{1,3}){4,}/g)) {
    const parts = run[0].match(/\\x[0-9a-fA-F]{2}|\\\d{1,3}/g) ?? [];
    count += parts.length;
    decoded += parts.map((p) => String.fromCharCode(p[1] === "x" ? parseInt(p.slice(2), 16) : parseInt(p.slice(1), 10))).join("") + "\n";
  }
  return { decoded, count };
}

const SENSITIVE = /PerformHttpRequest|assert|\bload\b|loadstring|os\.execute|io\.popen|_G|ExecuteCommand|add_ace|add_principal|GetConvar|https?:\/\/|\beval\b|Function|child_process/;
const KNOWN_BACKDOORS = /cipher-panel|ciphercheats|blum-panel|thedreamcheats|fivem-anticheat\.xyz/i;
const REWARD_CALL = /(addMoney|AddMoney|addAccountMoney|addInventoryItem|AddItem|giveWeapon|addWeapon|AddWeapon|GiveWeaponToPed|setJob|SetJob|AddBankMoney)\s*\(([^)]*)\)/g;
const HAS_REWARD = new RegExp(REWARD_CALL.source);
const SQL_CALL = /MySQL\.[\w.]+\s*\(|oxmysql[\w'"\]\[:.]*\s*\(|ghmattimysql[\w'"\]\[:.]*\s*\(|mysql-async[\w'"\]\[:.]*\s*\(/;
const WEBHOOK = /https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/;
const SECRETS: [RegExp, string][] = [
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/, "clé OpenAI"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "clé Google"],
  [/\bgh[pousr]_[A-Za-z0-9]{36}\b/, "token GitHub"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, "token Slack"],
  [/\b[MN][A-Za-z\d_-]{23,25}\.[\w-]{6}\.[\w-]{27,38}\b/, "token de bot Discord"],
  [/mysql:\/\/[^:\s'"]+:[^@\s'"]+@/, "mot de passe de base de données"],
  [/\bgsk_[A-Za-z0-9]{40,}/, "clé Groq"]
];

const extOf = (path: string) => path.slice(path.lastIndexOf(".")).toLowerCase();
const isJs = (ext: string) => [".js", ".mjs", ".cjs", ".ts"].includes(ext);

/** Findings of one file. `role`: client / server / shared (from the manifest), ui (NUI page), other. */
export function analyzeFile(path: string, content: string, role: Role): FileResult {
  const ext = extOf(path);
  const lines = content.split("\n");
  const lineAt = lineFinder(content);
  const out: Finding[] = [];
  const perRule = new Map<string, number>();
  const events: string[] = [];
  const add = (rule: string, index: number | null, detail: string) => {
    const n = (perRule.get(rule) ?? 0) + 1;
    perRule.set(rule, n);
    if (n > 5) return; // the same problem many times in a file: 5 are enough to show it
    const r = RULES[rule];
    const line = index === null ? undefined : lineAt(index);
    out.push({ rule, category: r.category, severity: r.severity, title: r.title, detail, fix: r.fix, line, snippet: line ? snippetAt(lines, line) : undefined });
  };
  const exposed = role === "client" || role === "shared" || role === "ui";

  // Secrets (any text file).
  const hook = WEBHOOK.exec(content);
  if (hook) add(exposed ? "exposed_webhook" : role === "server" ? "server_webhook" : "exposed_webhook", hook.index, exposed ? "Ce fichier est téléchargé par chaque joueur." : role === "server" ? "Fichier serveur." : "Fichier envoyé avec la ressource (config, NUI).");
  for (const [re, label] of SECRETS) {
    const m = re.exec(content);
    if (m) add(exposed || role === "other" ? "exposed_secret" : "server_secret", m.index, `${label[0].toUpperCase()}${label.slice(1)} en clair.`);
  }
  const known = KNOWN_BACKDOORS.exec(content) ?? (() => {
    const hidden = decodeEscapes(content).decoded;
    return KNOWN_BACKDOORS.test(hidden) ? ({ index: content.search(/\\x[0-9a-fA-F]{2}/) } as RegExpExecArray) : null;
  })();
  if (known) add("known_backdoor", known.index, "Adresse d'un panel de backdoor connu (cipher-panel…).");

  if (ext === ".lua") analyzeLua(content, role, add, events);
  else if (isJs(ext) || ext === ".html" || ext === ".htm") analyzeJs(content, role, ext, add, events);
  return { findings: out, events: [...new Set(events)].slice(0, 200) };
}

type Add = (rule: string, index: number | null, detail: string) => void;

function analyzeLua(code: string, role: Role, add: Add, events: string[]): void {
  const s = stripLua(code);
  const server = role === "server" || role === "shared";
  const client = role === "client" || role === "shared";
  // A match in the original code counts only if it is code (not blanked by stripLua: comment or string).
  const isCode = (i: number) => s[i] !== " " || code[i] === " ";

  // ---- backdoors ----
  const { decoded, count } = decodeEscapes(code);
  const hiddenCall = SENSITIVE.exec(decoded);
  if (hiddenCall) add("hidden_code", code.search(/\\x[0-9a-fA-F]{2}|\\\d{2,3}/), `Texte caché décodé : « ${decoded.replace(/\s+/g, " ").slice(0, 120)} ».`);
  // Names built from pieces ("Perform" .. "HttpRequest") then looked up in _G.
  const joined = code.replace(/(["'])\s*\.\.\s*(["'])/g, "");
  const viaG = /_G\s*\[\s*["'](PerformHttpRequest|load|loadstring|assert|os|io)["']\s*\]/.exec(joined);
  if (viaG && !hiddenCall) add("hidden_code", code.indexOf("_G"), `Appel caché de ${viaG[1]} via _G["…"].`);

  const http = /PerformHttpRequest/.test(s) || /PerformHttpRequest/.test(decoded);
  for (const m of s.matchAll(/(^|[^\w.:])(load|loadstring)\s*\(/g)) {
    const at = m.index + m[1].length;
    const arg = s.slice(at, at + 120);
    if (/LoadResourceFile/.test(arg)) continue; // loading a file of the resource itself (configs, libraries)
    if (http) add("remote_code", at, "PerformHttpRequest et load dans le même fichier : le code reçu d'Internet est exécuté.");
    else add("dynamic_code", at, `${m[2]}(…) exécute un texte comme du code.`);
  }
  for (const m of s.matchAll(/\bos\.execute\b|\bio\.popen\b/g)) add("system_command", m.index, `${m[0]} lance une commande sur la machine du serveur.`);
  for (const m of code.matchAll(/ExecuteCommand\s*\(\s*\(?\s*["'`[]=*\[?\s*(add_ace|add_principal|remove_principal)/g)) {
    if (isCode(m.index)) add("grant_admin", m.index, `ExecuteCommand(« ${m[1]} … »).`);
  }
  const secretConvar = /GetConvar\s*\(\s*["'](rcon_password|sv_licenseKey|mysql_connection_string|steam_webApiKey|sv_tebexSecret)["']/.exec(code);
  if (secretConvar && http) add("secret_exfiltration", secretConvar.index, `Lit ${secretConvar[1]} et fait des requêtes HTTP.`);

  // Obfuscators (Luraph, IronBrew, MoonSec, PSU) and walls of escapes.
  const longLine = code.split("\n").some((l) => l.length > 4000 && (l.match(/ /g)?.length ?? 0) < l.length / 40);
  if (!hiddenCall && (/LPH_|Luraph|IronBrew|MoonSec|PSU_|bit32\.bxor[\s\S]{0,200}getfenv/.test(code) || count > 300 || longLine)) {
    add("obfuscated", null, count > 300 ? `${count} caractères échappés.` : "Lignes géantes ou signature d'obfuscateur.");
  }

  // ---- events (server side) ----
  if (server) {
    const handler = /(RegisterNetEvent|RegisterServerEvent|AddEventHandler)\s*\(\s*(["'])([^"']+)\2\s*,\s*function\s*\(([^)]*)\)/g;
    for (const m of code.matchAll(handler)) {
      if (!isCode(m.index)) continue;
      const name = m[3];
      // AddEventHandler alone may be a local event; it is a network one when the name is also registered.
      if (m[1] !== "AddEventHandler" || code.includes(`RegisterNetEvent('${name}'`) || code.includes(`RegisterNetEvent("${name}"`)) events.push(name);
      const fnAt = m.index + m[0].lastIndexOf("function");
      const body = s.slice(fnAt, blockEnd(s, fnAt));
      const params = new Set(m[4].split(",").map((p) => p.trim()).filter((p) => p && p !== "source" && p !== "..."));
      let flagged = false;
      for (const call of body.matchAll(REWARD_CALL)) {
        const args = call[2].split(/[^\w]+/).filter(Boolean);
        const fromClient = args.find((a) => params.has(a));
        if (fromClient) {
          add("trusted_event", fnAt + (call.index ?? 0), `« ${name} » : ${call[1]}(…) utilise « ${fromClient} », envoyé par le client.`);
          flagged = true;
          break;
        }
      }
      if (!flagged && HAS_REWARD.test(body) && !/\bif\b/.test(body)) {
        add("unchecked_reward", fnAt, `« ${name} » donne une récompense sans aucun if.`);
      }
    }
  }

  // ---- SQL ----
  for (const m of code.matchAll(/(["'])\s*(SELECT|INSERT|UPDATE|DELETE|REPLACE)\b(?:(?!\1)[^\n])*\1\s*\.\./gi)) {
    // The literal is blanked by stripLua, the ".." after it is not, unless it all sits in a comment.
    if (s[m.index + m[0].length - 1] !== ".") continue;
    add("sql_injection", m.index, "La valeur est collée dans le texte de la requête avec « .. ».");
  }

  // ---- client-side trust ----
  if (client) {
    for (const m of code.matchAll(/TriggerServerEvent\s*\(\s*(["'])([^"']*(money|pay|buy|reward|give|salary|paycheck|cash|bank|sell|price)[^"']*)\1\s*,([^)\n]*)/gi)) {
      if (!isCode(m.index)) continue;
      if (/\d|price|amount|money|prix|montant|reward|count|quantity/i.test(m[4])) add("client_trust", m.index, `Le client envoie la valeur à « ${m[2]} ».`);
    }
    const perm = /(getGroup\s*\(\s*\)|\.group)\s*[=~]=\s*["'](admin|superadmin|god|owner|mod)["']/.exec(code);
    if (perm && isCode(perm.index) && /TriggerServerEvent/.test(s) && role === "client") add("client_trust", perm.index, "Une permission est vérifiée seulement côté client.");
  }

  // ---- performance ----
  for (const m of s.matchAll(/\bwhile\s+true\s+do\b/g)) {
    const doAt = m.index + m[0].length - 2;
    const body = s.slice(doAt, blockEnd(s, doAt));
    const zero = /Wait\s*\(\s*0\s*\)/.test(body);
    const other = /Wait\s*\(\s*(?!0\s*\))[^)]+\)/.test(body);
    const perFrame = /Draw|IsControl|IsDisabledControl|DisableControl|ThisFrame|SetText|HideHud|ShowHelp|BeginTextCommand|NetworkIsPlayerTalking|SetEntityLocallyInvisible|GetFrameTime/.test(body);
    if (client && zero && !other && !perFrame) add("busy_loop", m.index, "Wait(0) sans rien à dessiner ni de touche à lire.");
  }
  for (const m of s.matchAll(/\b(for|while)\b[^\n]*?\bdo\b/g)) {
    const doAt = m.index + m[0].length - 2;
    const body = s.slice(doAt, blockEnd(s, doAt));
    if (SQL_CALL.test(body)) {
      add("sql_in_loop", m.index, "Une requête part à chaque tour de boucle.");
    }
  }
  const dist = /GetDistanceBetweenCoords/.exec(s);
  if (dist) add("distance_native", dist.index, "");

  // ---- maintenance ----
  const oldSql = /MySQL\.(Async|Sync)\.|exports\.ghmattimysql|exports\[\s*["']ghmattimysql["']\]|@mysql-async\//.exec(code);
  if (oldSql && !/oxmysql/.test(code)) add("old_mysql", oldSql.index, `${oldSql[0]}… : interface mysql-async.`);
  const ped = /GetPlayerPed\s*\(\s*-1\s*\)/.exec(s);
  if (ped && client) add("deprecated_native", ped.index, "GetPlayerPed(-1)");
}

function analyzeJs(code: string, role: Role, ext: string, add: Add, events: string[]): void {
  const server = role === "server" || role === "shared";
  const http = /\b(https?\.(get|request)|fetch\s*\(|axios|XMLHttpRequest|PerformHttpRequest)/.test(code);
  const { decoded } = decodeEscapes(code);
  const hidden = SENSITIVE.exec(decoded);
  if (hidden && ext !== ".html" && role !== "ui") add("hidden_code", code.search(/\\x[0-9a-fA-F]{2}/), `Texte caché décodé : « ${decoded.replace(/\s+/g, " ").slice(0, 120)} ».`);
  for (const m of code.matchAll(/\beval\s*\(|\bnew\s+Function\s*\(/g)) {
    if (role === "ui" || ext === ".html") continue; // NUI pages run in the player's browser, not on the server
    add(http && server ? "remote_code" : "dynamic_code", m.index, http && server ? "Code reçu d'Internet exécuté (eval / new Function)." : "eval / new Function exécute un texte comme du code.");
  }
  for (const m of code.matchAll(/child_process|\bexecSync\s*\(|\bspawn\s*\(/g)) {
    if (server) add("system_command", m.index, `${m[0]} lance un programme sur la machine.`);
  }
  for (const m of code.matchAll(/ExecuteCommand\s*\(\s*[`'"](add_ace|add_principal|remove_principal)/g)) add("grant_admin", m.index, `ExecuteCommand(« ${m[1]} … »).`);
  const secretConvar = /GetConvar\s*\(\s*["'](rcon_password|sv_licenseKey|mysql_connection_string|steam_webApiKey)["']/.exec(code);
  if (secretConvar && http && server) add("secret_exfiltration", secretConvar.index, `Lit ${secretConvar[1]} et fait des requêtes HTTP.`);
  for (const m of code.matchAll(/`\s*(SELECT|INSERT|UPDATE|DELETE)\b[^`]*\$\{/gi)) add("sql_injection", m.index, "Valeur insérée dans la requête avec ${…}.");
  for (const m of code.matchAll(/(["'])\s*(SELECT|INSERT|UPDATE|DELETE)\b(?:(?!\1)[^\n])*\1\s*\+/gi)) add("sql_injection", m.index, "Valeur collée dans la requête avec « + ».");
  if (server) {
    for (const m of code.matchAll(/onNet\s*\(\s*(["'`])([^"'`]+)\1\s*,\s*(?:async\s*)?(?:function\s*)?\(?([\w\s,]*)\)?\s*=?>?\s*\{/g)) {
      events.push(m[2]);
      const params = new Set(m[3].split(",").map((p) => p.trim()).filter(Boolean));
      const body = code.slice(m.index, m.index + 2500);
      for (const call of body.matchAll(REWARD_CALL)) {
        const arg = call[2].split(/[^\w]+/).find((a) => params.has(a));
        if (arg) {
          add("trusted_event", m.index + (call.index ?? 0), `« ${m[2]} » : ${call[1]}(…) utilise « ${arg} », envoyé par le client.`);
          break;
        }
      }
    }
  }
}

// ---- the whole server ----

export type InventoryFile = { p: string; size: number; hash?: string; role: Role; kind: "code" | "stream" | "other"; enc?: boolean };
export type InventoryResource = {
  name: string;
  state: string;
  meta: { fx_version?: string; lua54?: string; dependencies?: string[]; legacy?: boolean; version?: string };
  protected?: boolean;
  files: InventoryFile[];
  truncated?: boolean;
};
export type Inventory = {
  agent?: string;
  confidential?: boolean;
  convars: Record<string, string>;
  rcon?: boolean;
  cfg: { path: string; content: string }[];
  resources: InventoryResource[];
};
export type Artifacts = { build: number; recommended: number; critical: number } | null;

export type CategoryScore = { score: number; counts: Record<Severity, number> };
export type Report = {
  engine: number;
  score: number;
  categories: Record<Category, CategoryScore>;
  findings: Finding[];
  stats: { resources: number; files: number; code: number; analyzed: number; known: number; protected: number; skipped: number; streamed: number };
};

/** Reputation key of a file: the same content analysed for the same role and type always gives the same findings. */
export const fileKey = (f: Pick<InventoryFile, "hash" | "role" | "p">) => `${f.hash}:${f.role}:${extOf(f.p)}`;

export const ANALYZABLE = /\.(lua|js|mjs|cjs|ts|html|htm|json|cfg|sql|xml|yml|yaml)$/i;
export const STREAM_LIMIT = 16 * 1024 * 1024;

/** Dependencies that are not resources: game build, OneSync, server version… */
const NOT_RESOURCE = /^\//;

function parseCfg(cfg: Inventory["cfg"]): { lines: { text: string; file: string; line: number }[]; ensures: string[] } {
  const lines: { text: string; file: string; line: number }[] = [];
  const ensures: string[] = [];
  for (const f of cfg) {
    f.content.split(/\r?\n/).forEach((raw, i) => {
      const text = raw.replace(/#.*$/, "").replace(/\/\/.*$/, "").trim();
      if (!text) return;
      lines.push({ text, file: f.path, line: i + 1 });
      const m = /^(ensure|start)\s+(\S+)/i.exec(text);
      if (m) ensures.push(m[2]);
    });
  }
  return { lines, ensures };
}

/** The report of a scan: files' findings (from the reputation), the server checks, the scores. */
export function buildReport(inv: Inventory, results: Map<string, FileResult>, artifacts: Artifacts): Report {
  const findings: Finding[] = [];
  const push = (rule: string, detail: string, where: Partial<Finding> = {}) => {
    const r = RULES[rule];
    findings.push({ rule, category: r.category, severity: r.severity, title: r.title, detail, fix: r.fix, ...where });
  };
  const byName = new Map(inv.resources.map((r) => [r.name, r]));
  const stats = { resources: inv.resources.length, files: 0, code: 0, analyzed: 0, known: 0, protected: 0, skipped: 0, streamed: 0 };
  const eventsBy = new Map<string, Set<string>>();
  const streamBy = new Map<string, Set<string>>();
  const fingerprints = new Map<string, string[]>();

  for (const res of inv.resources) {
    stats.files += res.files.length;
    if (res.protected) {
      stats.protected++;
      push("protected", "Fichiers chiffrés par l'escrow de Cfx.re.", { resource: res.name });
    }
    if (res.meta.legacy) push("legacy_manifest", "", { resource: res.name, file: "__resource.lua" });
    else if (!res.meta.fx_version || ["adamant", "bodacious"].includes(res.meta.fx_version)) {
      push("old_fx_version", res.meta.fx_version ? `fx_version '${res.meta.fx_version}'` : "fx_version absent.", { resource: res.name, file: "fxmanifest.lua" });
    }
    const hasLua = res.files.some((f) => f.p.endsWith(".lua") && !f.enc && f.p !== "fxmanifest.lua" && f.p !== "__resource.lua");
    if (hasLua && !res.meta.legacy && res.meta.lua54 !== "yes" && !res.protected) push("no_lua54", "", { resource: res.name, file: "fxmanifest.lua" });

    for (const dep of res.meta.dependencies ?? []) {
      const name = dep.replace(/\s*[<>=].*$/, "").trim();
      if (!name || NOT_RESOURCE.test(name)) continue;
      const target = byName.get(name);
      if (!target) push("missing_dependency", `« ${name} » est requise mais absente du serveur.`, { resource: res.name, file: "fxmanifest.lua" });
      else if (res.state === "started" && target.state !== "started") push("stopped_dependency", `« ${name} » est ${target.state}.`, { resource: res.name });
    }
    if (res.files.some((f) => f.p.includes("mysql-async")) || res.name === "mysql-async" || res.name === "ghmattimysql") {
      push("old_mysql", `Ressource ${res.name} installée.`, { resource: res.name });
    }

    const hashes: string[] = [];
    for (const f of res.files) {
      if (f.kind === "stream") {
        stats.streamed++;
        const base = f.p.split("/").pop()!.toLowerCase();
        if (!streamBy.has(base)) streamBy.set(base, new Set());
        streamBy.get(base)!.add(res.name);
        if (f.size > STREAM_LIMIT) push("oversized_asset", `${(f.size / 1048576).toFixed(1)} Mo (limite 16 Mo).`, { resource: res.name, file: f.p });
        continue;
      }
      if (f.kind !== "code" || !f.hash) continue;
      stats.code++;
      hashes.push(f.hash);
      if (f.enc) continue;
      const r = results.get(fileKey(f));
      if (!r) {
        stats.skipped++;
        continue;
      }
      stats.analyzed++;
      for (const finding of r.findings) findings.push({ ...finding, resource: res.name, file: f.p });
      if (f.role === "server" || f.role === "shared") {
        for (const e of r.events) {
          if (!eventsBy.has(e)) eventsBy.set(e, new Set());
          eventsBy.get(e)!.add(res.name);
        }
      }
    }
    if (hashes.length >= 3) {
      const print = [...hashes].sort().join(",");
      fingerprints.set(print, [...(fingerprints.get(print) ?? []), res.name]);
    }
  }
  if (stats.skipped) push("not_analyzed", `${stats.skipped} fichier(s) de code n'ont pas pu être analysés${inv.confidential ? " (mode confidentiel)" : ""}.`);

  for (const [base, owners] of streamBy) {
    if (owners.size > 1 && !/^(_manifest|\.)/.test(base)) push("duplicate_asset", `${base} : ${[...owners].join(", ")}.`, { resource: [...owners][0], file: base });
  }
  for (const names of fingerprints.values()) {
    if (names.length > 1) push("duplicate_resource", `Fichiers identiques : ${names.join(", ")}.`, { resource: names[1] });
  }
  for (const [name, owners] of eventsBy) {
    // Namespaced events ("esx:playerLoaded") are listened to by many resources on purpose.
    if (owners.size > 1 && !name.includes(":")) push("event_conflict", `« ${name} » : ${[...owners].join(", ")}.`, { resource: [...owners][0] });
  }

  // ---- server.cfg & convars ----
  const { lines, ensures } = parseCfg(inv.cfg);
  if (!inv.cfg.length) push("no_cfg", "");
  const convar = (name: string) => inv.convars[name] ?? "";
  if (["1", "true"].includes(convar("sv_scriptHookAllowed").toLowerCase())) push("scripthook", "sv_scriptHookAllowed vaut 1.");
  for (const l of lines) {
    const ace = /^add_ace\s+(\S+)\s+(\S+)\s+allow/i.exec(l.text);
    if (!ace) continue;
    const [, principal, object] = ace;
    if (/^(builtin\.everyone|group\.user)$/i.test(principal) && /^(command|command\.(?!help\b)\w+|\*|fiverax\.bypass|txadmin\..*|.*admin.*)$/i.test(object)) {
      push("open_ace", l.text, { file: l.file, line: l.line, snippet: l.text });
    } else if (/^resource\./i.test(principal) && /^command$/i.test(object) && !/^resource\.(fiverax_agent|monitor|txadmin)$/i.test(principal)) {
      push("wide_ace", l.text, { file: l.file, line: l.line, snippet: l.text });
    }
  }
  if (inv.rcon) push("rcon", "rcon_password est défini.");
  if (inv.cfg.length && !["true", "1"].includes(convar("sv_endpointprivacy").toLowerCase())) push("endpoint_privacy", "");
  if (inv.cfg.length && !convar("sv_enforceGameBuild")) push("game_build", "");
  if (artifacts) {
    if (artifacts.critical && artifacts.build < artifacts.critical) push("critical_artifacts", `Build ${artifacts.build}, minimum sûr ${artifacts.critical}.`);
    else if (artifacts.recommended && artifacts.build < artifacts.recommended) push("old_artifacts", `Build ${artifacts.build}, recommandé ${artifacts.recommended}.`);
  }
  // Order of the ensures: a dependency started after the resource needing it.
  const position = new Map(ensures.map((n, i) => [n, i]));
  for (const res of inv.resources) {
    const at = position.get(res.name);
    if (at === undefined) continue;
    for (const dep of res.meta.dependencies ?? []) {
      const d = position.get(dep.replace(/\s*[<>=].*$/, "").trim());
      if (d !== undefined && d > at) push("ensure_order", `${dep} est démarrée après ${res.name}.`, { resource: res.name });
    }
  }

  return { engine: ENGINE, ...score(findings), stats };
}

const SEV_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, info: 3 };

/** Scores out of 100 (per category, then weighted), findings sorted most severe first. */
export function score(findings: Finding[]): Pick<Report, "score" | "categories" | "findings"> {
  const categories = Object.fromEntries(
    CATEGORIES.map((c) => [c.key, { score: 100, counts: { critical: 0, high: 0, medium: 0, info: 0 } }])
  ) as Record<Category, CategoryScore>;
  const penalty = new Map<Category, number>();
  // The same rule repeated loses weight: a problem copied in 40 files is not 40 times worse.
  const seen = new Map<string, number>();
  for (const f of findings) {
    const cat = categories[f.category];
    cat.counts[f.severity]++;
    const k = `${f.category}:${f.rule}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    penalty.set(f.category, (penalty.get(f.category) ?? 0) + PENALTY[f.severity] / Math.sqrt(n));
  }
  for (const c of CATEGORIES) {
    const value = Math.max(0, Math.round(100 - (penalty.get(c.key) ?? 0)));
    // One critical problem caps the category: it cannot look "good".
    categories[c.key].score = categories[c.key].counts.critical ? Math.min(value, 40) : value;
  }
  let total = Math.round(CATEGORIES.reduce((sum, c) => sum + categories[c.key].score * c.weight, 0));
  if (categories.security.counts.critical) total = Math.min(total, 35);
  return {
    score: total,
    categories,
    findings: [...findings].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || (a.resource ?? "").localeCompare(b.resource ?? "") || (a.file ?? "").localeCompare(b.file ?? ""))
  };
}
