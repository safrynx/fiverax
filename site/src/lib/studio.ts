import { chatJson } from "./ai";
import { auditStmt } from "./audit";
import { db, stmt } from "./db";
import {
  cleanFiles, cleanMap, cleanTests, EMPTY_MAP, filesHash, mapFiles, PROPS, resourceSlug, RESOURCE_RE,
  type CreationKind, type Framework, type MapData, type StudioFile, type UITest
} from "./studio-shared";
import { blocksFiles, cleanBlocks, STARTER_BLOCKS } from "./studio-blocks";
import { cleanUIDesign, UI_TEMPLATES, uiFiles, uiTests, type UIDesign } from "./studio-ui";

/**
 * Studio IA: UI, scripts and mappings made from the panel. A creation is a FiveM resource (its files) plus the data
 * its editor works on (test messages of a UI, objects of a mapping). Every change (AI, hand edit, restore) is a
 * version, so nothing is ever lost. A creation can be downloaded as a .zip or deployed by the agent (`deploy`).
 *
 * The AI is the same OpenAI-compatible API as the weekly review (AI_BASE_URL / AI_API_KEY), with AI_CODE_MODEL.
 */

export type Actor = { discordId: string; username?: string | null };

/**
 * `mode: "visual"`: the script is made of blocks, the UI with the simple builder; its files are generated from
 * `blocks` / `ui` (like a mapping's from `map`). Without it, the files are the code (written by hand or by the AI).
 */
export type CreationData = { tests?: UITest[]; map?: MapData; mode?: "visual" | "code"; blocks?: unknown; ui?: UIDesign };

export type DeployState = { status: "none" | "pending" | "sent" | "done" | "failed" | "expired"; message: string | null; at: string | null; current: boolean };

export type CreationSummary = {
  id: number;
  kind: CreationKind;
  name: string;
  resource: string;
  framework: Framework;
  updatedAt: string;
  fileCount: number;
  deploy: DeployState;
};

export type Version = { id: number; source: "ai" | "manual" | "restore" | "create" | "library"; prompt: string | null; summary: string | null; author: string | null; createdAt: string };

export type Creation = CreationSummary & { files: StudioFile[]; data: CreationData; versions: Version[] };

const KEEP_VERSIONS = 40;
const iso = () => new Date().toISOString();

type Row = {
  id: number; kind: CreationKind; name: string; resource: string; framework: Framework; files_json: string; data_json: string; updated_at: string;
  deploy_hash: string | null; deployed_at: string | null; cmd_status: string | null; cmd_result: string | null;
};

const SELECT = `SELECT c.id, c.kind, c.name, c.resource, c.framework, c.files_json, c.data_json, c.updated_at, c.deploy_hash, c.deployed_at,
  f.status AS cmd_status, f.result AS cmd_result
  FROM studio_creations c LEFT JOIN fivem_commands f ON f.id = c.deploy_command_id AND f.server_id = c.server_id`;

