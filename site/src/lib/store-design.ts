/**
 * Store Creator : la boutique en ligne d'un serveur, faite de blocs empilés (en-tête, catégories, package mis en avant,
 * promo, objectif, derniers achats…) et d'un thème. Le même modèle est modifié par l'éditeur à blocs et par l'IA, puis
 * nettoyé ici (seule porte d'entrée) : textes bornés, couleurs en hexadécimal, liens https uniquement, aucun HTML.
 * Les packages, prix et catégories ne sont jamais copiés dans le design : les blocs n'en gardent que l'ID, le reste vient
 * de Tebex à l'affichage. Module pur, utilisable côté navigateur.
 */

export const STORE_FONTS = ["Inter", "Poppins", "Montserrat", "Space Grotesk", "Rajdhani", "Bebas Neue", "Orbitron", "Unbounded", "Playfair Display", "Russo One"] as const;
export type StoreFont = (typeof STORE_FONTS)[number];

export type StoreTheme = {
  bg: string; surface: string; text: string; muted: string; accent: string; accent2: string;
  radius: number;
  font: StoreFont; headingFont: StoreFont;
  background: "plain" | "gradient" | "glow" | "grid" | "image";
  backgroundImage: string;
  buttons: "solid" | "gradient" | "outline";
  cards: "flat" | "glass" | "bordered" | "elevated";
  /** Uppercase headings (gaming look). */
  caps: boolean;
};

export type StoreBrand = { name: string; tagline: string; logo: string; discord: string; website: string; connect: string; announcement: string };
export type StoreCheckout = { theme: "dark" | "light" | "auto"; coupon: boolean; giftCard: boolean; creatorCode: boolean };
export type StoreLegal = { terms: string; privacy: string; notice: string };
export type StoreSeo = { title: string; description: string; image: string };

/** Values a block field can hold. */
export type ListItem = Record<string, string>;
export type FieldValue = string | number | boolean | number[] | null | ListItem[];
export type StoreBlock = { id: string; type: BlockType; hidden: boolean; p: Record<string, FieldValue> };

export type StoreDesign = {
  version: 1;
  preset: string;
  theme: StoreTheme;
  brand: StoreBrand;
  blocks: StoreBlock[];
  checkout: StoreCheckout;
  legal: StoreLegal;
  seo: StoreSeo;
  /** "Propulsé par Fiverax" at the bottom of the page. */
  branding: boolean;
};

// ---- block catalogue ----

type SubField = { key: string; label: string; kind: "text" | "textarea" | "url"; max: number };
export type Field =
  | { key: string; label: string; kind: "text" | "textarea"; max: number; def: string; hint?: string }
  | { key: string; label: string; kind: "url"; def: string; hint?: string }
  | { key: string; label: string; kind: "date"; def: string; hint?: string }
  | { key: string; label: string; kind: "select"; options: readonly (readonly [string, string])[]; def: string; hint?: string }
  | { key: string; label: string; kind: "number"; min: number; max: number; def: number; hint?: string }
  | { key: string; label: string; kind: "bool"; def: boolean; hint?: string }
  | { key: string; label: string; kind: "packages" | "categories"; max: number; hint?: string }
  | { key: string; label: string; kind: "package" | "category" | "goal"; hint?: string }
  | { key: string; label: string; kind: "list"; max: number; fields: readonly SubField[]; def: readonly Readonly<ListItem>[]; hint?: string };

const ALIGN: [string, string][] = [["left", "À gauche"], ["center", "Centré"]];
const LAYOUT: [string, string][] = [["grid", "Grille"], ["list", "Liste"], ["carousel", "Carrousel"]];

