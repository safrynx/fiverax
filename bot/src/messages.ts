import { PermissionFlagsBits, type Guild, type GuildMember, type Message } from "discord.js";
import { attempt, getAntiraidConfig, isTrusted, observed, observing, report, type Action, type AntiraidConfig, type MessageProtection } from "./antiraid";
import { channelSpread, duplicateKey, scamDomain } from "./raid-detect";

/**
 * Message protection (Sécurité > Anti-raid > Réglages > Messages):
 *  - one member: flood, mass mentions, @everyone / @here, Discord invites and links, scam links (fake Nitro / Steam),
 *    and a hacked account posting in many channels within seconds;
 *  - several members: a copy-paste raid (the same message from many accounts within 30 s).
 * The offending messages are deleted and, except for plain invites and links, their authors muted.
 * Invites, links, scams and copy-paste raids need the Message Content intent (BOT_MESSAGE_CONTENT=1 and enabled in
 * the Developer Portal); flood, mentions and the many-channels check work without it.
 * Staff (Administrator, Manage Messages, or an ignored role) and trusted people are never checked.
 * Observation mode: everything is reported, nothing is deleted nor muted.
 */

const INVITE = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[\w-]+/i;
const LINKS = /https?:\/\/[^\s<>]+/gi;
const DUPLICATE_WINDOW_MS = 30_000;

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ");

/** Pure: the first banned word or phrase in the message (whole words, case and accents ignored), or null. */
export function bannedWord(content: string, words: string[] = []): string | null {
  if (!words.length) return null;
  const text = ` ${fold(content)} `;
  for (const word of words) {
    const needle = fold(word).trim();
    if (needle && text.includes(` ${needle} `)) return word;
  }
  return null;
}

/** Pure: does the message hold a link outside the allowed domains ("example.com" also allows its subdomains)? */
export function blockedLink(content: string, allowed: string[] = []): boolean {
  return (content.match(LINKS) ?? []).some((url) => {
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
    } catch {
      return true;
    }
    return !allowed.some((d) => host === d || host.endsWith(`.${d}`));
  });
}

/** Pure: what is wrong with this message (flood, spread and copy-paste raids are counted separately). */
export function messageViolation(
  m: { content: string; everyone: boolean; mentionCount: number },
  rules: Pick<MessageProtection, "blockEveryone" | "maxMentions" | "blockInvites" | "blockLinks"> & { blockScams?: boolean; allowedDomains?: string[]; bannedWords?: string[] }
): "scam_link" | "everyone_mention" | "mass_mention" | "banned_word" | "invite_link" | "link" | null {
  if (rules.blockScams !== false && scamDomain(m.content)) return "scam_link";
  if (rules.blockEveryone && (m.everyone || /@(everyone|here)\b/.test(m.content))) return "everyone_mention";
  if (m.mentionCount > rules.maxMentions) return "mass_mention";
  if (bannedWord(m.content, rules.bannedWords)) return "banned_word";
  if (rules.blockInvites && INVITE.test(m.content)) return "invite_link";
  if (rules.blockLinks && blockedLink(m.content, rules.allowedDomains)) return "link";
  return null;
}

type Sent = { at: number; channelId: string; id: string };
/** Recent messages of each author: guild:user -> messages */
const recent = new Map<string, Sent[]>();
/** Recent messages by content: guild:content -> messages with their author */
const copies = new Map<string, (Sent & { authorId: string })[]>();
/** One report per author (or guild, for raids) and kind every 2 minutes. */
const reported = new Map<string, number>();

const SUMMARY: Record<string, string> = {
  message_flood: "Flood de messages",
  mass_mention: "Mentions de masse",
  everyone_mention: "Tentative de @everyone / @here",
  invite_link: "Invitation vers un autre Discord",
  link: "Lien interdit",
  scam_link: "Lien d'arnaque",
  banned_word: "Mot interdit",
  account_compromised: "Compte probablement piraté",
  message_raid: "Raid de messages identiques"
};
/** Serious kinds: their author also gets the action of the settings (mute by default). Invites, links and banned words are only deleted. */
const MUTED = new Set(["message_flood", "mass_mention", "everyone_mention", "scam_link", "account_compromised", "message_raid"]);

