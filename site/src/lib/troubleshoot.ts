import { z } from "zod";
import { aiConfigured, chatJson } from "./ai";
import { COMMANDS, getConsole, getLiveState, type ConsoleLine, type LiveState } from "./agent";
import { latestReport } from "./server-audit";
import { cachedFiles, editSchema, listings, type Edit } from "./resource-files";
import { FILE_LIMITS, isEditablePath, RESOURCE_NAME_RE } from "./resource-files-shared";

/**
 * Troubleshooting assistant of "Ressources & console": the admin describes a problem in game (a resource that does
 * not start, a script error, a broken job…) and the AI answers from what the panel already knows of the server:
 * the console (errors first), the state of every resource and the findings of the latest scan.
 *
 * The AI never acts by itself: it proposes actions (a console command, start / stop / restart a resource) that the
 * admin runs with a click, through the usual command API and its permissions.
 *
 * With the permission `server_files`, it can also ask to read files of a resource (the panel fetches them through
 * the agent, then asks again with their content) and propose edits, which the admin reviews as a diff before they
 * are written (lib/resource-files.ts).
 */

export class TroubleshootError extends Error {}

const RESOURCE_NAME = /^[\w.\-[\]]{1,100}$/;
const MAX_TURNS = 12;
const MAX_MESSAGE = 4000;

export const troubleshootSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(MAX_MESSAGE) }))
    .min(1)
    .max(40),
  /** A resource the question is about (optional): its console lines are sent in priority. */
  resource: z.string().regex(RESOURCE_NAME).optional(),
  /** Files already read in this conversation (their cached content goes to the AI) and resources already listed. */
  files: z.array(z.object({ resource: z.string().regex(RESOURCE_NAME_RE), path: z.string().refine(isEditablePath) })).max(FILE_LIMITS.opened).default([]),
  listed: z.array(z.string().regex(RESOURCE_NAME_RE)).max(6).default([])
});
export type TroubleshootRequest = z.input<typeof troubleshootSchema>;

/** What the AI may do on players (each is a panel command, with its own permission). */
export const PLAYER_COMMANDS = ["game", "kick", "dm", "freeze"] as const;
export type PlayerCommand = (typeof PLAYER_COMMANDS)[number];
/** Command kinds the admin may run (from their permissions); the AI is told and its other actions are dropped. */
export type AllowedKinds = Set<"console" | "resource" | "announce" | PlayerCommand>;

export type TroubleshootAction =
  | { kind: "console"; command: string; label: string }
  | { kind: "resource"; action: "start" | "stop" | "restart"; name: string; label: string }
  | { kind: "announce"; message: string; label: string }
  /** `description`: written by the panel from the payload (what the confirmation shows), never by the AI. */
  | { kind: "player"; command: PlayerCommand; payload: Record<string, unknown>; player: string; label: string; description: string };
export type ReadRequest = { resource: string; paths?: string[] };
export type TroubleshootReply = { answer: string; actions: TroubleshootAction[]; read: ReadRequest[]; edits: Edit[]; summary: string };

/** Lines that look like a problem (FiveM / Lua / JS / MySQL / txAdmin wording). */
export const ERROR_LINE =
  /error|erreur|warn|fail|couldn'?t|could not|unable|missing|not found|attempt to (index|call|compare|perform)|nil value|stack traceback|exception|cannot|timed? ?out|refused|denied|unexpected|invalid|deprecated|crash/i;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const fmtLine = (l: ConsoleLine) => `${l.at.slice(11, 19)} ${l.channel ? `[${l.channel}] ` : ""}${clip(l.message.replace(/\s+$/, ""), 400)}`;

/** Pure: the console as the AI reads it — problem lines (and those of the resource asked about), then the latest lines. */
export function consoleDigest(lines: ConsoleLine[], resource?: string, budget = 12_000): string {
  const needle = resource?.toLowerCase();
  const recent = lines.slice(-40);
  const recentIds = new Set(recent.map((l) => l.id));
  const flagged = lines.filter(
    (l) => !recentIds.has(l.id) && (ERROR_LINE.test(l.message) || (needle && (l.message.toLowerCase().includes(needle) || l.channel?.toLowerCase() === needle)))
  );
  // Keep the newest flagged lines that fit, then the tail of the console.
  const out: string[] = [];
  let used = 0;
  const tail = recent.map(fmtLine);
  const tailSize = tail.reduce((n, l) => n + l.length + 1, 0);
  for (const l of flagged.slice().reverse()) {
    const text = fmtLine(l);
    if (used + text.length + tailSize > budget) break;
    out.unshift(text);
    used += text.length + 1;
  }
  return [
    out.length ? `--- Lignes suspectes plus anciennes (${out.length}) ---\n${out.join("\n")}` : "",
    `--- Dernières lignes de la console ---\n${tail.join("\n") || "(vide)"}`
  ].filter(Boolean).join("\n\n");
}