export const BLOCKS = {
  hero: {
    label: "En-tête", icon: "hero", lead: "Grand titre, accroche, image de fond et bouton.",
    fields: [
      { key: "kicker", label: "Sur-titre", kind: "text", max: 60, def: "Boutique officielle" },
      { key: "title", label: "Titre", kind: "text", max: 90, def: "Soutiens le serveur" },
      { key: "subtitle", label: "Accroche", kind: "textarea", max: 260, def: "Chaque achat finance l'hébergement et les nouveautés. Les avantages arrivent en jeu en quelques minutes." },
      { key: "image", label: "Image de fond", kind: "url", def: "", hint: "Lien https vers une image (1920×1080 conseillé)" },
      { key: "cta", label: "Texte du bouton", kind: "text", max: 40, def: "Voir les offres" },
      { key: "align", label: "Alignement", kind: "select", options: ALIGN, def: "left" },
      { key: "size", label: "Hauteur", kind: "select", options: [["md", "Normale"], ["lg", "Grande"], ["full", "Plein écran"]], def: "lg" },
      { key: "live", label: "Afficher les joueurs en ligne", kind: "bool", def: true }
    ]
  },
  server: {
    label: "Statut du serveur", icon: "server", lead: "Joueurs en ligne en direct et bouton pour rejoindre.",
    fields: [
      { key: "title", label: "Titre", kind: "text", max: 80, def: "Le serveur est en ligne" },
      { key: "text", label: "Texte", kind: "textarea", max: 200, def: "Rejoins-nous en un clic depuis FiveM." },
      { key: "button", label: "Texte du bouton", kind: "text", max: 40, def: "Rejoindre le serveur" }
    ]
  },
  featured: {
    label: "Package à la une", icon: "featured", lead: "Un package mis en avant, en grand.",
    fields: [
      { key: "packageId", label: "Package", kind: "package" },
      { key: "badge", label: "Badge", kind: "text", max: 30, def: "Le plus populaire" },
      { key: "text", label: "Argumentaire", kind: "textarea", max: 400, def: "" , hint: "Vide : la description Tebex du package" },
      { key: "image", label: "Image (remplace celle de Tebex)", kind: "url", def: "" },
      { key: "style", label: "Mise en page", kind: "select", options: [["split", "Image à côté"], ["banner", "Bannière"]], def: "split" }
    ]
  },
  categories: {
    label: "Catégories", icon: "categories", lead: "Les packages de tes catégories Tebex, avec onglets.",
    fields: [
      { key: "title", label: "Titre", kind: "text", max: 80, def: "Toutes les offres" },
      { key: "categoryIds", label: "Catégories", kind: "categories", max: 30, hint: "Aucune sélection : toutes les catégories" },
      { key: "layout", label: "Affichage", kind: "select", options: LAYOUT, def: "grid" },
      { key: "columns", label: "Colonnes", kind: "number", min: 2, max: 4, def: 3 },
      { key: "tabs", label: "Onglets par catégorie", kind: "bool", def: true },
      { key: "descriptions", label: "Afficher les descriptions", kind: "bool", def: true }
    ]
  },
  packages: {
    label: "Sélection de packages", icon: "packages", lead: "Quelques packages choisis à la main.",
    fields: [
      { key: "title", label: "Titre", kind: "text", max: 80, def: "Nos coups de cœur" },
      { key: "packageIds", label: "Packages", kind: "packages", max: 12 },
      { key: "layout", label: "Affichage", kind: "select", options: LAYOUT, def: "grid" },
      { key: "columns", label: "Colonnes", kind: "number", min: 2, max: 4, def: 3 }
    ]
  },
  promo: {
    label: "Promo", icon: "promo", lead: "Bandeau de promotion avec code et compte à rebours.",
    fields: [
      { key: "title", label: "Titre", kind: "text", max: 80, def: "-20 % sur toute la boutique" },
      { key: "text", label: "Texte", kind: "text", max: 160, def: "Avec le code ci-dessous, jusqu'à dimanche." },
      { key: "code", label: "Code promo", kind: "text", max: 40, def: "", hint: "Crée-le dans Boutique > Promotions" },
      { key: "endsAt", label: "Fin (compte à rebours)", kind: "date", def: "" }
    ]
  },
  goal: {
    label: "Objectif communautaire", icon: "goal", lead: "La jauge d'un objectif Tebex.",
    fields: [
      { key: "title", label: "Titre", kind: "text", max: 80, def: "Objectif du mois" },
      { key: "goalId", label: "Objectif", kind: "goal", hint: "Vide : le premier objectif actif" },
      { key: "text", label: "Texte", kind: "textarea", max: 200, def: "Quand la jauge est pleine, toute la communauté est récompensée." }
    ]
  },
  recent: {
    label: "Derniers achats", icon: "recent", lead: "Les derniers soutiens, en direct.",
    fields: [
      { key: "title", label: "Titre", kind: "text", max: 80, def: "Merci à nos derniers soutiens" },
      { key: "count", label: "Nombre", kind: "number", min: 3, max: 12, def: 6 },
      { key: "anonymous", label: "Masquer les pseudos", kind: "bool", def: false }
    ]
  },
  top: {
    label: "Meilleur soutien du mois", icon: "top", lead: "Le joueur qui a le plus soutenu sur 30 jours.",
    fields: [
      { key: "title", label: "Titre", kind: "text", max: 80, def: "Soutien du mois" },
      { key: "text", label: "Texte", kind: "text", max: 160, def: "Un immense merci !" },
      { key: "amount", label: "Afficher le montant", kind: "bool", def: false }
    ]
  },
  features: {
    label: "Arguments", icon: "features", lead: "Des cartes « pourquoi acheter ».",
    fields: [
      { key: "title", label: "Titre", kind: "text", max: 80, def: "Pourquoi nous soutenir ?" },
      {
        key: "items", label: "Cartes", kind: "list", max: 8,
        fields: [{ key: "icon", label: "Emoji", kind: "text", max: 4 }, { key: "title", label: "Titre", kind: "text", max: 60 }, { key: "text", label: "Texte", kind: "textarea", max: 200 }],
        def: [
          { icon: "⚡", title: "Livraison instantanée", text: "Tes avantages arrivent en jeu dès ta prochaine connexion." },
          { icon: "🔒", title: "Paiement sécurisé", text: "Le paiement est géré par Tebex, partenaire officiel de Cfx.re." },
          { icon: "❤️", title: "Tu fais vivre le serveur", text: "Chaque achat finance l'hébergement, les scripts et les events." }
        ]
      }
    ]
  },
  text: {
    label: "Texte", icon: "text", lead: "Un titre et des paragraphes.",
    fields: [
      { key: "title", label: "Titre", kind: "text", max: 80, def: "À propos" },
      { key: "body", label: "Texte", kind: "textarea", max: 2000, def: "Présente ton serveur, ses règles d'achat, ou ce que tu veux." },
      { key: "align", label: "Alignement", kind: "select", options: ALIGN, def: "left" }
    ]
  },
  faq: {
    label: "FAQ", icon: "faq", lead: "Questions fréquentes, dépliables.",
    fields: [
      { key: "title", label: "Titre", kind: "text", max: 80, def: "Questions fréquentes" },
      {
        key: "items", label: "Questions", kind: "list", max: 12,
        fields: [{ key: "q", label: "Question", kind: "text", max: 140 }, { key: "a", label: "Réponse", kind: "textarea", max: 600 }],
        def: [
          { q: "Quand est-ce que je reçois mon achat ?", a: "Automatiquement, en quelques minutes, à ta prochaine connexion au serveur." },
          { q: "Comment je me connecte ?", a: "Avec ton compte Cfx.re (celui de FiveM) au moment du paiement : c'est ce qui permet de te livrer en jeu." },
          { q: "Je n'ai rien reçu, que faire ?", a: "Reconnecte-toi au serveur, puis ouvre un ticket sur notre Discord avec ton numéro de transaction." }
        ]
      }
    ]
  },
  discord: {
    label: "Discord", icon: "discord", lead: "Grand bouton pour rejoindre le Discord.",
    fields: [
      { key: "title", label: "Titre", kind: "text", max: 80, def: "Rejoins la communauté" },
      { key: "text", label: "Texte", kind: "text", max: 200, def: "Annonces, events, support : tout se passe sur notre Discord." },
      { key: "button", label: "Texte du bouton", kind: "text", max: 40, def: "Rejoindre le Discord" }
    ]
  },
  image: {
    label: "Image", icon: "image", lead: "Une image pleine largeur, cliquable.",
    fields: [
      { key: "url", label: "Image", kind: "url", def: "" },
      { key: "caption", label: "Légende", kind: "text", max: 140, def: "" },
      { key: "link", label: "Lien au clic", kind: "url", def: "" }
    ]
  },
  spacer: {
    label: "Espace", icon: "spacer", lead: "De l'air entre deux blocs.",
    fields: [{ key: "size", label: "Hauteur", kind: "select", options: [["sm", "Petite"], ["md", "Moyenne"], ["lg", "Grande"]], def: "md" }]
  }
} as const satisfies Record<string, { label: string; icon: string; lead: string; fields: readonly Field[] }>;