type MessageAction = NonNullable<MessageProtection["action"]>;
const ACTION_WORDS: Record<MessageAction, string> = { delete: "", timeout: "rendu muet", kick: "expulsé", ban: "banni" };

/** The action of the settings on the author of a serious message (nothing for "delete"). */
async function sanctionAuthor(member: GuildMember, action: MessageAction, minutes: number, why: string): Promise<Action | null> {
  const reason = `Fiverax anti-raid : ${why}`;
  if (action === "timeout") return attempt("Membre rendu muet", () => member.timeout(minutes * 60_000, reason), `${minutes} min`);
  if (action === "kick") return attempt("Membre expulsé", () => member.kick(reason), member.user.tag);
  if (action === "ban") return attempt("Membre banni", () => member.ban({ reason, deleteMessageSeconds: 3600 }), member.user.tag);
  return null;
}

async function deleteMessages(guild: Guild, messages: Sent[]): Promise<number> {
  const byChannel = new Map<string, string[]>();
  for (const m of messages) byChannel.set(m.channelId, [...(byChannel.get(m.channelId) ?? []), m.id]);
  let deleted = 0;
  for (const [channelId, ids] of byChannel) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) continue;
    deleted += ids.length > 1
      ? await channel.bulkDelete(ids, true).then((r) => r.size, () => 0)
      : await channel.messages.delete(ids[0]).then(() => 1, () => 0);
  }
  return deleted;
}

const once = (key: string, now: number) => {
  if (now - (reported.get(key) ?? 0) < 120_000) return false;
  reported.set(key, now);
  return true;
};

export async function onMessage(message: Message): Promise<void> {
  if (!message.inGuild() || message.author.bot || !message.member) return;
  const guild = message.guild;
  const config = getAntiraidConfig(guild.id);
  const rules = config?.messages;
  if (!config?.enabled || !rules?.enabled || isTrusted(guild, config, message.author.id, message.member.roles.cache.keys())) return;
  if (rules.ignoredChannels.includes(message.channelId)) return;
  const member = message.member;
  if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
  if (member.roles.cache.some((r) => rules.ignoredRoles.includes(r.id))) return;

  const key = `${guild.id}:${message.author.id}`;
  const now = Date.now();
  const spreadSeconds = rules.multiChannelSeconds ?? 15;
  const list = (recent.get(key) ?? []).filter((m) => now - m.at < Math.max(rules.floodSeconds, spreadSeconds) * 1000);
  const sent: Sent = { at: now, channelId: message.channelId, id: message.id };
  list.push(sent);
  recent.set(key, list);

  // Several accounts posting the same message: a copy-paste raid.
  const copyKey = (rules.duplicateRaid ?? 0) > 0 ? duplicateKey(message.content) : null;
  if (copyKey) {
    const k = `${guild.id}:${copyKey}`;
    const same = [...(copies.get(k) ?? []).filter((m) => now - m.at < DUPLICATE_WINDOW_MS), { ...sent, authorId: message.author.id }];
    copies.set(k, same);
    const authors = [...new Set(same.map((m) => m.authorId))];
    if (authors.length >= (rules.duplicateRaid ?? 4)) {
      copies.set(k, []);
      await messageRaid(guild, config, same, authors, now);
      return;
    }
  }

  let kind: string | null = messageViolation(
    { content: message.content, everyone: message.mentions.everyone, mentionCount: message.mentions.users.size + message.mentions.roles.size },
    rules
  );
  let toDelete: Sent[] = [sent];
  const flood = list.filter((m) => now - m.at < rules.floodSeconds * 1000);
  if (!kind && flood.length > rules.floodCount) {
    kind = "message_flood";
    toDelete = flood;
  }
  // A hacked account posts its scam everywhere at once, slower than a flood but in many channels.
  if ((!kind || kind === "link" || kind === "invite_link") && (rules.multiChannel ?? 0) > 0 && channelSpread(list, spreadSeconds, now) >= (rules.multiChannel ?? 4)) {
    kind = "account_compromised";
    toDelete = list.filter((m) => now - m.at < spreadSeconds * 1000);
  }
  if (!kind) return;
  if (kind === "message_flood" || kind === "account_compromised") recent.set(key, []);

  const channelName = "name" in message.channel ? message.channel.name : "?";
  const actions: Action[] = [];
  const action: MessageAction = rules.action ?? "timeout";
  const minutes = config.timeoutMinutes ?? 60;
  const severe = MUTED.has(kind) && action !== "delete";
  if (observing(config)) {
    actions.push(observed(`aurait supprimé ${toDelete.length} message(s)${severe ? ` et ${ACTION_WORDS[action]} ${message.author.username}${action === "timeout" ? ` ${minutes} min` : ""}` : ""}`));
  } else {
    const deleted = await deleteMessages(guild, toDelete);
    actions.push({ type: "Messages supprimés", ok: deleted > 0, detail: String(deleted) });
    if (severe) {
      const sanction = await sanctionAuthor(member, action, minutes, SUMMARY[kind]);
      if (sanction) actions.push(sanction);
    }
  }

  if (!once(`${key}:${kind}`, now)) return;
  const scam = kind === "scam_link" ? scamDomain(message.content) : null;
  const word = kind === "banned_word" ? bannedWord(message.content, rules.bannedWords) : null;
  await report(guild, config, {
    kind,
    actorId: message.author.id,
    actorName: message.author.globalName || message.author.username,
    actorBot: false,
    summary: kind === "account_compromised"
      ? `${SUMMARY[kind]} : messages dans ${channelSpread(toDelete, spreadSeconds, now)} salons en ${spreadSeconds} s`
      : `${SUMMARY[kind]}${scam ? ` (${scam})` : word ? ` (« ${word} »)` : ""} dans #${channelName}`,
    details: scam ? { domain: scam } : word ? { word } : {},
    actions
  });
}

