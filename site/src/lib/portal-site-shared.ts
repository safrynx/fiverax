import { voteRewardSchema, type VoteReward } from "./votes-shared";

/**
 * Server player portal (/joueur/<slug>): a page each server builds from blocks in the panel (Réseau Fiverax >
 * Portail joueurs): announcements, events, buttons, information, FAQ, rules, live status, the player's own stats,
 * forms (applications, suggestions…) and giveaways (entries, draw, reward given in game by the agent).
 *
 * What the pages and the server share (no server imports here): the block catalogue, and the pure validation of a
 * design (anything not in the catalogue is dropped, links must be https or fivem:// / cfx.re).
 */

export type SubField = { key: string; label: string; kind: "text" | "textarea" | "url" | "select" | "bool"; max?: number; options?: readonly (readonly [string, string])[] };
export type Field =
  | { key: string; label: string; kind: "text" | "textarea"; max: number; def: string; hint?: string }
  | { key: string; label: string; kind: "url"; def: string; hint?: string }
  | { key: string; label: string; kind: "datetime"; def: string; hint?: string }
  | { key: string; label: string; kind: "select"; options: readonly (readonly [string, string])[]; def: string; hint?: string }
  | { key: string; label: string; kind: "number"; min: number; max: number; def: number; hint?: string }
  | { key: string; label: string; kind: "bool"; def: boolean; hint?: string }
  | { key: string; label: string; kind: "list"; max: number; fields: readonly SubField[]; def: readonly Record<string, string>[]; hint?: string };

export type ListItem = Record<string, string>;
export type FieldValue = string | number | boolean | ListItem[];
export type PortalBlock = { id: string; type: BlockType; hidden: boolean; p: Record<string, FieldValue> };

const TONES = [["info", "Info"], ["important", "Important"], ["event", "Événement"], ["update", "Mise à jour"]] as const;
const FORM_TYPES = [["text", "Réponse courte"], ["textarea", "Paragraphe"], ["select", "Choix"], ["number", "Nombre"], ["yesno", "Oui / Non"]] as const;
const REWARD_TYPES = [["none", "Aucune (le staff s'en occupe)"], ["money", "Argent en jeu"], ["item", "Objet en jeu"]] as const;
const ACCOUNTS = [["cash", "Liquide"], ["bank", "Banque"], ["black_money", "Argent sale"]] as const;

