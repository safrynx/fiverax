import { z } from "zod";

/**
 * Settings of the anticheat (FiveM agent) and of the anti-raid (Discord bot), with their defaults and labels.
 * Client-safe (no DB): the settings pages use the same catalogue as the server.
 */

// ---- anticheat ----

export const AC_ACTIONS = ["off", "log", "kick", "ban"] as const;
export type AcAction = (typeof AC_ACTIONS)[number];
export const AC_ACTION_LABELS: Record<AcAction, string> = { off: "Désactivé", log: "Signaler", kick: "Kick", ban: "Ban" };

/** Every detection of the agent: label, what it catches, and its default action. */
export const DETECTIONS = [
  { key: "event_honeypot", group: "Événements", label: "Événement piège", hint: "Un événement que seul un cheat déclenche (liste ci-dessous).", action: "ban", screenshot: false },
  { key: "event_spam", group: "Événements", label: "Spam d'événements", hint: "Trop d'appels d'un événement protégé en 10 s.", action: "kick", screenshot: false },
  { key: "blacklisted_entity", group: "Entités", label: "Entité interdite", hint: "Véhicule, ped ou objet de la liste noire (bloqué tant que la détection n'est pas désactivée).", action: "log", screenshot: true },
  { key: "entity_spam", group: "Entités", label: "Spam d'entités", hint: "Trop d'entités créées en 10 s (bloqué au-delà, sauf si désactivée).", action: "kick", screenshot: true },
  { key: "explosion", group: "Entités", label: "Explosion interdite", hint: "Explosion invisible ou d'un type bloqué (annulée, sauf si désactivée).", action: "kick", screenshot: true },
  { key: "explosion_spam", group: "Entités", label: "Spam d'explosions", hint: "Trop d'explosions en 10 s.", action: "kick", screenshot: true },
  { key: "ptfx_spam", group: "Entités", label: "Spam de particules", hint: "Effets visuels en rafale (bloqué au-delà, sauf si désactivée).", action: "kick", screenshot: false },
  { key: "projectile_spam", group: "Entités", label: "Spam de projectiles", hint: "Projectiles en rafale.", action: "log", screenshot: true },
  { key: "give_weapon", group: "Armes", label: "Don d'arme à un autre joueur", hint: "Un client donne une arme à un autre ped (bloqué tant que la détection n'est pas désactivée).", action: "kick", screenshot: true },
  { key: "remove_weapon", group: "Armes", label: "Retrait d'armes d'un autre joueur", hint: "Un client retire les armes d'un autre ped (bloqué tant que la détection n'est pas désactivée).", action: "log", screenshot: false },
  { key: "blacklisted_weapon", group: "Armes", label: "Arme interdite", hint: "Arme de la liste noire en main (retirée).", action: "kick", screenshot: true },
  { key: "damage_modifier", group: "Armes", label: "Multiplicateur de dégâts", hint: "Dégâts ou défense modifiés (one-shot).", action: "ban", screenshot: true },
  { key: "damage_distance", group: "Armes", label: "Tir à distance anormale", hint: "Dégâts infligés à une cible trop lointaine.", action: "log", screenshot: true },
  { key: "clear_ped_tasks", group: "Joueur", label: "Éjection d'un joueur", hint: "Un client vide les tâches d'un autre ped (sortie forcée de véhicule).", action: "log", screenshot: false },
  { key: "godmode", group: "Joueur", label: "Godmode", hint: "Joueur invincible côté serveur.", action: "log", screenshot: true },
  { key: "health", group: "Joueur", label: "Vie / armure anormale", hint: "Vie > 200 ou armure > 100.", action: "log", screenshot: true },
  { key: "speedhack", group: "Joueur", label: "Vitesse à pied anormale", hint: "Déplacement à pied plus rapide que la limite.", action: "log", screenshot: true },
  { key: "teleport", group: "Joueur", label: "Téléportation", hint: "Saut de position hors véhicule (peut venir d'un script légitime).", action: "log", screenshot: true },
  { key: "superjump", group: "Joueur", label: "Super saut", hint: "Super saut actif.", action: "kick", screenshot: true },
  { key: "invisible", group: "Joueur", label: "Invisibilité", hint: "Ped invisible pendant plus de 10 s.", action: "log", screenshot: true },
  { key: "blacklisted_ped", group: "Joueur", label: "Skin interdit", hint: "Modèle de ped de la liste noire.", action: "kick", screenshot: true },
  { key: "heartbeat", group: "Client", label: "Anticheat client coupé", hint: "Le module client ne répond plus (ressource arrêtée par un cheat).", action: "kick", screenshot: false },
  { key: "injected_resource", group: "Client", label: "Ressource injectée", hint: "Une ressource inconnue du serveur démarre chez le joueur (executor).", action: "ban", screenshot: true },
  { key: "spectate", group: "Client", label: "Mode spectateur", hint: "Spectate actif sans être staff.", action: "log", screenshot: true },
  { key: "vision", group: "Client", label: "Vision thermique / nocturne", hint: "Utilisée aussi par certains jobs : à activer selon ton serveur.", action: "off", screenshot: false },
  { key: "resource_stop", group: "Client", label: "Ressource arrêtée chez le joueur", hint: "Une ressource du serveur s'arrête chez lui seul (menu qui coupe l'anticheat ou un script).", action: "kick", screenshot: true },
  { key: "ai_screenshot", group: "IA", label: "Capture jugée « cheat » par l'IA", hint: "Menu de cheat, ESP ou aimbot visible à l'écran.", action: "log", screenshot: false },
  { key: "connection_refused", group: "Connexion", label: "Connexion refusée", hint: "Banni, serveur verrouillé, compte requis manquant, pseudo interdit. « Signaler » les garde dans le journal.", action: "log", screenshot: false }
] as const satisfies readonly { key: string; group: string; label: string; hint: string; action: AcAction; screenshot: boolean }[];