function parse<T>(raw: string | null, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function toSummary(r: Row): CreationSummary & { filesList: StudioFile[]; data: CreationData } {
  const files = parse<StudioFile[]>(r.files_json, []);
  const status = (r.cmd_status ?? (r.deployed_at ? "sent" : "none")) as DeployState["status"];
  return {
    id: Number(r.id),
    kind: r.kind,
    name: r.name,
    resource: r.resource,
    framework: r.framework,
    updatedAt: r.updated_at,
    fileCount: files.length,
    deploy: { status, message: r.cmd_result, at: r.deployed_at, current: Boolean(r.deploy_hash && r.deploy_hash === filesHash(files)) },
    filesList: files,
    data: parse<CreationData>(r.data_json, {})
  };
}

export async function listCreations(serverId: string, kind: CreationKind): Promise<CreationSummary[]> {
  const rows = await db.all<Row>(`${SELECT} WHERE c.server_id = ? AND c.kind = ? ORDER BY c.updated_at DESC`, [serverId, kind]);
  return rows.map((r) => {
    const { filesList: _f, data: _d, ...summary } = toSummary(r);
    return summary;
  });
}

export async function getCreation(serverId: string, id: number): Promise<Creation | null> {
  const [rows, versions] = await db.batch(
    [
      stmt(`${SELECT} WHERE c.server_id = ? AND c.id = ?`, [serverId, id]),
      stmt(
        `SELECT v.id, v.source, v.prompt, v.summary, COALESCE(v.author_name, s.username, v.author_discord_id) AS author, v.created_at
         FROM studio_versions v LEFT JOIN staff_members s ON s.server_id = v.server_id AND s.discord_id = v.author_discord_id
         WHERE v.server_id = ? AND v.creation_id = ? ORDER BY v.id DESC`,
        [serverId, id]
      )
    ],
    "read"
  );
  const row = rows.rows[0] as unknown as Row | undefined;
  if (!row) return null;
  const { filesList, ...summary } = toSummary(row);
  const data = summary.kind === "map" ? { ...summary.data, map: cleanMap(summary.data.map) } : summary.data;
  return {
    ...summary,
    files: filesList,
    data,
    versions: versions.rows.map((v) => ({
      id: Number(v.id), source: v.source as Version["source"], prompt: (v.prompt as string | null) ?? null, summary: (v.summary as string | null) ?? null,
      author: (v.author as string | null) ?? null, createdAt: String(v.created_at)
    }))
  };
}

export class StudioError extends Error {}

/** Files of a creation from its data: a mapping's or a visual creation's files are generated, the others are what was written. */
export function normalise(kind: CreationKind, name: string, framework: Framework, files: StudioFile[], data: CreationData): { files: StudioFile[]; data: CreationData } {
  if (kind === "map") {
    const map = cleanMap(data.map);
    return { files: mapFiles(name, map), data: { map } };
  }
  try {
    if (kind === "script" && data.mode === "visual") {
      const blocks = cleanBlocks(data.blocks);
      return { files: blocksFiles(name, framework, blocks).files, data: { mode: "visual", blocks } };
    }
    if (kind === "ui" && data.mode === "visual") {
      const ui = cleanUIDesign(data.ui);
      return { files: uiFiles(name, ui), data: { mode: "visual", ui, tests: uiTests(ui) } };
    }
    return { files: cleanFiles(files), data: kind === "ui" ? { tests: cleanTests(data.tests) } : {} };
  } catch (error) {
    throw new StudioError(error instanceof Error ? error.message : "invalid_files");
  }
}

export async function createCreation(
  serverId: string,
  actor: Actor,
  input: { kind: CreationKind; name: string; resource?: string; framework: Framework; center?: [number, number, number]; visual?: boolean; template?: string }
): Promise<number> {
  const resource = input.resource || resourceSlug(input.name);
  if (!RESOURCE_RE.test(resource)) throw new StudioError("invalid_resource");
  const taken = await db.get("SELECT 1 FROM studio_creations WHERE server_id = ? AND resource = ?", [serverId, resource]);
  if (taken) throw new StudioError("resource_taken");
  const startData: CreationData =
    input.kind === "map" ? { map: { ...EMPTY_MAP, center: input.center ?? EMPTY_MAP.center } }
    : !input.visual ? {}
    : input.kind === "script" ? { mode: "visual", blocks: STARTER_BLOCKS }
    : { mode: "visual", ui: (UI_TEMPLATES.find((t) => t.key === input.template) ?? UI_TEMPLATES[0]).make() };
  const start = normalise(input.kind, input.name, input.framework, [], startData);
  const now = iso();
  const [insert] = await db.batch([
    stmt(
      `INSERT INTO studio_creations (server_id, kind, name, resource, framework, files_json, data_json, author_discord_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [serverId, input.kind, input.name, resource, input.framework, JSON.stringify(start.files), JSON.stringify(start.data), actor.discordId, now, now]
    ),
    auditStmt(serverId, actor, "studio_create", null, { kind: input.kind, name: input.name, resource })
  ]);
  const id = Number(insert.rows[0].id);
  await db.run(
    `INSERT INTO studio_versions (creation_id, server_id, source, prompt, summary, files_json, data_json, author_discord_id, author_name, created_at)
     VALUES (?, ?, 'create', NULL, 'Création', ?, ?, ?, ?, ?)`,
    [id, serverId, JSON.stringify(start.files), JSON.stringify(start.data), actor.discordId, actor.username ?? null, now]
  );
  return id;
}

/** Save new files / data as a version. `files` is ignored for a mapping (generated from its data). */
export async function saveCreation(
  serverId: string,
  actor: Actor,
  id: number,
  change: { files?: StudioFile[]; data?: CreationData; name?: string; framework?: Framework },
  meta: { source: Version["source"]; prompt?: string | null; summary?: string | null }
): Promise<Creation> {
  const current = await getCreation(serverId, id);
  if (!current) throw new StudioError("unknown_creation");
  const name = change.name?.trim() || current.name;
  const framework = change.framework ?? current.framework;
  const next = normalise(current.kind, name, framework, change.files ?? current.files, { ...current.data, ...(change.data ?? {}) });
  const now = iso();
  await db.batch([
    stmt("UPDATE studio_creations SET name = ?, framework = ?, files_json = ?, data_json = ?, updated_at = ? WHERE server_id = ? AND id = ?", [
      name, framework, JSON.stringify(next.files), JSON.stringify(next.data), now, serverId, id
    ]),
    stmt(
      `INSERT INTO studio_versions (creation_id, server_id, source, prompt, summary, files_json, data_json, author_discord_id, author_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, serverId, meta.source, meta.prompt ?? null, meta.summary ?? null, JSON.stringify(next.files), JSON.stringify(next.data), actor.discordId, actor.username ?? null, now]
    ),
    stmt(
      `DELETE FROM studio_versions WHERE creation_id = ? AND id <= (SELECT id FROM studio_versions WHERE creation_id = ? ORDER BY id DESC LIMIT 1 OFFSET ${KEEP_VERSIONS})`,
      [id, id]
    )
  ]);
  return (await getCreation(serverId, id)) as Creation;
}

export async function restoreVersion(serverId: string, actor: Actor, id: number, versionId: number): Promise<Creation> {
  const v = await db.get<{ files_json: string; data_json: string; created_at: string }>(
    "SELECT files_json, data_json, created_at FROM studio_versions WHERE server_id = ? AND creation_id = ? AND id = ?",
    [serverId, id, versionId]
  );
  if (!v) throw new StudioError("unknown_version");
  return saveCreation(serverId, actor, id, { files: parse(v.files_json, []), data: parse(v.data_json, {}) }, { source: "restore", summary: `Retour à la version du ${v.created_at}` });
}

export async function deleteCreation(serverId: string, actor: Actor, id: number): Promise<boolean> {
  const current = await db.get<{ name: string; resource: string }>("SELECT name, resource FROM studio_creations WHERE server_id = ? AND id = ?", [serverId, id]);
  if (!current) return false;
  await db.batch([
    stmt("DELETE FROM studio_versions WHERE server_id = ? AND creation_id = ?", [serverId, id]),
    stmt("DELETE FROM studio_creations WHERE server_id = ? AND id = ?", [serverId, id]),
    auditStmt(serverId, actor, "studio_delete", null, current)
  ]);
  return true;
}

/** Remember which agent command deploys which files (the status comes from the command). */
export async function markDeploy(serverId: string, id: number, commandId: number, files: StudioFile[]): Promise<void> {
  await db.run("UPDATE studio_creations SET deploy_command_id = ?, deploy_hash = ?, deployed_at = ? WHERE server_id = ? AND id = ?", [
    commandId, filesHash(files), iso(), serverId, id
  ]);
}

// ---- AI ----

export function studioAIConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY);
}

