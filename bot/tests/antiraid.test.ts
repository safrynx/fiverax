import { test } from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";

process.env.SITE_URL = "http://site.test";
process.env.BOT_API_TOKEN = "secret";

const { Tracker, addedDangerous, isDangerous } = await import("../src/antiraid");

const item = (label: string) => ({ at: 0, undo: null, label });

test("tracker: tolerated actions pass, the one past the limit undoes the whole window, then each new one at once", () => {
  const t = new Tracker();
  const rule = { enabled: true, max: 2, windowSec: 60 };
  const now = 1_000_000;
  assert.equal(t.push("g:a:ban", rule, item("1"), now).triggered, false);
  assert.equal(t.push("g:a:ban", rule, item("2"), now + 1000).triggered, false);
  const third = t.push("g:a:ban", rule, item("3"), now + 2000);
  assert.deepEqual([third.triggered, third.firstTrigger, third.toUndo.map((i) => i.label)], [true, true, ["1", "2", "3"]]);
  const fourth = t.push("g:a:ban", rule, item("4"), now + 3000);
  assert.deepEqual([fourth.triggered, fourth.firstTrigger, fourth.toUndo.map((i) => i.label)], [true, false, ["4"]]);
  // Another author, another rule: counted apart.
  assert.equal(t.push("g:b:ban", rule, item("x"), now).triggered, false);
});

test("tracker: max 0 triggers on the first action; old actions leave the window", () => {
  const t = new Tracker();
  assert.equal(t.push("g:a:role_delete", { enabled: true, max: 0, windowSec: 60 }, item("r"), 0).firstTrigger, true);
  const rule = { enabled: true, max: 1, windowSec: 10 };
  t.push("g:c:kick", rule, item("1"), 0);
  assert.equal(t.push("g:c:kick", rule, item("2"), 11_000).triggered, false); // the first one is 11 s old
  assert.equal(t.push("g:c:kick", rule, item("3"), 12_000).triggered, true);
});

test("dangerous permissions", () => {
  assert.equal(isDangerous(PermissionFlagsBits.Administrator), true);
  assert.equal(isDangerous(PermissionFlagsBits.SendMessages | PermissionFlagsBits.Connect), false);
  const base = PermissionFlagsBits.SendMessages;
  assert.equal(addedDangerous(base, base | PermissionFlagsBits.BanMembers), true);
  assert.equal(addedDangerous(String(base | PermissionFlagsBits.ManageRoles), String(base | PermissionFlagsBits.ManageRoles)), false); // already had it
  assert.equal(addedDangerous(base | PermissionFlagsBits.Administrator, base), false); // removing is fine
});

test("message protection: @everyone, mass mentions, invites and links, each only when enabled", async () => {
  const { messageViolation } = await import("../src/messages");
  const rules = { blockEveryone: true, maxMentions: 5, blockInvites: true, blockLinks: false };
  const msg = (content: string, mentionCount = 0, everyone = false) => ({ content, mentionCount, everyone });
  assert.equal(messageViolation(msg("salut @everyone"), rules), "everyone_mention");
  assert.equal(messageViolation(msg("", 0, true), rules), "everyone_mention");
  assert.equal(messageViolation(msg("hey", 6), rules), "mass_mention");
  assert.equal(messageViolation(msg("hey", 5), rules), null);
  assert.equal(messageViolation(msg("rejoins discord.gg/abc123"), rules), "invite_link");
  assert.equal(messageViolation(msg("https://youtube.com/x"), rules), null);
  assert.equal(messageViolation(msg("https://youtube.com/x"), { ...rules, blockLinks: true }), "link");
  assert.equal(messageViolation(msg("@here"), { ...rules, blockEveryone: false }), null);
});

test("restore order: categories before their channels, then by position", async () => {
  const { channelOrder } = await import("../src/backup");
  const ch = (id: string, type: number, position: number) => ({ id, name: id, type, parentId: null, position, overwrites: [] });
  assert.deepEqual(channelOrder([ch("text2", 0, 2), ch("cat", 4, 5), ch("text1", 0, 1), ch("cat0", 4, 0)]).map((c) => c.id), ["cat0", "cat", "text1", "text2"]);
});

