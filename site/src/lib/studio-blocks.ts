import { MODEL_RE, type Framework, type StudioFile } from "./studio-shared";

/**
 * Script Creator, mode blocs : des blocs à emboîter comme dans Scratch (éditeur Blockly côté navigateur).
 * Ce module est pur (pas de Blockly ici) : il décrit les blocs et la boîte à outils, et traduit l'espace de travail
 * sauvegardé (JSON de Blockly) en ressource FiveM. Le serveur refait la même traduction à l'enregistrement.
 *
 * Exécution : les événements « joueur » (touche, zone, arrivée, boucle, mort) tournent côté client ; une commande
 * tourne côté serveur, ce qui permet de vérifier les droits et de donner de l'argent sans faire confiance au client.
 * Une action joueur lancée par le serveur passe par un événement serveur -> client de la ressource.
 */

// ---- blocs (définitions JSON de Blockly) ----

const C = { event: "#FFBF00", player: "#4C97FF", vehicle: "#0FBD8C", server: "#59C059", control: "#FFAB19", value: "#9966FF" };

export const KEYS: [string, string][] = [
  ["E", "E"], ["F", "F"], ["G", "G"], ["H", "H"], ["K", "K"], ["L", "L"], ["M", "M"], ["U", "U"], ["Y", "Y"], ["X", "X"],
  ["F5", "F5"], ["F6", "F6"], ["F7", "F7"], ["F9", "F9"], ["F10", "F10"]
];

export const WEAPONS: [string, string][] = [
  ["pistolet", "WEAPON_PISTOL"], ["pistolet de combat", "WEAPON_COMBATPISTOL"], ["taser", "WEAPON_STUNGUN"], ["SMG", "WEAPON_SMG"],
  ["carabine", "WEAPON_CARBINERIFLE"], ["fusil à pompe", "WEAPON_PUMPSHOTGUN"], ["couteau", "WEAPON_KNIFE"], ["batte", "WEAPON_BAT"],
  ["matraque", "WEAPON_NIGHTSTICK"], ["lampe torche", "WEAPON_FLASHLIGHT"], ["extincteur", "WEAPON_FIREEXTINGUISHER"], ["parachute", "GADGET_PARACHUTE"]
];

export const SCENARIOS: [string, string][] = [
  ["fumer", "WORLD_HUMAN_SMOKING"], ["boire un café", "WORLD_HUMAN_AA_COFFEE"], ["téléphoner", "WORLD_HUMAN_STAND_MOBILE"],
  ["prendre des notes", "WORLD_HUMAN_CLIPBOARD"], ["jouer de la guitare", "WORLD_HUMAN_MUSICIAN"], ["faire des pompes", "WORLD_HUMAN_PUSH_UPS"],
  ["s'asseoir par terre", "WORLD_HUMAN_PICNIC"], ["prendre une photo", "WORLD_HUMAN_PAPARAZZI"], ["réparer (à genoux)", "WORLD_HUMAN_WELDING"],
  ["arrêter l'animation", "stop"]
];

const num = (name: string, value: number, extra: Record<string, unknown> = {}) => ({ type: "field_number", name, value, ...extra });
const statement = (name = "DO") => ({ type: "input_statement", name });
const action = { previousStatement: null, nextStatement: null };

