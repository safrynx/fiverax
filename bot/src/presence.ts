import { ActivityType, type Client, type PresenceData, type PresenceStatusData } from "discord.js";

/**
 * The bot's status and activity, chosen by the platform admins on the site (/admin/bot) and sent back with every
 * heartbeat: "Regarde 12 serveurs FiveM", a custom status, idle / do not disturb… Applied only when it changes.
 */

export type PresenceSetting = { status?: string; activityType?: string; activityText?: string };

const TYPES = {
  playing: ActivityType.Playing,
  watching: ActivityType.Watching,
  listening: ActivityType.Listening,
  competing: ActivityType.Competing,
  custom: ActivityType.Custom
} as const;
const STATUSES = new Set(["online", "idle", "dnd", "invisible"]);

/** Pure: the presence for this setting ({serveurs} = how many Discord servers the bot protects). Null when there is none. */
export function presenceData(setting: PresenceSetting | null | undefined, servers: number): PresenceData | null {
  if (!setting || typeof setting !== "object") return null;
  const status = (STATUSES.has(String(setting.status)) ? setting.status : "online") as PresenceStatusData;
  const text = String(setting.activityText ?? "").replace(/\{serveurs\}/g, String(servers)).trim().slice(0, 128);
  const type = TYPES[setting.activityType as keyof typeof TYPES];
  if (type === undefined || !text) return { status, activities: [] };
  return { status, activities: [type === ActivityType.Custom ? { type, name: "Custom Status", state: text } : { type, name: text }] };
}

let applied = "";

export function applyPresence(client: Client<true>, setting: PresenceSetting | null | undefined, servers: number): void {
  const data = presenceData(setting, servers);
  if (!data) return;
  const key = JSON.stringify(data);
  if (key === applied) return;
  applied = key;
  client.user.setPresence(data);
}
