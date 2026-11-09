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
  { key: "event_honeypot", group: "Événements", label: "Événement piège", hint: "Un événement que seul un cheat déclenche (liste ci-dessous).", action: "ban", screenshot: false, risk: 5 },
  { key: "event_spam", group: "Événements", label: "Spam d'événements", hint: "Trop d'appels d'un événement protégé en 10 s.", action: "kick", screenshot: false, risk: 3 },
  { key: "event_distance", group: "Événements", label: "Action à distance sur un joueur", hint: "Menottes, réanimation, prison, facture… déclenchées sur un joueur trop loin (menus « cuff all », « jail all », « bill all »). Liste « Événements ciblés » ci-dessous.", action: "log", screenshot: true, risk: 4 },
  { key: "blacklisted_entity", group: "Entités", label: "Entité interdite", hint: "Véhicule, ped ou objet de la liste noire (bloqué tant que la détection n'est pas désactivée).", action: "log", screenshot: true, risk: 2 },
  { key: "entity_spam", group: "Entités", label: "Spam d'entités", hint: "Trop d'entités créées en 10 s (bloqué au-delà, sauf si désactivée).", action: "kick", screenshot: true, risk: 3 },
  { key: "explosion", group: "Entités", label: "Explosion interdite", hint: "Explosion invisible ou d'un type bloqué (annulée, sauf si désactivée).", action: "kick", screenshot: true, risk: 4 },
  { key: "explosion_spam", group: "Entités", label: "Spam d'explosions", hint: "Trop d'explosions en 10 s.", action: "kick", screenshot: true, risk: 4 },
  { key: "ptfx_spam", group: "Entités", label: "Spam de particules", hint: "Effets visuels en rafale (bloqué au-delà, sauf si désactivée).", action: "kick", screenshot: false, risk: 3 },
  { key: "projectile_spam", group: "Entités", label: "Spam de projectiles", hint: "Projectiles en rafale.", action: "log", screenshot: true, risk: 3 },
  { key: "give_weapon", group: "Armes", label: "Don d'arme à un autre joueur", hint: "Un client donne une arme à un autre ped (bloqué tant que la détection n'est pas désactivée).", action: "kick", screenshot: true, risk: 4 },
  { key: "remove_weapon", group: "Armes", label: "Retrait d'armes d'un autre joueur", hint: "Un client retire les armes d'un autre ped (bloqué tant que la détection n'est pas désactivée).", action: "log", screenshot: false, risk: 2 },
  { key: "blacklisted_weapon", group: "Armes", label: "Arme interdite", hint: "Arme de la liste noire en main (retirée).", action: "kick", screenshot: true, risk: 3 },
  { key: "damage_modifier", group: "Armes", label: "Multiplicateur de dégâts", hint: "Dégâts ou défense modifiés (one-shot).", action: "ban", screenshot: true, risk: 5 },
  { key: "damage_distance", group: "Armes", label: "Tir à distance anormale", hint: "Dégâts infligés à une cible trop lointaine.", action: "log", screenshot: true, risk: 2 },
  { key: "damage_spam", group: "Armes", label: "Rafale de dégâts", hint: "Trop de coups infligés en 10 s (tir rapide, « magic bullet ») : les coups au-delà sont bloqués, sauf si désactivée.", action: "log", screenshot: true, risk: 4 },
  { key: "kill_spam", group: "Armes", label: "Kills en masse", hint: "Trop de joueurs tués en 10 s (« kill all ») : les coups mortels au-delà sont bloqués, sauf si désactivée.", action: "log", screenshot: true, risk: 5 },
  { key: "clear_ped_tasks", group: "Joueur", label: "Éjection d'un joueur", hint: "Un client vide les tâches d'un autre ped (sortie forcée de véhicule).", action: "log", screenshot: false, risk: 2 },
  { key: "godmode", group: "Joueur", label: "Godmode", hint: "Joueur invincible côté serveur.", action: "log", screenshot: true, risk: 3 },
  { key: "health", group: "Joueur", label: "Vie / armure anormale", hint: "Vie > 200 ou armure > 100.", action: "log", screenshot: true, risk: 2 },
  { key: "speedhack", group: "Joueur", label: "Vitesse à pied anormale", hint: "Déplacement à pied plus rapide que la limite.", action: "log", screenshot: true, risk: 2 },
  { key: "teleport", group: "Joueur", label: "Téléportation", hint: "Saut de position hors véhicule (peut venir d'un script légitime).", action: "log", screenshot: true, risk: 2 },
  { key: "noclip", group: "Joueur", label: "Noclip / vol", hint: "À pied, le joueur se déplace plusieurs secondes d'affilée sans vitesse réelle (position modifiée directement). Un script de téléportation ne fait qu'un saut : il n'est pas compté.", action: "log", screenshot: true, risk: 4 },
  { key: "superjump", group: "Joueur", label: "Super saut", hint: "Super saut actif.", action: "kick", screenshot: true, risk: 4 },
  { key: "invisible", group: "Joueur", label: "Invisibilité", hint: "Ped invisible pendant plus de 10 s.", action: "log", screenshot: true, risk: 3 },
  { key: "blacklisted_ped", group: "Joueur", label: "Skin interdit", hint: "Modèle de ped de la liste noire.", action: "kick", screenshot: true, risk: 2 },
  { key: "vehicle_speed", group: "Véhicules", label: "Vitesse de véhicule anormale", hint: "Voiture, moto ou bateau au-delà de la limite (boost de vitesse). Les avions et hélicoptères ne sont pas contrôlés.", action: "log", screenshot: true, risk: 2 },
  { key: "heartbeat", group: "Client", label: "Anticheat client coupé", hint: "Le module client ne répond plus (ressource arrêtée par un cheat).", action: "kick", screenshot: false, risk: 3 },
  { key: "injected_resource", group: "Client", label: "Ressource injectée", hint: "Une ressource inconnue du serveur démarre chez le joueur (executor).", action: "ban", screenshot: true, risk: 5 },
  { key: "spectate", group: "Client", label: "Mode spectateur", hint: "Spectate actif sans être staff.", action: "log", screenshot: true, risk: 2 },
  { key: "vision", group: "Client", label: "Vision thermique / nocturne", hint: "Utilisée aussi par certains jobs : à activer selon ton serveur.", action: "off", screenshot: false, risk: 1 },
  { key: "resource_stop", group: "Client", label: "Ressource arrêtée chez le joueur", hint: "Une ressource du serveur s'arrête chez lui seul (menu qui coupe l'anticheat ou un script).", action: "kick", screenshot: true, risk: 3 },
  { key: "ai_screenshot", group: "IA", label: "Capture jugée « cheat » par l'IA", hint: "Menu de cheat, ESP ou aimbot visible à l'écran.", action: "log", screenshot: false, risk: 4 },
  { key: "connection_refused", group: "Connexion", label: "Connexion refusée", hint: "Banni, serveur verrouillé, compte requis manquant, pseudo interdit. « Signaler » les garde dans le journal.", action: "log", screenshot: false, risk: 0 }
] as const satisfies readonly { key: string; group: string; label: string; hint: string; action: AcAction; screenshot: boolean; risk: number }[];

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
  "adminmenu:allowall", "AdminMenu:giveCash", "AdminMenu:giveBank", "AdminMenu:giveDirtyMoney", "fiverax:honeypot",
  // ESX events that "cuff all / jail all / revive all / bill all" menus fire: bait on servers that do not run them.
  "esx_dmvschool:pay", "esx_society:withdrawMoney", "esx_vehicleshop:setVehicleOwned", "esx_billing:sendBill", "esx-qalle-jail:jailPlayer",
  "esx_jailer:sendToJail", "esx_communityservice:sendToCommunityService", "esx_policejob:handcuff", "esx_ambulancejob:revive"
];
export const RECOMMENDED_HONEYPOTS: readonly string[] = DEFAULT_HONEYPOTS;