export type BlockType = keyof typeof BLOCKS;
export const BLOCK_TYPES = Object.keys(BLOCKS) as BlockType[];
export const isBlockType = (v: unknown): v is BlockType => typeof v === "string" && Object.hasOwn(BLOCKS, v);
export const blockFields = (type: BlockType): readonly Field[] => BLOCKS[type].fields;

// ---- helpers ----

let seq = 0;
export const blockId = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;

const HEX = /^#[0-9a-fA-F]{6}$/;
const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

/** Pure: an https link, else "". */
export function cleanUrl(raw: unknown, max = 500): string {
  if (typeof raw !== "string") return "";
  const v = raw.trim().slice(0, max);
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password ? u.toString() : "";
  } catch {
    return "";
  }
}

/** Pure: what players paste to join ("cfx.re/join/abc123", "connect 1.2.3.4:30120", "play.server.fr") as a fivem:// link, else "". */
export function connectLink(raw: string): string {
  const v = raw.trim().replace(/^connect\s+/i, "").replace(/^https?:\/\//i, "");
  const join = /^cfx\.re\/join\/([a-z0-9]{4,12})$/i.exec(v);
  if (join) return `fivem://connect/cfx.re/join/${join[1].toLowerCase()}`;
  if (/^[a-z0-9.-]{3,253}(:\d{2,5})?$/i.test(v)) return `fivem://connect/${v}`;
  return "";
}

const text = (raw: unknown, max: number, def = ""): string => (typeof raw === "string" ? raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, max) : def);
const pick = <T extends string>(raw: unknown, allowed: readonly T[], def: T): T => (allowed.includes(raw as T) ? (raw as T) : def);
const color = (raw: unknown, def: string) => (typeof raw === "string" && HEX.test(raw) ? raw.toLowerCase() : def);
const ids = (raw: unknown, max: number): number[] =>
  Array.isArray(raw) ? [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, max) : [];
