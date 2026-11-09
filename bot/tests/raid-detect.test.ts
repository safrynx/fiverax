import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SITE_URL = "http://site.test";
process.env.BOT_API_TOKEN = "secret";

const { channelSpread, duplicateKey, joinSuspicion, nameBase, raidWave, scamDomain } = await import("../src/raid-detect");
const { messageViolation } = await import("../src/messages");

const DAY = 86_400_000;
const now = 1_800_000_000_000;

test("joins: suspicion from account age, avatar and look-alike names", () => {
  assert.equal(nameBase("xX_Raïder_042"), "xxraider");
  assert.equal(joinSuspicion({ createdAt: now - 2 * 3600_000, hasAvatar: false, name: "raider77" }, ["raider", "raider"], now), 4);
  assert.equal(joinSuspicion({ createdAt: now - 3 * DAY, hasAvatar: true, name: "Lucas" }, [], now), 1);
  assert.equal(joinSuspicion({ createdAt: now - 400 * DAY, hasAvatar: true, name: "Lucas" }, ["lucas"], now), 0); // one look-alike is a coincidence
});

test("joins: a burst over the limit, or a slower wave of fresh accounts (smart)", () => {
  const join = (i: number, secondsAgo: number, suspicion: number) => ({ id: String(i), at: now - secondsAgo * 1000, suspicion, base: "x" });
  const cfg = { joins: 10, windowSec: 10 };
  // 11 normal accounts in 10 s: raid whatever their look.
  assert.equal(raidWave(Array.from({ length: 11 }, (_, i) => join(i, 2, 0)), cfg, now)?.length, 11);
  // 5 fresh accounts over 50 s: under the count, caught only by the smart check.
  const slow = Array.from({ length: 5 }, (_, i) => join(i, i * 10, 3));
  assert.equal(raidWave(slow, cfg, now), null);
  assert.equal(raidWave(slow, { ...cfg, smart: true }, now)?.length, 5);
  // Normal newcomers trickling in never trigger it.
  assert.equal(raidWave(Array.from({ length: 8 }, (_, i) => join(i, i * 7, 1)), { ...cfg, smart: true }, now), null);
});

test("scam links: look-alikes and bait domains, never the official ones nor ordinary links", () => {
  for (const [text, host] of [
    ["Free nitro https://dlscord.gift/xyz", "dlscord.gift"],
    ["https://discorcl-app.com/login", "discorcl-app.com"],
    ["claim it https://steamcomrnunity.com/tradeoffer", "steamcomrnunity.com"],
    ["https://steamcommunlty.ru/id/x", "steamcommunlty.ru"],
    ["https://discord-nitro.ru/gift", "discord-nitro.ru"],
    ["https://free-nitro.xyz", "free-nitro.xyz"],
    ["cadeau www.discrod.com/airdrop", "discrod.com"]
  ] as const) assert.equal(scamDomain(text), host, text);
  for (const text of [
    "rejoins https://discord.gg/abcdef", "https://discord.com/channels/1/2", "https://discord.gift/AbCdEf", "https://steamcommunity.com/id/x",
    "https://store.steampowered.com/app/271590", "https://cfx.re/join/abc123", "https://youtube.com/watch?v=1", "https://disboard.org/server/1",
    "https://nitrous-racing.com", "regarde https://discords.com/servers/x", "pas de lien ici"
  ]) assert.equal(scamDomain(text), null, text);
  assert.equal(messageViolation({ content: "nitro gratuit https://dlscord.gift/x @everyone", everyone: true, mentionCount: 0 }, { blockEveryone: true, maxMentions: 5, blockInvites: false, blockLinks: false }), "scam_link");
  assert.equal(messageViolation({ content: "https://dlscord.gift/x", everyone: false, mentionCount: 0 }, { blockEveryone: true, maxMentions: 5, blockInvites: false, blockLinks: false, blockScams: false }), null);
});

test("copy-paste raids and hacked accounts", () => {
  assert.equal(duplicateKey("salut"), null); // short everyday messages are not a raid
  assert.equal(duplicateKey("gg"), null);
  assert.equal(duplicateKey("Rejoins vite https://x.y"), duplicateKey("rejoins   vite https://x.y​"));
  assert.equal(duplicateKey("<@123456789012345678> regarde ce serveur incroyable"), duplicateKey("<@!987654321098765432> regarde ce serveur incroyable"));
  const msgs = ["a", "b", "c", "d", "a"].map((channelId, i) => ({ at: now - i * 2000, channelId }));
  assert.equal(channelSpread(msgs, 15, now), 4);
  assert.equal(channelSpread(msgs, 3, now), 2);
});