/**
 * Events whose first argument is the server id of the player it acts on. Fired on a player further than
 * `maxDistance` meters (or on everyone, -1): a cheat menu acting on the whole server. Legit uses happen face to face.
 */
const DEFAULT_TARGETED = [
  ["esx_policejob:handcuff", 15], ["esx_policejob:drag", 15], ["esx_policejob:putInVehicle", 15], ["esx_policejob:OutVehicle", 15],
  ["esx_ambulancejob:revive", 15], ["esx_billing:sendBill", 15], ["esx-qalle-jail:jailPlayer", 30], ["esx_jailer:sendToJail", 30],
  ["esx_communityservice:sendToCommunityService", 30], ["police:server:CuffPlayer", 15], ["police:server:EscortPlayer", 15],
  ["police:server:PutPlayerInVehicle", 15], ["police:server:SetPlayerOutVehicle", 15], ["hospital:server:RevivePlayer", 15], ["police:server:JailPlayer", 30]
].map(([event, maxDistance]) => ({ event: event as string, maxDistance: maxDistance as number }));
export const RECOMMENDED_TARGETED: readonly { event: string; maxDistance: number }[] = DEFAULT_TARGETED;

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
  /** Events acting on another player (first argument): flagged when that player is too far away. */
  targetedEvents: z.array(z.object({ event: z.string().trim().min(1).max(100), maxDistance: z.number().min(2).max(1000) })).max(100).default(DEFAULT_TARGETED),
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
      damageDistance: z.number().min(50).max(5000).default(450),
      /** m/s of a car, bike or boat (450 km/h by default: no stock vehicle gets near). */
      vehicleSpeed: z.number().min(30).max(500).default(125),
      /** Hits given to entities per player in 10 s (beyond, the hits are blocked). */
      damagePer10s: z.number().int().min(10).max(1000).default(90),
      /** Players killed per player in 10 s (beyond, the killing hits are blocked). */
      killsPer10s: z.number().int().min(2).max(100).default(6),
      /** Meters moved on foot in 2 s with almost no real speed, three times in a row = noclip. */
      noclipDistance: z.number().min(8).max(200).default(20)
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