const FRAMEWORK_HINTS: Record<Framework, string> = {
  standalone: "Standalone : uniquement les natives FiveM, aucune dépendance. Les droits admin se vérifient avec IsPlayerAceAllowed(source, 'command').",
  esx: "ESX (es_extended récent) : local ESX = exports['es_extended']:getSharedObject() ; côté serveur xPlayer = ESX.GetPlayerFromId(source), xPlayer.getGroup(), xPlayer.addMoney / removeMoney, xPlayer.addInventoryItem ; notifications ESX.ShowNotification côté client. Déclare dependency 'es_extended'.",
  qbcore: "QBCore : local QBCore = exports['qb-core']:GetCoreObject() ; côté serveur Player = QBCore.Functions.GetPlayer(source), Player.Functions.AddMoney('cash', n), QBCore.Functions.HasPermission(source, 'admin') ; notifications QBCore.Functions.Notify côté client. Déclare dependency 'qb-core'.",
  qbox: "Qbox : exports.qbx_core:GetPlayer(source), ox_lib (shared_script '@ox_lib/init.lua', lib.notify, lib.callback), ox_inventory pour les objets (exports.ox_inventory:AddItem). Déclare les dependencies 'qbx_core' et 'ox_lib'."
};

const RULES_JSON = `Réponds UNIQUEMENT par un objet JSON valide (pas de texte autour) :
{"summary":"ce que tu as fait, en 1 à 3 phrases en français","files":{"chemin/du/fichier":"contenu COMPLET du fichier"}}
- À la création, donne tous les fichiers. Ensuite, seulement les fichiers que tu modifies ou ajoutes, toujours en entier (jamais d'extrait ni de « ... »). Mets null pour supprimer un fichier.
- Chemins relatifs à la ressource (ex. "client.lua", "html/index.html").
- Code complet, qui fonctionne tel quel, commenté brièvement en français ; textes vus par les joueurs en français.`;