export type DetectionKind = (typeof DETECTIONS)[number]["key"];
export const DETECTION_KINDS = DETECTIONS.map((d) => d.key) as [DetectionKind, ...DetectionKind[]];
/** Entries of the detections journal that are not anticheat detections (no setting of their own). */
const OTHER_LABELS: Record<string, string> = { network_flag: "Signalé par le réseau Fiverax", network_refused: "Refusé par le réseau Fiverax" };
export const detectionLabel = (kind: string) => DETECTIONS.find((d) => d.key === kind)?.label ?? OTHER_LABELS[kind] ?? kind;

/**
 * Events cheat menus fire blindly (money exploits of old resources). The agent ignores an event whose prefix is the
 * name of a resource running on the server ("esx_truckerjob:pay" while esx_truckerjob runs): legit players use it.
 */
const DEFAULT_HONEYPOTS = [
  "esx:giveInventoryItem2", "esx_truckerjob:pay", "esx_jobs:caution", "esx_fueldelivery:pay", "esx_carthief:pay", "esx_godirtyjob:pay",
  "esx_pizza:pay", "esx_ranger:pay", "esx_garbagejob:pay", "esx_slotmachine:sv:2", "esx_banksecurity:pay", "esx_gopostaljob:pay",
  "esx_mugging:giveMoney", "lscustoms:payGarage", "vrp_slotmachine:server:2", "mellotrainer:adminTempBan", "mellotrainer:adminKick",
  "adminmenu:allowall", "AdminMenu:giveCash", "AdminMenu:giveBank", "AdminMenu:giveDirtyMoney", "fiverax:honeypot"
];

const BLACKLISTED_WEAPONS = ["WEAPON_RAILGUN", "WEAPON_RAILGUNXM3", "WEAPON_RAYPISTOL", "WEAPON_RAYCARBINE", "WEAPON_RAYMINIGUN", "WEAPON_MINIGUN", "WEAPON_STUNGUN_MP", "WEAPON_EMPLAUNCHER", "WEAPON_HOMINGLAUNCHER", "WEAPON_COMPACTLAUNCHER"];

const BLACKLISTED_MODELS = [
  "hydra", "lazer", "rhino", "khanjali", "oppressor", "oppressor2", "deluxo", "vigilante", "ruiner2", "scramjet", "thruster", "akula", "hunter",
  "savage", "strikeforce", "bombushka", "volatol", "avenger", "chernobog", "apc", "halftrack", "tampa3", "insurgent3", "jet", "cargoplane", "blimp",
  "blimp2", "blimp3", "titan", "kosatka", "prop_windmill_01", "prop_fnclink_05crnr1", "stt_prop_stunt_track_start", "p_spinning_anus_s",
  "stt_prop_stunt_soccer_ball", "prop_container_01a", "prop_cs_dildo_01", "prop_ld_ferris_wheel"
];

