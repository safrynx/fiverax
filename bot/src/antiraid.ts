import {
  AuditLogEvent, ChannelType, GuildVerificationLevel, PermissionFlagsBits, PermissionsBitField,
  type Client, type Guild, type GuildAuditLogsEntry, type GuildMember, type NonThreadGuildBasedChannel, type Role
} from "discord.js";
import { sitePost } from "./api";
import { joinSuspicion, nameBase, raidWave, type Join } from "./raid-detect";

/**
 * Anti-raid of every watched guild, driven by the settings of the panel (Sécurité > Anti-raid > Réglages).
 *
 * The bot reads the guild's audit log in real time (GuildAuditLogEntryCreate): each destructive action (role or
 * channel deleted, roles taken from members, bans…) is counted per author. Once an author goes past what a rule
 * tolerates in its time window, the bot undoes every action of that author in the window (recreates the role and
 * gives it back to its members, recreates the channel, re-adds the roles…), punishes the author (derank / kick / ban;
 * a bot is always kicked), and reports the incident to the panel (and to an alert channel).
 * Mass joins lock the guild down for a while (highest verification level, newcomers kicked); with "smart" joins, a
 * slower wave of fresh accounts (days old, no avatar, look-alike names) does too.
 * Observation mode ("observe"): the bot reports what it would have done, without undoing nor punishing anything.
 */

// ---- settings (sent by the site, see site/src/lib/security-config.ts) ----

type Punishment = "derank" | "quarantine" | "timeout" | "kick" | "ban";
/** `punishment`: "default" = the general one, "none" = undo and report only. `undo` false: nothing is undone. */
type Rule = { enabled: boolean; max: number; windowSec: number; punishment?: "default" | "none" | Punishment; undo?: boolean };
export type RuleKey =
  | "role_delete" | "channel_delete" | "role_create" | "channel_create" | "member_role_remove" | "member_role_add" | "dangerous_role_add"
  | "role_permissions" | "ban" | "kick" | "prune" | "bot_add" | "webhook_create" | "guild_update" | "protected_role" | "channel_update";

export type MessageProtection = {
  enabled: boolean; floodCount: number; floodSeconds: number; maxMentions: number; blockEveryone: boolean; blockInvites: boolean;
  blockLinks: boolean; ignoredRoles: string[]; ignoredChannels: string[];
  blockScams?: boolean; multiChannel?: number; multiChannelSeconds?: number; duplicateRaid?: number;
  /** What the author of a serious message gets besides the deletion (absent: mute). */
  action?: "delete" | "timeout" | "kick" | "ban";
  allowedDomains?: string[];
  bannedWords?: string[];
};

export type AntiraidConfig = {
  enabled: boolean;
  /** "observe": report only (absent on settings saved before it existed: protect). */
  mode?: "protect" | "observe";
  punishment: Punishment;
  trustOwner: boolean;
  trusted: string[];
  /** Members with one of these roles are never watched. */
  trustedRoles?: string[];
  alertChannelId: string | null;
  /** Role pinged with each incident in the alert channel. */
  alertRoleId?: string | null;
  /** Private message to the sanctioned person, before the sanction. */
  dm?: { enabled: boolean; message: string };
  youngAccountAction?: "kick" | "ban" | "quarantine" | "log";
  rules: Partial<Record<RuleKey, Rule>>;
  joinRaid: { enabled: boolean; joins: number; windowSec: number; lockdownMinutes: number; smart?: boolean; action?: "kick" | "ban" | "none"; lockChannels?: boolean };
  minAccountAgeDays: number;
  quarantineRoleId?: string | null;
  timeoutMinutes?: number;
  protectedRoles?: string[];
  protectedChannels?: string[];
  alertOwnerDm?: boolean;
  backupEveryHours?: number;
  messages?: MessageProtection;
};

const configs = new Map<string, AntiraidConfig>();

export const getAntiraidConfig = (guildId: string) => configs.get(guildId);

/** Observation mode: detect and report, never act. */
export const observing = (config: AntiraidConfig) => config.mode === "observe";
/** What the incident shows in observation mode instead of the actions. */
export const observed = (detail: string): Action => ({ type: "Mode observation", ok: true, detail: `aucune action : ${detail}`.slice(0, 300) });

/** Never watched: the bot itself, trusted people, members of a trusted role, and the owner when the settings say so. */
export function isTrusted(guild: Guild, config: AntiraidConfig, userId: string, roleIds: Iterable<string> = []): boolean {
  if (userId === guild.client.user.id || config.trusted.includes(userId) || (config.trustOwner && userId === guild.ownerId)) return true;
  const trustedRoles = config.trustedRoles ?? [];
  if (!trustedRoles.length) return false;
  for (const id of roleIds) if (trustedRoles.includes(id)) return true;
  return false;
}

/** isTrusted, looking up the member's roles (cache first) when trusted roles are set. */
export async function isTrustedMember(guild: Guild, config: AntiraidConfig, userId: string): Promise<boolean> {
  if (isTrusted(guild, config, userId)) return true;
  if (!config.trustedRoles?.length) return false;
  const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
  return member ? isTrusted(guild, config, userId, member.roles.cache.keys()) : false;
}