function systemPrompt(kind: CreationKind, framework: Framework): string {
  if (kind === "ui") {
    return `Tu es un développeur FiveM expert en interfaces NUI (HTML/CSS/JS). Tu écris une ressource complète.
Structure :
- fxmanifest.lua : fx_version 'cerulean', game 'gta5', lua54 'yes', ui_page 'html/index.html', files { 'html/index.html' }, client_script 'client.lua' (+ server_script 'server.lua' seulement si nécessaire).
- html/index.html : HTML, CSS et JS dans ce seul fichier. Pas de framework ni de CDN (Google Fonts autorisé). Fond transparent (html, body { background: transparent }).
- Le jeu envoie les données avec SendNUIMessage({ action = '...', ... }) ; la page les lit avec window.addEventListener('message', (e) => { const data = e.data; ... }).
- La page répond au jeu avec fetch(\`https://\${GetParentResourceName()}/nom\`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({...}) }) ; le client.lua a RegisterNUICallback('nom', function(data, cb) ... cb('ok') end).
- Un menu est caché au départ, s'ouvre par une commande (RegisterCommand) avec SetNuiFocus(true, true), se ferme avec Échap (keydown Escape -> fetch close) et SetNuiFocus(false, false). Un HUD reste affiché et se met à jour (boucle CreateThread côté client).
- Pensé pour 1920x1080 mais responsive (vw/vh, clamp). Design soigné et moderne : animations douces, bonne lisibilité en jeu.
${FRAMEWORK_HINTS[framework]}
${RULES_JSON}
- Ajoute "tests" : 2 à 6 messages d'exemple, exactement comme ceux de SendNUIMessage, pour tester la page dans le panel : "tests":[{"label":"Ouvrir le menu","data":{"action":"open"}}]. Redonne "tests" à chaque fois.`;
  }
  return `Tu es un développeur FiveM expert (Lua 5.4, natives FiveM). Tu écris une ressource complète et sûre.
Structure : fxmanifest.lua (fx_version 'cerulean', game 'gta5', lua54 'yes'), config.lua (shared_script, tout ce qui se règle : prix, positions, délais, textes), client.lua, server.lua, README.md (installation et commandes).
${FRAMEWORK_HINTS[framework]}
Sécurité (le serveur ne fait JAMAIS confiance au client) :
- Argent, objets, jobs et récompenses sont donnés côté serveur uniquement, après vérification (distance au point avec GetEntityCoords(GetPlayerPed(source)), job, délai anti-spam par joueur).
- Vérifie le type et les bornes de chaque argument reçu dans un RegisterNetEvent serveur.
- Jamais d'os.execute, io.popen, load / loadstring.
- Pas de boucle Wait(0) inutile : dors plus longtemps quand le joueur est loin.
${RULES_JSON}`;
}

function mapPrompt(): string {
  const catalog = PROPS.map((p) => `${p.model} (${p.label}, ${p.w}x${p.d} m)`).join("; ");
  return `Tu es mappeur FiveM. Tu places des objets (props GTA V) autour d'un point central pour créer la scène demandée.
Repère en mètres, relatif au point central : x vers l'est, y vers le nord, z vers le haut (0 = au sol). heading en degrés : 0 = face au nord, 90 = face à l'ouest, 180 = sud, 270 = est.
Modèles conseillés (largeur x profondeur) : ${catalog}.
Tu peux utiliser d'autres props GTA V seulement si tu es sûr de leur nom exact.
Réponds UNIQUEMENT par un objet JSON valide :
{"summary":"ce que tu as fait, 1 à 2 phrases en français","objects":[{"id":"...","model":"prop_...","x":0,"y":0,"z":0,"heading":0}]}
- Renvoie la liste COMPLÈTE de la scène : les objets existants que tu gardes (avec leur "id") et les nouveaux (sans id).
- Les objets ne se chevauchent pas (tiens compte des tailles) ; alignés proprement ; 80 objets maximum.`;
}