const BLACKLISTED_PEDS = ["a_c_chimp", "a_c_rhesus", "u_m_y_zombie_01", "u_m_m_jesus_01", "s_m_m_movalien_01", "u_m_y_imporage", "a_c_cow", "a_c_deer"];

const detectionSetting = z.object({ action: z.enum(AC_ACTIONS), screenshot: z.boolean() });
const nameList = (max: number) => z.array(z.string().trim().min(1).max(100)).max(max);

const defaultDetections = Object.fromEntries(DETECTIONS.map((d) => [d.key, { action: d.action, screenshot: d.screenshot }])) as Record<DetectionKind, z.infer<typeof detectionSetting>>;

export const anticheatSchema = z.object({
  enabled: z.boolean().default(true),
  /** Unknown keys are dropped, missing ones take their default (a detection added later starts with its default). */
  detections: z
    .record(z.string(), detectionSetting)
    .default({})
    .transform((stored) => Object.fromEntries(DETECTIONS.map((d) => [d.key, stored[d.key] ?? defaultDetections[d.key]])) as Record<DetectionKind, z.infer<typeof detectionSetting>>),
  banMessage: z.string().trim().min(1).max(300).default("Tu as été banni de ce serveur par l'anticheat."),
  honeypotEvents: nameList(300).default(DEFAULT_HONEYPOTS),
  /** Events watched for spam (rate limit per player). */
  protectedEvents: nameList(300).default([]),
  blacklistedWeapons: nameList(300).default(BLACKLISTED_WEAPONS),
  blacklistedModels: nameList(500).default(BLACKLISTED_MODELS),
  blacklistedPeds: nameList(300).default(BLACKLISTED_PEDS),
  /** GTA explosion types always cancelled (empty: only invisible explosions are). */
  blockedExplosions: z.array(z.number().int().min(0).max(100)).max(100).default([]),
  limits: z
    .object({
      eventsPer10s: z.number().int().min(5).max(1000).default(40),
      entitiesPer10s: z.number().int().min(3).max(500).default(20),
      explosionsPer10s: z.number().int().min(1).max(200).default(6),
      ptfxPer10s: z.number().int().min(3).max(500).default(30),
      projectilesPer10s: z.number().int().min(3).max(500).default(30),
      /** m/s on foot (a sprinting ped stays under 10). */
      footSpeed: z.number().min(10).max(200).default(25),
      /** meters jumped between two checks (2 s) outside a vehicle. */
      teleportDistance: z.number().min(50).max(10000).default(500),
      damageDistance: z.number().min(50).max(5000).default(450)
    })
    .default({}),
  ai: z
    .object({
      /** Analyse each screenshot with the vision model. */
      enabled: z.boolean().default(true),
      /** Screenshot of a random player every N minutes (0: never). */
      randomEveryMinutes: z.number().int().min(0).max(1440).default(0),
      /** Ban automatically when the AI says "cheat" with at least this confidence (0: never ban on the AI alone). */
      autoBanScore: z.number().int().min(0).max(100).default(0)
    })
    .default({}),
  /** Length of the bans given by the anticheat (0: permanent). */
  banHours: z.number().int().min(0).max(24 * 3650).default(0),
  /** Escalation: detections of one player add up over the window (dismissed ones do not count). */
  strikes: z
    .object({
      enabled: z.boolean().default(false),
      windowHours: z.number().int().min(1).max(720).default(24),
      kickAt: z.number().int().min(0).max(100).default(3),
      banAt: z.number().int().min(0).max(100).default(6)
    })
    .default({}),
  /** Discord webhook receiving the anticheat alerts. */
  alerts: z
    .object({
      webhookUrl: z.string().trim().regex(/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/).nullable().default(null),
      /** Lowest action alerted: log = every detection. */
      minAction: z.enum(["log", "kick", "ban"]).default("kick"),
      aiCheat: z.boolean().default(true)
    })
    .default({}),
  /** Who may join: checked by the agent when a player connects. */
  connection: z
    .object({
      /** Server locked (maintenance, event): only whitelisted identifiers get in. */
      locked: z.boolean().default(false),
      lockMessage: z.string().trim().min(1).max(300).default("Le serveur est fermé pour le moment. Reviens plus tard !"),
      requireDiscord: z.boolean().default(false),
      requireSteam: z.boolean().default(false),
      minNameLength: z.number().int().min(0).max(20).default(0),
      /** Refused when the name contains one of these (case ignored). */
      blockedNames: nameList(200).default([]),
      /** Identifiers (license:…, discord:…) let in while locked and never checked by the anticheat. */
      whitelist: z.array(z.string().trim().regex(/^[a-z0-9]+:[\w.-]+$/i)).max(500).default([])
    })
    .default({})
});