/** Pure: the text of the private message to a sanctioned person ({serveur}, {raison}, {sanction}). */
export function dmText(template: string, vars: { server: string; reason: string; sanction: string }): string {
  const base = template.trim() || "Tu as été sanctionné sur {serveur} par la protection anti-raid ({sanction}) : {raison}.";
  return base.replace(/\{serveur\}/g, vars.server).replace(/\{raison\}/g, vars.reason).replace(/\{sanction\}/g, vars.sanction).slice(0, 1900);
}

export function setAntiraidConfig(guildId: string, config: unknown): void {
  if (config && typeof config === "object" && "enabled" in config) configs.set(guildId, config as AntiraidConfig);
}

// ---- pure helpers (tested) ----

/** Permissions that let someone wreck a guild. */
export const DANGEROUS = [
  PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers, PermissionFlagsBits.ManageWebhooks, PermissionFlagsBits.ModerateMembers
].reduce((a, b) => a | b, 0n);

export const isDangerous = (bits: bigint | string | number) => (BigInt(bits) & DANGEROUS) !== 0n;

/** Dangerous permissions present in `after` and not in `before`. */
export const addedDangerous = (before: bigint | string | number, after: bigint | string | number) => (BigInt(after) & ~BigInt(before) & DANGEROUS) !== 0n;

type Pending = { at: number; undo: (() => Promise<Action>) | null; label: string };
/** `remap`: a recreated role (new id), so the panel updates its grade / avert / access rules. */
export type Action = { type: string; ok: boolean; detail?: string; remap?: { from: string; to: string } };

/**
 * Actions of each author per rule within the rule's window. `push` returns the actions to undo now: none while the
 * author stays within what is tolerated, all of the window's actions the moment they go past it, then each new one
 * at once while they are flagged.
 */
export class Tracker {
  private entries = new Map<string, Pending[]>();
  private flagged = new Map<string, number>();

  push(key: string, rule: Rule, item: Omit<Pending, "at"> & { at?: number }, now = Date.now()): { triggered: boolean; firstTrigger: boolean; toUndo: Pending[] } {
    const windowMs = rule.windowSec * 1000;
    const entry = { ...item, at: now };
    const list = (this.entries.get(key) ?? []).filter((e) => now - e.at < windowMs);
    list.push(entry);
    this.entries.set(key, list);
    const flaggedAt = this.flagged.get(key);
    if (flaggedAt && now - flaggedAt < Math.max(windowMs, 60_000)) return { triggered: true, firstTrigger: false, toUndo: [entry] };
    if (list.length <= rule.max) return { triggered: false, firstTrigger: false, toUndo: [] };
    this.flagged.set(key, now);
    this.entries.set(key, []);
    return { triggered: true, firstTrigger: true, toUndo: list };
  }
}

// ---- what the bot remembers to be able to undo ----

/** Roles of each member (role deletions do not tell who had the role). */
const memberRoles = new Map<string, Map<string, Set<string>>>();
type DeletedRole = { role: Role; holders: string[]; overwrites: { channelId: string; allow: bigint; deny: bigint }[]; at: number };
const deletedRoles = new Map<string, DeletedRole>();
type DeletedChannel = { channel: NonThreadGuildBasedChannel; children: string[]; at: number };
const deletedChannels = new Map<string, DeletedChannel>();
const recentJoins = new Map<string, Join[]>();
type Lockdown = { until: number; previousLevel: GuildVerificationLevel; channels: { id: string; allow: bigint | null; deny: bigint | null }[]; timer: NodeJS.Timeout };
const lockdowns = new Map<string, Lockdown>();
const tracker = new Tracker();
const punished = new Map<string, number>();

export function indexGuildMembers(guild: Guild, members: Iterable<GuildMember>): void {
  const map = new Map<string, Set<string>>();
  for (const m of members) map.set(m.id, new Set(m.roles.cache.keys()));
  memberRoles.set(guild.id, map);
}

export function memberChanged(member: GuildMember, present = true): void {
  const map = memberRoles.get(member.guild.id);
  if (!map) return;
  if (present) map.set(member.id, new Set(member.roles.cache.keys()));
  else map.delete(member.id);
}

function rememberDeletedRole(role: Role): void {
  const holders = [...(memberRoles.get(role.guild.id) ?? new Map<string, Set<string>>()).entries()].filter(([, roles]) => roles.has(role.id)).map(([id]) => id);
  const overwrites = role.guild.channels.cache
    .filter((c): c is NonThreadGuildBasedChannel => "permissionOverwrites" in c)
    .map((c) => ({ c, o: c.permissionOverwrites.cache.get(role.id) }))
    .filter((x) => x.o)
    .map(({ c, o }) => ({ channelId: c.id, allow: o!.allow.bitfield, deny: o!.deny.bitfield }));
  deletedRoles.set(role.id, { role, holders, overwrites, at: Date.now() });
}