export type AIReply = { summary: string; files: Map<string, string | null> | null; tests: UITest[] | null; objects: unknown[] | null };

/** Pure: read the model's JSON reply (tolerates code fences and text around; files as an object or a list). */
export function parseAIReply(text: string): AIReply | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  let files: Map<string, string | null> | null = null;
  if (Array.isArray(data.files)) {
    files = new Map();
    for (const f of data.files as { path?: unknown; content?: unknown }[]) {
      if (f && typeof f.path === "string") files.set(f.path, typeof f.content === "string" ? f.content : null);
    }
  } else if (data.files && typeof data.files === "object") {
    files = new Map(Object.entries(data.files as Record<string, unknown>).map(([k, v]) => [k, typeof v === "string" ? v : null]));
  }
  const objects = Array.isArray(data.objects) ? data.objects : null;
  if (!files && !objects) return null;
  return {
    summary: typeof data.summary === "string" && data.summary.trim() ? data.summary.trim().slice(0, 600) : "Modifications de l'IA",
    files,
    tests: Array.isArray(data.tests) ? cleanTests(data.tests) : null,
    objects
  };
}

/** Pure: the creation's files after the AI's changes (null removes a file). */
export function applyFiles(current: StudioFile[], changes: Map<string, string | null>): StudioFile[] {
  const byPath = new Map(current.map((f) => [f.path, f.content]));
  for (const [rawPath, content] of changes) {
    const path = rawPath.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (content === null) byPath.delete(path);
    else byPath.set(path, content);
  }
  return [...byPath.entries()].map(([path, content]) => ({ path, content }));
}

async function chat(system: string, user: string): Promise<string> {
  try {
    return await chatJson(system, user, { model: process.env.AI_CODE_MODEL, maxTokens: Number(process.env.AI_CODE_MAX_TOKENS) || 8000 });
  } catch (error) {
    throw new StudioError(error instanceof Error ? error.message : "ai_error");
  }
}

/** Context of the current files for the model, newest first, within a budget. */
function filesContext(files: StudioFile[], budget = 40_000): string {
  let used = 0;
  const parts: string[] = [];
  for (const f of files) {
    const block = `--- ${f.path} ---\n${f.content}\n`;
    if (used + block.length > budget) {
      parts.push(`--- ${f.path} --- (trop long, non montré : ne le modifie pas sauf demande explicite)\n`);
      continue;
    }
    used += block.length;
    parts.push(block);
  }
  return parts.join("\n");
}

/** Ask the AI to create or change a creation; the result is saved as a new version. */
export async function generateCreation(serverId: string, actor: Actor, id: number, instruction: string): Promise<{ creation: Creation; summary: string }> {
  if (!studioAIConfigured()) throw new StudioError("ai_not_configured");
  const current = await getCreation(serverId, id);
  if (!current) throw new StudioError("unknown_creation");

  if (current.kind === "map") {
    const map = cleanMap(current.data.map);
    const user = `Scène actuelle (${map.objects.length} objets) :\n${JSON.stringify(map.objects.map(({ id: oid, model, x, y, z, heading }) => ({ id: oid, model, x, y, z, heading })))}\n\nDemande : ${instruction}`;
    const reply = parseAIReply(await chat(mapPrompt(), user));
    if (!reply?.objects) throw new StudioError("ai_unreadable");
    const creation = await saveCreation(serverId, actor, id, { data: { map: cleanMap({ ...map, objects: reply.objects }) } }, { source: "ai", prompt: instruction, summary: reply.summary });
    return { creation, summary: reply.summary };
  }

  const user = current.files.length
    ? `Ressource « ${current.resource} » (${current.name}). Fichiers actuels :\n\n${filesContext(current.files)}\n\nDemande de modification : ${instruction}`
    : `Nouvelle ressource « ${current.resource} » (${current.name}).\n\nDemande : ${instruction}`;
  const reply = parseAIReply(await chat(systemPrompt(current.kind, current.framework), user));
  if (!reply?.files) throw new StudioError("ai_unreadable");
  const files = applyFiles(current.files, reply.files);
  // The AI writes code: a creation made with blocks / the simple builder goes on as code from here.
  const data: CreationData = current.kind === "ui" ? { mode: "code", tests: reply.tests ?? current.data.tests ?? [] } : { mode: "code" };
  const creation = await saveCreation(serverId, actor, id, { files, data }, { source: "ai", prompt: instruction, summary: reply.summary });
  return { creation, summary: reply.summary };
}