export type AnticheatSettings = z.infer<typeof anticheatSchema>;
export const DEFAULT_ANTICHEAT: AnticheatSettings = anticheatSchema.parse({});

// ---- Discord anti-raid ----

export const PUNISHMENTS = ["derank", "quarantine", "timeout", "kick", "ban"] as const;
export const PUNISHMENT_LABELS: Record<(typeof PUNISHMENTS)[number], string> = {
  derank: "Derank (retirer tous ses rôles)",
  quarantine: "Quarantaine (derank + rôle de quarantaine)",
  timeout: "Exclusion temporaire (derank + mute)",
  kick: "Expulser du Discord",
  ban: "Bannir du Discord"
};

/**
 * Each rule: what it watches, what the bot undoes, and how many actions one person may do in the window before it
 * triggers (max 0 = the first one triggers).
 */
export const RAID_RULES = [
  { key: "role_delete", label: "Suppression de rôle", undo: "Rôle recréé (couleur, permissions, position) et redonné à tous ses membres", max: 0, windowSec: 60 },
  { key: "channel_delete", label: "Suppression de salon", undo: "Salon recréé avec ses permissions, sa catégorie et sa position", max: 1, windowSec: 300 },
  { key: "role_create", label: "Création de rôles en masse", undo: "Rôles créés supprimés", max: 4, windowSec: 60 },
  { key: "channel_create", label: "Création de salons en masse", undo: "Salons créés supprimés", max: 4, windowSec: 60 },
  { key: "member_role_remove", label: "Retrait de rôles en masse", undo: "Rôles remis aux membres", max: 4, windowSec: 60 },
  { key: "member_role_add", label: "Ajout de rôles en masse", undo: "Rôles retirés aux membres", max: 8, windowSec: 60 },
  { key: "dangerous_role_add", label: "Rôle dangereux donné", undo: "Rôle retiré (Administrateur, gérer le serveur / les rôles / les salons, bannir…)", max: 0, windowSec: 60 },
  { key: "role_permissions", label: "Permissions dangereuses ajoutées à un rôle", undo: "Anciennes permissions du rôle remises", max: 0, windowSec: 60 },
  { key: "ban", label: "Bans en masse", undo: "Membres débannis", max: 2, windowSec: 60 },
  { key: "kick", label: "Kicks en masse", undo: "Aucun (Discord ne permet pas d'annuler un kick)", max: 3, windowSec: 60 },
  { key: "prune", label: "Purge de membres", undo: "Aucun", max: 0, windowSec: 60 },
  { key: "bot_add", label: "Ajout d'un bot", undo: "Bot expulsé", max: 0, windowSec: 60 },
  { key: "webhook_create", label: "Création de webhooks", undo: "Webhooks supprimés", max: 1, windowSec: 60 },
  { key: "guild_update", label: "Modification du serveur", undo: "Nom du serveur remis", max: 0, windowSec: 60 },
  { key: "protected_role", label: "Rôle protégé donné ou retiré", undo: "Changement annulé (rôles protégés ci-dessus)", max: 0, windowSec: 60 },
  { key: "channel_update", label: "Permissions de salons modifiées en masse", undo: "Aucun (signalé et sanctionné)", max: 6, windowSec: 60 }
] as const;