function rememberDeletedChannel(channel: NonThreadGuildBasedChannel): void {
  const children = channel.type === ChannelType.GuildCategory ? channel.guild.channels.cache.filter((c) => "parentId" in c && c.parentId === channel.id).map((c) => c.id) : [];
  deletedChannels.set(channel.id, { channel, children, at: Date.now() });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The audit entry may arrive before the delete event: wait a little for the snapshot. */
async function waitFor<T>(map: Map<string, T>, id: string): Promise<T | undefined> {
  for (let i = 0; i < 10 && !map.has(id); i++) await wait(300);
  return map.get(id);
}

export const attempt = async (type: string, run: () => Promise<unknown>, detail?: string): Promise<Action> => {
  try {
    await run();
    return { type, ok: true, detail };
  } catch (error) {
    return { type, ok: false, detail: `${detail ? `${detail} : ` : ""}${error instanceof Error ? error.message : String(error)}`.slice(0, 300) };
  }
};

// ---- undo builders ----

function undoRoleDelete(guild: Guild, roleId: string, reason: string) {
  return async (): Promise<Action> => {
    const snap = await waitFor(deletedRoles, roleId);
    if (!snap) return { type: "Rôle recréé", ok: false, detail: "rôle inconnu du bot (supprimé avant son démarrage)" };
    const old = snap.role;
    try {
      const role = await guild.roles.create({
        name: old.name, color: old.color, hoist: old.hoist, mentionable: old.mentionable, permissions: old.permissions,
        unicodeEmoji: old.unicodeEmoji ?? undefined, reason
      });
      await role.setPosition(Math.max(1, Math.min(old.position, (guild.members.me?.roles.highest.position ?? 1) - 1))).catch(() => undefined);
      for (const o of snap.overwrites) {
        const channel = guild.channels.cache.get(o.channelId);
        if (channel && "permissionOverwrites" in channel) await channel.permissionOverwrites.create(role, Object.fromEntries([
          ...new PermissionsBitField(o.allow).toArray().map((p) => [p, true]),
          ...new PermissionsBitField(o.deny).toArray().map((p) => [p, false])
        ]), { reason }).catch(() => undefined);
      }
      let given = 0;
      for (const id of snap.holders) {
        if (await guild.members.addRole({ user: id, role, reason }).then(() => true, () => false)) given++;
      }
      deletedRoles.delete(roleId);
      return { type: "Rôle recréé", ok: true, detail: `@${old.name}, redonné à ${given}/${snap.holders.length} membre(s)`, remap: { from: roleId, to: role.id } };
    } catch (error) {
      return { type: "Rôle recréé", ok: false, detail: `@${old.name} : ${error instanceof Error ? error.message : error}` };
    }
  };
}

function undoChannelDelete(guild: Guild, channelId: string, reason: string) {
  return async (): Promise<Action> => {
    const snap = await waitFor(deletedChannels, channelId);
    if (!snap) return { type: "Salon recréé", ok: false, detail: "salon inconnu du bot" };
    const c = snap.channel;
    return attempt("Salon recréé", async () => {
      const created = await guild.channels.create({
        name: c.name,
        type: c.type as ChannelType.GuildText,
        parent: "parentId" in c && c.parentId && guild.channels.cache.has(c.parentId) ? c.parentId : undefined,
        position: c.rawPosition,
        permissionOverwrites: c.permissionOverwrites.cache.map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield })),
        topic: "topic" in c && c.topic ? c.topic : undefined,
        nsfw: "nsfw" in c ? c.nsfw : undefined,
        bitrate: "bitrate" in c ? c.bitrate : undefined,
        userLimit: "userLimit" in c ? c.userLimit : undefined,
        rateLimitPerUser: "rateLimitPerUser" in c ? c.rateLimitPerUser ?? undefined : undefined,
        reason
      });
      for (const childId of snap.children) {
        const child = guild.channels.cache.get(childId);
        if (child && "setParent" in child) await child.setParent(created.id, { lockPermissions: false, reason }).catch(() => undefined);
      }
      deletedChannels.delete(channelId);
    }, `#${c.name}`);
  };
}

// ---- punishment ----

const SANCTION_NAMES: Record<Punishment, string> = { derank: "retrait des rôles", quarantine: "quarantaine", timeout: "mute", kick: "expulsion", ban: "bannissement" };

/** The sanction of a rule: its own, the general one, or none. */
export function sanctionFor(config: AntiraidConfig, rule?: RuleKey): Punishment | "none" {
  const own = rule ? config.rules[rule]?.punishment : undefined;
  return own && own !== "default" ? own : config.punishment;
}

/** Private message before a sanction (setting `dm`); never blocks the sanction. */
async function notify(member: GuildMember, config: AntiraidConfig, why: string, sanction: Punishment): Promise<Action | null> {
  if (!config.dm?.enabled) return null;
  const text = dmText(config.dm.message, { server: member.guild.name, reason: why, sanction: SANCTION_NAMES[sanction] });
  return attempt("Message privé envoyé", () => member.send({ content: text, allowedMentions: { parse: [] } }));
}