export const BLOCKS = {
  hero: {
    label: "En-tête", lead: "Grand titre, texte d'accueil et image.",
    fields: [
      { key: "title", label: "Titre", kind: "text", max: 90, def: "Bienvenue sur le serveur" },
      { key: "text", label: "Texte", kind: "textarea", max: 400, def: "Toutes les infos, les annonces et les événements du serveur, au même endroit." },
      { key: "image", label: "Image de fond", kind: "url", def: "", hint: "Lien https (1920×600 conseillé)" }
    ]
  },
  announcement: {
    label: "Annonce", lead: "Une nouvelle, une mise à jour, un message important.",
    fields: [
      { key: "title", label: "Titre", kind: "text", max: 120, def: "Nouvelle mise à jour" },
      { key: "body", label: "Texte", kind: "textarea", max: 3000, def: "Décris ici ce qui change sur le serveur." },
      { key: "tone", label: "Type", kind: "select", options: TONES, def: "info" },
      { key: "date", label: "Date affichée", kind: "datetime", def: "" },
      { key: "image", label: "Image", kind: "url", def: "" }
    ]
  },
  event: {
    label: "Événement", lead: "Une date avec compte à rebours (soirée, ouverture, wipe…).",
    fields: [
      { key: "title", label: "Titre", kind: "text", max: 120, def: "Grande soirée au casino" },
      { key: "text", label: "Texte", kind: "textarea", max: 1500, def: "Rendez-vous en jeu, tenue correcte exigée." },
      { key: "at", label: "Date et heure", kind: "datetime", def: "" },
      { key: "place", label: "Lieu", kind: "text", max: 80, def: "" },
      { key: "image", label: "Image", kind: "url", def: "" }
    ]
  },
  buttons: {
    label: "Boutons", lead: "Liens vers ton Discord, ta boutique, tes règles, le serveur…",
    fields: [
      { key: "title", label: "Titre (facultatif)", kind: "text", max: 80, def: "" },
      { key: "items", label: "Boutons", kind: "list", max: 8, fields: [{ key: "label", label: "Texte", kind: "text", max: 40 }, { key: "url", label: "Lien", kind: "url" }], def: [{ label: "Rejoindre le Discord", url: "" }] },
      { key: "primaryFirst", label: "Mettre le premier en avant", kind: "bool", def: true }
    ]
  },
  text: {
    label: "Texte d'info", lead: "Un paragraphe libre : présentation, horaires, recrutement…",
    fields: [
      { key: "title", label: "Titre", kind: "text", max: 120, def: "À propos" },
      { key: "body", label: "Texte", kind: "textarea", max: 5000, def: "" },
      { key: "image", label: "Image", kind: "url", def: "" }
    ]
  },
  faq: {
    label: "FAQ", lead: "Questions fréquentes, dépliables.",
    fields: [
      { key: "title", label: "Titre", kind: "text", max: 80, def: "Questions fréquentes" },
      { key: "items", label: "Questions", kind: "list", max: 25, fields: [{ key: "q", label: "Question", kind: "text", max: 200 }, { key: "a", label: "Réponse", kind: "textarea", max: 1500 }], def: [{ q: "Comment rejoindre le serveur ?", a: "Clique sur « Rejoindre » ou cherche le serveur dans FiveM." }] }
    ]
  },
  rules: {
    label: "Règlement", lead: "Les règles numérotées du serveur.",
    fields: [
      { key: "title", label: "Titre", kind: "text", max: 80, def: "Règlement" },
      { key: "items", label: "Règles", kind: "list", max: 50, fields: [{ key: "title", label: "Règle", kind: "text", max: 160 }, { key: "text", label: "Détail", kind: "textarea", max: 1000 }], def: [{ title: "Respect de tous les joueurs", text: "" }] }
    ]
  },
  status: {
    label: "Statut du serveur", lead: "Joueurs connectés en direct et bouton pour rejoindre.",
    fields: [
      { key: "title", label: "Titre", kind: "text", max: 80, def: "Le serveur" },
      { key: "connect", label: "Adresse de connexion", kind: "text", max: 120, def: "", hint: "cfx.re/join/xxxxxx ou ip:port (vide : celle de ta fiche annuaire)" },
      { key: "button", label: "Texte du bouton", kind: "text", max: 40, def: "Rejoindre le serveur" }
    ]
  },
  stats: {
    label: "Mes stats", lead: "Le temps de jeu, les sessions et le statut du joueur connecté.",
    fields: [{ key: "title", label: "Titre", kind: "text", max: 80, def: "Ton profil sur le serveur" }]
  },
  form: {
    label: "Formulaire", lead: "Candidature staff, whitelist, suggestion, signalement… Les réponses arrivent dans le panel.",
    fields: [
      { key: "title", label: "Titre", kind: "text", max: 120, def: "Candidature staff" },
      { key: "text", label: "Présentation", kind: "textarea", max: 1500, def: "Réponds sérieusement : le staff lit chaque candidature." },
      {
        key: "questions", label: "Questions", kind: "list", max: 20,
        fields: [
          { key: "label", label: "Question", kind: "text", max: 200 },
          { key: "type", label: "Type", kind: "select", options: FORM_TYPES },
          { key: "options", label: "Choix (séparés par des virgules)", kind: "text", max: 400 },
          { key: "required", label: "Obligatoire", kind: "bool" }
        ],
        def: [{ label: "Âge", type: "number", options: "", required: "1" }, { label: "Pourquoi veux-tu nous rejoindre ?", type: "textarea", options: "", required: "1" }]
      },
      { key: "button", label: "Texte du bouton", kind: "text", max: 40, def: "Envoyer" },
      { key: "success", label: "Message après envoi", kind: "text", max: 200, def: "Merci ! Le staff te répondra ici." },
      { key: "minHours", label: "Heures de jeu minimum", kind: "number", min: 0, max: 500, def: 0, hint: "0 : tout compte Discord peut répondre" },
      { key: "once", label: "Une seule réponse par joueur", kind: "bool", def: true },
      { key: "open", label: "Formulaire ouvert", kind: "bool", def: true }
    ]
  },
  giveaway: {
    label: "Giveaway", lead: "Les joueurs s'inscrivent, un tirage au sort désigne les gagnants, la récompense arrive en jeu.",
    fields: [
      { key: "title", label: "Titre", kind: "text", max: 120, def: "Giveaway du week-end" },
      { key: "prize", label: "Lot", kind: "text", max: 160, def: "Une voiture de sport" },
      { key: "text", label: "Texte", kind: "textarea", max: 1000, def: "Inscris-toi, le tirage a lieu dimanche soir." },
      { key: "image", label: "Image", kind: "url", def: "" },
      { key: "endsAt", label: "Fin des inscriptions", kind: "datetime", def: "", hint: "Le tirage se fait automatiquement à cette date" },
      { key: "winners", label: "Nombre de gagnants", kind: "number", min: 1, max: 20, def: 1 },
      { key: "minHours", label: "Heures de jeu minimum", kind: "number", min: 0, max: 500, def: 1 },
      { key: "rewardType", label: "Récompense en jeu", kind: "select", options: REWARD_TYPES, def: "none" },
      { key: "rewardAccount", label: "Compte (argent)", kind: "select", options: ACCOUNTS, def: "bank" },
      { key: "rewardAmount", label: "Montant (argent)", kind: "number", min: 1, max: 10_000_000, def: 5000 },
      { key: "rewardItem", label: "Objet (nom technique)", kind: "text", max: 60, def: "", hint: "Exemple : bread, lockpick" },
      { key: "rewardItemLabel", label: "Nom affiché de l'objet", kind: "text", max: 40, def: "" },
      { key: "rewardCount", label: "Quantité (objet)", kind: "number", min: 1, max: 1000, def: 1 }
    ]
  }
} as const satisfies Record<string, { label: string; lead: string; fields: readonly Field[] }>;