test("per-server settings: banned words, allowed domains, DM text, per-rule sanction, trusted roles", async () => {
  const { bannedWord, blockedLink, messageViolation } = await import("../src/messages");
  const { dmText, isTrusted, sanctionFor } = await import("../src/antiraid");

  // Banned words: whole words or phrases, case and accents ignored.
  assert.equal(bannedWord("Tu es un GROS Nul", ["gros nul"]), "gros nul");
  assert.equal(bannedWord("Réglé !", ["regle"]), "regle");
  assert.equal(bannedWord("grosnul", ["gros nul"]), null);
  assert.equal(bannedWord("classe", ["ass"]), null); // never inside another word
  assert.equal(bannedWord("salut", []), null);

  // Links: blocked unless every link is on an allowed domain (subdomains included).
  assert.equal(blockedLink("voir https://youtube.com/x", ["youtube.com"]), false);
  assert.equal(blockedLink("voir https://www.youtube.com/x", ["youtube.com"]), false);
  assert.equal(blockedLink("voir https://notyoutube.com/x", ["youtube.com"]), true);
  assert.equal(blockedLink("https://youtube.com/a https://evil.gg/b", ["youtube.com"]), true);
  assert.equal(blockedLink("pas de lien", []), false);
  const rules = { blockEveryone: true, maxMentions: 5, blockInvites: false, blockLinks: true, allowedDomains: ["tebex.io"], bannedWords: ["nul"] };
  const msg = (content: string) => ({ content, mentionCount: 0, everyone: false });
  assert.equal(messageViolation(msg("boutique https://monserveur.tebex.io"), rules), null);
  assert.equal(messageViolation(msg("https://autre.com"), rules), "link");
  assert.equal(messageViolation(msg("t'es nul"), rules), "banned_word");

  // Private message before a sanction.
  assert.equal(dmText("", { server: "LS RP", reason: "bans en masse", sanction: "expulsion" }), "Tu as été sanctionné sur LS RP par la protection anti-raid (expulsion) : bans en masse.");
  assert.equal(dmText("{serveur} : {sanction} ({raison})", { server: "LS", reason: "x", sanction: "mute" }), "LS : mute (x)");

  // Per-rule sanction: its own, the general one, or none.
  const config = {
    enabled: true, punishment: "derank" as const, trustOwner: true, trusted: ["1"], trustedRoles: ["role-staff"], alertChannelId: null, minAccountAgeDays: 0,
    joinRaid: { enabled: true, joins: 10, windowSec: 10, lockdownMinutes: 10 },
    rules: { ban: { enabled: true, max: 2, windowSec: 60, punishment: "ban" as const }, kick: { enabled: true, max: 3, windowSec: 60, punishment: "default" as const }, prune: { enabled: true, max: 0, windowSec: 60, punishment: "none" as const } }
  };
  assert.equal(sanctionFor(config, "ban"), "ban");
  assert.equal(sanctionFor(config, "kick"), "derank");
  assert.equal(sanctionFor(config, "prune"), "none");
  assert.equal(sanctionFor(config, "role_delete"), "derank");

  // Trusted people and trusted roles.
  const guild = { client: { user: { id: "bot" } }, ownerId: "owner" } as never;
  assert.equal(isTrusted(guild, config, "1"), true);
  assert.equal(isTrusted(guild, config, "owner"), true);
  assert.equal(isTrusted(guild, config, "2"), false);
  assert.equal(isTrusted(guild, config, "2", ["role-staff"]), true);
  assert.equal(isTrusted(guild, config, "2", ["role-other"]), false);
});

test("presence: the status and activity chosen on the site, {serveurs} filled in, custom status, nothing on a bad setting", async () => {
  const { ActivityType } = await import("discord.js");
  const { presenceData } = await import("../src/presence");
  assert.deepEqual(presenceData({ status: "online", activityType: "watching", activityText: "{serveurs} serveurs FiveM" }, 12), {
    status: "online", activities: [{ type: ActivityType.Watching, name: "12 serveurs FiveM" }]
  });
  assert.deepEqual(presenceData({ status: "dnd", activityType: "custom", activityText: "Protège {serveurs} serveurs" }, 3), {
    status: "dnd", activities: [{ type: ActivityType.Custom, name: "Custom Status", state: "Protège 3 serveurs" }]
  });
  assert.deepEqual(presenceData({ status: "idle", activityType: "none", activityText: "x" }, 1), { status: "idle", activities: [] });
  assert.deepEqual(presenceData({ status: "sleeping", activityType: "playing", activityText: "  " }, 1), { status: "online", activities: [] });
  assert.equal(presenceData(null, 1), null);
  assert.equal(presenceData(undefined, 1), null);
});