async function punish(guild: Guild, config: AntiraidConfig, executorId: string, why: string, rule?: RuleKey): Promise<{ actions: Action[]; removedRoles: string[] }> {
  const sanction = sanctionFor(config, rule);
  if (sanction === "none") return { actions: [{ type: "Sanction", ok: true, detail: "aucune (réglage de la règle)" }], removedRoles: [] };
  const key = `${guild.id}:${executorId}`;
  if (Date.now() - (punished.get(key) ?? 0) < 60_000) return { actions: [], removedRoles: [] };
  punished.set(key, Date.now());
  const reason = `Fiverax anti-raid : ${why}`.slice(0, 400);
  if (executorId === guild.ownerId) return { actions: [{ type: "Sanction", ok: false, detail: "propriétaire du Discord : Discord interdit de le sanctionner" }], removedRoles: [] };
  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member) return { actions: [{ type: "Sanction", ok: false, detail: "auteur introuvable (déjà parti ?)" }], removedRoles: [] };

  if (member.user.bot) return { actions: [await attempt("Bot expulsé", () => member.kick(reason), member.user.tag)], removedRoles: [] };
  const dm = await notify(member, config, why, sanction);
  const before = dm ? [dm] : [];
  if (sanction === "kick") return { actions: [...before, await attempt("Auteur expulsé", () => member.kick(reason), member.user.tag)], removedRoles: [] };
  if (sanction === "ban") return { actions: [...before, await attempt("Auteur banni", () => member.ban({ reason }), member.user.tag)], removedRoles: [] };
  const result = await derank(member, config, reason, sanction);
  return { actions: [...before, ...result.actions], removedRoles: result.removedRoles };
}

/** Derank (every role the bot can remove), then quarantine role or mute depending on the punishment. */
export async function derank(member: GuildMember, config: AntiraidConfig, reason: string, punishment: Punishment = config.punishment): Promise<{ actions: Action[]; removedRoles: string[] }> {
  const guild = member.guild;
  const quarantine = punishment === "quarantine" ? config.quarantineRoleId ?? null : null;
  const removable = member.roles.cache.filter((r) => r.id !== guild.id && r.id !== quarantine && !r.managed && r.editable);
  const kept = member.roles.cache.filter((r) => r.id !== guild.id && !r.managed && !r.editable);
  const action = await attempt("Auteur derank", () => member.roles.remove([...removable.keys()], reason), `${removable.size} rôle(s) retiré(s)`);
  const actions = [action];
  if (kept.size) actions.push({ type: "Derank incomplet", ok: false, detail: `rôles au-dessus du bot : ${kept.map((r) => r.name).join(", ")}` });
  if (punishment === "quarantine") {
    actions.push(quarantine
      ? await attempt("Mis en quarantaine", () => member.roles.add(quarantine, reason))
      : { type: "Quarantaine", ok: false, detail: "aucun rôle de quarantaine choisi dans les réglages" });
  }
  if (punishment === "timeout") {
    const minutes = config.timeoutMinutes ?? 60;
    actions.push(await attempt("Exclu temporairement", () => member.timeout(minutes * 60_000, reason), `${minutes} min`));
  }
  return { actions, removedRoles: action.ok ? [...removable.keys()] : [] };
}

// ---- reporting ----

export type Incident = { kind: string; actorId: string | null; actorName: string | null; actorBot: boolean; summary: string; details?: Record<string, unknown>; actions: Action[]; removedRoles?: string[] };

/** Send the incident to the panel, the alert channel and (setting) the owner's DMs. */
export async function report(guild: Guild, config: AntiraidConfig, incident: Incident) {
  console.log(`[antiraid] ${guild.name}: ${incident.kind} by ${incident.actorName ?? "?"} — ${incident.summary}`);
  void sitePost("incident", { guildId: guild.id, details: {}, removedRoles: [], ...incident, actions: incident.actions.slice(0, 200) }, 2);
  const lines = incident.actions.slice(0, 12).map((a) => `${a.ok ? "✅" : "❌"} ${a.type}${a.detail ? ` — ${a.detail}` : ""}`);
  const embed = {
    title: "🛡️ Anti-raid",
    description: `**${incident.summary}**\nAuteur : ${incident.actorId ? `<@${incident.actorId}>` : "?"}${incident.actorBot ? " (bot)" : ""}\n\n${lines.join("\n")}`.slice(0, 4000),
    color: 0xd4b06a,
    footer: { text: guild.name },
    timestamp: new Date().toISOString()
  };
  const channel = config.alertChannelId ? guild.channels.cache.get(config.alertChannelId) : undefined;
  // The alert role is pinged (and only it: the embed never pings anyone).
  const ping = config.alertRoleId ? { content: `<@&${config.alertRoleId}>`, allowedMentions: { roles: [config.alertRoleId] } } : { allowedMentions: { parse: [] as never[] } };
  if (channel?.isTextBased()) await channel.send({ embeds: [embed], ...ping }).catch(() => undefined);
  if (config.alertOwnerDm) {
    const owner = await guild.fetchOwner().catch(() => null);
    await owner?.send({ embeds: [embed] }).catch(() => undefined);
  }
}