export type BlockType = keyof typeof BLOCKS;
export const BLOCK_TYPES = Object.keys(BLOCKS) as BlockType[];
export const isBlockType = (v: unknown): v is BlockType => typeof v === "string" && Object.hasOwn(BLOCKS, v);
export const blockFields = (type: BlockType): readonly Field[] => BLOCKS[type].fields;

export type PortalDesign = {
  version: 1;
  title: string;
  tagline: string;
  logo: string;
  banner: string;
  accent: string;
  blocks: PortalBlock[];
};

export const MAX_BLOCKS = 40;
export const PORTAL_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

// ---- cleaning ----

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : typeof v === "number" ? String(v).slice(0, max) : "");

/** Pure: a safe link (https, fivem://connect, a cfx.re link without scheme), or "". */
export function cleanLink(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim().slice(0, 500) : "";
  if (!s) return "";
  if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return s;
  if (/^fivem:\/\/connect\/[\w.:-]{3,120}$/i.test(s)) return s;
  if (/^(?:www\.)?cfx\.re\/join\/[a-z0-9]{4,8}$/i.test(s)) return `https://${s.replace(/^www\./i, "")}`;
  if (/^(?:discord\.gg|discord\.com\/invite)\/[\w-]{2,40}$/i.test(s)) return `https://${s}`;
  return "";
}
/** Pure: an image link (https only). */
export const cleanImage = (raw: unknown) => {
  const s = typeof raw === "string" ? raw.trim().slice(0, 500) : "";
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : "";
};
const cleanDate = (raw: unknown) => {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return "";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
};

