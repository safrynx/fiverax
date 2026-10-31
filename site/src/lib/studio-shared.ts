/**
 * Studio IA: what the UI, script and mapping creators share. Client-safe (no DB): the editors use the same checks,
 * the same file rules and the same mapping code generator as the server.
 */

export const CREATION_KINDS = ["ui", "script", "map"] as const;
export type CreationKind = (typeof CREATION_KINDS)[number];
export const isCreationKind = (v: string): v is CreationKind => (CREATION_KINDS as readonly string[]).includes(v);

export const KIND_META: Record<CreationKind, { title: string; one: string; lead: string; examples: string[] }> = {
  ui: {
    title: "UI Creator",
    one: "interface",
    lead: "Assemble une fenêtre en mode simple (titres, boutons, jauges…), ou décris l'interface à l'IA qui écrit la page NUI et le client.lua. Tu la testes ici avant de l'envoyer sur le serveur.",
    examples: [
      "HUD en bas à gauche : vie, armure, faim et soif en jauges circulaires, style néon violet",
      "Menu de garage : liste des véhicules avec photo, plaque et bouton Sortir, s'ouvre avec /garage",
      "Notifications en haut à droite avec 4 types (succès, erreur, info, alerte) et une barre de temps"
    ]
  },
  script: {
    title: "Script Creator",
    one: "script",
    lead: "Emboîte des blocs comme dans Scratch, ou décris le script à l'IA qui écrit fxmanifest, config, client et serveur pour ton framework. Les vérifications signalent les erreurs et les failles exploitables par les cheaters.",
    examples: [
      "Commande /repair qui répare le véhicule du joueur, réservée au groupe admin, avec un délai de 60 s",
      "Job livreur : prendre un colis au dépôt, le livrer à un point aléatoire, payé 250 $ côté serveur",
      "Coffre de véhicule : /coffre ouvre le stockage du véhicule le plus proche, 50 kg max"
    ]
  },
  map: {
    title: "Mapping Creator",
    one: "mapping",
    lead: "Place des objets dans le monde depuis le panel : choisis un endroit (ou la position d'un joueur en jeu), décris la scène à l'IA ou pose les props à la main. Le panel écrit la ressource qui les fait apparaître.",
    examples: [
      "Barrage de police : barrières en travers de la route, cônes de chaque côté, deux projecteurs",
      "Petit marché : 4 stands sous tonnelles, tables, caisses de fruits et poubelles",
      "Zone de chantier : clôtures, conteneur, cabane de chantier, générateur et lumières"
    ]
  }
};

export const FRAMEWORKS = [
  { key: "standalone", label: "Standalone" },
  { key: "esx", label: "ESX" },
  { key: "qbcore", label: "QBCore" },
  { key: "qbox", label: "Qbox / ox" }
] as const;
export type Framework = (typeof FRAMEWORKS)[number]["key"];
export const isFramework = (v: string): v is Framework => FRAMEWORKS.some((f) => f.key === v);

export type StudioFile = { path: string; content: string };

export const LIMITS = { files: 25, fileBytes: 200_000, totalBytes: 400_000, objects: 400 } as const;

/** Resource folder name: what `ensure` uses. */
export const RESOURCE_RE = /^[a-z0-9][a-z0-9_-]{2,47}$/;
/** Relative path inside the resource: no "..", no absolute path, plain characters. */
const FILE_RE = /^(?!.*\.\.)[A-Za-z0-9_-][A-Za-z0-9_.\-/]{0,119}\.(lua|html|css|js|json|md|txt|cfg|svg)$/;
export const isFilePath = (p: string) => FILE_RE.test(p) && !p.includes("//") && !p.endsWith("/");

/** "Menu Garage (v2)" -> "fvx_menu_garage_v2". */
export function resourceSlug(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `fvx_${base || "creation"}`;
}