/** Every block type the generator understands (plus a few built-in Blockly blocks, see BUILTIN). */
export const BLOCK_DEFS: Record<string, unknown>[] = [
  // Événements
  { type: "fvx_on_command", message0: "quand un joueur tape /%1", args0: [{ type: "field_input", name: "NAME", text: "soin" }],
    message1: "réservée aux admins %1", args1: [{ type: "field_checkbox", name: "ADMIN", checked: false }],
    message2: "%1", args2: [statement()], colour: C.event, tooltip: "Une commande du chat (côté serveur). Admins = joueurs avec la permission ACE « command »." },
  { type: "fvx_on_key", message0: "quand j'appuie sur %1", args0: [{ type: "field_dropdown", name: "KEY", options: KEYS }],
    message1: "%1", args1: [statement()], colour: C.event, tooltip: "Chaque joueur peut changer la touche dans Paramètres > Raccourcis > FiveM." },
  { type: "fvx_on_zone", message0: "quand j'entre dans la zone x %1 y %2 z %3 rayon %4 m",
    args0: [num("X", 0, { precision: 0.1 }), num("Y", 0, { precision: 0.1 }), num("Z", 0, { precision: 0.1 }), num("R", 3, { min: 1, max: 100 })],
    message1: "en appuyant sur E %1 avec un marqueur au sol %2", args1: [{ type: "field_checkbox", name: "PRESS", checked: true }, { type: "field_checkbox", name: "MARKER", checked: true }],
    message2: "%1", args2: [statement()], colour: C.event, tooltip: "Astuce : en jeu, la position s'obtient avec un script de coordonnées (/coords) ou dans le panel (Carte)." },
  { type: "fvx_on_start", message0: "quand j'arrive en jeu", message1: "%1", args1: [statement()], colour: C.event },
  { type: "fvx_on_death", message0: "quand je meurs", message1: "%1", args1: [statement()], colour: C.event },
  { type: "fvx_every", message0: "toutes les %1 secondes", args0: [num("SECONDS", 60, { min: 1, max: 86400 })], message1: "%1", args1: [statement()], colour: C.event },

  // Joueur
  { type: "fvx_notify", message0: "afficher la notification %1", args0: [{ type: "input_value", name: "TEXT" }], ...action, colour: C.player },
  { type: "fvx_heal", message0: "soigner le joueur", ...action, colour: C.player },
  { type: "fvx_armor", message0: "donner %1 d'armure", args0: [{ type: "input_value", name: "N", check: "Number" }], ...action, colour: C.player },
  { type: "fvx_teleport", message0: "téléporter à x %1 y %2 z %3", args0: [num("X", 0, { precision: 0.1 }), num("Y", 0, { precision: 0.1 }), num("Z", 0, { precision: 0.1 })], ...action, colour: C.player },
  { type: "fvx_waypoint", message0: "mettre un point GPS à x %1 y %2", args0: [num("X", 0, { precision: 0.1 }), num("Y", 0, { precision: 0.1 })], ...action, colour: C.player },
  { type: "fvx_weapon", message0: "donner l'arme %1 avec %2 balles", args0: [{ type: "field_dropdown", name: "WEAPON", options: WEAPONS }, num("AMMO", 60, { min: 0, max: 9999 })], ...action, colour: C.player },
  { type: "fvx_scenario", message0: "jouer l'animation %1", args0: [{ type: "field_dropdown", name: "NAME", options: SCENARIOS }], ...action, colour: C.player },
  { type: "fvx_freeze", message0: "%1 le joueur", args0: [{ type: "field_dropdown", name: "ON", options: [["geler", "TRUE"], ["dégeler", "FALSE"]] }], ...action, colour: C.player },

  // Véhicule
  { type: "fvx_vehicle", message0: "faire apparaître le véhicule %1", args0: [{ type: "field_input", name: "MODEL", text: "sultan" }], ...action, colour: C.vehicle, tooltip: "Nom de modèle GTA (adder, sultan, police…). Le joueur est mis au volant." },
  { type: "fvx_repair", message0: "réparer mon véhicule", ...action, colour: C.vehicle },
  { type: "fvx_delete_vehicle", message0: "supprimer mon véhicule", ...action, colour: C.vehicle },

  // Serveur
  { type: "fvx_money", message0: "%1 %2 $ %3", args0: [
    { type: "field_dropdown", name: "MODE", options: [["donner", "ADD"], ["retirer", "REMOVE"]] }, { type: "input_value", name: "AMOUNT", check: "Number" },
    { type: "field_dropdown", name: "ACCOUNT", options: [["en liquide", "cash"], ["en banque", "bank"]] }
  ], inputsInline: true, ...action, colour: C.server, tooltip: "Seulement dans « quand un joueur tape /… » et avec ESX, QBCore ou Qbox." },
  { type: "fvx_announce", message0: "annoncer à tout le serveur %1", args0: [{ type: "input_value", name: "TEXT" }], ...action, colour: C.server, tooltip: "Message dans le chat de tous les joueurs." },
  { type: "fvx_kick", message0: "expulser le joueur, raison %1", args0: [{ type: "input_value", name: "TEXT" }], ...action, colour: C.server },
  { type: "fvx_print", message0: "écrire dans la console %1", args0: [{ type: "input_value", name: "TEXT" }], ...action, colour: C.server },

  // Contrôle
  { type: "fvx_wait", message0: "attendre %1 secondes", args0: [{ type: "input_value", name: "SECONDS", check: "Number" }], ...action, colour: C.control },

  // Valeurs
  { type: "fvx_player_name", message0: "nom du joueur", output: "String", colour: C.value },
  { type: "fvx_cmd_arg", message0: "mot n° %1 après la commande", args0: [num("N", 1, { min: 1, max: 9, precision: 1 })], output: null, colour: C.value, tooltip: "/donner 500 : le mot n° 1 vaut 500." },
  { type: "fvx_is_admin", message0: "le joueur est admin", output: "Boolean", colour: C.value },
  { type: "fvx_in_vehicle", message0: "le joueur est dans un véhicule", output: "Boolean", colour: C.value },
  { type: "fvx_player_count", message0: "nombre de joueurs connectés", output: "Number", colour: C.value }
];