// ---- presets ----

export const AC_PRESETS = [
  {
    key: "soft", label: "Souple",
    hint: "Tout est signalé, seuls les cheats certains sont sanctionnés (événements pièges, ressources injectées). Pour démarrer et repérer les faux positifs propres à ton serveur."
  },
  {
    key: "balanced", label: "Équilibré",
    hint: "Les réglages par défaut : kick ou ban sur les détections fiables, simple signalement sur celles qui dépendent de tes scripts."
  },
  {
    key: "strict", label: "Strict",
    hint: "Kick ou ban sur presque tout et cumul de détections activé. Pour les serveurs ciblés par les cheaters, après une semaine en Équilibré sans faux positif."
  }
] as const;
export type AcPreset = (typeof AC_PRESETS)[number]["key"];

const STRICT: Partial<Record<DetectionKind, AcAction>> = {
  event_honeypot: "ban", event_spam: "kick", event_distance: "kick", blacklisted_entity: "kick", entity_spam: "ban", explosion: "ban", explosion_spam: "ban",
  ptfx_spam: "kick", projectile_spam: "kick", give_weapon: "ban", remove_weapon: "kick", blacklisted_weapon: "ban", damage_modifier: "ban",
  damage_distance: "kick", damage_spam: "ban", kill_spam: "ban", clear_ped_tasks: "kick", godmode: "kick", health: "kick", speedhack: "kick",
  teleport: "log", noclip: "kick", superjump: "ban", invisible: "kick", blacklisted_ped: "kick", vehicle_speed: "kick", heartbeat: "kick",
  injected_resource: "ban", spectate: "kick", resource_stop: "ban"
};

