import { createHmac } from "node:crypto";
import { enqueueCommand, getLiveState } from "./agent";
import { auditStmt } from "./audit";
import { db, stmt } from "./db";
import {
  DEFAULT_VOTE_SETTINGS, discordAccountCreatedAt, MIN_ACCOUNT_AGE_DAYS, REWARD_WAIT_DAYS, rewardText, VOTE_COOLDOWN_HOURS, voteSettingsSchema,
  type RewardStatus, type VoteReward, type VoteSettings, type VoteState
} from "./votes-shared";

/**
 * Votes in the public directory (/annuaire/<slug>): one per Discord account and per server every VOTE_COOLDOWN_HOURS,
 * from accounts older than MIN_ACCOUNT_AGE_DAYS, one per network address in the same window (stored as a keyed hash,
 * never the address). Votes of the month rank the servers.
 *
 * Rewards: the server picks money and / or items. The voter's player on that server (Discord linked in FiveM) gets them
 * in game through the agent (command game/reward), now if they play, else at their next session (REWARD_WAIT_DAYS).
 */

export class VoteError extends Error {}
type Actor = { discordId: string; username?: string | null };
export type Voter = { discordId: string; username: string };

const iso = (d = new Date()) => d.toISOString();
const COOLDOWN_MS = VOTE_COOLDOWN_HOURS * 3600_000;
/** A reward is handed to the agent once the player has been in game this long (their character is loaded). */
const SETTLE_MS = 60_000;
const MAX_ATTEMPTS = 5;
export const VOTE_ACTOR = { discordId: "fiverax", username: "Votes Fiverax" };

export const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** Keyed hash of the voter's address: compares votes without keeping the address. */
export function ipHash(ip: string | null | undefined): string | null {
  const clean = ip?.split(",")[0]?.trim();
  if (!clean) return null;
  const secret = process.env.SESSION_SECRET || "fiverax";
  return createHmac("sha256", secret).update(`vote:${clean}`).digest("base64url").slice(0, 32);
}

// ---- settings ----

export async function getVoteSettings(serverId: string): Promise<VoteSettings> {
  const row = await db.get<{ settings_json: string }>("SELECT settings_json FROM directory_vote_settings WHERE server_id = ?", [serverId]);
  if (!row) return DEFAULT_VOTE_SETTINGS;
  try {
    return voteSettingsSchema.parse(JSON.parse(row.settings_json));
  } catch {
    return DEFAULT_VOTE_SETTINGS;
  }
}