function playersDigest(live: LiveState): string {
  if (!live.players.length) return "Aucun joueur connecté.";
  return clip(live.players.map((p) => `id ${p.id} · ${p.name}${p.staff ? ` · staff ${p.staff.grade || ""}`.trimEnd() : ""}${p.zone ? ` · ${p.zone}` : ""}`).join("\n"), 12_000);
}

const KIND_LABEL: Record<string, string> = {
  console: "commandes console", resource: "ressources", announce: "annonces", game: "argent / objets / job / soin / téléportation",
  kick: "expulsion", dm: "messages privés", freeze: "gel"
};
function allowedNote(allowed?: AllowedKinds): string {
  if (!allowed) return "";
  const missing = Object.keys(KIND_LABEL).filter((k) => !allowed.has(k as never)).map((k) => KIND_LABEL[k]);
  return missing.length ? `\nL'admin n'a PAS le droit de faire : ${missing.join(", ")}. Ne propose pas ces actions ; dis-lui qu'il lui manque la permission si c'est ce qu'il demande.` : "";
}

function resourcesDigest(live: LiveState): string {
  if (!live.resources.length) return "Aucune liste de ressources reçue.";
  const started = live.resources.filter((r) => r.state === "started").map((r) => r.name);
  const other = live.resources.filter((r) => r.state !== "started").map((r) => `${r.name} (${r.state})`);
  return `Démarrées (${started.length}) : ${clip(started.join(", "), 5000)}\nNon démarrées (${other.length}) : ${clip(other.join(", ") || "aucune", 3000)}`;
}

async function scanDigest(serverId: string): Promise<string> {
  const scan = await latestReport(serverId);
  const findings = scan?.report?.findings.filter((f) => f.severity !== "info").slice(0, 15) ?? [];
  if (!scan?.report) return "Aucun scan du serveur disponible.";
  return [
    `Dernier scan (${scan.createdAt.slice(0, 10)}) : score ${scan.report.score}/100.`,
    ...findings.map((f) => `- [${f.severity}] ${f.title}${f.resource ? ` — ${f.resource}${f.file ? `/${f.file}${f.line ? `:${f.line}` : ""}` : ""}` : ""}`)
  ].join("\n");
}

/** Contents of the files read in the conversation, newest first, within a budget (characters). */
function filesDigest(files: { resource: string; path: string; content: string }[], budget = 90_000): string {
  const out: string[] = [];
  let used = 0;
  for (const f of files.slice().reverse()) {
    const body = f.content.length > 40_000 ? `${f.content.slice(0, 40_000)}\n… (fichier coupé : ${f.content.length} caractères)` : f.content;
    if (used + body.length > budget) {
      out.push(`### ${f.resource}/${f.path}\n(non inclus : trop de fichiers ouverts, redemande-le si besoin)`);
      continue;
    }
    out.push(`### ${f.resource}/${f.path}\n\`\`\`\n${body}\n\`\`\``);
    used += body.length;
  }
  return out.length ? `\n## Fichiers lus (contenu actuel sur le serveur)\n${out.reverse().join("\n\n")}` : "";
}