/** Pure: the action of each detection in a preset (detections off by default stay off). */
export function presetActions(preset: AcPreset): Record<DetectionKind, AcAction> {
  return Object.fromEntries(DETECTIONS.map((d) => {
    const base: AcAction = d.action;
    if (preset === "balanced" || base === "off" || d.key === "ai_screenshot" || d.key === "connection_refused") return [d.key, base];
    if (preset === "soft") return [d.key, d.key === "event_honeypot" ? "ban" : d.key === "injected_resource" ? "kick" : "log"];
    return [d.key, STRICT[d.key] ?? base];
  })) as Record<DetectionKind, AcAction>;
}

/** Pure: the settings with a preset's actions (screenshots, lists and limits are kept; Strict turns the escalation on). */
export function applyPreset(settings: AnticheatSettings, preset: AcPreset): AnticheatSettings {
  const actions = presetActions(preset);
  const detections = Object.fromEntries(DETECTIONS.map((d) => [d.key, { ...settings.detections[d.key], action: actions[d.key] }])) as AnticheatSettings["detections"];
  const strikes = preset === "strict" ? { ...settings.strikes, enabled: true } : settings.strikes;
  return { ...settings, enabled: true, detections, strikes };
}

/** Pure: which preset the settings match, or "custom". */
export function presetOf(settings: AnticheatSettings): AcPreset | "custom" {
  for (const p of AC_PRESETS) {
    const actions = presetActions(p.key);
    if (DETECTIONS.every((d) => settings.detections[d.key]?.action === actions[d.key])) return p.key;
  }
  return "custom";
}

const ACTION_LEVEL: Record<AcAction, number> = { off: 0, log: 0.6, kick: 0.9, ban: 1 };

/**
 * Pure: how much of the cheating the settings catch and stop, out of 100. Detections weighted by their risk
 * (off 0, recorded 60 %, kick 90 %, ban 100 %) for 70 points; escalation, alerts and baits for the rest.
 */
export function anticheatStrength(settings: AnticheatSettings): number {
  if (!settings.enabled) return 0;
  let weight = 0;
  let got = 0;
  for (const d of DETECTIONS) {
    if (!d.risk || d.key === "ai_screenshot") continue;
    weight += d.risk;
    got += d.risk * ACTION_LEVEL[settings.detections[d.key]?.action ?? "off"];
  }
  const coverage = weight ? got / weight : 0;
  const extras =
    (settings.strikes.enabled ? 10 : 0) +
    (settings.alerts.webhookUrl ? 10 : 0) +
    (settings.honeypotEvents.length >= 10 ? 5 : 0) +
    (settings.targetedEvents.length > 0 || settings.protectedEvents.length > 0 ? 5 : 0);
  return Math.max(0, Math.min(100, Math.round(coverage * 70 + extras)));
}

/** Risk weight of a journal entry (detections of the anticheat, and the network's flags). */
export const riskWeight = (kind: string): number => (kind === "network_flag" ? 6 : DETECTIONS.find((d) => d.key === kind)?.risk ?? 1);

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
/** Sanction of one rule: the general one, none (undo and report only) or its own. */
export const RULE_SANCTIONS = ["default", "none", ...PUNISHMENTS] as const;
export const RULE_SANCTION_LABELS: Record<(typeof RULE_SANCTIONS)[number], string> = {
  default: "Sanction générale", none: "Aucune (annuler et signaler)", derank: "Derank", quarantine: "Quarantaine", timeout: "Mute", kick: "Expulser", ban: "Bannir"
};
const rule = z.object({
  enabled: z.boolean(),
  max: z.number().int().min(0).max(100),
  windowSec: z.number().int().min(5).max(3600),
  punishment: z.enum(RULE_SANCTIONS).default("default"),
  /** Undo what was done (false: only report and punish). */
  undo: z.boolean().default(true)
});
const defaultRules = Object.fromEntries(
  RAID_RULES.map((r) => [r.key, { enabled: true, max: r.max, windowSec: r.windowSec, punishment: "default", undo: true }])
) as Record<RaidRuleKey, z.infer<typeof rule>>;
const snowflake = z.string().regex(/^\d{17,20}$/);
/** "example.com": also allows its subdomains. */
const domain = z.string().trim().toLowerCase().regex(/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/);

