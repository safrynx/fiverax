import { z } from "zod";
import { FRAMEWORKS } from "./studio-shared";

/** Public directory of Fiverax servers: what the pages and the server share (no server imports here). */

export const DIRECTORY_TAGS = [
  { key: "serious", label: "RP sérieux" },
  { key: "fun", label: "RP fun" },
  { key: "whitelist", label: "Whitelist" },
  { key: "open", label: "Accès libre" },
  { key: "beginner", label: "Débutants bienvenus" },
  { key: "economy", label: "Économie poussée" },
  { key: "police", label: "Police / EMS" },
  { key: "illegal", label: "Illégal / gangs" },
  { key: "jobs", label: "Métiers" },
  { key: "custom", label: "Scripts custom" },
  { key: "cars", label: "Véhicules custom" },
  { key: "mapping", label: "Mapping custom" },
  { key: "vocal", label: "Vocal obligatoire" },
  { key: "streamers", label: "Streamers" },
  { key: "events", label: "Events réguliers" }
] as const;
export type DirectoryTag = (typeof DIRECTORY_TAGS)[number]["key"];
export const tagLabel = (key: string) => DIRECTORY_TAGS.find((t) => t.key === key)?.label ?? key;

export const LANGUAGES = [
  { key: "fr", label: "Français" },
  { key: "en", label: "English" },
  { key: "multi", label: "Multilingue" }
] as const;
export const MIN_AGES = [0, 13, 16, 18] as const;

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const CFX_RE = /^(?:https?:\/\/)?cfx\.re\/join\/([a-z0-9]{4,8})$/i;
const HOST_RE = /^([a-z0-9.-]{3,100}|\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})$/i;
const DISCORD_RE = /^(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([\w-]{2,40})$/i;

const httpsUrl = z.string().trim().max(500).refine((u) => u === "" || /^https:\/\/[^\s"'<>]+$/.test(u), "url");

export const listingSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(SLUG_RE),
  name: z.string().trim().min(2).max(60),
  tagline: z.string().trim().max(120),
  description: z.string().trim().max(5000),
  logoUrl: httpsUrl,
  bannerUrl: httpsUrl,
  gallery: z.array(httpsUrl.refine((u) => u !== "")).max(6),
  connect: z.string().trim().max(120).refine((c) => c === "" || CFX_RE.test(c) || HOST_RE.test(c), "connect"),
  discord: z.string().trim().max(120).refine((d) => d === "" || DISCORD_RE.test(d), "discord"),
  website: httpsUrl,
  tags: z.array(z.enum(DIRECTORY_TAGS.map((t) => t.key) as [DirectoryTag, ...DirectoryTag[]])).max(6),
  framework: z.enum(FRAMEWORKS.map((f) => f.key) as [string, ...string[]]),
  language: z.enum(["fr", "en", "multi"]),
  minAge: z.union([z.literal(0), z.literal(13), z.literal(16), z.literal(18)]),
  showPlayers: z.boolean()
});
export type ListingInput = z.infer<typeof listingSchema>;

/** Pure: what a listing still needs before going public (field keys). */
export function publishProblems(l: Pick<ListingInput, "tagline" | "description" | "connect" | "discord">): ("tagline" | "description" | "connect")[] {
  const out: ("tagline" | "description" | "connect")[] = [];
  if (l.tagline.trim().length < 10) out.push("tagline");
  if (l.description.trim().length < 80) out.push("description");
  if (!l.connect && !l.discord) out.push("connect");
  return out;
}

/** Pure: the link that opens FiveM on the server (cfx.re code or address). */
export function joinUrl(connect: string): string | null {
  const cfx = CFX_RE.exec(connect);
  if (cfx) return `https://cfx.re/join/${cfx[1].toLowerCase()}`;
  return HOST_RE.test(connect) ? `fivem://connect/${connect}` : null;
}

/** Pure: a clean Discord invite link. */
export function discordUrl(invite: string): string | null {
  const m = DISCORD_RE.exec(invite);
  return m ? `https://discord.gg/${m[1]}` : null;
}

/** Minimum play time on a server, as recorded by the agent, before its players may review it. */
export const MIN_REVIEW_SECONDS = 3600;
export const REVIEW_HIDE_REPORTS = 3;

export const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().min(20).max(2000)
});

export type LiveSummary = { online: boolean; players: number; maxClients: number; weekPlayers: number };
export type RatingSummary = { average: number | null; count: number; distribution: [number, number, number, number, number] };

export type DirectoryCard = {
  serverId: string;
  slug: string;
  name: string;
  tagline: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  tags: string[];
  framework: string;
  language: string;
  minAge: number;
  featured: boolean;
  live: LiveSummary | null;
  rating: RatingSummary;
  publishedAt: string | null;
  /** Votes of the current month. */
  votes: number;
};

export type PublicReview = {
  id: number;
  author: string;
  avatarUrl: string | null;
  rating: number;
  body: string;
  playtimeHours: number;
  reply: string | null;
  replyAt: string | null;
  createdAt: string;
  updatedAt: string;
  mine: boolean;
  status: "published" | "hidden" | "removed";
};

export type StatKind = "view" | "join" | "discord" | "store" | "website";
export const STAT_KINDS: readonly StatKind[] = ["view", "join", "discord", "store", "website"];

export const DIRECTORY_SORTS = ["relevance", "players", "votes", "rating", "recent"] as const;
export type DirectorySort = (typeof DIRECTORY_SORTS)[number];

/** Pure: the order of the directory. Featured first; then live players, rating weighed by its number of reviews, freshness. */
export function sortCards(cards: DirectoryCard[], sort: DirectorySort): DirectoryCard[] {
  const score = (c: DirectoryCard) => {
    const players = c.live?.online ? c.live.players : 0;
    const rating = c.rating.average ? (c.rating.average - 3) * Math.log2(1 + c.rating.count) : 0;
    return players * 2 + (c.live?.weekPlayers ?? 0) * 0.2 + rating * 10 + (c.live?.online ? 15 : 0) + Math.log2(1 + (c.votes ?? 0)) * 6;
  };
  const by: Record<DirectorySort, (a: DirectoryCard, b: DirectoryCard) => number> = {
    relevance: (a, b) => Number(b.featured) - Number(a.featured) || score(b) - score(a),
    players: (a, b) => (b.live?.online ? b.live.players : -1) - (a.live?.online ? a.live.players : -1) || score(b) - score(a),
    votes: (a, b) => (b.votes ?? 0) - (a.votes ?? 0) || score(b) - score(a),
    rating: (a, b) => (b.rating.average ?? 0) - (a.rating.average ?? 0) || b.rating.count - a.rating.count,
    recent: (a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")
  };
  return [...cards].sort(by[sort]);
}
