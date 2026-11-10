import { z } from "zod";

/**
 * Platform-wide settings, changed by the platform admins (PANEL_OWNER_IDS) from /admin/settings. Client-safe (no DB).
 * Stored as one JSON row (platform_settings, key "settings"); anything missing falls back to the defaults below,
 * so a new setting never needs a migration.
 */

export const platformSettingsSchema = z.object({
  /**
   * Private beta (on by default): only partner accounts (chosen in /admin/beta) may register servers, and a server's
   * panel only opens when one of its owners (or its creator) is a partner. Players' public pages, the bot and the
   * agents keep working for everyone. Everyone else can ask for access.
   */
  beta: z.object({
    active: z.boolean().default(true),
    message: z.string().trim().max(400).default("")
  }).default({}),
  /** New servers can be registered by anyone (platform admins always can). */
  registrationsOpen: z.boolean().default(true),
  /** Servers one account may register; null = MAX_SERVERS_PER_USER (env, 5 by default). */
  maxServersPerUser: z.number().int().min(0).max(100).nullable().default(null),
  /** The free public scan (/scan). */
  publicScanEnabled: z.boolean().default(true),
  /** Maintenance: the panel (/servers, /s/…) shows the message to everyone but the platform admins. Public pages, the bot and the FiveM agents keep working. */
  maintenance: z.object({
    active: z.boolean().default(false),
    message: z.string().trim().max(300).default("")
  }).default({}),
  /** A message shown at the top of every panel page. */
  announcement: z.object({
    active: z.boolean().default(false),
    tone: z.enum(["info", "warn", "danger"]).default("info"),
    text: z.string().trim().max(300).default("")
  }).default({}),
  /** The shared Discord bot's status and activity ("Regarde 12 serveurs FiveM"), applied by the bot at its next heartbeat. */
  bot: z.object({
    status: z.enum(["online", "idle", "dnd", "invisible"]).default("online"),
    activityType: z.enum(["none", "playing", "watching", "listening", "competing", "custom"]).default("watching"),
    /** {serveurs} is replaced by the number of Discord servers the bot watches. */
    activityText: z.string().trim().max(128).default("{serveurs} serveurs FiveM")
  }).default({}),
  /** AI (studio, assistant, store creator, plans, explanations, weekly reviews, screenshots). 0 = no limit. */
  ai: z.object({
    enabled: z.boolean().default(true),
    perServerDaily: z.number().int().min(0).max(100_000).default(200),
    perUserDaily: z.number().int().min(0).max(100_000).default(300),
    globalDaily: z.number().int().min(0).max(1_000_000).default(0)
  }).default({})
});

export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = platformSettingsSchema.parse({});

/** What each AI call is for (usage statistics of /admin). */
export const AI_KINDS = {
  studio: "Studio IA",
  assistant: "Assistant IA",
  copilot: "Copilote IA",
  store: "Store Creator",
  plan: "Plan de protection",
  explain: "Explications du scanner",
  review: "Bilan hebdo",
  vision: "Captures d'écran"
} as const;

export type AiKind = keyof typeof AI_KINDS;

/** Readable names of the admin actions (journal of /admin). */
export const ADMIN_ACTIONS: Record<string, string> = {
  settings_save: "Réglages de la plateforme",
  server_suspend: "Serveur suspendu",
  server_unsuspend: "Serveur rétabli",
  server_delete: "Serveur supprimé",
  server_owner_add: "Propriétaire ajouté",
  server_owner_remove: "Propriétaire retiré",
  server_ai_reset: "Quota IA remis à zéro",
  user_ban: "Compte banni",
  user_unban: "Compte débanni",
  user_sessions_revoke: "Sessions fermées",
  session_revoke: "Session fermée",
  review_moderate: "Avis modéré",
  library_moderate: "Création modérée",
  partner_add: "Partenaire ajouté",
  partner_remove: "Partenaire retiré",
  beta_approve: "Accès bêta accordé",
  beta_refuse: "Accès bêta refusé",
  feedback_status: "Retour traité",
  bot_identity: "Profil du bot modifié",
  bot_presence: "Statut du bot modifié"
};

export const BOT_STATUSES = { online: "En ligne", idle: "Inactif", dnd: "Ne pas déranger", invisible: "Invisible" } as const;
export const BOT_ACTIVITIES = { none: "Aucune activité", playing: "Joue à", watching: "Regarde", listening: "Écoute", competing: "Participe à", custom: "Statut personnalisé" } as const;

/** Images the bot's profiles accept (Discord): data URIs, size checked on both sides. */
export const BOT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
/** Raw bytes; two images must fit one request (4.5 MB on Vercel once in base64). */
export const BOT_IMAGE_MAX_BYTES = 1_500_000;
export const BOT_NICK_MAX = 32;
export const BOT_BIO_MAX = 190;

/** Where a bug report / idea was sent from, and what it is. */
export const FEEDBACK_KINDS = { bug: "Bug", idea: "Idée", question: "Question" } as const;
export type FeedbackKind = keyof typeof FEEDBACK_KINDS;