export type RaidRuleKey = (typeof RAID_RULES)[number]["key"];
const rule = z.object({ enabled: z.boolean(), max: z.number().int().min(0).max(100), windowSec: z.number().int().min(5).max(3600) });
const defaultRules = Object.fromEntries(RAID_RULES.map((r) => [r.key, { enabled: true, max: r.max, windowSec: r.windowSec }])) as Record<RaidRuleKey, z.infer<typeof rule>>;
const snowflake = z.string().regex(/^\d{17,20}$/);

export const antiraidSchema = z.object({
  /** Off until an owner turns it on: the bot then acts on its own. */
  enabled: z.boolean().default(false),
  punishment: z.enum(PUNISHMENTS).default("derank"),
  /** The Discord owner's actions are not watched (Discord would not let the bot punish them anyway). */
  trustOwner: z.boolean().default(true),
  /** People whose actions are never watched. */
  trusted: z.array(snowflake).max(100).default([]),
  /** Salon where the bot posts each incident (none: panel only). */
  alertChannelId: snowflake.nullable().default(null),
  rules: z
    .record(z.string(), rule)
    .default({})
    .transform((stored) => Object.fromEntries(RAID_RULES.map((r) => [r.key, stored[r.key] ?? defaultRules[r.key]])) as Record<RaidRuleKey, z.infer<typeof rule>>),
  joinRaid: z
    .object({
      enabled: z.boolean().default(true),
      joins: z.number().int().min(3).max(500).default(10),
      windowSec: z.number().int().min(3).max(600).default(10),
      /** While locked down, every newcomer is kicked and the verification level is raised. */
      lockdownMinutes: z.number().int().min(1).max(1440).default(10)
    })
    .default({}),
  /** Kick accounts younger than this (0: off). */
  minAccountAgeDays: z.number().int().min(0).max(365).default(0),
  /** Role given with the "quarantine" punishment (no access anywhere). */
  quarantineRoleId: snowflake.nullable().default(null),
  /** Mute length of the "timeout" punishment and of the message protection. */
  timeoutMinutes: z.number().int().min(1).max(40320).default(60),
  /** Roles nobody but trusted people may give, remove, delete or edit. */
  protectedRoles: z.array(snowflake).max(100).default([]),
  /** Channels whose deletion always triggers at once. */
  protectedChannels: z.array(snowflake).max(200).default([]),
  /** DM the Discord owner on each incident. */
  alertOwnerDm: z.boolean().default(false),
  /** Automatic backup of roles and channels (hours between two, 0: off). */
  backupEveryHours: z.number().int().min(0).max(168).default(12),
  messages: z
    .object({
      enabled: z.boolean().default(false),
      /** More than floodCount messages in floodSeconds = flood. */
      floodCount: z.number().int().min(3).max(50).default(6),
      floodSeconds: z.number().int().min(2).max(60).default(5),
      /** Users + roles mentioned in one message. */
      maxMentions: z.number().int().min(2).max(50).default(6),
      blockEveryone: z.boolean().default(true),
      /** Needs the Message Content intent (BOT_MESSAGE_CONTENT=1 on the bot). */
      blockInvites: z.boolean().default(false),
      blockLinks: z.boolean().default(false),
      /** Members with one of these roles are never checked (staff). */
      ignoredRoles: z.array(snowflake).max(100).default([]),
      ignoredChannels: z.array(snowflake).max(200).default([])
    })
    .default({})
});

export type AntiraidSettings = z.infer<typeof antiraidSchema>;
export const DEFAULT_ANTIRAID: AntiraidSettings = antiraidSchema.parse({});

/** Readable name of each kind of anti-raid incident. */
export const INCIDENT_LABELS: Record<string, string> = {
  ...Object.fromEntries(RAID_RULES.map((r) => [r.key, r.label])),
  join_raid: "Raid de comptes (arrivées en masse)",
  young_account: "Compte trop récent",
  lockdown_end: "Fin du verrouillage",
  lockdown: "Verrouillage manuel",
  unlock: "Déverrouillage",
  message_flood: "Flood de messages",
  mass_mention: "Mentions de masse",
  everyone_mention: "@everyone / @here",
  invite_link: "Invitation Discord",
  link: "Lien interdit",
  backup: "Sauvegarde",
  backup_restore: "Restauration d'une sauvegarde"
};