function cleanField(f: Field, raw: unknown): FieldValue {
  switch (f.kind) {
    case "text":
    case "textarea":
      return raw === undefined ? f.def : text(raw, f.max);
    case "url":
      return f.key === "image" ? cleanImage(raw) : cleanLink(raw);
    case "datetime":
      return cleanDate(raw);
    case "select":
      return f.options.some(([v]) => v === raw) ? String(raw) : f.def;
    case "number": {
      const n = Math.round(Number(raw));
      return Number.isFinite(n) && raw !== undefined && raw !== "" ? Math.min(f.max, Math.max(f.min, n)) : f.def;
    }
    case "bool":
      return raw === undefined ? f.def : raw === true;
    case "list": {
      if (!Array.isArray(raw)) return raw === undefined ? f.def.map((x) => ({ ...x })) : [];
      return raw.slice(0, f.max).filter((x) => x && typeof x === "object").map((x) => {
        const item: ListItem = {};
        for (const sf of f.fields) {
          const v = (x as Record<string, unknown>)[sf.key];
          item[sf.key] = sf.kind === "url" ? cleanLink(v)
            : sf.kind === "select" ? (sf.options?.some(([o]) => o === v) ? String(v) : sf.options?.[0]?.[0] ?? "")
            : sf.kind === "bool" ? (v === true || v === "1" ? "1" : "")
            : text(v, sf.max ?? 200);
        }
        return item;
      });
    }
  }
}

let seq = 0;
export const blockId = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;

export function newBlock(type: BlockType): PortalBlock {
  const p: Record<string, FieldValue> = {};
  for (const f of blockFields(type)) p[f.key] = cleanField(f, undefined);
  return { id: blockId(), type, hidden: false, p };
}

export function cleanBlock(raw: unknown): PortalBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { id?: unknown; type?: unknown; hidden?: unknown; p?: unknown };
  if (!isBlockType(r.type)) return null;
  const props = (r.p && typeof r.p === "object" ? r.p : {}) as Record<string, unknown>;
  const p: Record<string, FieldValue> = {};
  for (const f of blockFields(r.type)) p[f.key] = cleanField(f, props[f.key]);
  const id = typeof r.id === "string" && /^[\w-]{1,40}$/.test(r.id) ? r.id : blockId();
  return { id, type: r.type, hidden: r.hidden === true, p };
}

/** Pure: a valid design from anything (the editor, the database). Duplicate block ids get new ones. */
export function cleanDesign(raw: unknown, fallbackTitle = "Espace joueurs"): PortalDesign {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const blocks: PortalBlock[] = [];
  for (const b of Array.isArray(r.blocks) ? r.blocks.slice(0, MAX_BLOCKS) : []) {
    const block = cleanBlock(b);
    if (!block) continue;
    if (seen.has(block.id)) block.id = blockId();
    seen.add(block.id);
    blocks.push(block);
  }
  const accent = typeof r.accent === "string" && /^#[0-9a-f]{6}$/i.test(r.accent) ? r.accent.toLowerCase() : "#d4b06a";
  return {
    version: 1,
    title: text(r.title, 80) || fallbackTitle,
    tagline: text(r.tagline, 200),
    logo: cleanImage(r.logo),
    banner: cleanImage(r.banner),
    accent,
    blocks
  };
}

/** Pure: the page a new server starts from. */
export function starterDesign(name: string): PortalDesign {
  const hero = newBlock("hero");
  hero.p.title = `Bienvenue sur ${name}`.slice(0, 90);
  return cleanDesign({
    title: name, tagline: "L'espace des joueurs : annonces, événements, candidatures et giveaways.",
    blocks: [hero, newBlock("status"), newBlock("announcement"), newBlock("stats"), newBlock("buttons"), newBlock("rules")]
  }, name);
}

/** Pure: "r,g,b" of a #rrggbb color (CSS variables of the page). */
export function hexRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

