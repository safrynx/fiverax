/**
 * Pure detectors of the anti-raid (no Discord calls, tested): waves of suspicious newcomers, scam links (fake Nitro /
 * Steam), copy-paste raids and hacked accounts spamming every channel.
 */

const DAY = 86_400_000;

// ---- joins ----

export type Join = { id: string; at: number; suspicion: number; base: string };

/** Pure: a name without digits, separators, accents nor case ("xX_Raïder_042" → "xxraider"), to spot look-alikes. */
export const nameBase = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "");

/**
 * Pure: how suspicious a newcomer looks, 0 to 4: account younger than a day (+2) or a week (+1), no avatar (+1), name
 * looking like the names of two other recent newcomers (+1). Raid accounts are made in bulk, minutes before.
 */
export function joinSuspicion(user: { createdAt: number; hasAvatar: boolean; name: string }, recentBases: string[], now: number): number {
  const age = now - user.createdAt;
  let score = age < DAY ? 2 : age < 7 * DAY ? 1 : 0;
  if (!user.hasAvatar) score++;
  const base = nameBase(user.name);
  if (base.length >= 3 && recentBases.filter((b) => b === base).length >= 2) score++;
  return score;
}

/**
 * Pure: the raiders, or null. Too many joins in the window (any accounts), or, with `smart`, a wave of suspicious
 * accounts (score ≥ 2) within a minute: half the tolerated joins, 3 at least. Slow raids stay under a count limit.
 */
export function raidWave(joins: Join[], cfg: { joins: number; windowSec: number; smart?: boolean }, now: number): Join[] | null {
  const inWindow = joins.filter((j) => now - j.at < cfg.windowSec * 1000);
  const wave = cfg.smart ? joins.filter((j) => now - j.at < Math.max(cfg.windowSec, 60) * 1000 && j.suspicion >= 2) : [];
  const counted = inWindow.length > cfg.joins;
  const smart = wave.length >= Math.max(3, Math.ceil(cfg.joins / 2));
  if (!counted && !smart) return null;
  const all = new Map<string, Join>();
  for (const j of [...(counted ? inWindow : []), ...wave]) all.set(j.id, j);
  return [...all.values()];
}

// ---- scam links ----

/** Domains a link may point to without being a scam, whatever it looks like. */
const OFFICIAL = [
  "discord.com", "discord.gg", "discordapp.com", "discordapp.net", "discord.media", "discord.gift", "discord.new", "discordstatus.com",
  "steamcommunity.com", "steampowered.com", "steamstatic.com", "steamchina.com", "fivem.net", "cfx.re", "tebex.io"
];
const BRANDS = ["discord", "steamcommunity", "steampowered"];
const BAIT = ["nitro", "gift", "free", "airdrop", "promo", "claim", "giveaway", "trade", "drop"];

/** Optimal string alignment distance (Levenshtein + adjacent swaps): "discrod" is 1 away from "discord". */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Characters scammers swap for look-alikes: "dlscord", "disc0rd", "stearncommunity", "discorcl". */
const unglyph = (s: string) => s.replace(/rn/g, "m").replace(/vv/g, "w").replace(/cl/g, "d").replace(/[1l|!]/g, "i").replace(/0/g, "o").replace(/3/g, "e").replace(/5/g, "s");

/** Does this domain label imitate a brand (look-alike), rather than contain it plainly? */
function imitates(label: string): boolean {
  const flat = label.replace(/[^a-z0-9]/g, "");
  const clean = unglyph(flat);
  for (const brand of BRANDS) {
    if (!flat.includes(brand) && clean.includes(unglyph(brand))) return true;
    const tolerance = brand.length >= 10 ? 2 : 1;
    for (let size = brand.length - 1; size <= brand.length + 1; size++) {
      for (let start = 0; start + size <= flat.length; start++) {
        const part = flat.slice(start, start + size);
        const d = distance(part, brand);
        if (d > 0 && d <= tolerance && !flat.includes(brand)) return true;
      }
    }
  }
  return false;
}

/**
 * Pure: the domain of a scam link in a message, or null. A look-alike of Discord or Steam ("dlscord.gift",
 * "steamcomrnunity.com"), a domain carrying the brand with bait words ("discord-nitro.ru", "steamcommunity-trade.xyz"),
 * or a "free nitro" domain. Official domains (discord.com, discord.gift, steamcommunity.com…) are never flagged.
 */
export function scamDomain(content: string): string | null {
  const text = content.toLowerCase();
  const baitInText = /\b(nitro|free|gratuit|gift|cadeau|airdrop|giveaway)\b/.test(text);
  for (const m of text.matchAll(/(?:https?:\/\/|www\.)([a-z0-9.-]+\.[a-z]{2,})/g)) {
    const host = m[1].replace(/^www\./, "").replace(/\.+$/, "");
    if (OFFICIAL.some((o) => host === o || host.endsWith(`.${o}`))) continue;
    const labels = host.split(".").slice(0, -1);
    for (const label of labels) {
      const flat = label.replace(/[^a-z0-9]/g, "");
      if (imitates(label)) return host;
      const bait = BAIT.some((b) => flat.includes(b));
      if (BRANDS.some((b) => flat.includes(b)) && (bait || baitInText)) return host;
      // "free-nitro.ru", "nitrogift.com"; not "nitrous-racing.com".
      if (flat.includes("nitro") && (BAIT.some((b) => b !== "nitro" && flat.includes(b)) || baitInText)) return host;
    }
  }
  return null;
}

// ---- copy-paste raids ----

/**
 * Pure: the key of a message for copy-paste raid detection, or null for short everyday messages ("salut", "gg"):
 * many people saying the same short thing at once is normal. Mentions and invisible characters are ignored.
 */
export function duplicateKey(content: string): string | null {
  const s = content
    .toLowerCase()
    .replace(/<@[!&]?\d+>/g, "@")
    .replace(/[​-‏⁠﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length < 20 && !/https?:\/\/|discord\.gg\//.test(s)) return null;
  return s.slice(0, 500);
}

/** Pure: how many different channels these messages were posted in within the last `seconds`. */
export function channelSpread(messages: { at: number; channelId: string }[], seconds: number, now: number): number {
  return new Set(messages.filter((m) => now - m.at < seconds * 1000).map((m) => m.channelId)).size;
}