const oneId = (raw: unknown): number | null => {
  const n = Number(raw);
  return raw !== null && raw !== "" && Number.isInteger(n) && n > 0 ? n : null;
};

/** Pure: a field value, valid for its field, or the field's default. */
function cleanField(f: Field, raw: unknown): FieldValue {
  switch (f.kind) {
    case "text":
    case "textarea":
      return text(raw, f.max, f.def);
    case "url":
      return raw === undefined ? f.def : cleanUrl(raw);
    case "date":
      return typeof raw === "string" && DATE.test(raw) ? raw : "";
    case "select":
      return pick(raw, f.options.map((o) => o[0]), f.def);
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? Math.min(f.max, Math.max(f.min, Math.round(n))) : f.def;
    }
    case "bool":
      return typeof raw === "boolean" ? raw : f.def;
    case "packages":
    case "categories":
      return ids(raw, f.max);
    case "package":
    case "category":
    case "goal":
      return oneId(raw);
    case "list": {
      if (!Array.isArray(raw)) return f.def.map((x) => ({ ...x }));
      return raw.slice(0, f.max).filter((x) => x && typeof x === "object").map((x) => {
        const item: ListItem = {};
        for (const sf of f.fields) item[sf.key] = sf.kind === "url" ? cleanUrl((x as Record<string, unknown>)[sf.key]) : text((x as Record<string, unknown>)[sf.key], sf.max);
        return item;
      });
    }
  }
}