// ---- the audit log ----

const LABELS: Record<RuleKey, string> = {
  role_delete: "suppression de rôle", channel_delete: "suppression de salon", role_create: "création de rôles en masse",
  channel_create: "création de salons en masse", member_role_remove: "retrait de rôles en masse", member_role_add: "ajout de rôles en masse",
  dangerous_role_add: "rôle dangereux donné", role_permissions: "permissions dangereuses ajoutées à un rôle", ban: "bans en masse",
  kick: "kicks en masse", prune: "purge de membres", bot_add: "ajout d'un bot", webhook_create: "création de webhooks", guild_update: "modification du serveur",
  protected_role: "rôle protégé modifié", channel_update: "permissions de salons modifiées en masse"
};

type Classified = { rule: RuleKey; label: string; undo: (() => Promise<Action>) | null; protectedHit?: boolean };

type Change = { key: string; old?: unknown; new?: unknown };
const rolesOf = (changes: Change[], key: "$add" | "$remove") => (changes.find((c) => c.key === key)?.new as { id: string; name: string }[] | undefined) ?? [];

/** What one audit entry means: the rule(s) it counts for, and how to undo it. */
function classify(guild: Guild, config: AntiraidConfig, entry: GuildAuditLogsEntry, reason: string): Classified[] {
  const target = entry.targetId ?? "";
  const changes = (entry.changes ?? []) as Change[];
  const protectedRoles = new Set(config.protectedRoles ?? []);
  switch (entry.action) {
    case AuditLogEvent.RoleDelete:
      return [{ rule: "role_delete", label: "rôle supprimé", undo: undoRoleDelete(guild, target, reason), protectedHit: protectedRoles.has(target) }];
    case AuditLogEvent.ChannelDelete:
      return [{ rule: "channel_delete", label: "salon supprimé", undo: undoChannelDelete(guild, target, reason), protectedHit: (config.protectedChannels ?? []).includes(target) }];
    case AuditLogEvent.ChannelUpdate:
    case AuditLogEvent.ChannelOverwriteCreate:
    case AuditLogEvent.ChannelOverwriteUpdate:
    case AuditLogEvent.ChannelOverwriteDelete:
      return [{ rule: "channel_update", label: "salon modifié", undo: null, protectedHit: (config.protectedChannels ?? []).includes(target) }];
    case AuditLogEvent.RoleCreate:
      return [{ rule: "role_create", label: "rôle créé", undo: () => attempt("Rôle créé supprimé", async () => { await guild.roles.cache.get(target)?.delete(reason); }) }];
    case AuditLogEvent.ChannelCreate:
      return [{ rule: "channel_create", label: "salon créé", undo: () => attempt("Salon créé supprimé", async () => { await guild.channels.cache.get(target)?.delete(reason); }) }];
    case AuditLogEvent.MemberRoleUpdate: {
      const out: Classified[] = [];
      const removed = rolesOf(changes, "$remove");
      const added = rolesOf(changes, "$add");
      const pAdded = added.filter((r) => protectedRoles.has(r.id));
      const pRemoved = removed.filter((r) => protectedRoles.has(r.id));
      if (pAdded.length || pRemoved.length) {
        out.push({
          rule: "protected_role", label: "rôle protégé", protectedHit: true,
          undo: () => attempt("Rôle protégé remis en état", async () => {
            const m = await guild.members.fetch(target);
            if (pAdded.length) await m.roles.remove(pAdded.map((r) => r.id), reason);
            if (pRemoved.length) await m.roles.add(pRemoved.map((r) => r.id), reason);
          }, `<@${target}> : ${[...pAdded, ...pRemoved].map((r) => r.name).join(", ")}`)
        });
      }
      if (removed.length) {
        out.push({ rule: "member_role_remove", label: "rôles retirés", undo: () => attempt("Rôles remis", () => guild.members.cache.get(target)?.roles.add(removed.map((r) => r.id), reason) ?? guild.members.fetch(target).then((m) => m.roles.add(removed.map((r) => r.id), reason)), `<@${target}> : ${removed.map((r) => r.name).join(", ")}`) });
      }
      const dangerous = added.filter((r) => { const role = guild.roles.cache.get(r.id); return role && isDangerous(role.permissions.bitfield); });
      if (dangerous.length) {
        out.push({ rule: "dangerous_role_add", label: "rôle dangereux donné", undo: () => attempt("Rôle dangereux retiré", () => guild.members.fetch(target).then((m) => m.roles.remove(dangerous.map((r) => r.id), reason)), `<@${target}> : ${dangerous.map((r) => r.name).join(", ")}`) });
      }
      if (added.length) {
        out.push({ rule: "member_role_add", label: "rôles ajoutés", undo: () => attempt("Rôles ajoutés retirés", () => guild.members.fetch(target).then((m) => m.roles.remove(added.map((r) => r.id), reason)), `<@${target}> : ${added.map((r) => r.name).join(", ")}`) });
      }
      return out;
    }
    case AuditLogEvent.RoleUpdate: {
      if (protectedRoles.has(target)) {
        const old = Object.fromEntries(changes.filter((c) => ["name", "color", "hoist", "mentionable", "permissions"].includes(c.key)).map((c) => [c.key, c.key === "permissions" ? BigInt(String(c.old ?? "0")) : c.old]));
        return [{ rule: "protected_role", label: "rôle protégé modifié", protectedHit: true, undo: () => attempt("Rôle protégé remis en état", async () => { await guild.roles.cache.get(target)?.edit({ ...old, reason }); }, guild.roles.cache.get(target)?.name) }];
      }
      const perms = changes.find((c) => c.key === "permissions");
      if (!perms || !addedDangerous(String(perms.old ?? "0"), String(perms.new ?? "0"))) return [];
      return [{ rule: "role_permissions", label: "permissions dangereuses ajoutées", undo: () => attempt("Permissions du rôle remises", async () => { await guild.roles.cache.get(target)?.setPermissions(BigInt(String(perms.old ?? "0")), reason); }, guild.roles.cache.get(target)?.name) }];
    }
    case AuditLogEvent.MemberBanAdd:
      return [{ rule: "ban", label: "membre banni", undo: () => attempt("Membre débanni", () => guild.members.unban(target, reason), `<@${target}>`) }];
    case AuditLogEvent.MemberKick:
      return [{ rule: "kick", label: "membre expulsé", undo: null }];
    case AuditLogEvent.MemberPrune:
      return [{ rule: "prune", label: "purge de membres", undo: null }];
    case AuditLogEvent.BotAdd:
      return [{ rule: "bot_add", label: "bot ajouté", undo: () => attempt("Bot ajouté expulsé", () => guild.members.fetch(target).then((m) => m.kick(reason)), `<@${target}>`) }];
    case AuditLogEvent.WebhookCreate:
      return [{ rule: "webhook_create", label: "webhook créé", undo: () => attempt("Webhook supprimé", () => guild.client.deleteWebhook(target, { reason })) }];
    case AuditLogEvent.GuildUpdate: {
      const name = changes.find((c) => c.key === "name");
      if (!name && !changes.some((c) => c.key === "vanity_url_code" || c.key === "icon_hash")) return [];
      return [{ rule: "guild_update", label: "serveur modifié", undo: name ? () => attempt("Nom du serveur remis", () => guild.setName(String(name.old), reason), String(name.old)) : null }];
    }
    default:
      return [];
  }
}