export async function saveVoteSettings(serverId: string, actor: Actor, input: unknown, now = new Date()): Promise<VoteSettings> {
  const parsed = voteSettingsSchema.safeParse(input);
  if (!parsed.success) throw new VoteError("invalid_vote_settings");
  const settings = parsed.data;
  if (settings.rewardsEnabled && settings.rewards.length === 0) throw new VoteError("no_rewards");
  await db.batch([
    stmt(
      `INSERT INTO directory_vote_settings (server_id, settings_json, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT (server_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      [serverId, JSON.stringify(settings), iso(now), actor.discordId]
    ),
    auditStmt(serverId, actor, "vote_settings", null, { rewardsEnabled: settings.rewardsEnabled, rewards: settings.rewards.map(rewardText) })
  ]);
  return settings;
}

// ---- counts and ranking ----

/** Votes of the month for each server (listed or not). */
export async function monthlyVotes(now = new Date()): Promise<Map<string, number>> {
  const rows = await db.all<{ server_id: string; n: number }>("SELECT server_id, COUNT(*) AS n FROM directory_votes WHERE voted_at >= ? GROUP BY server_id", [iso(monthStart(now))]);
  return new Map(rows.map((r) => [r.server_id, Number(r.n)]));
}

/** Rank of a server among the published listings this month (null without votes). */
async function rankOf(serverId: string, counts: Map<string, number>): Promise<number | null> {
  const mine = counts.get(serverId) ?? 0;
  if (!mine) return null;
  const listed = await db.all<{ server_id: string }>("SELECT server_id FROM directory_listings WHERE published = 1");
  return 1 + listed.filter((l) => (counts.get(l.server_id) ?? 0) > mine).length;
}

async function lastVote(serverId: string, discordId: string): Promise<Date | null> {
  const row = await db.get<{ voted_at: string }>("SELECT voted_at FROM directory_votes WHERE server_id = ? AND discord_id = ? ORDER BY voted_at DESC LIMIT 1", [serverId, discordId]);
  return row ? new Date(row.voted_at) : null;
}

/** The voter's player on this server (Discord linked in FiveM), the most recently seen. */
async function linkedPlayer(serverId: string, discordId: string): Promise<number | null> {
  const row = await db.get<{ id: number }>("SELECT id FROM players WHERE server_id = ? AND discord_id = ? ORDER BY last_seen_at DESC LIMIT 1", [serverId, discordId]);
  return row ? Number(row.id) : null;
}

const youngAccount = (discordId: string, now: Date) => {
  const created = discordAccountCreatedAt(discordId);
  return !created || now.getTime() - created.getTime() < MIN_ACCOUNT_AGE_DAYS * 86_400_000;
};

export async function voteState(serverId: string, viewer: Voter | null, published: boolean, now = new Date()): Promise<VoteState> {
  const [settings, counts] = await Promise.all([getVoteSettings(serverId), monthlyVotes(now)]);
  const rewards = settings.rewardsEnabled ? settings.rewards.map(rewardText) : [];
  const base = { month: counts.get(serverId) ?? 0, rank: await rankOf(serverId, counts), rewards, message: settings.message };
  if (!published) return { ...base, canVote: false, reason: "unpublished", nextAt: null, linked: false };
  if (!viewer) return { ...base, canVote: false, reason: "login", nextAt: null, linked: false };
  const [last, player] = await Promise.all([lastVote(serverId, viewer.discordId), linkedPlayer(serverId, viewer.discordId)]);
  const next = last ? new Date(last.getTime() + COOLDOWN_MS) : null;
  if (next && next > now) return { ...base, canVote: false, reason: "cooldown", nextAt: iso(next), linked: Boolean(player) };
  if (youngAccount(viewer.discordId, now)) return { ...base, canVote: false, reason: "young_account", nextAt: null, linked: Boolean(player) };
  return { ...base, canVote: true, reason: null, nextAt: null, linked: Boolean(player) };
}

// ---- voting ----

export type VoteResult = { ok: true; nextAt: string; reward: RewardStatus; month: number };

export async function castVote(slug: string, voter: Voter, address: string | null, now = new Date()): Promise<VoteResult> {
  const listing = await db.get<{ server_id: string }>("SELECT server_id FROM directory_listings WHERE slug = ? AND published = 1", [slug]);
  if (!listing) throw new VoteError("unknown_listing");
  const serverId = listing.server_id;
  if (youngAccount(voter.discordId, now)) throw new VoteError("vote_young_account");
  const since = iso(new Date(now.getTime() - COOLDOWN_MS));
  const [mine, sameAddress] = await db.batch(
    [
      stmt("SELECT voted_at FROM directory_votes WHERE server_id = ? AND discord_id = ? AND voted_at > ? LIMIT 1", [serverId, voter.discordId, since]),
      stmt("SELECT 1 FROM directory_votes WHERE server_id = ? AND ip_hash = ? AND voted_at > ? AND discord_id != ? LIMIT 1", [serverId, address ?? "", since, voter.discordId])
    ],
    "read"
  );
  if (mine.rows.length) throw new VoteError("vote_cooldown");
  if (address && sameAddress.rows.length) throw new VoteError("vote_same_address");

  const [settings, playerId] = await Promise.all([getVoteSettings(serverId), linkedPlayer(serverId, voter.discordId)]);
  const rewards = settings.rewardsEnabled ? settings.rewards : [];
  const status: RewardStatus = rewards.length === 0 ? "none" : playerId ? "pending" : "no_player";
  await db.run(
    `INSERT INTO directory_votes (server_id, discord_id, username, ip_hash, voted_at, player_id, reward_status, reward_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [serverId, voter.discordId, voter.username.slice(0, 80), address, iso(now), playerId, status, rewards.length ? JSON.stringify({ rewards, message: settings.message }) : null]
  );
  let reward: RewardStatus = status;
  if (status === "pending") {
    await deliverPendingRewards(serverId, now);
    const row = await db.get<{ reward_status: RewardStatus }>("SELECT reward_status FROM directory_votes WHERE server_id = ? AND discord_id = ? ORDER BY id DESC LIMIT 1", [serverId, voter.discordId]);
    reward = row?.reward_status ?? status;
  }
  const counts = await monthlyVotes(now);
  return { ok: true, nextAt: iso(new Date(now.getTime() + COOLDOWN_MS)), reward, month: counts.get(serverId) ?? 0 };
}

// ---- rewards ----

/**
 * Hand the waiting rewards of a server to its agent, for voters in game for a minute (their character is loaded).
 * Called after a vote and when the agent sends a snapshot while rewards wait. Rewards handed over but never answered
 * go back to waiting; those older than REWARD_WAIT_DAYS expire.
 */
export async function deliverPendingRewards(serverId: string, now = new Date()): Promise<number> {
  await db.batch([
    stmt("UPDATE directory_votes SET reward_status = 'expired' WHERE server_id = ? AND reward_status = 'pending' AND voted_at < ?", [serverId, iso(new Date(now.getTime() - REWARD_WAIT_DAYS * 86_400_000))]),
    stmt(
      `UPDATE directory_votes SET reward_status = CASE WHEN reward_attempts + 1 >= ? THEN 'failed' ELSE 'pending' END, reward_attempts = reward_attempts + 1,
         reward_command_id = NULL, reward_note = 'Le serveur FiveM n''a pas répondu'
       WHERE server_id = ? AND reward_status = 'sent' AND reward_command_id IN (SELECT id FROM fivem_commands WHERE server_id = ? AND (status = 'expired' OR (status = 'sent' AND sent_at < ?)))`,
      [MAX_ATTEMPTS, serverId, serverId, iso(new Date(now.getTime() - 3 * 60_000))]
    )
  ]);
  const pending = await db.all<{ id: number; discord_id: string; reward_json: string | null }>(
    "SELECT id, discord_id, reward_json FROM directory_votes WHERE server_id = ? AND reward_status = 'pending' ORDER BY id LIMIT 30",
    [serverId]
  );
  if (!pending.length) return 0;
  const live = await getLiveState(serverId, {}, now);
  if (!live.online) return 0;
  let sent = 0;
  for (const vote of pending) {
    const player = live.players.find((p) => p.discordId === vote.discord_id && p.connectedAt && now.getTime() - new Date(p.connectedAt).getTime() >= SETTLE_MS);
    if (!player) continue;
    let data: { rewards: VoteReward[]; message: string } | null = null;
    try {
      data = vote.reward_json ? JSON.parse(vote.reward_json) : null;
    } catch { /* corrupt: dropped below */ }
    if (!data?.rewards?.length) {
      await db.run("UPDATE directory_votes SET reward_status = 'failed', reward_note = 'Récompense illisible' WHERE id = ?", [vote.id]);
      continue;
    }
    const commandId = await enqueueCommand(
      serverId, VOTE_ACTOR, "game",
      { op: "reward", target: player.id, message: data.message, rewards: data.rewards.map((r) => (r.type === "item" ? { ...r, label: r.label || r.item } : r)) },
      { playerName: player.name, targetDiscordId: player.discordId }
    );
    await db.run("UPDATE directory_votes SET reward_status = 'sent', reward_command_id = ? WHERE id = ? AND reward_status = 'pending'", [commandId, vote.id]);
    sent++;
  }
  return sent;
}

/** Statements recording the agent's answers to reward commands (run with the agent's other writes). */
export function rewardResultStmts(serverId: string, results: { id: number; ok: boolean; message?: string }[], now = new Date()) {
  return results.map((r) =>
    stmt(
      `UPDATE directory_votes SET
         reward_status = CASE WHEN ? = 1 THEN 'delivered' WHEN reward_attempts + 1 >= ? THEN 'failed' ELSE 'pending' END,
         reward_attempts = reward_attempts + 1, reward_note = ?, rewarded_at = CASE WHEN ? = 1 THEN ? ELSE rewarded_at END,
         reward_command_id = CASE WHEN ? = 1 THEN reward_command_id ELSE NULL END
       WHERE server_id = ? AND reward_command_id = ? AND reward_status = 'sent'`,
      [r.ok ? 1 : 0, MAX_ATTEMPTS, r.message?.slice(0, 300) ?? null, r.ok ? 1 : 0, iso(now), r.ok ? 1 : 0, serverId, r.id]
    )
  );
}

// ---- what the staff and the voters see ----

export type VoteRow = { id: number; username: string; votedAt: string; reward: RewardStatus; note: string | null };

export async function votesForStaff(serverId: string, now = new Date()) {
  const counts = await monthlyVotes(now);
  const [recent, top, previous] = await db.batch(
    [
      stmt("SELECT id, username, voted_at, reward_status, reward_note FROM directory_votes WHERE server_id = ? ORDER BY id DESC LIMIT 40", [serverId]),
      stmt(
        "SELECT username, COUNT(*) AS n FROM directory_votes WHERE server_id = ? AND voted_at >= ? GROUP BY discord_id ORDER BY n DESC LIMIT 10",
        [serverId, iso(monthStart(now))]
      ),
      stmt("SELECT COUNT(*) AS n FROM directory_votes WHERE server_id = ? AND voted_at >= ? AND voted_at < ?", [
        serverId, iso(monthStart(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)))), iso(monthStart(now))
      ])
    ],
    "read"
  );
  return {
    month: counts.get(serverId) ?? 0,
    previousMonth: Number(previous.rows[0]?.n ?? 0),
    rank: await rankOf(serverId, counts),
    recent: recent.rows.map((r) => ({
      id: Number(r.id), username: String(r.username), votedAt: String(r.voted_at), reward: r.reward_status as RewardStatus, note: (r.reward_note as string | null) ?? null
    })) as VoteRow[],
    top: top.rows.map((r) => ({ username: String(r.username), votes: Number(r.n) }))
  };
}

/** A voter's votes on every server (player portal). */
export async function votesBy(discordId: string, limit = 30) {
  const rows = await db.all<{ server_id: string; voted_at: string; reward_status: RewardStatus; reward_json: string | null }>(
    "SELECT server_id, voted_at, reward_status, reward_json FROM directory_votes WHERE discord_id = ? ORDER BY id DESC LIMIT ?",
    [discordId, limit]
  );
  return rows.map((r) => {
    let rewards: string[] = [];
    try {
      rewards = r.reward_json ? (JSON.parse(r.reward_json) as { rewards: VoteReward[] }).rewards.map(rewardText) : [];
    } catch { /* none */ }
    return { serverId: r.server_id, votedAt: r.voted_at, reward: r.reward_status, rewards };
  });
}