export const YOUNG_ACCOUNT_ACTIONS = { kick: "Expulser", ban: "Bannir", quarantine: "Rôle de quarantaine", log: "Seulement signaler" } as const;
export const JOIN_RAID_ACTIONS = { kick: "Expulser les arrivants", ban: "Bannir les arrivants", none: "Les laisser (verrouillage seul)" } as const;
export const MESSAGE_ACTIONS = { delete: "Supprimer seulement", timeout: "Supprimer + mute", kick: "Supprimer + expulser", ban: "Supprimer + bannir" } as const;

export const ANTIRAID_MODES = ["protect", "observe"] as const;

export const antiraidSchema = z.object({
  /** Off until an owner turns it on: the bot then acts on its own. */
  enabled: z.boolean().default(false),
  /** "observe": the bot reports what it would have done, without undoing nor punishing (to trust it first). */
  mode: z.enum(ANTIRAID_MODES).default("protect"),
  punishment: z.enum(PUNISHMENTS).default("derank"),
  /** The Discord owner's actions are not watched (Discord would not let the bot punish them anyway). */
  trustOwner: z.boolean().default(true),
  /** People whose actions are never watched. */
  trusted: z.array(snowflake).max(100).default([]),
  /** Members holding one of these roles are never watched either. */
  trustedRoles: z.array(snowflake).max(100).default([]),
  /** Salon where the bot posts each incident (none: panel only). */
  alertChannelId: snowflake.nullable().default(null),
  /** Role pinged in the alert channel with each incident (none: no ping). */
  alertRoleId: snowflake.nullable().default(null),
  /** Private message sent to the sanctioned person (before a kick or a ban). {serveur}, {raison}, {sanction} are replaced. */
  dm: z.object({ enabled: z.boolean().default(false), message: z.string().trim().max(500).default("") }).default({}),
  /** What happens to an account younger than minAccountAgeDays. */
  youngAccountAction: z.enum(["kick", "ban", "quarantine", "log"]).default("kick"),
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
      lockdownMinutes: z.number().int().min(1).max(1440).default(10),
      /** Slower raids too: a wave of fresh accounts (days old, no avatar, look-alike names) within a minute. */
      smart: z.boolean().default(true),
      /** What happens to the accounts of the raid (the lockdown applies in any case). */
      action: z.enum(["kick", "ban", "none"]).default("kick"),
      /** During an automatic lockdown, also make every text channel read-only for @everyone. */
      lockChannels: z.boolean().default(false)
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
      /** Fake Nitro / Steam links (look-alike domains). Needs the Message Content intent. */
      blockScams: z.boolean().default(true),
      /** One member posting in this many channels within multiChannelSeconds: a hacked account (0: off). */
      multiChannel: z.number().int().min(0).max(20).default(4),
      multiChannelSeconds: z.number().int().min(3).max(120).default(15),
      /** This many members posting the same message within 30 s: a message raid (0: off). Needs Message Content. */
      duplicateRaid: z.number().int().min(0).max(50).default(4),
      /** Members with one of these roles are never checked (staff). */
      ignoredRoles: z.array(snowflake).max(100).default([]),
      ignoredChannels: z.array(snowflake).max(200).default([]),
      /** What the author of a serious message (flood, mentions, @everyone, scam, hacked account, copy-paste raid) gets besides the deletion. */
      action: z.enum(["delete", "timeout", "kick", "ban"]).default("timeout"),
      /** Domains still allowed when every link is blocked. */
      allowedDomains: z.array(domain).max(100).default([]),
      /** Words or phrases whose messages are deleted (case and accents ignored). Needs the Message Content intent. */
      bannedWords: z.array(z.string().trim().min(2).max(60)).max(200).default([])
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
  scam_link: "Lien d'arnaque (faux Nitro / Steam)",
  banned_word: "Mot interdit",
  account_compromised: "Compte probablement piraté",
  message_raid: "Raid de messages identiques",
  backup: "Sauvegarde",
  backup_restore: "Restauration d'une sauvegarde"
};