async function onAuditEntry(entry: GuildAuditLogsEntry, guild: Guild): Promise<void> {
  const config = configs.get(guild.id);
  const executorId = entry.executorId;
  if (!config?.enabled || !executorId || (await isTrustedMember(guild, config, executorId))) return;

  const reason = "Fiverax anti-raid : action annulée";
  for (const item of classify(guild, config, entry, reason)) {
    const base = config.rules[item.rule];
    // A protected role or channel triggers at once, even when the rule itself is off.
    const rule = item.protectedHit ? { enabled: true, max: 0, windowSec: base?.windowSec ?? 60 } : base;
    if (!rule?.enabled) continue;
    // Per rule (Sécurité > Anti-raid > Règles): undo or not, and its own sanction.
    const undo = base?.undo !== false;
    const { triggered, firstTrigger, toUndo } = tracker.push(`${guild.id}:${executorId}:${item.rule}`, rule, { at: Date.now(), undo: item.undo, label: item.label });
    if (!triggered) continue;

    if (observing(config)) {
      if (!firstTrigger) continue;
      const executor = entry.executor ?? (await guild.client.users.fetch(executorId).catch(() => null));
      const undoable = undo ? toUndo.filter((p) => p.undo).length : 0;
      const sanction = executor?.bot ? "kick (bot)" : sanctionFor(config, item.rule) === "none" ? "aucune" : sanctionFor(config, item.rule);
      await report(guild, config, {
        kind: item.rule,
        actorId: executorId,
        actorName: executor ? executor.globalName || executor.username : null,
        actorBot: Boolean(executor?.bot),
        summary: `${LABELS[item.rule].replace(/^./, (c) => c.toUpperCase())} : ${toUndo.length} action(s) en ${rule.windowSec} s (toléré : ${rule.max})`,
        details: { count: toUndo.length, max: rule.max, windowSec: rule.windowSec, observe: true },
        actions: [observed(`aurait annulé ${undoable} action(s) et appliqué la sanction « ${sanction} »`)]
      });
      continue;
    }

    const actions: Action[] = [];
    if (undo) for (const pending of toUndo) if (pending.undo) actions.push(await pending.undo());
    const executor = entry.executor ?? (await guild.client.users.fetch(executorId).catch(() => null));
    let removedRoles: string[] = [];
    if (firstTrigger) {
      const result = await punish(guild, config, executorId, LABELS[item.rule], item.rule);
      actions.push(...result.actions);
      removedRoles = result.removedRoles;
    }
    if (firstTrigger || actions.length) {
      await report(guild, config, {
        kind: item.rule,
        actorId: executorId,
        actorName: executor ? executor.globalName || executor.username : null,
        actorBot: Boolean(executor?.bot),
        summary: firstTrigger
          ? `${LABELS[item.rule].replace(/^./, (c) => c.toUpperCase())} : ${toUndo.length} action(s) en ${rule.windowSec} s (toléré : ${rule.max})`
          : `Nouvelle action bloquée (${item.label})`,
        details: { count: toUndo.length, max: rule.max, windowSec: rule.windowSec, remaps: actions.flatMap((a) => (a.remap ? [a.remap] : [])) },
        actions,
        removedRoles
      });
    }
  }
}