/** Built-in Blockly blocks used by the toolbox and handled by the generator. */
export const BUILTIN = [
  "controls_if", "controls_repeat_ext", "logic_compare", "logic_operation", "logic_negate", "logic_boolean",
  "math_number", "math_arithmetic", "math_random_int", "text", "text_join"
] as const;

const shadowText = (text: string) => ({ shadow: { type: "text", fields: { TEXT: text } } });
const shadowNum = (n: number) => ({ shadow: { type: "math_number", fields: { NUM: n } } });
const block = (type: string, inputs?: Record<string, unknown>) => ({ kind: "block", type, ...(inputs ? { inputs } : {}) });

export const TOOLBOX = {
  kind: "categoryToolbox",
  contents: [
    { kind: "category", name: "Événements", colour: C.event, contents: ["fvx_on_command", "fvx_on_key", "fvx_on_zone", "fvx_on_start", "fvx_on_death", "fvx_every"].map((t) => block(t)) },
    { kind: "category", name: "Joueur", colour: C.player, contents: [
      block("fvx_notify", { TEXT: shadowText("Salut !") }), block("fvx_heal"), block("fvx_armor", { N: shadowNum(100) }), block("fvx_teleport"),
      block("fvx_waypoint"), block("fvx_weapon"), block("fvx_scenario"), block("fvx_freeze")
    ] },
    { kind: "category", name: "Véhicule", colour: C.vehicle, contents: [block("fvx_vehicle"), block("fvx_repair"), block("fvx_delete_vehicle")] },
    { kind: "category", name: "Serveur", colour: C.server, contents: [
      block("fvx_money", { AMOUNT: shadowNum(500) }), block("fvx_announce", { TEXT: shadowText("Événement dans 5 minutes !") }),
      block("fvx_kick", { TEXT: shadowText("Au revoir") }), block("fvx_print", { TEXT: shadowText("Test") })
    ] },
    { kind: "category", name: "Contrôle", colour: C.control, contents: [
      block("fvx_wait", { SECONDS: shadowNum(1) }), block("controls_if"), { kind: "block", type: "controls_if", extraState: { hasElse: true } },
      block("controls_repeat_ext", { TIMES: shadowNum(3) })
    ] },
    { kind: "category", name: "Valeurs", colour: C.value, contents: [
      block("fvx_player_name"), block("fvx_cmd_arg"), block("fvx_is_admin"), block("fvx_in_vehicle"), block("fvx_player_count"),
      block("logic_compare", { A: shadowNum(0), B: shadowNum(0) }), block("logic_operation"), block("logic_negate"), block("logic_boolean"),
      block("math_number"), block("math_arithmetic", { A: shadowNum(1), B: shadowNum(1) }), block("math_random_int", { FROM: shadowNum(1), TO: shadowNum(100) }),
      block("text"), block("text_join")
    ] }
  ]
};

/** What a new block script starts with: a working /soin command. */
export const STARTER_BLOCKS = {
  blocks: {
    languageVersion: 0,
    blocks: [{
      type: "fvx_on_command", x: 40, y: 40, fields: { NAME: "soin", ADMIN: false },
      inputs: { DO: { block: {
        type: "fvx_heal",
        next: { block: { type: "fvx_notify", inputs: { TEXT: { shadow: { type: "text", fields: { TEXT: "Tu es soigné !" } } } } } }
      } } }
    }]
  }
};

// ---- génération Lua ----

type Input = { block?: BNode; shadow?: BNode };
export type BNode = {
  type?: string;
  fields?: Record<string, unknown>;
  inputs?: Record<string, Input>;
  next?: Input;
  enabled?: boolean;
  disabledReasons?: unknown[];
};

type Side = "client" | "server";
type Ctx = { side: Side; warnings: Set<string>; actions: Set<string>; serverHelpers: Set<string>; framework: Framework; nodes: number };

const MAX_NODES = 3000;
const MAX_DEPTH = 120;
const HATS: Record<string, Side> = { fvx_on_command: "server", fvx_on_key: "client", fvx_on_zone: "client", fvx_on_start: "client", fvx_on_death: "client", fvx_every: "client" };
const SERVER_ONLY: Record<string, string> = {
  fvx_money: "« donner / retirer de l'argent »",
  fvx_kick: "« expulser le joueur »",
  fvx_announce: "« annoncer à tout le serveur »",
  fvx_is_admin: "« le joueur est admin »",
  fvx_player_count: "« nombre de joueurs connectés »"
};