/** Keep the valid files, drop duplicates (last wins), sorted with fxmanifest first. Throws on size limits. */
export function cleanFiles(files: StudioFile[]): StudioFile[] {
  const byPath = new Map<string, StudioFile>();
  for (const f of files) {
    const path = f.path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (!isFilePath(path) || typeof f.content !== "string") continue;
    byPath.set(path, { path, content: f.content.replace(/\r\n/g, "\n") });
  }
  const list = [...byPath.values()].sort((a, b) => fileOrder(a.path) - fileOrder(b.path) || a.path.localeCompare(b.path));
  if (list.length > LIMITS.files) throw new Error("too_many_files");
  const enc = new TextEncoder();
  let total = 0;
  for (const f of list) {
    const size = enc.encode(f.content).length;
    if (size > LIMITS.fileBytes) throw new Error("file_too_large");
    total += size;
  }
  if (total > LIMITS.totalBytes) throw new Error("files_too_large");
  return list;
}

function fileOrder(path: string): number {
  const order = ["fxmanifest.lua", "config.lua", "client.lua", "server.lua"];
  const i = order.indexOf(path);
  return i === -1 ? order.length : i;
}

/** Stable short hash of a set of files: tells whether what is deployed is what is saved. */
export function filesHash(files: StudioFile[]): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const f of files) {
    const s = `${f.path}\u0000${f.content}\u0001`;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
    }
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

// ---- checks ----

export type Check = { level: "error" | "warn" | "info"; file: string | null; message: string };