// ---- mass joins ----

async function onJoin(member: GuildMember): Promise<void> {
  const guild = member.guild;
  const config = configs.get(guild.id);
  if (!config?.enabled || member.user.bot) return;
  const now = Date.now();
  const observe = observing(config);
  const lock = lockdowns.get(guild.id);

  // A lockdown is always real (raid seen in protect mode, or asked from the panel).
  if (lock && lock.until > now) {
    await member.kick("Fiverax anti-raid : serveur verrouillé").catch(() => undefined);
    return;
  }

  const minAge = config.minAccountAgeDays * 86400_000;
  if (minAge > 0 && now - member.user.createdTimestamp < minAge) {
    const why = `Fiverax anti-raid : compte de moins de ${config.minAccountAgeDays} jour(s)`;
    const mode = config.youngAccountAction ?? "kick";
    const quarantine = config.quarantineRoleId ?? null;
    const action: Action = observe
      ? observed(`aurait appliqué « ${mode} » à ${member.user.tag}`)
      : mode === "log" ? { type: "Signalé", ok: true, detail: "réglage : seulement signaler" }
      : mode === "ban" ? await attempt("Compte banni", () => member.ban({ reason: why }), member.user.tag)
      : mode === "quarantine"
        ? quarantine ? await attempt("Mis en quarantaine", () => member.roles.add(quarantine, why), member.user.tag) : { type: "Quarantaine", ok: false, detail: "aucun rôle de quarantaine choisi dans les réglages" }
      : await attempt("Compte expulsé", () => member.kick(why), member.user.tag);
    await report(guild, config, { kind: "young_account", actorId: member.id, actorName: member.user.username, actorBot: false, summary: `Compte créé il y a ${Math.floor((now - member.user.createdTimestamp) / 86400_000)} jour(s)`, actions: [action] });
    return;
  }

  if (!config.joinRaid.enabled) return;
  const keepMs = Math.max(config.joinRaid.windowSec, 60) * 1000;
  const previous = (recentJoins.get(guild.id) ?? []).filter((j) => now - j.at < keepMs);
  const join: Join = {
    id: member.id,
    at: now,
    base: nameBase(member.user.username),
    suspicion: joinSuspicion({ createdAt: member.user.createdTimestamp, hasAvatar: Boolean(member.user.avatar), name: member.user.username }, previous.map((j) => j.base), now)
  };
  const recent = [...previous, join];
  recentJoins.set(guild.id, recent);
  const raiders = raidWave(recent, { ...config.joinRaid, smart: config.joinRaid.smart !== false }, now);
  if (!raiders) return;

  // Raid: lock the guild down and kick the raiders.
  recentJoins.set(guild.id, []);
  const suspicious = raiders.filter((j) => j.suspicion >= 2).length;
  const summary = `${raiders.length} arrivée(s) en ${Math.round((now - Math.min(...raiders.map((j) => j.at))) / 1000)} s${suspicious ? `, dont ${suspicious} compte(s) suspect(s) : récents, sans avatar ou aux noms semblables` : ""}`;
  const raidAction = config.joinRaid.action ?? "kick";
  if (observe) {
    const what = raidAction === "ban" ? `banni ${raiders.length} arrivant(s)` : raidAction === "kick" ? `expulsé ${raiders.length} arrivant(s)` : "laissé les arrivants";
    await report(guild, config, {
      kind: "join_raid", actorId: null, actorName: null, actorBot: false, summary, details: { joins: raiders.length, suspicious, observe: true },
      actions: [observed(`aurait verrouillé le serveur ${config.joinRaid.lockdownMinutes} min et ${what}`)]
    });
    return;
  }
  const actions = await startLockdown(guild, config.joinRaid.lockdownMinutes, config.joinRaid.lockChannels === true, "raid de comptes");
  if (raidAction !== "none") {
    let done = 0;
    for (const j of raiders) {
      const ok = raidAction === "ban"
        ? await guild.members.ban(j.id, { reason: "Fiverax anti-raid : raid de comptes" }).then(() => true, () => false)
        : await guild.members.kick(j.id, "Fiverax anti-raid : raid de comptes").then(() => true, () => false);
      if (ok) done++;
    }
    actions.push({ type: raidAction === "ban" ? "Arrivants bannis" : "Arrivants expulsés", ok: true, detail: `${done}/${raiders.length}` });
  }
  await report(guild, config, { kind: "join_raid", actorId: null, actorName: null, actorBot: false, summary, details: { joins: raiders.length, suspicious }, actions });
}

