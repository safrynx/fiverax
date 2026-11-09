import { PermissionFlagsBits, UserFlags, type Guild } from "discord.js";
import { sitePost } from "./api";

/**
 * Discord security audit: the bot reads how the guild is set up (who holds which dangerous permission, bots, @everyone,
 * verification, 2FA for moderators, webhooks, invites, where the bot's role sits) and sends it to the site, which
 * scores it and explains each fix (site/src/lib/discord-audit-shared.ts). Nothing is changed here.
 * Run from the panel (Anti-raid > Audit Discord) and once a day.
 */

export type DiscordAuditSnapshot = {
  memberCount: number;
  verificationLevel: number;
  mfaLevel: number;
  explicitContentFilter: number;
  everyonePermissions: string;
  bot: { permissions: string; position: number };
  roles: { id: string; name: string; permissions: string; position: number; members: number; managed: boolean }[];
  /** Members (not bots, not the owner) holding Administrator. */
  humanAdmins: number;
  bots: { id: string; name: string; permissions: string; verified: boolean }[];
  /** Channels where @everyone is allowed something dangerous by an overwrite. */
  everyoneOverwrites: { channelId: string; name: string; allow: string }[];
  /** Null: the bot may not read them. */
  webhooks: number | null;
  invites: { total: number; permanent: number } | null;
};

/** Channel permissions @everyone should never be given. */
const CHANNEL_DANGER = PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ManageRoles | PermissionFlagsBits.ManageWebhooks | PermissionFlagsBits.MentionEveryone;

export async function collectAudit(guild: Guild): Promise<DiscordAuditSnapshot> {
  await guild.members.fetch().catch(() => undefined);
  const me = guild.members.me;
  const members = [...guild.members.cache.values()];
  const roles = [...guild.roles.cache.values()]
    .filter((r) => r.id !== guild.id)
    .sort((a, b) => b.position - a.position)
    .slice(0, 250)
    .map((r) => ({ id: r.id, name: r.name.slice(0, 100), permissions: r.permissions.bitfield.toString(), position: r.position, members: r.members.size, managed: r.managed }));
  const bots = members
    .filter((m) => m.user.bot && m.id !== guild.client.user.id)
    .slice(0, 100)
    .map((m) => ({ id: m.id, name: (m.user.globalName || m.user.username).slice(0, 100), permissions: m.permissions.bitfield.toString(), verified: Boolean(m.user.flags?.has(UserFlags.VerifiedBot)) }));
  const everyoneOverwrites = [...guild.channels.cache.values()]
    .flatMap((c) => {
      if (!("permissionOverwrites" in c)) return [];
      const o = c.permissionOverwrites.cache.get(guild.id);
      if (!o || (o.allow.bitfield & CHANNEL_DANGER) === 0n) return [];
      return [{ channelId: c.id, name: c.name.slice(0, 100), allow: (o.allow.bitfield & CHANNEL_DANGER).toString() }];
    })
    .slice(0, 200);
  const [webhooks, invites] = await Promise.all([
    guild.fetchWebhooks().then((w) => w.size, () => null),
    guild.invites.fetch().then((list) => ({ total: list.size, permanent: list.filter((i) => !i.maxAge && !i.maxUses).size }), () => null)
  ]);
  return {
    memberCount: guild.memberCount,
    verificationLevel: guild.verificationLevel,
    mfaLevel: guild.mfaLevel,
    explicitContentFilter: guild.explicitContentFilter,
    everyonePermissions: guild.roles.everyone.permissions.bitfield.toString(),
    bot: { permissions: (me?.permissions.bitfield ?? 0n).toString(), position: me?.roles.highest.position ?? 0 },
    roles,
    humanAdmins: members.filter((m) => !m.user.bot && m.id !== guild.ownerId && m.permissions.has(PermissionFlagsBits.Administrator)).length,
    bots,
    everyoneOverwrites,
    webhooks,
    invites
  };
}

/** Audit a guild and hand the result to the site. Returns the audit id, or null. */
export async function auditGuild(guild: Guild): Promise<{ id: number; score: number } | null> {
  const result = await sitePost<{ id?: number; score?: number }>("discord-audit", { op: "store", guildId: guild.id, data: await collectAudit(guild) }, 2);
  return result?.id ? { id: result.id, score: Number(result.score ?? 0) } : null;
}