const SYSTEM = `Tu es l'assistant d'un panel de gestion de serveurs FiveM (GTA V RP), le bras droit de l'admin. Deux rôles :
1. Dépannage : ressource qui ne démarre pas, erreur de script (SCRIPT ERROR, attempt to index a nil value…), dépendance manquante, mauvais ordre des ensure, erreur oxmysql / SQL, NUI qui ne s'affiche pas, framework ESX / QBCore / Qbox / ox_lib mal configuré, lag, server.cfg…
2. Gestion en jeu : rembourser ou donner de l'argent, donner / retirer des objets, changer le job, réanimer, soigner, téléporter, envoyer un message, geler, expulser, faire une annonce… L'admin parle naturellement (« rembourse 5000 à Tata », « mets Bob mécano grade 2 », « réanime tout le monde ») : tu traduis en actions.
Tu reçois l'état du serveur : les joueurs connectés (id serveur et nom), les ressources, la console (lignes suspectes puis dernières lignes) et le dernier scan.

Méthode :
- Appuie-toi sur les lignes de console : cite la ligne d'erreur utile, nomme la ressource et le fichier en cause, explique la cause probable en mots simples.
- Donne des étapes concrètes et numérotées. Si un fichier doit être modifié, donne le chemin (ex. resources/[jobs]/mon_job/server.lua) et le code corrigé dans un bloc \`\`\`lua … \`\`\`.
- Si l'information manque (console vide, erreur trop ancienne), dis exactement quoi faire pour la faire apparaître (ex. redémarrer la ressource puis reposer la question) — n'invente rien.
- Reste bref et en français. Pas de blabla.

Actions : tu peux proposer jusqu'à 8 actions ; l'admin confirme chacune d'un clic (rien ne part sans lui).
- {"kind":"resource","action":"start|stop|restart","name":"nom_exact","label":"Redémarrer mon_job"} — uniquement pour une ressource de la liste.
- {"kind":"console","command":"ensure mon_job","label":"…"} — une commande de console FiveM (ensure, refresh, restart, stop, start, status, txAdmin…). Jamais quit, ni de commande qui supprime des données ou bannit.
- {"kind":"announce","message":"…"} — annonce à tout le serveur.
- Sur un joueur CONNECTÉ ("target" = son id serveur dans la liste des joueurs) :
  {"kind":"player","command":"game","payload":{"op":"give_money","target":12,"account":"cash|bank|black_money","amount":5000}}  (remove_money pareil)
  {"kind":"player","command":"game","payload":{"op":"give_item","target":12,"item":"nom_technique","count":1}}  (remove_item pareil ; nom technique de l'objet : bread, water, phone, lockpick…)
  {"kind":"player","command":"game","payload":{"op":"set_job","target":12,"job":"mechanic","grade":0}}
  {"kind":"player","command":"game","payload":{"op":"revive|heal|info","target":12}}  (info : argent, job et groupe du joueur)
  {"kind":"player","command":"game","payload":{"op":"teleport","target":12,"to":7}}  ou  {"op":"teleport","target":12,"x":298.6,"y":-584.6,"z":43.3}
  {"kind":"player","command":"dm","payload":{"target":12,"message":"…"}}   {"kind":"player","command":"kick","payload":{"target":12,"reason":"…"}}   {"kind":"player","command":"freeze","payload":{"target":12,"on":true}}
- Retrouve le joueur par son nom dans la liste (approximatif : majuscules, accents, bout de pseudo). Si plusieurs joueurs correspondent ou aucun, ne devine pas : demande lequel, ou dis qu'il n'est pas connecté (les actions ne marchent que sur les joueurs en ligne ; pour un joueur hors ligne, propose de le faire à sa prochaine connexion).
- Montant flou (« un peu d'argent ») ou compte non précisé : liquide (cash) par défaut pour un remboursement, et dis-le. « Tout le monde » : une action par joueur (8 max), sinon demande.
- Avant de modifier l'argent ou un job sans savoir l'état du joueur, tu peux d'abord proposer "info".
- Ne propose une action que si elle aide vraiment ; sinon "actions":[]. "answer" résume ce que les actions vont faire.

Réponds UNIQUEMENT par un objet JSON valide :
{"answer":"ta réponse (texte, retours à la ligne et blocs de code autorisés)","actions":[...]}`;

const FILES_ON = `
Fichiers des ressources : tu peux les LIRE et les MODIFIER toi-même.
- Lire : ajoute "read":[{"resource":"nom_exact"}] pour la liste des fichiers et le fxmanifest, ou "read":[{"resource":"nom_exact","paths":["server.lua","config.lua"]}] (20 fichiers max). Dans ce cas "answer" dit en une phrase ce que tu vas regarder : le panel lit les fichiers et te repose la question avec leur contenu. Ne devine jamais un contenu que tu n'as pas lu.
- Modifier : ajoute "summary":"ce que la modification corrige, 1 phrase" et "edits":[{"resource":"nom_exact","path":"server.lua","patches":[{"find":"texte EXACT actuel (quelques lignes, unique dans le fichier)","replace":"nouveau texte"}]}]. Pour un nouveau fichier ou un petit fichier réécrit : {"resource":"…","path":"…","content":"contenu complet"} ; "content":null supprime le fichier.
- Une seule ressource par modification ; uniquement des fichiers que tu as lus (sauf nouveau fichier). Corrige la cause, sans réécrire ce qui marche. L'admin voit le diff et valide ; la ressource est redémarrée ensuite, puis tu peux vérifier la console.
- Si une modification a été refusée (texte introuvable…), relis le fichier et recommence.`;

