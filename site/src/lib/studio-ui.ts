import type { StudioFile, UITest } from "./studio-shared";

/**
 * UI Creator, mode simple : une fenêtre faite d'éléments empilés (titre, texte, bouton, jauge, champ, image),
 * avec une position, des couleurs et une façon de s'ouvrir. Ce module pur en écrit la ressource NUI ; le serveur
 * refait la même chose à l'enregistrement.
 */

export type UIElement =
  | { id: string; type: "title"; text: string }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "button"; text: string; action: "close" | "command"; command: string; style: "primary" | "ghost" }
  | { id: string; type: "gauge"; label: string; stat: "health" | "armor" | "speed"; color: string }
  | { id: string; type: "input"; label: string; placeholder: string }
  | { id: string; type: "image"; url: string }
  | { id: string; type: "divider" };

export type UIElementType = UIElement["type"];

export const POSITIONS = ["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"] as const;
export type UIPosition = (typeof POSITIONS)[number];

export type UIDesign = {
  open: "always" | "command" | "key";
  command: string;
  key: string;
  position: UIPosition;
  width: number;
  theme: "dark" | "light" | "glass";
  accent: string;
  radius: number;
  font: "Poppins" | "Inter" | "Montserrat" | "Bebas Neue";
  elements: UIElement[];
};

export const ELEMENT_LABEL: Record<UIElementType, string> = {
  title: "Titre", text: "Texte", button: "Bouton", gauge: "Jauge", input: "Champ à remplir", image: "Image", divider: "Séparateur"
};
export const STAT_LABEL = { health: "Vie", armor: "Armure", speed: "Vitesse (km/h)" } as const;
export const FONTS = ["Poppins", "Inter", "Montserrat", "Bebas Neue"] as const;
export const UI_KEYS = ["F1", "F2", "F3", "F5", "F6", "F7", "F9", "F10", "E", "G", "H", "K", "M", "U", "Y"] as const;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