/** Lua string literal. */
export function luaString(value: unknown): string {
  const s = String(value ?? "").slice(0, 500);
  return `"${s.replace(/[\\"]/g, (c) => `\\${c}`).replace(/\n/g, "\\n").replace(/\r/g, "").replace(/[\u0000-\u001f]/g, " ")}"`;
}

function luaNumber(value: unknown, fallback = 0): string {
  const n = Number(value);
  return String(Number.isFinite(n) ? Number(n.toFixed(3)) : fallback);
}

const field = (node: BNode, name: string) => node.fields?.[name];
const child = (node: BNode, name: string): BNode | undefined => node.inputs?.[name]?.block ?? node.inputs?.[name]?.shadow;
const enabled = (node: BNode) => node.enabled !== false && !(Array.isArray(node.disabledReasons) && node.disabledReasons.length);

function count(ctx: Ctx) {
  if (++ctx.nodes > MAX_NODES) throw new Error("blocks_too_large");
}

/** A value block as a Lua expression. */
function expr(node: BNode | undefined, ctx: Ctx, fallback: string, depth: number): string {
  if (!node || !enabled(node) || depth > MAX_DEPTH) return fallback;
  count(ctx);
  const sub = (name: string, fb: string) => expr(child(node, name), ctx, fb, depth + 1);
  switch (node.type) {
    case "math_number": return luaNumber(field(node, "NUM"));
    case "text": return luaString(field(node, "TEXT"));
    case "logic_boolean": return field(node, "BOOL") === "FALSE" ? "false" : "true";
    case "logic_negate": return `not (${sub("BOOL", "false")})`;
    case "logic_operation": return `(${sub("A", "false")}) ${field(node, "OP") === "OR" ? "or" : "and"} (${sub("B", "false")})`;
    case "logic_compare": {
      const ops: Record<string, string> = { EQ: "==", NEQ: "~=", LT: "<", LTE: "<=", GT: ">", GTE: ">=" };
      const op = ops[String(field(node, "OP"))] ?? "==";
      // Comparer « 500 » (texte tapé après une commande) à 500 doit marcher : on compare des nombres quand c'est possible.
      return op === "==" || op === "~="
        ? `(tostring(${sub("A", "0")}) ${op} tostring(${sub("B", "0")}))`
        : `((tonumber(${sub("A", "0")}) or 0) ${op} (tonumber(${sub("B", "0")}) or 0))`;
    }
    case "math_arithmetic": {
      const ops: Record<string, string> = { ADD: "+", MINUS: "-", MULTIPLY: "*", DIVIDE: "/", POWER: "^" };
      return `((tonumber(${sub("A", "0")}) or 0) ${ops[String(field(node, "OP"))] ?? "+"} (tonumber(${sub("B", "0")}) or 0))`;
    }
    case "math_random_int": return `math.random(math.floor(tonumber(${sub("FROM", "1")}) or 1), math.floor(tonumber(${sub("TO", "100")}) or 100))`;
    case "text_join": {
      const parts = Object.keys(node.inputs ?? {}).filter((k) => /^ADD\d+$/.test(k)).sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)))
        .map((k) => `tostring(${sub(k, '""')})`);
      return parts.length ? `(${parts.join(" .. ")})` : '""';
    }
    case "fvx_player_name": return ctx.side === "server" ? "GetPlayerName(src)" : "GetPlayerName(PlayerId())";
    case "fvx_cmd_arg": {
      if (ctx.side !== "server") {
        ctx.warnings.add("« mot n° … après la commande » ne marche que dans « quand un joueur tape /… ».");
        return '""';
      }
      return `(args[${Math.max(1, Math.min(9, Math.floor(Number(field(node, "N")) || 1)))}] or "")`;
    }
    case "fvx_is_admin":
      if (ctx.side !== "server") return serverOnly(node, ctx, "false");
      return 'IsPlayerAceAllowed(src, "command")';
    case "fvx_player_count":
      if (ctx.side !== "server") return serverOnly(node, ctx, "0");
      return "#GetPlayers()";
    case "fvx_in_vehicle": return ctx.side === "server" ? "(GetVehiclePedIsIn(GetPlayerPed(src), false) ~= 0)" : "IsPedInAnyVehicle(PlayerPedId(), false)";
    default:
      ctx.warnings.add(`Bloc inconnu ignoré : ${String(node.type)}.`);
      return fallback;
  }
}

function serverOnly(node: BNode, ctx: Ctx, fallback: string): string {
  ctx.warnings.add(`${SERVER_ONLY[String(node.type)]} ne marche que dans « quand un joueur tape /… » (côté serveur) : bloc ignoré ailleurs.`);
  return fallback;
}