const FILES_OFF = `
Tu n'as pas accès aux fichiers (permission « Laisser l'assistant IA lire et modifier les fichiers » absente) : donne le chemin et le code corrigé à copier.`;

const FORBIDDEN_COMMAND = /^\s*(quit|exit|killserver|txaReboot)\b|\b(ban|wipe|drop\s+table|truncate|delete\s+from)\b/i;

const ACCOUNT_LABEL: Record<string, string> = { cash: "liquide", bank: "banque", black_money: "argent sale" };
const fmt = (n: unknown) => Number(n).toLocaleString("fr-FR");

/** Pure: what a player action does, in French, from its validated payload (shown in the confirmation). */
export function describePlayerAction(command: PlayerCommand, p: Record<string, unknown>, name: string, players: Map<number, string>): string {
  const who = `${name} (id ${p.target})`;
  if (command === "dm") return `Message privé à ${who} : « ${p.message} »`;
  if (command === "kick") return `Expulser ${who} : « ${p.reason} »`;
  if (command === "freeze") return `${p.on ? "Geler" : "Dégeler"} ${who}`;
  switch (p.op) {
    case "give_money": return `Donner ${fmt(p.amount)} $ (${ACCOUNT_LABEL[String(p.account)]}) à ${who}`;
    case "remove_money": return `Retirer ${fmt(p.amount)} $ (${ACCOUNT_LABEL[String(p.account)]}) à ${who}`;
    case "give_item": return `Donner ${p.count}x ${p.item} à ${who}`;
    case "remove_item": return `Retirer ${p.count}x ${p.item} à ${who}`;
    case "set_job": return `Mettre ${who} job ${p.job}, grade ${p.grade}`;
    case "revive": return `Réanimer ${who}`;
    case "heal": return `Soigner ${who}`;
    case "info": return `Voir l'argent et le job de ${who}`;
    case "teleport":
      return p.to !== undefined
        ? `Téléporter ${who} vers ${players.get(Number(p.to)) ?? "?"} (id ${p.to})`
        : `Téléporter ${who} en (${Math.round(Number(p.x))}, ${Math.round(Number(p.y))}, ${Math.round(Number(p.z))})`;
    default: return `Action sur ${who}`;
  }
}

/**
 * Pure: read the model's JSON reply; actions are filtered (known resources and connected players, payload validated
 * like the panel's commands, no dangerous console command, only kinds the admin may run).
 */
export function parseTroubleshoot(text: string, resources: Set<string>, players: Map<number, string> = new Map(), allowed?: AllowedKinds): TroubleshootReply | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof d.answer !== "string" || !d.answer.trim()) return null;
  const actions: TroubleshootAction[] = [];
  for (const raw of Array.isArray(d.actions) ? d.actions : []) {
    if (!raw || typeof raw !== "object" || actions.length >= 8) continue;
    const a = raw as Record<string, unknown>;
    const label = typeof a.label === "string" ? a.label.trim().slice(0, 80) : "";
    if (allowed && !allowed.has((a.kind === "player" ? a.command : a.kind) as never)) continue;
    if (a.kind === "player" && typeof a.command === "string" && (PLAYER_COMMANDS as readonly string[]).includes(a.command)) {
      const command = a.command as PlayerCommand;
      const parsed = COMMANDS[command].schema.safeParse(a.payload);
      if (!parsed.success) continue;
      const payload = parsed.data as Record<string, unknown>;
      const name = players.get(Number(payload.target));
      if (name === undefined) continue; // not connected
      if (payload.to !== undefined && !players.has(Number(payload.to))) continue;
      const description = describePlayerAction(command, payload, name, players);
      actions.push({ kind: "player", command, payload, player: name, label: label || description, description });
    } else if (a.kind === "announce" && typeof a.message === "string" && a.message.trim()) {
      const message = a.message.trim().slice(0, 300);
      actions.push({ kind: "announce", message, label: label || "Faire l'annonce" });
    } else if (a.kind === "resource" && typeof a.name === "string" && resources.has(a.name) && (a.action === "start" || a.action === "stop" || a.action === "restart")) {
      if (a.name === "fiverax_agent" && a.action !== "start") continue;
      const verb = { start: "Démarrer", stop: "Arrêter", restart: "Redémarrer" }[a.action];
      actions.push({ kind: "resource", action: a.action, name: a.name, label: label || `${verb} ${a.name}` });
    } else if (a.kind === "console" && typeof a.command === "string") {
      const command = a.command.trim().slice(0, 500);
      if (!command || FORBIDDEN_COMMAND.test(command) || /fiverax_agent/i.test(command)) continue;
      actions.push({ kind: "console", command, label: label || command });
    }
  }
  const read: ReadRequest[] = [];
  for (const raw of Array.isArray(d.read) ? d.read : []) {
    if (!raw || typeof raw !== "object" || read.length >= 3) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.resource !== "string" || !resources.has(r.resource) || r.resource === "fiverax_agent") continue;
    const paths = Array.isArray(r.paths) ? r.paths.filter((p): p is string => typeof p === "string" && isEditablePath(p)).slice(0, FILE_LIMITS.readPaths) : [];
    read.push(paths.length ? { resource: r.resource, paths } : { resource: r.resource });
  }
  const edits: Edit[] = [];
  for (const raw of Array.isArray(d.edits) ? d.edits : []) {
    const parsed = editSchema.safeParse(raw);
    if (parsed.success && resources.has(parsed.data.resource) && edits.length < FILE_LIMITS.files) edits.push(parsed.data);
  }
  const summary = typeof d.summary === "string" ? d.summary.trim().slice(0, 500) : "";
  return { answer: d.answer.trim().slice(0, 12_000), actions, read, edits, summary };
}