let seq = 0;
export const uiId = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`;

export function newElement(type: UIElementType): UIElement {
  const id = uiId();
  switch (type) {
    case "title": return { id, type, text: "Mon menu" };
    case "text": return { id, type, text: "Un petit texte d'explication." };
    case "button": return { id, type, text: "Valider", action: "close", command: "", style: "primary" };
    case "gauge": return { id, type, label: "Vie", stat: "health", color: "#4ade80" };
    case "input": return { id, type, label: "Montant", placeholder: "500" };
    case "image": return { id, type, url: "" };
    case "divider": return { id, type };
  }
}

const base: Omit<UIDesign, "elements"> = { open: "command", command: "menu", key: "F5", position: "mc", width: 380, theme: "dark", accent: "#8b5cf6", radius: 14, font: "Poppins" };

/** Ready-made starting points. */
export const UI_TEMPLATES: { key: string; label: string; make: () => UIDesign }[] = [
  {
    key: "menu", label: "Menu",
    make: () => ({ ...base, elements: [
      { id: uiId(), type: "title", text: "Menu" },
      { id: uiId(), type: "text", text: "Choisis une option :" },
      { id: uiId(), type: "button", text: "Réparer mon véhicule", action: "command", command: "repair", style: "primary" },
      { id: uiId(), type: "button", text: "Fermer", action: "close", command: "", style: "ghost" }
    ] })
  },
  {
    key: "hud", label: "HUD (toujours affiché)",
    make: () => ({ ...base, open: "always", position: "bl", width: 260, theme: "glass", accent: "#4ade80", radius: 10, elements: [
      { id: uiId(), type: "gauge", label: "Vie", stat: "health", color: "#4ade80" },
      { id: uiId(), type: "gauge", label: "Armure", stat: "armor", color: "#60a5fa" }
    ] })
  },
  {
    key: "speedo", label: "Compteur de vitesse",
    make: () => ({ ...base, open: "always", position: "br", width: 220, theme: "glass", accent: "#f59e0b", radius: 10, font: "Bebas Neue", elements: [
      { id: uiId(), type: "gauge", label: "km/h", stat: "speed", color: "#f59e0b" }
    ] })
  },
  {
    key: "form", label: "Formulaire",
    make: () => ({ ...base, command: "don", elements: [
      { id: uiId(), type: "title", text: "Faire un don" },
      { id: uiId(), type: "input", label: "Montant", placeholder: "500" },
      { id: uiId(), type: "button", text: "Envoyer", action: "command", command: "don", style: "primary" },
      { id: uiId(), type: "button", text: "Annuler", action: "close", command: "", style: "ghost" }
    ] })
  },
  {
    key: "info", label: "Panneau d'infos",
    make: () => ({ ...base, command: "regles", width: 520, theme: "light", accent: "#2563eb", elements: [
      { id: uiId(), type: "title", text: "Règlement" },
      { id: uiId(), type: "text", text: "1. Respecte les autres joueurs.\n2. Pas de freekill.\n3. Amuse-toi bien !" },
      { id: uiId(), type: "divider" },
      { id: uiId(), type: "button", text: "J'ai compris", action: "close", command: "", style: "primary" }
    ] })
  }
];

export const DEFAULT_UI = (): UIDesign => UI_TEMPLATES[0].make();

const clampN = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
const str = (v: unknown, max: number, fallback = "") => (typeof v === "string" ? v.slice(0, max) : fallback);
const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const cmdName = (v: unknown) => str(v, 32).trim().replace(/^\//, "").toLowerCase().replace(/[^a-z0-9_]/g, "");

/** Read a stored design, dropping anything invalid. */
export function cleanUIDesign(raw: unknown): UIDesign {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const elements = (Array.isArray(d.elements) ? d.elements : []).slice(0, 40).map((e): UIElement | null => {
    if (!e || typeof e !== "object") return null;
    const r = e as Record<string, unknown>;
    const id = typeof r.id === "string" && /^[\w-]{1,40}$/.test(r.id) ? r.id : uiId();
    switch (r.type) {
      case "title": case "text": return { id, type: r.type, text: str(r.text, r.type === "title" ? 120 : 2000) };
      case "button": return { id, type: "button", text: str(r.text, 60), action: r.action === "command" ? "command" : "close", command: cmdName(r.command), style: r.style === "ghost" ? "ghost" : "primary" };
      case "gauge": return { id, type: "gauge", label: str(r.label, 40), stat: pick(r.stat, ["health", "armor", "speed"] as const, "health"), color: COLOR_RE.test(String(r.color)) ? String(r.color) : "#4ade80" };
      case "input": return { id, type: "input", label: str(r.label, 60), placeholder: str(r.placeholder, 60) };
      case "image": return { id, type: "image", url: /^https:\/\/[^\s"'<>]{4,400}$/.test(String(r.url)) ? String(r.url) : "" };
      case "divider": return { id, type: "divider" };
      default: return null;
    }
  }).filter((e): e is UIElement => e !== null);
  return {
    open: pick(d.open, ["always", "command", "key"] as const, base.open),
    command: cmdName(d.command) || base.command,
    key: pick(d.key, UI_KEYS, "F5"),
    position: pick(d.position, POSITIONS, base.position),
    width: clampN(d.width, 160, 900, base.width),
    theme: pick(d.theme, ["dark", "light", "glass"] as const, base.theme),
    accent: COLOR_RE.test(String(d.accent)) ? String(d.accent) : base.accent,
    radius: clampN(d.radius, 0, 32, base.radius),
    font: pick(d.font, FONTS, base.font),
    elements
  };
}

const html = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const luaStr = (s: string) => `"${s.replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\r\n]/g, " ")}"`;

/** Test messages for the preview, like those client.lua sends. */
export function uiTests(d: UIDesign): UITest[] {
  const tests: UITest[] = [];
  if (d.open !== "always") tests.push({ label: "Ouvrir", data: { action: "open" } }, { label: "Fermer", data: { action: "close" } });
  if (d.elements.some((e) => e.type === "gauge")) {
    tests.push({ label: "Stats pleines", data: { action: "stats", health: 100, armor: 100, speed: 0 } }, { label: "Stats basses", data: { action: "stats", health: 25, armor: 0, speed: 180 } });
  }
  return tests;
}

/** Pure: the NUI resource of a design. */
export function uiFiles(name: string, d: UIDesign): StudioFile[] {
  const label = name.replace(/[\r\n'\]]/g, " ").slice(0, 80);
  const [v, h] = [d.position[0], d.position[1]];
  const place = [
    v === "t" ? "top: 4vh;" : v === "b" ? "bottom: 4vh;" : "top: 50%;",
    h === "l" ? "left: 3vw;" : h === "r" ? "right: 3vw;" : "left: 50%;",
    `transform: translate(${h === "c" ? "-50%" : "0"}, ${v === "m" ? "-50%" : "0"});`
  ].join(" ");
  const theme = {
    dark: { bg: "rgba(17, 17, 24, 0.94)", fg: "#f4f4f5", muted: "#a1a1aa", line: "rgba(255,255,255,0.08)", field: "rgba(255,255,255,0.06)" },
    light: { bg: "rgba(255, 255, 255, 0.97)", fg: "#18181b", muted: "#52525b", line: "rgba(0,0,0,0.08)", field: "rgba(0,0,0,0.05)" },
    glass: { bg: "rgba(10, 10, 16, 0.45)", fg: "#ffffff", muted: "rgba(255,255,255,0.7)", line: "rgba(255,255,255,0.12)", field: "rgba(255,255,255,0.1)" }
  }[d.theme];
  const interactive = d.open !== "always";
  const gauges = d.elements.some((e) => e.type === "gauge");

  const body = d.elements.map((e) => {
    switch (e.type) {
      case "title": return `    <h1>${html(e.text)}</h1>`;
      case "text": return `    <p>${html(e.text).replace(/\n/g, "<br>")}</p>`;
      case "divider": return "    <hr>";
      case "image": return e.url ? `    <img src="${html(e.url)}" alt="">` : "";
      case "input": return `    <label class="input"><span>${html(e.label)}</span><input data-input placeholder="${html(e.placeholder)}"></label>`;
      case "gauge": return `    <div class="gauge" data-stat="${e.stat}" style="--c: ${e.color}"><div class="gauge-top"><span>${html(e.label)}</span><b>0</b></div><div class="bar"><i></i></div></div>`;
      case "button": return `    <button class="${e.style}" data-action="${e.action}" data-command="${html(e.command)}">${html(e.text)}</button>`;
    }
  }).filter(Boolean).join("\n");

  const font = d.font.replace(/ /g, "+");
  const page = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>${html(label)}</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${font}:wght@400;600;700&display=swap">
  <style>
    * { box-sizing: border-box; margin: 0; }
    html, body { background: transparent; overflow: hidden; height: 100%; font-family: "${d.font}", system-ui, sans-serif; }
    #app {
      position: absolute; ${place}
      width: ${d.width}px; max-width: 92vw; padding: 20px; display: flex; flex-direction: column; gap: 12px;
      background: ${theme.bg}; color: ${theme.fg}; border: 1px solid ${theme.line}; border-radius: ${d.radius}px;
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35); ${d.theme === "glass" ? "backdrop-filter: blur(10px);" : ""}
      transition: opacity 0.18s ease, scale 0.18s ease;
    }
    #app.hidden { opacity: 0; scale: 0.96; pointer-events: none; }
    h1 { font-size: 22px; font-weight: 700; color: ${d.accent}; }
    p { font-size: 14px; line-height: 1.5; color: ${theme.muted}; }
    hr { border: 0; border-top: 1px solid ${theme.line}; }
    img { width: 100%; border-radius: ${Math.max(0, d.radius - 6)}px; }
    .input { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: ${theme.muted}; }
    .input input { font: inherit; font-size: 15px; padding: 10px 12px; color: ${theme.fg}; background: ${theme.field}; border: 1px solid ${theme.line}; border-radius: ${Math.max(0, d.radius - 6)}px; outline: none; }
    .input input:focus { border-color: ${d.accent}; }
    button { font: inherit; font-size: 15px; font-weight: 600; padding: 11px 14px; border-radius: ${Math.max(0, d.radius - 6)}px; border: 1px solid transparent; cursor: pointer; transition: filter 0.15s, transform 0.1s; }
    button:hover { filter: brightness(1.12); }
    button:active { transform: scale(0.98); }
    button.primary { background: ${d.accent}; color: #fff; }
    button.ghost { background: transparent; color: ${theme.fg}; border-color: ${theme.line}; }
    .gauge { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
    .gauge-top { display: flex; justify-content: space-between; color: ${theme.muted}; }
    .gauge-top b { color: ${theme.fg}; }
    .bar { height: 8px; border-radius: 99px; background: ${theme.field}; overflow: hidden; }
    .bar i { display: block; height: 100%; width: 0%; background: var(--c); border-radius: inherit; transition: width 0.3s ease; }
  </style>
</head>
<body>
  <div id="app"${interactive ? ' class="hidden"' : ""}>
${body}
  </div>
  <script>
    const app = document.getElementById("app");
    const post = (name, data) => fetch(\`https://\${GetParentResourceName()}/\${name}\`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data || {}) });

    window.addEventListener("message", (event) => {
      const data = event.data || {};
      if (data.action === "open") app.classList.remove("hidden");
      if (data.action === "close") app.classList.add("hidden");
      if (data.action === "stats") {
        document.querySelectorAll(".gauge").forEach((g) => {
          const stat = g.dataset.stat;
          const value = Math.max(0, Math.round(Number(data[stat]) || 0));
          g.querySelector("b").textContent = value;
          g.querySelector(".bar i").style.width = Math.min(100, stat === "speed" ? value / 2.5 : value) + "%";
        });
      }
    });

    // Boutons : fermer, ou lancer une commande avec ce qui est écrit dans les champs.
    document.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      const values = [...document.querySelectorAll("[data-input]")].map((i) => i.value.trim()).filter(Boolean);
      if (b.dataset.action === "command" && b.dataset.command) post("command", { command: b.dataset.command, args: values });
      else post("close");
    }));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") post("close"); });
  </script>
</body>
</html>
`;

  const opener = d.open === "always"
    ? "-- Toujours affiché : pas de souris, rien à ouvrir."
    : `local open = false

local function setOpen(state)
    open = state
    SetNuiFocus(state, state)
    SendNUIMessage({ action = state and "open" or "close" })
end

RegisterCommand(${luaStr(d.command)}, function() setOpen(not open) end, false)
${d.open === "key" ? `RegisterKeyMapping(${luaStr(d.command)}, ${luaStr(`Ouvrir ${label}`)}, "keyboard", ${luaStr(d.key)})\n` : ""}
RegisterNUICallback("close", function(_, cb)
    setOpen(false)
    cb("ok")
end)

-- Un bouton lance une commande (avec ce qui est écrit dans les champs), puis la fenêtre se ferme.
RegisterNUICallback("command", function(data, cb)
    cb("ok")
    setOpen(false)
    local name = tostring(data.command or ""):gsub("[^%w_]", "")
    if name == "" then return end
    local args = {}
    for _, value in ipairs(type(data.args) == "table" and data.args or {}) do args[#args + 1] = tostring(value):gsub("[^%w%._%-]", "") end
    ExecuteCommand(name .. (#args > 0 and (" " .. table.concat(args, " ")) or ""))
end)

AddEventHandler("onResourceStop", function(resource)
    if resource == GetCurrentResourceName() and open then SetNuiFocus(false, false) end
end)`;

  const stats = gauges
    ? `

-- Jauges : envoyées à la page 4 fois par seconde.
CreateThread(function()
    while true do
        local ped = PlayerPedId()
        local max = GetEntityMaxHealth(ped) - 100
        SendNUIMessage({
            action = "stats",
            health = max > 0 and math.max(0, (GetEntityHealth(ped) - 100) / max * 100) or 0,
            armor = GetPedArmour(ped),
            speed = IsPedInAnyVehicle(ped, false) and GetEntitySpeed(GetVehiclePedIsIn(ped, false)) * 3.6 or 0
        })
        Wait(250)
    end
end)`
    : "";

  const client = `-- « ${label} », interface générée par Fiverax Studio (UI Creator, mode simple).
-- Modifie-la dans le panel plutôt qu'ici : ce fichier est réécrit à chaque enregistrement.
${d.open === "command" ? `-- Ouverture : /${d.command}` : d.open === "key" ? `-- Ouverture : touche ${d.key} (ou /${d.command})` : ""}

${opener}${stats}
`;

  const manifest = `fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name '${label}'
description 'Interface créée avec Fiverax Studio'

ui_page 'html/index.html'
files { 'html/index.html' }

client_script 'client.lua'
`;
  return [{ path: "fxmanifest.lua", content: manifest }, { path: "client.lua", content: client }, { path: "html/index.html", content: page }];
}