/** A client action: called directly on the client, or sent to the player's client from the server. */
function act(ctx: Ctx, name: string, args: string[]): string {
  ctx.actions.add(name);
  return ctx.side === "client" ? `A.${name}(${args.join(", ")})` : `TriggerClientEvent(EVENT, src, ${[luaString(name), ...args].join(", ")})`;
}

/** A chain of statement blocks, as indented Lua lines. */
function stmts(first: BNode | undefined, ctx: Ctx, indent: string, depth: number): string[] {
  const lines: string[] = [];
  let node = first;
  let guard = 0;
  while (node && guard++ < MAX_NODES) {
    if (enabled(node)) lines.push(...stmt(node, ctx, indent, depth));
    node = node.next?.block;
  }
  return lines;
}

function stmt(node: BNode, ctx: Ctx, indent: string, depth: number): string[] {
  if (depth > MAX_DEPTH) throw new Error("blocks_too_large");
  count(ctx);
  const e = (name: string, fb: string) => expr(child(node, name), ctx, fb, depth + 1);
  const body = (name: string) => stmts(child(node, name), ctx, `${indent}    `, depth + 1);
  const line = (code: string) => [`${indent}${code}`];
  const coord = (name: string) => luaNumber(field(node, name));
  switch (node.type) {
    case "fvx_notify": return line(act(ctx, "notify", [e("TEXT", '""')]));
    case "fvx_heal": return line(act(ctx, "heal", []));
    case "fvx_armor": return line(act(ctx, "armor", [e("N", "100")]));
    case "fvx_teleport": return line(act(ctx, "teleport", [coord("X"), coord("Y"), coord("Z")]));
    case "fvx_waypoint": return line(act(ctx, "waypoint", [coord("X"), coord("Y")]));
    case "fvx_weapon": {
      const weapon = String(field(node, "WEAPON") ?? "");
      if (!/^[A-Z0-9_]{3,40}$/.test(weapon)) return [];
      return line(act(ctx, "weapon", [luaString(weapon), luaNumber(field(node, "AMMO"), 60)]));
    }
    case "fvx_scenario": {
      const name = String(field(node, "NAME") ?? "stop");
      return line(act(ctx, "scenario", [luaString(/^[A-Z_]{3,40}$|^stop$/.test(name) ? name : "stop")]));
    }
    case "fvx_freeze": return line(act(ctx, "freeze", [field(node, "ON") === "FALSE" ? "false" : "true"]));
    case "fvx_vehicle": {
      const model = String(field(node, "MODEL") ?? "").trim();
      if (!MODEL_RE.test(model)) {
        ctx.warnings.add(`Modèle de véhicule invalide : « ${model.slice(0, 40)} ».`);
        return [];
      }
      return line(act(ctx, "vehicle", [luaString(model)]));
    }
    case "fvx_repair": return line(act(ctx, "repair", []));
    case "fvx_delete_vehicle": return line(act(ctx, "delete_vehicle", []));
    case "fvx_print": return line(`print(${ctx.side === "server" ? "" : '"[client] " .. '}tostring(${e("TEXT", '""')}))`);
    case "fvx_announce":
      if (ctx.side !== "server") return line(`-- ${serverOnly(node, ctx, "")}bloc « annoncer » ignoré (côté client)`);
      return line(`TriggerClientEvent("chat:addMessage", -1, { color = { 255, 191, 0 }, args = { "Annonce", tostring(${e("TEXT", '""')}) } })`);
    case "fvx_kick":
      if (ctx.side !== "server") return line(`-- ${serverOnly(node, ctx, "")}bloc « expulser » ignoré (côté client)`);
      return line(`DropPlayer(src, tostring(${e("TEXT", '"Expulsé"')}))`);
    case "fvx_money": {
      if (ctx.side !== "server") return line(`-- ${serverOnly(node, ctx, "")}bloc « argent » ignoré (côté client)`);
      if (ctx.framework === "standalone") {
        ctx.warnings.add("L'argent dépend du framework : choisis ESX, QBCore ou Qbox en haut de la page.");
        return line("-- bloc « argent » ignoré : aucun framework choisi");
      }
      ctx.serverHelpers.add("money");
      const account = field(node, "ACCOUNT") === "bank" ? "bank" : "cash";
      return line(`money(src, ${field(node, "MODE") === "REMOVE" ? "-" : ""}(tonumber(${e("AMOUNT", "0")}) or 0), ${luaString(account)})`);
    }
    case "fvx_wait": return line(`Wait(math.floor((tonumber(${e("SECONDS", "1")}) or 1) * 1000))`);
    case "controls_repeat_ext": {
      const inner = body("DO");
      return [`${indent}for _ = 1, math.min(1000, math.floor(tonumber(${e("TIMES", "1")}) or 0)) do`, ...inner, `${indent}end`];
    }
    case "controls_if": {
      const out: string[] = [];
      for (let i = 0; node.inputs && (`IF${i}` in node.inputs || `DO${i}` in node.inputs); i++) {
        out.push(`${indent}${i === 0 ? "if" : "elseif"} ${e(`IF${i}`, "false")} then`, ...body(`DO${i}`));
      }
      if (!out.length) out.push(`${indent}if false then`);
      if (node.inputs?.ELSE) out.push(`${indent}else`, ...body("ELSE"));
      out.push(`${indent}end`);
      return out;
    }
    default:
      if (node.type && node.type in HATS) return [];
      ctx.warnings.add(`Bloc inconnu ignoré : ${String(node.type)}.`);
      return [];
  }
}