// ---- forms ----

export type FormQuestion = { label: string; type: "text" | "textarea" | "select" | "number" | "yesno"; options: string[]; required: boolean };

export function formQuestions(block: PortalBlock): FormQuestion[] {
  const items = Array.isArray(block.p.questions) ? (block.p.questions as ListItem[]) : [];
  return items
    .filter((q) => q.label?.trim())
    .map((q) => ({
      label: q.label.trim(),
      type: (["text", "textarea", "select", "number", "yesno"].includes(q.type) ? q.type : "text") as FormQuestion["type"],
      options: (q.options ?? "").split(",").map((o) => o.trim()).filter(Boolean).slice(0, 20),
      required: q.required === "1"
    }));
}

/** Pure: the answers of a form, checked against its questions (index → answer). Throws a code on the first problem. */
export function checkAnswers(questions: FormQuestion[], raw: unknown): string[] {
  const input = Array.isArray(raw) ? raw : [];
  return questions.map((q, i) => {
    const v = typeof input[i] === "string" || typeof input[i] === "number" ? String(input[i]).trim() : "";
    if (!v) {
      if (q.required) throw new Error(`answer_required:${i}`);
      return "";
    }
    const max = q.type === "textarea" ? 3000 : 300;
    if (v.length > max) throw new Error(`answer_too_long:${i}`);
    if (q.type === "number" && !/^-?\d{1,9}([.,]\d{1,3})?$/.test(v)) throw new Error(`answer_number:${i}`);
    if (q.type === "yesno" && !["Oui", "Non"].includes(v)) throw new Error(`answer_choice:${i}`);
    if (q.type === "select" && q.options.length && !q.options.includes(v)) throw new Error(`answer_choice:${i}`);
    return v;
  });
}

export type ResponseStatus = "new" | "accepted" | "refused" | "seen";
export const RESPONSE_STATUS_LABEL: Record<ResponseStatus, string> = { new: "En attente", seen: "Lue par le staff", accepted: "Acceptée", refused: "Refusée" };

// ---- giveaways ----

/** Pure: the in-game reward of a giveaway block (null: none, or invalid). */
export function giveawayReward(block: PortalBlock): VoteReward | null {
  const p = block.p;
  if (p.rewardType === "money") {
    const r = voteRewardSchema.safeParse({ type: "money", account: p.rewardAccount, amount: Number(p.rewardAmount) });
    return r.success ? r.data : null;
  }
  if (p.rewardType === "item") {
    const r = voteRewardSchema.safeParse({ type: "item", item: String(p.rewardItem ?? ""), label: String(p.rewardItemLabel ?? ""), count: Number(p.rewardCount) });
    return r.success ? r.data : null;
  }
  return null;
}

/** Pure: whether a giveaway still takes entries. */
export const giveawayOpen = (block: PortalBlock, drawn: boolean, now = new Date()) =>
  !drawn && (!block.p.endsAt || new Date(String(block.p.endsAt)) > now);

// ---- what the page shows to its visitor ----

export type ViewerStats = { linked: boolean; playSeconds: number; sessions: number; firstSeenAt: string | null; inGame: boolean; banned: boolean };
export type FormView = {
  responses: { id: number; status: ResponseStatus; reply: string | null; createdAt: string }[];
  canSubmit: boolean;
  reason: "login" | "closed" | "once" | "playtime" | null;
  playHours: number;
};
export type GiveawayView = {
  entries: number;
  entered: boolean;
  open: boolean;
  drawn: boolean;
  winners: string[];
  won: boolean;
  reason: "login" | "playtime" | "closed" | null;
  playHours: number;
};
export type PortalContext = {
  serverName: string;
  slug: string;
  live: { online: boolean; players: number; maxClients: number } | null;
  connect: string | null;
  viewer: { username: string; avatarUrl: string | null } | null;
  stats: ViewerStats | null;
  forms: Record<string, FormView>;
  giveaways: Record<string, GiveawayView>;
};