export function newBlock(type: BlockType, patch: Record<string, FieldValue> = {}): StoreBlock {
  const p: Record<string, FieldValue> = {};
  for (const f of blockFields(type)) p[f.key] = cleanField(f, patch[f.key]);
  return { id: blockId(), type, hidden: false, p };
}

export const MAX_BLOCKS = 30;

/** Pure: one block, valid (unknown type -> null). */
export function cleanBlock(raw: unknown): StoreBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { id?: unknown; type?: unknown; hidden?: unknown; p?: unknown };
  if (!isBlockType(r.type)) return null;
  const props = (r.p && typeof r.p === "object" ? r.p : raw) as Record<string, unknown>;
  const p: Record<string, FieldValue> = {};
  for (const f of blockFields(r.type)) p[f.key] = cleanField(f, props[f.key]);
  const id = typeof r.id === "string" && /^[\w-]{1,40}$/.test(r.id) ? r.id : blockId();
  return { id, type: r.type, hidden: r.hidden === true, p };
}

// ---- presets ----

type Preset = { key: string; label: string; lead: string; theme: StoreTheme };

const T = (t: Partial<StoreTheme>): StoreTheme => ({
  bg: "#0b0906", surface: "#16120c", text: "#f6efe2", muted: "#a59a86", accent: "#e2b45a", accent2: "#f59e3b",
  radius: 16, font: "Inter", headingFont: "Unbounded", background: "glow", backgroundImage: "", buttons: "gradient", cards: "glass", caps: false, ...t
});

export const PRESETS: Preset[] = [
  { key: "gold", label: "Nuit dorée", lead: "Sombre et luxueux, reflets or.", theme: T({}) },
  { key: "neon", label: "Néon", lead: "Cyberpunk, magenta et cyan sur grille.", theme: T({ bg: "#07060f", surface: "#120f24", text: "#f2efff", muted: "#9b95c2", accent: "#ff3df2", accent2: "#22d3ee", radius: 10, font: "Rajdhani", headingFont: "Orbitron", background: "grid", cards: "bordered", caps: true }) },
  { key: "sunset", label: "Los Santos", lead: "Coucher de soleil sur Vinewood.", theme: T({ bg: "#140a12", surface: "#22121d", text: "#fff1ea", muted: "#c9a3a6", accent: "#ff7a45", accent2: "#ff3d81", radius: 20, font: "Poppins", headingFont: "Bebas Neue", background: "gradient", cards: "glass", caps: true }) },
  { key: "police", label: "LSPD", lead: "Bleu nuit, net et institutionnel.", theme: T({ bg: "#060b16", surface: "#0e1628", text: "#eef3ff", muted: "#93a2c2", accent: "#3b82f6", accent2: "#60a5fa", radius: 12, font: "Inter", headingFont: "Russo One", background: "glow", buttons: "solid", cards: "bordered" }) },
  { key: "street", label: "Street", lead: "Vert acide, noir profond, typo massive.", theme: T({ bg: "#050705", surface: "#0e130e", text: "#ecfbe8", muted: "#8fa48a", accent: "#a3e635", accent2: "#22c55e", radius: 6, font: "Space Grotesk", headingFont: "Bebas Neue", background: "plain", buttons: "solid", cards: "flat", caps: true }) },
  { key: "clean", label: "Minimal", lead: "Clair, épuré, élégant.", theme: T({ bg: "#f7f5f1", surface: "#ffffff", text: "#17140f", muted: "#6b645a", accent: "#111111", accent2: "#c2410c", radius: 14, font: "Inter", headingFont: "Playfair Display", background: "plain", buttons: "solid", cards: "elevated" }) }
];