/** One turn of the conversation: the server's current state + the history → the AI's answer. */
export async function troubleshoot(serverId: string, req: TroubleshootRequest, opts: { files: boolean; allowed?: AllowedKinds } = { files: false }): Promise<TroubleshootReply> {
  if (!aiConfigured()) throw new TroubleshootError("ai_not_configured");
  const [live, lines, scan, opened, listed] = await Promise.all([
    getLiveState(serverId), getConsole(serverId, 0, 600), scanDigest(serverId),
    opts.files ? cachedFiles(serverId, req.files ?? []) : Promise.resolve([]),
    opts.files ? listings(serverId, req.listed ?? []) : Promise.resolve([])
  ]);

  const state = [
    `Serveur : ${live.hostname ?? "?"} · ${live.online ? "en ligne" : "HORS LIGNE (agent muet)"} · build ${live.build ?? "?"} · ${live.players.length}/${live.maxClients} joueurs · en route depuis ${Math.round(live.uptime / 60)} min`,
    req.resource ? `Ressource concernée : ${req.resource} (état : ${live.resources.find((r) => r.name === req.resource)?.state ?? "absente de la liste"})` : "",
    `\n## Joueurs connectés (${live.players.length})\n${playersDigest(live)}`,
    `\n## Ressources\n${resourcesDigest(live)}`,
    `\n## Console\n${consoleDigest(lines, req.resource)}`,
    `\n## Scan\n${scan}`,
    ...listed.map((l) => `\n## Fichiers de ${l.resource}\n${clip(l.files.map((f) => `${f.path} (${f.size} o)`).join("\n"), 6000)}`),
    filesDigest(opened)
  ].filter(Boolean).join("\n");

  const history = req.messages.slice(-MAX_TURNS);
  const conversation = history.map((m) => `${m.role === "user" ? "ADMIN" : "ASSISTANT"} : ${m.content}`).join("\n\n");
  const user = `# État actuel du serveur\n${state}\n\n# Conversation\n${conversation}\n\nRéponds au dernier message de l'ADMIN.`;

  let reply: TroubleshootReply | null;
  try {
    const text = await chatJson(SYSTEM + (opts.files ? FILES_ON : FILES_OFF) + allowedNote(opts.allowed), user, { model: process.env.AI_CODE_MODEL, maxTokens: Number(process.env.AI_CODE_MAX_TOKENS) || 4000, temperature: 0.2, timeoutMs: 55_000 });
    reply = parseTroubleshoot(text, new Set(live.resources.map((r) => r.name)), new Map(live.players.map((p) => [p.id, p.name])), opts.allowed);
    if (reply && !opts.files) reply = { ...reply, read: [], edits: [] };
  } catch (error) {
    throw new TroubleshootError(error instanceof Error ? error.message : "ai_error");
  }
  if (!reply) throw new TroubleshootError("ai_unreadable");
  return reply;
}