/** Lua without comments and strings (keeps line breaks), to count keywords safely. */
export function stripLua(code: string): string {
  let out = "";
  let i = 0;
  const longClose = (at: number): [number, number] | null => {
    const m = /^\[(=*)\[/.exec(code.slice(at, at + 20));
    if (!m) return null;
    const close = `]${m[1]}]`;
    const end = code.indexOf(close, at + m[0].length);
    return [at, end === -1 ? code.length : end + close.length];
  };
  const keepLines = (s: string) => s.replace(/[^\n]/g, " ");
  while (i < code.length) {
    const c = code[i];
    if (c === "-" && code[i + 1] === "-") {
      const long = longClose(i + 2);
      if (long) {
        out += keepLines(code.slice(i, long[1]));
        i = long[1];
      } else {
        const end = code.indexOf("\n", i);
        const stop = end === -1 ? code.length : end;
        out += keepLines(code.slice(i, stop));
        i = stop;
      }
      continue;
    }
    if (c === "[") {
      const long = longClose(i);
      if (long) {
        out += keepLines(code.slice(i, long[1]));
        i = long[1];
        continue;
      }
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < code.length && code[j] !== c && code[j] !== "\n") j += code[j] === "\\" ? 2 : 1;
      out += " ".repeat(Math.min(j + 1, code.length) - i);
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Blocks closed by `end` (function, if, do) against the `end`s: a mismatch is almost always a syntax error. */
export function luaBalance(code: string): { opens: number; ends: number } {
  // Split on what cannot be part of a name, keeping "." and ":" so that `t.end` or `obj:do` never count.
  let opens = 0;
  let ends = 0;
  for (const w of stripLua(code).split(/[^\w.:]+/)) {
    if (w === "end") ends++;
    else if (w === "function" || w === "if" || w === "do") opens++;
  }
  return { opens, ends };
}

const RISKS: { re: RegExp; level: Check["level"]; message: string; side?: "server" }[] = [
  { re: /\bos\.execute\b|\bio\.popen\b/, level: "error", message: "Lance des commandes système sur la machine du serveur : à retirer." },
  { re: /\bload(string)?\s*\(/, level: "warn", message: "Exécute du code reçu sous forme de texte (load) : dangereux si le texte vient d'un joueur." },
  { re: /\bPerformHttpRequest\b/, level: "info", message: "Appelle un site externe : vérifie l'adresse." },
  {
    re: /RegisterNetEvent[\s\S]{0,600}?(addMoney|AddMoney|addAccountMoney|addInventoryItem|AddItem|giveWeapon|GiveWeaponToPed|SetJob|setJob)/,
    level: "warn",
    side: "server",
    message: "Un événement réseau donne de l'argent, des objets ou un job : le serveur doit vérifier que le joueur y a droit (distance, job, délai), sinon un cheater peut l'appeler à volonté."
  }
];

/** Static checks of a resource: missing files, unbalanced Lua blocks, risky calls. */
export function checkFiles(files: StudioFile[]): Check[] {
  const checks: Check[] = [];
  const paths = new Set(files.map((f) => f.path));
  const manifest = files.find((f) => f.path === "fxmanifest.lua");
  if (!manifest) checks.push({ level: "error", file: null, message: "fxmanifest.lua manquant : FiveM ne chargera pas la ressource." });
  else {
    if (!/fx_version/.test(manifest.content)) checks.push({ level: "error", file: "fxmanifest.lua", message: "fx_version absent." });
    for (const m of manifest.content.matchAll(/['"]([^'"@*]+\.(lua|html|css|js|json|png|jpg|svg|ogg|mp3))['"]/g)) {
      if (!paths.has(m[1])) checks.push({ level: "error", file: "fxmanifest.lua", message: `Fichier déclaré mais absent : ${m[1]}` });
    }
    const ui = /ui_page\s*\(?\s*['"]([^'"]+)['"]/.exec(manifest.content)?.[1];
    if (ui && !/files\s*\{[\s\S]*?\}/.test(manifest.content) && !/file\s*['"]/.test(manifest.content)) {
      checks.push({ level: "error", file: "fxmanifest.lua", message: "ui_page sans bloc files { } : la page ne sera pas envoyée aux joueurs." });
    }
  }
  for (const f of files) {
    if (f.path.endsWith(".lua")) {
      const { opens, ends } = luaBalance(f.content);
      if (opens !== ends) {
        checks.push({
          level: "error",
          file: f.path,
          message: opens > ends ? `${opens - ends} bloc(s) sans « end » (function / if / do).` : `${ends - opens} « end » en trop.`
        });
      }
      const server = /server/i.test(f.path);
      for (const risk of RISKS) {
        if (risk.side === "server" && !server) continue;
        if (risk.re.test(f.content)) checks.push({ level: risk.level, file: f.path, message: risk.message });
      }
    }
    if (f.path.endsWith(".html") && !/<\/html>/i.test(f.content)) checks.push({ level: "warn", file: f.path, message: "Balise </html> absente : le fichier semble coupé." });
  }
  return checks;
}

// ---- mapping ----

export type MapObject = { id: string; model: string; x: number; y: number; z: number; heading: number; ground: boolean };
/** `center` in game coordinates; objects are offsets in metres from it (x east, y north, z up). */
export type MapData = { center: [number, number, number]; distance: number; objects: MapObject[] };
export const MODEL_RE = /^[A-Za-z0-9_]{2,64}$/;

export const EMPTY_MAP: MapData = { center: [215.8, -810.1, 30.7], distance: 150, objects: [] };

/** Common GTA V props with their approximate footprint (width x depth, metres), for the top-down editor. */
export const PROPS: { model: string; label: string; cat: string; w: number; d: number }[] = [
  { model: "prop_barrier_work05", label: "Barrière de chantier", cat: "Route", w: 2.6, d: 0.6 },
  { model: "prop_barrier_work06a", label: "Barrière fléchée", cat: "Route", w: 2.4, d: 0.6 },
  { model: "prop_mp_barrier_02b", label: "Barrière police", cat: "Route", w: 2.2, d: 0.5 },
  { model: "prop_mp_barrier_01", label: "Barrière béton", cat: "Route", w: 2.4, d: 0.7 },
  { model: "prop_mp_arrow_barrier_01", label: "Panneau flèche", cat: "Route", w: 1.6, d: 0.7 },
  { model: "prop_roadcone02a", label: "Cône", cat: "Route", w: 0.5, d: 0.5 },
  { model: "prop_mp_cone_01", label: "Grand cône", cat: "Route", w: 0.6, d: 0.6 },
  { model: "prop_worklight_03b", label: "Projecteur de chantier", cat: "Route", w: 1.2, d: 1.2 },
  { model: "prop_traffic_01a", label: "Feu tricolore", cat: "Route", w: 0.6, d: 0.6 },
  { model: "prop_streetlight_01", label: "Lampadaire", cat: "Route", w: 0.5, d: 0.5 },
  { model: "prop_fire_hydrant_1", label: "Bouche d'incendie", cat: "Route", w: 0.5, d: 0.5 },
  { model: "prop_gazebo_02", label: "Tonnelle", cat: "Événement", w: 4, d: 4 },
  { model: "prop_gazebo_03", label: "Tonnelle (grande)", cat: "Événement", w: 5, d: 5 },
  { model: "prop_table_03", label: "Table", cat: "Événement", w: 1.6, d: 0.9 },
  { model: "prop_table_04", label: "Table ronde", cat: "Événement", w: 1.2, d: 1.2 },
  { model: "prop_chair_01a", label: "Chaise", cat: "Événement", w: 0.6, d: 0.6 },
  { model: "prop_chair_02", label: "Chaise pliante", cat: "Événement", w: 0.6, d: 0.6 },
  { model: "prop_bench_01a", label: "Banc", cat: "Événement", w: 2, d: 0.7 },
  { model: "prop_bench_05", label: "Banc de parc", cat: "Événement", w: 2, d: 0.8 },
  { model: "prop_bbq_1", label: "Barbecue", cat: "Événement", w: 1, d: 0.8 },
  { model: "prop_speaker_06", label: "Enceinte", cat: "Événement", w: 0.6, d: 0.6 },
  { model: "prop_vend_snak_01", label: "Distributeur snacks", cat: "Mobilier urbain", w: 1, d: 0.9 },
  { model: "prop_vend_soda_01", label: "Distributeur sodas", cat: "Mobilier urbain", w: 1, d: 0.9 },
  { model: "prop_atm_01", label: "Distributeur de billets", cat: "Mobilier urbain", w: 0.8, d: 0.6 },
  { model: "prop_bin_01a", label: "Poubelle", cat: "Mobilier urbain", w: 0.6, d: 0.6 },
  { model: "prop_dumpster_01a", label: "Benne", cat: "Mobilier urbain", w: 2, d: 1.2 },
  { model: "prop_dumpster_02a", label: "Benne (verte)", cat: "Mobilier urbain", w: 2, d: 1.2 },
  { model: "prop_portaloo_01a", label: "Toilettes de chantier", cat: "Mobilier urbain", w: 1.2, d: 1.2 },
  { model: "prop_pot_plant_01a", label: "Plante en pot", cat: "Décor", w: 0.8, d: 0.8 },
  { model: "prop_plant_int_01a", label: "Plante d'intérieur", cat: "Décor", w: 0.6, d: 0.6 },
  { model: "prop_bush_med_03", label: "Buisson", cat: "Décor", w: 2, d: 2 },
  { model: "prop_tree_cedar_02", label: "Arbre (cèdre)", cat: "Décor", w: 4, d: 4 },
  { model: "prop_flag_us", label: "Drapeau", cat: "Décor", w: 0.6, d: 0.6 },
  { model: "prop_container_01a", label: "Conteneur", cat: "Industriel", w: 12.2, d: 2.5 },
  { model: "prop_container_05a", label: "Conteneur (court)", cat: "Industriel", w: 6.1, d: 2.5 },
  { model: "prop_portacabin01", label: "Cabane de chantier", cat: "Industriel", w: 7, d: 3 },
  { model: "prop_generator_01a", label: "Générateur", cat: "Industriel", w: 1.8, d: 1 },
  { model: "prop_gascyl_01a", label: "Bouteille de gaz", cat: "Industriel", w: 0.4, d: 0.4 },
  { model: "prop_barrel_01a", label: "Baril", cat: "Industriel", w: 0.7, d: 0.7 },
  { model: "prop_barrel_02a", label: "Baril rouillé", cat: "Industriel", w: 0.7, d: 0.7 },
  { model: "prop_toolchest_05", label: "Servante d'atelier", cat: "Industriel", w: 1.2, d: 0.6 },
  { model: "prop_box_wood02a", label: "Caisse en bois", cat: "Caisses", w: 1, d: 1 },
  { model: "prop_boxpile_07d", label: "Pile de caisses", cat: "Caisses", w: 2.4, d: 1.4 },
  { model: "prop_cs_cardbox_01", label: "Carton", cat: "Caisses", w: 0.5, d: 0.5 },
  { model: "prop_rub_cardpile_01", label: "Tas de cartons", cat: "Caisses", w: 1.6, d: 1.2 },
  { model: "prop_tv_flat_01", label: "Écran plat", cat: "Intérieur", w: 1.4, d: 0.3 },
  { model: "prop_laptop_01a", label: "Ordinateur portable", cat: "Intérieur", w: 0.4, d: 0.3 }
];

export const propOf = (model: string) => PROPS.find((p) => p.model.toLowerCase() === model.toLowerCase());

/** Ready-made groups of props, placed together (offsets in metres from where they are dropped). */
export const PROP_KITS: { key: string; label: string; objects: { model: string; x: number; y: number; heading?: number }[] }[] = [
  { key: "roadblock", label: "Barrage de police", objects: [
    { model: "prop_mp_barrier_02b", x: -2.3, y: 0 }, { model: "prop_mp_barrier_02b", x: 0, y: 0 }, { model: "prop_mp_barrier_02b", x: 2.3, y: 0 },
    { model: "prop_roadcone02a", x: -4.2, y: 0.6 }, { model: "prop_roadcone02a", x: 4.2, y: 0.6 }, { model: "prop_worklight_03b", x: 0, y: -2.2, heading: 180 }
  ] },
  { key: "stall", label: "Stand de marché", objects: [
    { model: "prop_gazebo_02", x: 0, y: 0 }, { model: "prop_table_03", x: 0, y: 0.8 }, { model: "prop_box_wood02a", x: -1.3, y: -0.9 },
    { model: "prop_chair_02", x: 0.6, y: -0.5, heading: 180 }, { model: "prop_cs_cardbox_01", x: 1.4, y: -1 }
  ] },
  { key: "terrace", label: "Terrasse", objects: [
    { model: "prop_table_04", x: -1.8, y: 0 }, { model: "prop_chair_01a", x: -1.8, y: 1.2, heading: 180 }, { model: "prop_chair_01a", x: -1.8, y: -1.2 },
    { model: "prop_table_04", x: 1.8, y: 0 }, { model: "prop_chair_01a", x: 1.8, y: 1.2, heading: 180 }, { model: "prop_chair_01a", x: 1.8, y: -1.2 },
    { model: "prop_pot_plant_01a", x: 0, y: 1.6 }
  ] },
  { key: "bbq", label: "Coin barbecue", objects: [
    { model: "prop_bbq_1", x: 0, y: 1.6 }, { model: "prop_bench_01a", x: -1.6, y: -0.4, heading: 90 }, { model: "prop_bench_01a", x: 1.6, y: -0.4, heading: 270 },
    { model: "prop_bin_01a", x: 2.6, y: 1.6 }, { model: "prop_speaker_06", x: -2.6, y: 1.6 }
  ] },
  { key: "worksite", label: "Chantier", objects: [
    { model: "prop_barrier_work05", x: -2.7, y: 0 }, { model: "prop_barrier_work05", x: 0, y: 0 }, { model: "prop_barrier_work05", x: 2.7, y: 0 },
    { model: "prop_generator_01a", x: -2, y: -2.5 }, { model: "prop_worklight_03b", x: 1.5, y: -2.5, heading: 180 }, { model: "prop_portaloo_01a", x: 4.5, y: -2.5 },
    { model: "prop_roadcone02a", x: -4.6, y: 0 }, { model: "prop_roadcone02a", x: 4.6, y: 0 }
  ] }
];

const num = (v: number, digits: number) => (Number.isFinite(v) ? Number(v.toFixed(digits)) : 0).toFixed(digits);

/** The resource's files for a mapping: objects spawned (frozen) while a player is near, removed when they leave. */
export function mapFiles(name: string, data: MapData): StudioFile[] {
  const [cx, cy, cz] = data.center;
  const radius = data.objects.reduce((r, o) => Math.max(r, Math.hypot(o.x, o.y)), 0);
  const objects = data.objects
    .filter((o) => MODEL_RE.test(o.model))
    .map((o) => `    { model = '${o.model}', pos = vector3(${num(cx + o.x, 3)}, ${num(cy + o.y, 3)}, ${num(cz + o.z, 3)}), heading = ${num(o.heading, 2)}, ground = ${o.ground ? "true" : "false"} },`)
    .join("\n");
  const label = name.replace(/[\r\n\]]/g, " ").slice(0, 80);

  const manifest = `fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name '${label.replace(/'/g, "")}'
description 'Mapping créé avec Fiverax Studio'

client_script 'client.lua'
`;

  const client = `-- Mapping « ${label} », généré par Fiverax Studio (Mapping Creator).
-- Les objets apparaissent (figés) quand un joueur est à moins de DISTANCE mètres, et disparaissent quand il s'éloigne.

local CENTER = vector3(${num(cx, 3)}, ${num(cy, 3)}, ${num(cz, 3)})
local DISTANCE = ${num(Math.max(20, data.distance) + radius, 1)}
local OBJECTS = {
${objects}
}

local spawned = {}

local function loadModel(hash)
    if not IsModelInCdimage(hash) then return false end
    RequestModel(hash)
    local timeout = GetGameTimer() + 5000
    while not HasModelLoaded(hash) and GetGameTimer() < timeout do Wait(10) end
    return HasModelLoaded(hash)
end

local function spawnAll()
    for _, o in ipairs(OBJECTS) do
        local hash = GetHashKey(o.model)
        if loadModel(hash) then
            local obj = CreateObjectNoOffset(hash, o.pos.x, o.pos.y, o.pos.z, false, false, false)
            SetEntityHeading(obj, o.heading)
            if o.ground then PlaceObjectOnGroundProperly(obj) end
            FreezeEntityPosition(obj, true)
            SetModelAsNoLongerNeeded(hash)
            spawned[#spawned + 1] = obj
        else
            print(('[%s] Modèle introuvable : %s'):format(GetCurrentResourceName(), o.model))
        end
    end
end

local function removeAll()
    for _, obj in ipairs(spawned) do
        if DoesEntityExist(obj) then DeleteObject(obj) end
    end
    spawned = {}
end

CreateThread(function()
    local here = false
    while true do
        local near = #(GetEntityCoords(PlayerPedId()) - CENTER) < DISTANCE
        if near and not here then spawnAll() elseif not near and here then removeAll() end
        here = near
        Wait(1000)
    end
end)

AddEventHandler('onResourceStop', function(resource)
    if resource == GetCurrentResourceName() then removeAll() end
end)
`;
  return [{ path: "fxmanifest.lua", content: manifest }, { path: "client.lua", content: client }];
}

/** Read stored / AI-made mapping data, dropping anything invalid. */
export function cleanMap(raw: unknown): MapData {
  const d = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof MapData, unknown>>;
  const n = (v: unknown, min: number, max: number, fallback: number) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : fallback;
  };
  const c = Array.isArray(d.center) ? d.center : EMPTY_MAP.center;
  const objects = (Array.isArray(d.objects) ? d.objects : [])
    .map((o, i): MapObject | null => {
      if (!o || typeof o !== "object") return null;
      const r = o as Record<string, unknown>;
      const model = String(r.model ?? "").trim();
      if (!MODEL_RE.test(model)) return null;
      return {
        id: typeof r.id === "string" && /^[\w-]{1,40}$/.test(r.id) ? r.id : `o${i}_${Math.random().toString(36).slice(2, 7)}`,
        model,
        x: n(r.x, -500, 500, 0),
        y: n(r.y, -500, 500, 0),
        z: n(r.z, -100, 100, 0),
        heading: ((n(r.heading, -3600, 3600, 0) % 360) + 360) % 360,
        ground: r.ground !== false
      };
    })
    .filter((o): o is MapObject => o !== null)
    .slice(0, LIMITS.objects);
  return {
    center: [n(c[0], -8000, 8000, EMPTY_MAP.center[0]), n(c[1], -8000, 8000, EMPTY_MAP.center[1]), n(c[2], -200, 2000, EMPTY_MAP.center[2])],
    distance: n(d.distance, 20, 500, EMPTY_MAP.distance),
    objects
  };
}

// ---- UI preview ----

export type UITest = { label: string; data: unknown };

export function cleanTests(raw: unknown): UITest[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is { label: unknown; data: unknown } => Boolean(t && typeof t === "object" && "data" in t))
    .map((t) => ({ label: String(t.label ?? "Message").slice(0, 60), data: t.data }))
    .filter((t) => JSON.stringify(t.data ?? null).length <= 5000)
    .slice(0, 12);
}