/** Pure: a full starter page for a preset, filled with the store's real packages. */
export function starterDesign(presetKey: string, ctx: { name: string; firstPackageId?: number | null; hasGoals?: boolean; discord?: string }): StoreDesign {
  const preset = PRESETS.find((p) => p.key === presetKey) ?? PRESETS[0];
  const blocks: StoreBlock[] = [
    newBlock("hero", { title: `Boutique ${ctx.name}`.slice(0, 90) }),
    newBlock("server"),
    ...(ctx.firstPackageId ? [newBlock("featured", { packageId: ctx.firstPackageId })] : []),
    newBlock("categories"),
    newBlock("features"),
    ...(ctx.hasGoals ? [newBlock("goal")] : []),
    newBlock("recent"),
    newBlock("faq"),
    ...(ctx.discord ? [newBlock("discord")] : [])
  ];
  return cleanStoreDesign({ preset: preset.key, theme: preset.theme, brand: { name: ctx.name, discord: ctx.discord ?? "" }, blocks });
}

export const DEFAULT_CHECKOUT: StoreCheckout = { theme: "auto", coupon: true, giftCard: true, creatorCode: false };

/** Pure: the only way a design enters the database (from the editor or the AI). */
export function cleanStoreDesign(raw: unknown): StoreDesign {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const preset = PRESETS.find((p) => p.key === r.preset) ?? PRESETS[0];
  const t = (r.theme && typeof r.theme === "object" ? r.theme : {}) as Record<string, unknown>;
  const d = preset.theme;
  const b = (r.brand && typeof r.brand === "object" ? r.brand : {}) as Record<string, unknown>;
  const c = (r.checkout && typeof r.checkout === "object" ? r.checkout : {}) as Record<string, unknown>;
  const l = (r.legal && typeof r.legal === "object" ? r.legal : {}) as Record<string, unknown>;
  const s = (r.seo && typeof r.seo === "object" ? r.seo : {}) as Record<string, unknown>;
  const blocks = (Array.isArray(r.blocks) ? r.blocks : []).map(cleanBlock).filter((x): x is StoreBlock => Boolean(x)).slice(0, MAX_BLOCKS);
  // Ids stay unique (the AI may repeat one).
  const seen = new Set<string>();
  for (const block of blocks) {
    if (seen.has(block.id)) block.id = blockId();
    seen.add(block.id);
  }
  const radius = Number(t.radius);
  return {
    version: 1,
    preset: preset.key,
    theme: {
      bg: color(t.bg, d.bg), surface: color(t.surface, d.surface), text: color(t.text, d.text), muted: color(t.muted, d.muted),
      accent: color(t.accent, d.accent), accent2: color(t.accent2, d.accent2),
      radius: Number.isFinite(radius) ? Math.min(28, Math.max(0, Math.round(radius))) : d.radius,
      font: pick(t.font, STORE_FONTS, d.font), headingFont: pick(t.headingFont, STORE_FONTS, d.headingFont),
      background: pick(t.background, ["plain", "gradient", "glow", "grid", "image"] as const, d.background),
      backgroundImage: cleanUrl(t.backgroundImage),
      buttons: pick(t.buttons, ["solid", "gradient", "outline"] as const, d.buttons),
      cards: pick(t.cards, ["flat", "glass", "bordered", "elevated"] as const, d.cards),
      caps: typeof t.caps === "boolean" ? t.caps : d.caps
    },
    brand: {
      name: text(b.name, 60, "Ma boutique") || "Ma boutique", tagline: text(b.tagline, 120), logo: cleanUrl(b.logo), discord: cleanUrl(b.discord),
      website: cleanUrl(b.website), connect: connectLink(text(b.connect, 120)) ? text(b.connect, 120).trim() : "", announcement: text(b.announcement, 140)
    },
    blocks,
    checkout: {
      theme: pick(c.theme, ["dark", "light", "auto"] as const, DEFAULT_CHECKOUT.theme),
      coupon: typeof c.coupon === "boolean" ? c.coupon : DEFAULT_CHECKOUT.coupon,
      giftCard: typeof c.giftCard === "boolean" ? c.giftCard : DEFAULT_CHECKOUT.giftCard,
      creatorCode: typeof c.creatorCode === "boolean" ? c.creatorCode : DEFAULT_CHECKOUT.creatorCode
    },
    legal: { terms: cleanUrl(l.terms), privacy: cleanUrl(l.privacy), notice: text(l.notice, 400) },
    seo: { title: text(s.title, 70), description: text(s.description, 180), image: cleanUrl(s.image) },
    branding: typeof r.branding === "boolean" ? r.branding : true
  };
}