/** Same message from many accounts within 30 s: every copy deleted, every author muted, one incident. */
async function messageRaid(guild: Guild, config: AntiraidConfig, messages: (Sent & { authorId: string })[], authors: string[], now: number): Promise<void> {
  const actions: Action[] = [];
  const minutes = config.timeoutMinutes ?? 60;
  const action: MessageAction = config.messages?.action ?? "timeout";
  if (observing(config)) {
    actions.push(observed(`aurait supprimé ${messages.length} message(s)${action === "delete" ? "" : ` et ${ACTION_WORDS[action]} ${authors.length} membre(s)`}`));
  } else {
    const deleted = await deleteMessages(guild, messages);
    actions.push({ type: "Messages supprimés", ok: deleted > 0, detail: `${deleted}/${messages.length}` });
    if (action !== "delete") {
      let done = 0;
      for (const id of authors) {
        const m = await guild.members.fetch(id).catch(() => null);
        if (m && (await sanctionAuthor(m, action, minutes, "raid de messages identiques"))?.ok) done++;
      }
      actions.push({ type: `Membres ${action === "timeout" ? "rendus muets" : action === "kick" ? "expulsés" : "bannis"}`, ok: done > 0, detail: `${done}/${authors.length}${action === "timeout" ? `, ${minutes} min` : ""}` });
    }
  }
  if (!once(`${guild.id}:message_raid`, now)) return;
  await report(guild, config, {
    kind: "message_raid",
    actorId: null,
    actorName: `${authors.length} comptes`,
    actorBot: false,
    summary: `${SUMMARY.message_raid} : ${authors.length} comptes, ${messages.length} message(s) en ${Math.round((now - Math.min(...messages.map((m) => m.at))) / 1000)} s`,
    details: { authors: authors.slice(0, 50) },
    actions
  });
}

// Forget old entries now and then.
setInterval(() => {
  const now = Date.now();
  for (const [key, list] of recent) if (!list.length || now - list[list.length - 1].at > 180_000) recent.delete(key);
  for (const [key, list] of copies) if (!list.length || now - list[list.length - 1].at > DUPLICATE_WINDOW_MS) copies.delete(key);
  for (const [key, at] of reported) if (now - at > 600_000) reported.delete(key);
}, 60_000).unref();