/**
 * Lock the guild: highest verification level, every newcomer kicked and, with `lockChannels`, @everyone may no longer
 * write in any text channel. Ends by itself after `minutes` (or with endLockdown).
 */
export async function startLockdown(guild: Guild, minutes: number, lockChannels: boolean, why: string): Promise<Action[]> {
  const reason = `Fiverax anti-raid : ${why}`;
  const current = lockdowns.get(guild.id);
  if (current) clearTimeout(current.timer);
  const previousLevel = current?.previousLevel ?? guild.verificationLevel;
  const actions: Action[] = [await attempt("Vérification au maximum", () => guild.setVerificationLevel(GuildVerificationLevel.VeryHigh, reason))];
  const channels = current?.channels ?? [];
  if (lockChannels && !channels.length) {
    let closed = 0;
    for (const c of guild.channels.cache.values()) {
      if (c.type !== ChannelType.GuildText && c.type !== ChannelType.GuildAnnouncement && c.type !== ChannelType.GuildForum) continue;
      const o = c.permissionOverwrites.cache.get(guild.id);
      const ok = await c.permissionOverwrites.edit(guild.id, { SendMessages: false, SendMessagesInThreads: false, CreatePublicThreads: false, AddReactions: false }, { reason }).then(() => true, () => false);
      if (ok) {
        channels.push({ id: c.id, allow: o?.allow.bitfield ?? null, deny: o?.deny.bitfield ?? null });
        closed++;
      }
    }
    actions.push({ type: "Salons fermés", ok: true, detail: `${closed} salon(s) en lecture seule pour @everyone` });
  }
  const timer = setTimeout(() => void endLockdown(guild, "fin du verrouillage"), minutes * 60_000);
  lockdowns.set(guild.id, { until: Date.now() + minutes * 60_000, previousLevel, channels, timer });
  actions.push({ type: "Verrouillage", ok: true, detail: `${minutes} min : chaque nouvel arrivant est expulsé` });
  return actions;
}

export async function endLockdown(guild: Guild, why: string): Promise<Action[]> {
  const lock = lockdowns.get(guild.id);
  if (!lock) return [{ type: "Déverrouillage", ok: false, detail: "le serveur n'était pas verrouillé" }];
  clearTimeout(lock.timer);
  lockdowns.delete(guild.id);
  const reason = `Fiverax anti-raid : ${why}`;
  const actions: Action[] = [await attempt("Vérification remise", () => guild.setVerificationLevel(lock.previousLevel, reason))];
  let reopened = 0;
  for (const saved of lock.channels) {
    const c = guild.channels.cache.get(saved.id);
    if (!c || !("permissionOverwrites" in c)) continue;
    const ok = saved.allow === null
      ? await c.permissionOverwrites.delete(guild.id, reason).then(() => true, () => false)
      : await c.permissionOverwrites.create(guild.id, Object.fromEntries([
          ...new PermissionsBitField(saved.allow).toArray().map((p) => [p, true]),
          ...new PermissionsBitField(saved.deny ?? 0n).toArray().map((p) => [p, false])
        ]), { reason }).then(() => true, () => false);
    if (ok) reopened++;
  }
  if (lock.channels.length) actions.push({ type: "Salons rouverts", ok: reopened === lock.channels.length, detail: `${reopened}/${lock.channels.length}` });
  const config = configs.get(guild.id);
  if (config) await report(guild, config, { kind: "lockdown_end", actorId: null, actorName: null, actorBot: false, summary: "Fin du verrouillage", actions });
  return actions;
}

/** Wire the anti-raid on the client. `watched(guildId)`: the guild belongs to a server of the panel. */
export function setupAntiraid(client: Client, watched: (guildId: string) => boolean): void {
  client.on("guildAuditLogEntryCreate", (entry, guild) => {
    if (watched(guild.id)) void onAuditEntry(entry, guild).catch((e) => console.error("[antiraid] audit entry failed:", e instanceof Error ? e.message : e));
  });
  client.on("roleDelete", (role) => {
    if (watched(role.guild.id)) rememberDeletedRole(role);
  });
  client.on("channelDelete", (channel) => {
    if ("guild" in channel && channel.guild && watched(channel.guild.id)) rememberDeletedChannel(channel as NonThreadGuildBasedChannel);
  });
  client.on("guildMemberAdd", (member) => {
    if (watched(member.guild.id)) void onJoin(member).catch((e) => console.error("[antiraid] join check failed:", e instanceof Error ? e.message : e));
  });
  // Forget snapshots nobody needed (10 min).
  setInterval(() => {
    const old = Date.now() - 10 * 60_000;
    for (const [id, s] of deletedRoles) if (s.at < old) deletedRoles.delete(id);
    for (const [id, s] of deletedChannels) if (s.at < old) deletedChannels.delete(id);
  }, 60_000).unref();
}