/** Each event block: where it runs and its Lua code. */
function hat(node: BNode, ctx: Ctx, index: number): string[] {
  const inner = stmts(child(node, "DO"), ctx, "        ", 1);
  const thread = (pre: string, post: string) => [pre, "    CreateThread(function()", ...inner, "    end)", post];
  switch (node.type) {
    case "fvx_on_command": {
      const name = String(field(node, "NAME") ?? "").trim().replace(/^\//, "").toLowerCase();
      if (!/^[a-z0-9_]{1,32}$/.test(name)) {
        ctx.warnings.add(`Nom de commande invalide : « /${name.slice(0, 40)} » (lettres, chiffres et _ uniquement).`);
        return [];
      }
      const admin = field(node, "ADMIN") === true || field(node, "ADMIN") === "TRUE";
      return [
        `-- /${name}${admin ? " (admins seulement : permission ACE « command »)" : ""}`,
        ...thread(`RegisterCommand(${luaString(name)}, function(src, args)\n    if src == 0 then return print("/${name} : commande réservée aux joueurs") end`, `end, ${admin ? "true" : "false"})`)
      ];
    }
    case "fvx_on_key": {
      const key = String(field(node, "KEY") ?? "E");
      const valid = KEYS.some(([, k]) => k === key) ? key : "E";
      const cmd = `KEY_${index}`;
      return [
        `-- Touche ${valid}`,
        `local ${cmd} = GetCurrentResourceName() .. "_touche_${index}"`,
        ...thread(`RegisterCommand(${cmd}, function()`, "end, false)"),
        `RegisterKeyMapping(${cmd}, "${valid} (" .. GetCurrentResourceName() .. ")", "keyboard", ${luaString(valid)})`
      ];
    }
    case "fvx_on_zone": {
      const pos = `vector3(${luaNumber(field(node, "X"))}, ${luaNumber(field(node, "Y"))}, ${luaNumber(field(node, "Z"))})`;
      const r = luaNumber(Math.max(1, Math.min(100, Number(field(node, "R")) || 3)));
      const press = field(node, "PRESS") !== false && field(node, "PRESS") !== "FALSE";
      const marker = field(node, "MARKER") !== false && field(node, "MARKER") !== "FALSE";
      const run = ["            CreateThread(function()", ...inner.map((l) => `        ${l}`), "            end)"];
      return [
        `-- Zone ${index}`,
        "CreateThread(function()",
        `    local pos, radius, inside = ${pos}, ${r}, false`,
        "    while true do",
        "        local dist = #(GetEntityCoords(PlayerPedId()) - pos)",
        "        local wait = dist < radius + 30 and 0 or 1000",
        ...(marker ? ["        if dist < radius + 30 then DrawMarker(1, pos.x, pos.y, pos.z - 1.0, 0, 0, 0, 0, 0, 0, radius * 2, radius * 2, 0.6, 255, 191, 0, 90, false, false, 2, false, nil, nil, false) end"] : []),
        "        if dist < radius then",
        ...(press
          ? [
              '            BeginTextCommandDisplayHelp("STRING")',
              '            AddTextComponentSubstringPlayerName("Appuie sur ~INPUT_CONTEXT~")',
              "            EndTextCommandDisplayHelp(0, false, true, -1)",
              "            if IsControlJustReleased(0, 38) then",
              ...run.map((l) => `    ${l}`),
              "                Wait(500)",
              "            end"
            ]
          : ["            if not inside then", ...run.map((l) => `    ${l}`), "            end", "            inside = true"]),
        ...(press ? [] : ["        else", "            inside = false"]),
        "        end",
        "        Wait(wait)",
        "    end",
        "end)"
      ];
    }
    case "fvx_on_start":
      return ["-- À l'arrivée en jeu", "CreateThread(function()", "    while not NetworkIsPlayerActive(PlayerId()) do Wait(500) end", "    Wait(2000)", ...inner.map((l) => l.slice(4)), "end)"];
    case "fvx_on_death":
      return [
        "-- À la mort du joueur",
        "CreateThread(function()",
        "    local dead = false",
        "    while true do",
        "        local now = IsEntityDead(PlayerPedId())",
        "        if now and not dead then",
        "            CreateThread(function()",
        ...inner.map((l) => `        ${l}`),
        "            end)",
        "        end",
        "        dead = now",
        "        Wait(500)",
        "    end",
        "end)"
      ];
    case "fvx_every": {
      const seconds = Math.max(1, Math.min(86400, Math.floor(Number(field(node, "SECONDS")) || 60)));
      return [`-- Toutes les ${seconds} s`, "CreateThread(function()", "    while true do", `        Wait(${seconds * 1000})`, ...inner, "    end", "end)"];
    }
    default:
      return [];
  }
}

const CLIENT_ACTIONS: Record<string, string> = {
  notify: `function A.notify(msg)
    BeginTextCommandThefeedPost("STRING")
    AddTextComponentSubstringPlayerName(tostring(msg))
    EndTextCommandThefeedPostTicker(false, true)
end`,
  heal: `function A.heal()
    local ped = PlayerPedId()
    SetEntityHealth(ped, GetEntityMaxHealth(ped))
    ClearPedBloodDamage(ped)
end`,
  armor: `function A.armor(n)
    SetPedArmour(PlayerPedId(), math.max(0, math.min(100, math.floor(tonumber(n) or 0))))
end`,
  teleport: `function A.teleport(x, y, z)
    local ped = PlayerPedId()
    local entity = IsPedInAnyVehicle(ped, false) and GetVehiclePedIsIn(ped, false) or ped
    SetEntityCoords(entity, x + 0.0, y + 0.0, z + 0.0, false, false, false, false)
end`,
  waypoint: `function A.waypoint(x, y)
    SetNewWaypoint(x + 0.0, y + 0.0)
end`,
  weapon: `function A.weapon(name, ammo)
    GiveWeaponToPed(PlayerPedId(), GetHashKey(name), math.floor(tonumber(ammo) or 0), false, true)
end`,
  scenario: `function A.scenario(name)
    local ped = PlayerPedId()
    if name == "stop" then ClearPedTasks(ped) else TaskStartScenarioInPlace(ped, name, 0, true) end
end`,
  freeze: `function A.freeze(on)
    FreezeEntityPosition(PlayerPedId(), on == true)
end`,
  vehicle: `function A.vehicle(model)
    local hash = GetHashKey(model)
    if not IsModelInCdimage(hash) or not IsModelAVehicle(hash) then return A.notify("Véhicule inconnu : " .. tostring(model)) end
    RequestModel(hash)
    local timeout = GetGameTimer() + 5000
    while not HasModelLoaded(hash) and GetGameTimer() < timeout do Wait(10) end
    local ped = PlayerPedId()
    local pos = GetEntityCoords(ped)
    local vehicle = CreateVehicle(hash, pos.x, pos.y, pos.z, GetEntityHeading(ped), true, false)
    SetPedIntoVehicle(ped, vehicle, -1)
    SetVehicleOnGroundProperly(vehicle)
    SetModelAsNoLongerNeeded(hash)
end`,
  repair: `function A.repair()
    local vehicle = GetVehiclePedIsIn(PlayerPedId(), false)
    if vehicle == 0 then return end
    SetVehicleFixed(vehicle)
    SetVehicleDeformationFixed(vehicle)
    SetVehicleEngineHealth(vehicle, 1000.0)
end`,
  delete_vehicle: `function A.delete_vehicle()
    local vehicle = GetVehiclePedIsIn(PlayerPedId(), false)
    if vehicle == 0 then return end
    SetEntityAsMissionEntity(vehicle, true, true)
    DeleteVehicle(vehicle)
end`
};

function moneyHelper(framework: Framework): string {
  if (framework === "esx") {
    return `local ESX = exports["es_extended"]:getSharedObject()

local function money(src, amount, account)
    local xPlayer = ESX.GetPlayerFromId(src)
    if not xPlayer or amount == 0 then return end
    local name = account == "bank" and "bank" or "money"
    if amount > 0 then xPlayer.addAccountMoney(name, math.floor(amount)) else xPlayer.removeAccountMoney(name, math.floor(-amount)) end
end`;
  }
  const get = framework === "qbox" ? "exports.qbx_core:GetPlayer(src)" : "QBCore.Functions.GetPlayer(src)";
  return `${framework === "qbcore" ? 'local QBCore = exports["qb-core"]:GetCoreObject()\n\n' : ""}local function money(src, amount, account)
    local player = ${get}
    if not player or amount == 0 then return end
    if amount > 0 then player.Functions.AddMoney(account, math.floor(amount)) else player.Functions.RemoveMoney(account, math.floor(-amount)) end
end`;
}

const DEPENDENCY: Partial<Record<Framework, string>> = { esx: "es_extended", qbcore: "qb-core", qbox: "qbx_core" };

/** Pure: the resource made from a block workspace, and what does not work as placed. */
export function blocksFiles(name: string, framework: Framework, workspace: unknown): { files: StudioFile[]; warnings: string[] } {
  const ws = (workspace && typeof workspace === "object" ? workspace : {}) as { blocks?: { blocks?: unknown } };
  const top = (Array.isArray(ws.blocks?.blocks) ? ws.blocks.blocks : []).filter((b): b is BNode => Boolean(b && typeof b === "object"));
  const warnings = new Set<string>();
  const actions = new Set<string>();
  const serverHelpers = new Set<string>();
  const ctx = (side: Side): Ctx => ({ side, warnings, actions, serverHelpers, framework, nodes: 0 });
  const sections: Record<Side, string[][]> = { client: [], server: [] };
  let orphans = 0;
  let serverActions = false;
  let total = 0;

  top.forEach((node, i) => {
    if (!enabled(node)) return;
    const side = node.type ? HATS[node.type] : undefined;
    if (!side) {
      orphans++;
      return;
    }
    const c = ctx(side);
    const code = hat(node, c, i + 1);
    total += c.nodes;
    if (total > MAX_NODES) throw new Error("blocks_too_large");
    if (side === "server" && code.some((l) => l.includes("TriggerClientEvent(EVENT"))) serverActions = true;
    if (code.length) sections[side].push(code);
  });
  if (orphans) warnings.add(`${orphans} groupe(s) de blocs posé(s) hors d'un événement (jaune) : ils ne font rien.`);
  if (!sections.client.length && !sections.server.length) warnings.add("Aucun événement : commence par un bloc jaune (« quand… »).");

  const label = name.replace(/[\r\n'\]]/g, " ").slice(0, 80);
  const header = (side: string) => `-- « ${label} » (${side}), généré par Fiverax Studio à partir des blocs.\n-- Modifie les blocs dans le panel plutôt que ce fichier : il est réécrit à chaque enregistrement.\n`;
  const needClient = sections.client.length > 0 || serverActions;
  const files: StudioFile[] = [];

  const deps = serverHelpers.has("money") && DEPENDENCY[framework] ? [DEPENDENCY[framework] as string] : [];
  files.push({
    path: "fxmanifest.lua",
    content: `fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name '${label}'
description 'Script créé avec les blocs de Fiverax Studio'
${needClient ? "\nclient_script 'client.lua'" : ""}${sections.server.length ? "\nserver_script 'server.lua'" : ""}${deps.length ? `\n\ndependencies { ${deps.map((d) => `'${d}'`).join(", ")} }` : ""}
`
  });

  if (needClient) {
    const lib = [...actions].sort().map((a) => CLIENT_ACTIONS[a]).filter(Boolean);
    files.push({
      path: "client.lua",
      content: [
        header("client"),
        "local A = {}",
        ...(lib.length ? ["", lib.join("\n\n")] : []),
        ...(serverActions
          ? ["", "-- Actions demandées par le serveur (commandes) : seul le serveur peut envoyer cet événement aux autres joueurs.", 'local EVENT = GetCurrentResourceName() .. ":action"', "RegisterNetEvent(EVENT, function(name, ...)", "    if A[name] then A[name](...) end", "end)"]
          : []),
        ...sections.client.flatMap((s) => ["", ...s])
      ].join("\n") + "\n"
    });
  }
  if (sections.server.length) {
    files.push({
      path: "server.lua",
      content: [
        header("serveur"),
        'local EVENT = GetCurrentResourceName() .. ":action"',
        ...(serverHelpers.has("money") ? ["", moneyHelper(framework)] : []),
        ...sections.server.flatMap((s) => ["", ...s])
      ].join("\n") + "\n"
    });
  }
  return { files, warnings: [...warnings] };
}

/** Stored workspace: a plain object within size limits. */
export function cleanBlocks(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return STARTER_BLOCKS;
  if (JSON.stringify(raw).length > 300_000) throw new Error("blocks_too_large");
  return raw;
}
