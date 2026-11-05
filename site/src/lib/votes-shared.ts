import { z } from "zod";

/** Votes in the public directory: what the pages and the server share (no server imports here). */

/** One vote per Discord account and per server in this window: the same for every server, so the ranking is fair. */
export const VOTE_COOLDOWN_HOURS = 2;
/** Discord accounts younger than this cannot vote (cheap protection against throwaway accounts). */
export const MIN_ACCOUNT_AGE_DAYS = 30;
/** A reward waits this long for its player to come in game, then it is dropped. */
export const REWARD_WAIT_DAYS = 7;

export const VOTE_ACCOUNTS = [
  { key: "cash", label: "liquide" },
  { key: "bank", label: "banque" },
  { key: "black_money", label: "argent sale" }
] as const;

export const voteRewardSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("money"), account: z.enum(["cash", "bank", "black_money"]), amount: z.number().int().min(1).max(10_000_000) }),
  z.object({
    type: z.literal("item"),
    item: z.string().trim().regex(/^[\w-]{1,60}$/),
    /** Shown to the players ("Pain") instead of the item name ("bread"). */
    label: z.string().trim().max(40).default(""),
    count: z.number().int().min(1).max(1000)
  })
]);
export type VoteReward = z.infer<typeof voteRewardSchema>;

export const voteSettingsSchema = z.object({
  rewardsEnabled: z.boolean().default(false),
  rewards: z.array(voteRewardSchema).max(3).default([]),
  message: z.string().trim().max(150).default("Merci pour ton vote !")
});
export type VoteSettings = z.infer<typeof voteSettingsSchema>;
export const DEFAULT_VOTE_SETTINGS: VoteSettings = voteSettingsSchema.parse({});

const groupDigits = (n: number) => String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** "5 000 $ en banque", "3 × Pain". */
export function rewardText(r: VoteReward): string {
  if (r.type === "money") return `${groupDigits(r.amount)} $${r.account === "cash" ? "" : ` (${VOTE_ACCOUNTS.find((a) => a.key === r.account)?.label})`}`;
  return `${r.count} × ${r.label || r.item}`;
}

/** Creation date of a Discord account, read from its id (snowflake). */
export function discordAccountCreatedAt(discordId: string): Date | null {
  if (!/^\d{17,20}$/.test(discordId)) return null;
  return new Date(Number(BigInt(discordId) / BigInt(4194304)) + 1420070400000); // id >> 22, plus the Discord epoch
}

export type RewardStatus = "none" | "no_player" | "pending" | "sent" | "delivered" | "failed" | "expired";
export const REWARD_LABEL: Record<RewardStatus, string> = {
  none: "Sans récompense",
  no_player: "Compte Discord pas lié en jeu",
  pending: "En attente de ta connexion",
  sent: "En cours de livraison",
  delivered: "Livrée",
  failed: "Échec de livraison",
  expired: "Expirée"
};

/** What a visitor sees around the vote button. */
export type VoteState = {
  /** Votes of the current month (all accounts). */
  month: number;
  /** Rank of the server among the listed ones this month (1 = most voted), null without votes. */
  rank: number | null;
  rewards: string[];
  message: string;
  canVote: boolean;
  reason: "login" | "cooldown" | "young_account" | "unpublished" | null;
  /** When the viewer may vote again. */
  nextAt: string | null;
  /** The viewer plays on this server with their Discord linked (the reward can be delivered). */
  linked: boolean;
};