/** Pure: drop references to packages / categories / goals that no longer exist (deleted in Tebex). */
export function pruneDesign(design: StoreDesign, known: { packages: Set<number>; categories: Set<number>; goals: Set<number> }): StoreDesign {
  const blocks = design.blocks.map((block) => {
    const p = { ...block.p };
    for (const f of blockFields(block.type)) {
      const v = p[f.key];
      if (f.kind === "packages") p[f.key] = (v as number[]).filter((id) => known.packages.has(id));
      if (f.kind === "categories") p[f.key] = (v as number[]).filter((id) => known.categories.has(id));
      if (f.kind === "package" && typeof v === "number" && !known.packages.has(v)) p[f.key] = null;
      if (f.kind === "category" && typeof v === "number" && !known.categories.has(v)) p[f.key] = null;
      if (f.kind === "goal" && typeof v === "number" && !known.goals.has(v)) p[f.key] = null;
    }
    return { ...block, p };
  });
  return { ...design, blocks };
}

// ---- addresses ----

export const STORE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const RESERVED = new Set(["admin", "api", "login", "servers", "store", "fiverax", "tebex", "www", "support", "help", "new"]);
export const isValidStoreSlug = (slug: string) => STORE_SLUG_RE.test(slug) && !RESERVED.has(slug) && !slug.includes("--");

/** Pure: Tebex descriptions are HTML written in Tebex; shown as plain text paragraphs (never injected as HTML). */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

// ---- data shown by a store (built on the server from Tebex, the webhooks and the FiveM agent) ----

export type StorePackage = {
  id: number; name: string; description: string; image: string; price: number; basePrice: number; discount: number;
  currency: string; type: string; quantity: boolean; categoryId: number | null; expires: boolean;
};
export type StoreCategory = { id: number; name: string; description: string; packages: StorePackage[] };
export type StoreGoal = { id: number; name: string; current: number; target: number; achieved: number };
export type StoreData = {
  currency: string;
  categories: StoreCategory[];
  goals: StoreGoal[];
  recent: { name: string | null; item: string; at: string }[];
  top: { name: string; amount: number } | null;
  server: { online: boolean; players: number; max: number } | null;
  /** Why the catalogue could not be read (shown to editors only). */
  error: string | null;
};

export const EMPTY_STORE_DATA: StoreData = { currency: "EUR", categories: [], goals: [], recent: [], top: null, server: null, error: null };

/** Pure: every package of the data, by id. */
export function packageIndex(data: StoreData): Map<number, StorePackage> {
  const map = new Map<number, StorePackage>();
  for (const c of data.categories) for (const p of c.packages) map.set(p.id, p);
  return map;
}
