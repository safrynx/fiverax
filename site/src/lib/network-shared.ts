import { z } from "zod";

/**
 * Fiverax network: what the panel pages and the server share (client-safe, no DB).
 *
 * Servers that join the network share their bans: any member sees, on a player's page and at connection, on how
 * many other servers that player is banned and why. Bans are matched on hashed identifiers (Rockstar license,
 * Discord, Steam, hardware tokens…): a server never sees another server's raw identifiers.
 */

export const BAN_CATEGORIES = [
  { key: "cheat", label: "Triche", hint: "Menu, executor, godmode, aimbot…" },
  { key: "exploit", label: "Exploit / duplication", hint: "Bug abusé, argent ou objets dupliqués" },
  { key: "raid", label: "Raid / sabotage", hint: "Raid Discord, sabotage du serveur, staff malveillant" },
  { key: "scam", label: "Arnaque", hint: "Arnaque d'argent réel, chargeback, revente de comptes" },
  { key: "toxic", label: "Comportement toxique", hint: "Harcèlement, menaces, discriminations" },
  { key: "other", label: "Autre", hint: "Règlement du serveur" }
] as const;

export type BanCategory = (typeof BAN_CATEGORIES)[number]["key"];
export const BAN_CATEGORY_KEYS = BAN_CATEGORIES.map((c) => c.key) as [BanCategory, ...BanCategory[]];
export const isBanCategory = (v: unknown): v is BanCategory => typeof v === "string" && (BAN_CATEGORY_KEYS as string[]).includes(v);
export const categoryLabel = (key: string) => BAN_CATEGORIES.find((c) => c.key === key)?.label ?? key;

export const NETWORK_MODES = [
  { key: "off", label: "Consulter", hint: "La réputation réseau s'affiche sur les fiches joueurs. Rien ne se passe à la connexion." },
  { key: "alert", label: "Alerter", hint: "Un joueur banni ailleurs qui se connecte est signalé dans l'Anticheat et sur le webhook d'alertes." },
  { key: "block", label: "Bloquer", hint: "Refusé à la connexion s'il est banni sur assez d'autres serveurs, pour les catégories choisies. Signalé sinon." }
] as const;
export type NetworkMode = (typeof NETWORK_MODES)[number]["key"];

const DISCORD_INVITE = /^https:\/\/(discord\.gg|discord\.com\/invite)\/[\w-]{2,40}$/;

export const networkSettingsSchema = z.object({
  mode: z.enum(["off", "alert", "block"]).default("alert"),
  /** Block mode: banned on at least this many other servers. */
  minServers: z.number().int().min(1).max(10).default(2),
  /** Block mode: only bans of these categories count. */
  blockCategories: z.array(z.enum(BAN_CATEGORY_KEYS)).max(BAN_CATEGORIES.length).default(["cheat", "exploit", "raid", "scam"]),
  /** Shown in the members directory. */
  listed: z.boolean().default(true),
  description: z.string().trim().max(300).default(""),
  inviteUrl: z.union([z.literal(""), z.string().trim().regex(DISCORD_INVITE)]).default("")
});
export type NetworkSettings = z.infer<typeof networkSettingsSchema>;
export const DEFAULT_NETWORK_SETTINGS: NetworkSettings = networkSettingsSchema.parse({});

/** Identifier kinds a network ban matches on (never the IP), with their readable name. */
export const KEY_KINDS: Record<string, string> = {
  license: "license Rockstar", license2: "license Rockstar", discord: "Discord", steam: "Steam", fivem: "Cfx.re", xbl: "Xbox", live: "Microsoft", live2: "Microsoft", token: "PC (identifiant matériel)"
};

/** A ban of another server that matches the player. */
export type NetworkRecord = {
  banId: number;
  serverId: string;
  serverName: string;
  serverIcon: string | null;
  playerName: string;
  reason: string;
  category: BanCategory;
  createdAt: string;
  expiresAt: string | null;
  /** Identifier kinds that matched (license, discord, token…). */
  matchedOn: string[];
};

export type Reputation = {
  /** Distinct other servers with an active shared ban. */
  servers: number;
  records: NetworkRecord[];
};

export type Verdict = { flagged: boolean; blocked: boolean; blockingServers: number; message: string | null };

/** Pure: what the network says about a player for a server with these settings. */
export function networkVerdict(rep: Reputation, settings: NetworkSettings): Verdict {
  const counted = new Set(rep.records.filter((r) => settings.blockCategories.includes(r.category)).map((r) => r.serverId));
  const blockingServers = counted.size;
  const blocked = settings.mode === "block" && blockingServers >= settings.minServers;
  const cats = [...new Set(rep.records.filter((r) => settings.blockCategories.includes(r.category)).map((r) => categoryLabel(r.category)))];
  return {
    flagged: rep.servers > 0,
    blocked,
    blockingServers,
    message: blocked
      ? `Connexion refusée par le réseau Fiverax : tu es banni sur ${blockingServers} autres serveurs (${cats.join(", ")}). Pour contester, contacte les serveurs concernés.`
      : null
  };
}

/** Pure: the most serious records first (permanent, then most recent). */
export function sortRecords(records: NetworkRecord[]): NetworkRecord[] {
  return [...records].sort((a, b) => Number(Boolean(a.expiresAt)) - Number(Boolean(b.expiresAt)) || b.createdAt.localeCompare(a.createdAt));
}
