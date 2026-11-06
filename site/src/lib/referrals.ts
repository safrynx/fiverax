import { randomBytes } from "node:crypto";
import { auditStmt } from "./audit";
import { db, stmt } from "./db";
import { addFeatured } from "./directory";
import {
  ambassadorTier, milestoneBonus, QUALIFY_PLAYERS, QUALIFY_WITHIN_DAYS, REFERRAL_CODE_RE, REFERRAL_DAYS, referralProgress, WELCOME_DAYS,
  type ReferralStatus
} from "./referrals-shared";
import { getServer } from "./servers";

/**
 * Referrals between servers (rules in lib/referrals-shared.ts). The featured days earned are a ledger per server
 * (referral, welcome, milestone, redeem): the balance is its sum, spent as "À la une" slots of the directory.
 *
 * Abuse: a server cannot refer itself, nor be referred by a server its creator owns; one referrer per server; a
 * referral only counts once the new server runs with real players (agent + distinct players).
 */

export class ReferralError extends Error {}
type Actor = { discordId: string; username?: string | null };
const iso = (d = new Date()) => d.toISOString();
const DAY = 86_400_000;
export const REFERRAL_ACTOR = { discordId: "fiverax", username: "Parrainage Fiverax" };

/** The server's referral code, created the first time it is asked for. */
export async function ensureCode(serverId: string, now = new Date()): Promise<string> {
  const row = await db.get<{ code: string }>("SELECT code FROM referral_codes WHERE server_id = ?", [serverId]);
  if (row) return row.code;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = BigInt(`0x${randomBytes(6).toString("hex")}`).toString(36).slice(0, 8).padStart(8, "0");
    const { changes } = await db.run("INSERT OR IGNORE INTO referral_codes (server_id, code, created_at) VALUES (?, ?, ?)", [serverId, code, iso(now)]);
    if (changes) return code;
    const again = await db.get<{ code: string }>("SELECT code FROM referral_codes WHERE server_id = ?", [serverId]);
    if (again) return again.code;
  }
  throw new ReferralError("code_failed");
}

export const referralLink = (code: string) => `${(process.env.APP_URL || "").replace(/\/+$/, "")}/r/${code}`;

/** A click on a referral link: true when the code exists (the cookie is then set by the route). */
export async function countClick(code: string): Promise<boolean> {
  if (!REFERRAL_CODE_RE.test(code)) return false;
  const { changes } = await db.run("UPDATE referral_codes SET clicks = clicks + 1 WHERE code = ?", [code]);
  return changes > 0;
}

/** A server was just registered by `creator` after following a referral link. Silent no-op when it cannot count. */
export async function recordReferral(code: string | null | undefined, referredServerId: string, creator: string, now = new Date()): Promise<boolean> {
  if (!code || !REFERRAL_CODE_RE.test(code)) return false;
  const ref = await db.get<{ server_id: string }>("SELECT server_id FROM referral_codes WHERE code = ?", [code]);
  if (!ref || ref.server_id === referredServerId) return false;
  const [referrer, owners] = await Promise.all([
    db.get<{ created_by: string | null }>("SELECT created_by FROM servers WHERE id = ?", [ref.server_id]),
    db.get<{ n: number }>("SELECT COUNT(*) AS n FROM server_owners WHERE server_id = ? AND discord_id = ?", [ref.server_id, creator])
  ]);
  if (!referrer || referrer.created_by === creator || Number(owners?.n ?? 0) > 0) return false;
  const { changes } = await db.run(
    "INSERT OR IGNORE INTO referrals (referrer_server_id, referred_server_id, referred_by, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
    [ref.server_id, referredServerId, creator, iso(now)]
  );
  return changes > 0;
}

type ReferralRow = { id: number; referrer_server_id: string; referred_server_id: string; status: ReferralStatus; created_at: string; qualified_at: string | null };

async function progressOf(serverId: string): Promise<{ agentSeen: boolean; players: number }> {
  const [agent, players] = await db.batch(
    [
      stmt("SELECT 1 FROM fivem_state WHERE server_id = ?", [serverId]),
      stmt("SELECT COUNT(DISTINCT player_id) AS n FROM player_sessions WHERE server_id = ?", [serverId])
    ],
    "read"
  );
  return { agentSeen: agent.rows.length > 0, players: Number(players.rows[0]?.n ?? 0) };
}

/**
 * Validate the pending referrals that now qualify, expire the too old ones. Idempotent (each referral changes status
 * once, and only that change writes the ledger). Called by the tick, and by the referral page for its server.
 */
export async function qualifyPending(opts: { serverId?: string } = {}, now = new Date()): Promise<number> {
  const rows = await db.all<ReferralRow>(
    `SELECT id, referrer_server_id, referred_server_id, status, created_at, qualified_at FROM referrals WHERE status = 'pending'
     ${opts.serverId ? "AND (referrer_server_id = ? OR referred_server_id = ?)" : ""} ORDER BY id LIMIT 200`,
    opts.serverId ? [opts.serverId, opts.serverId] : []
  );
  let qualified = 0;
  for (const r of rows) {
    if (!(await getServer(r.referred_server_id))) continue;
    const progress = await progressOf(r.referred_server_id);
    if (referralProgress(progress).done) {
      const { changes } = await db.run("UPDATE referrals SET status = 'qualified', qualified_at = ? WHERE id = ? AND status = 'pending'", [iso(now), r.id]);
      if (!changes) continue;
      qualified++;
      const count = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM referrals WHERE referrer_server_id = ? AND status = 'qualified'", [r.referrer_server_id]);
      const bonus = milestoneBonus(Number(count?.n ?? 0));
      const ledger = (serverId: string, days: number, kind: string, note: string) =>
        stmt("INSERT INTO referral_ledger (server_id, days, kind, referral_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?)", [serverId, days, kind, r.id, note, iso(now)]);
      const referred = await getServer(r.referred_server_id);
      const referrer = await getServer(r.referrer_server_id);
      await db.batch([
        ledger(r.referrer_server_id, REFERRAL_DAYS, "referral", `Parrainage validé : ${referred?.name ?? r.referred_server_id}`),
        ledger(r.referred_server_id, WELCOME_DAYS, "welcome", `Bienvenue, parrainé par ${referrer?.name ?? r.referrer_server_id}`),
        ...(bonus ? [ledger(r.referrer_server_id, bonus, "milestone", `Palier de ${Number(count?.n)} parrainages`)] : []),
        auditStmt(r.referrer_server_id, REFERRAL_ACTOR, "referral_qualified", null, { serveur: referred?.name ?? r.referred_server_id, jours: REFERRAL_DAYS + bonus })
      ]);
    } else if (now.getTime() - new Date(r.created_at).getTime() > QUALIFY_WITHIN_DAYS * DAY) {
      await db.run("UPDATE referrals SET status = 'expired', reason = ? WHERE id = ? AND status = 'pending'", [`Pas actif après ${QUALIFY_WITHIN_DAYS} jours`, r.id]);
    }
  }
  return qualified;
}

export async function balanceOf(serverId: string): Promise<number> {
  const row = await db.get<{ days: number | null }>("SELECT SUM(days) AS days FROM referral_ledger WHERE server_id = ?", [serverId]);
  return Number(row?.days ?? 0);
}

export type ReferralOverview = {
  code: string;
  link: string;
  clicks: number;
  balance: number;
  qualified: number;
  tier: ReturnType<typeof ambassadorTier>;
  referredBy: { name: string; status: ReferralStatus } | null;
  referrals: { id: number; name: string; status: ReferralStatus; createdAt: string; qualifiedAt: string | null; progress: ReturnType<typeof referralProgress> | null }[];
  ledger: { id: number; days: number; kind: string; note: string | null; createdAt: string }[];
};

export async function referralOverview(serverId: string, now = new Date()): Promise<ReferralOverview> {
  await qualifyPending({ serverId }, now);
  const code = await ensureCode(serverId, now);
  const [codeRow, rows, ledger, by] = await Promise.all([
    db.get<{ clicks: number }>("SELECT clicks FROM referral_codes WHERE server_id = ?", [serverId]),
    db.all<ReferralRow>("SELECT id, referrer_server_id, referred_server_id, status, created_at, qualified_at FROM referrals WHERE referrer_server_id = ? ORDER BY id DESC LIMIT 100", [serverId]),
    db.all<{ id: number; days: number; kind: string; note: string | null; created_at: string }>("SELECT id, days, kind, note, created_at FROM referral_ledger WHERE server_id = ? ORDER BY id DESC LIMIT 30", [serverId]),
    db.get<{ referrer_server_id: string; status: ReferralStatus }>("SELECT referrer_server_id, status FROM referrals WHERE referred_server_id = ?", [serverId])
  ]);
  const referrals: ReferralOverview["referrals"] = [];
  for (const r of rows) {
    const server = await getServer(r.referred_server_id);
    referrals.push({
      id: Number(r.id), name: server?.name ?? "Serveur supprimé", status: r.status, createdAt: r.created_at, qualifiedAt: r.qualified_at,
      progress: r.status === "pending" && server ? referralProgress(await progressOf(r.referred_server_id)) : null
    });
  }
  const qualified = rows.filter((r) => r.status === "qualified").length;
  const referrer = by ? await getServer(by.referrer_server_id) : null;
  return {
    code,
    link: referralLink(code),
    clicks: Number(codeRow?.clicks ?? 0),
    balance: ledger.length ? await balanceOf(serverId) : 0,
    qualified,
    tier: ambassadorTier(qualified),
    referredBy: by ? { name: referrer?.name ?? "Serveur supprimé", status: by.status } : null,
    referrals,
    ledger: ledger.map((l) => ({ id: Number(l.id), days: Number(l.days), kind: l.kind, note: l.note, createdAt: l.created_at }))
  };
}

/** Spend earned days as a featured slot of the directory (the listing must be published). */
export async function redeemDays(serverId: string, actor: Actor, days: number, now = new Date()): Promise<{ balance: number }> {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new ReferralError("invalid_days");
  const listing = await db.get<{ published: number }>("SELECT published FROM directory_listings WHERE server_id = ?", [serverId]);
  if (!listing?.published) throw new ReferralError("listing_not_published");
  // Debit first, only if the balance covers it (one statement: two clicks cannot spend the same days).
  const { changes } = await db.run(
    `INSERT INTO referral_ledger (server_id, days, kind, note, actor_discord_id, created_at)
     SELECT ?, ?, 'redeem', ?, ?, ? WHERE (SELECT COALESCE(SUM(days), 0) FROM referral_ledger WHERE server_id = ?) >= ?`,
    [serverId, -days, `${days} jour${days > 1 ? "s" : ""} à la une`, actor.discordId, iso(now), serverId, days]
  );
  if (!changes) throw new ReferralError("not_enough_days");
  try {
    await addFeatured(serverId, actor, days, "Jours gagnés par le parrainage", now, "referral");
  } catch (error) {
    await db.run("INSERT INTO referral_ledger (server_id, days, kind, note, created_at) VALUES (?, ?, 'refund', 'Remboursé : mise en avant impossible', ?)", [serverId, days, iso(now)]);
    throw error;
  }
  return { balance: await balanceOf(serverId) };
}

/** Ambassador titles of several servers (directory): servers with at least the first milestone. */
export async function ambassadors(serverIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!serverIds.length) return out;
  const rows = await db.all<{ referrer_server_id: string; n: number }>(
    `SELECT referrer_server_id, COUNT(*) AS n FROM referrals WHERE status = 'qualified' AND referrer_server_id IN (${serverIds.map(() => "?").join(", ")}) GROUP BY referrer_server_id`,
    serverIds
  );
  for (const r of rows) {
    const tier = ambassadorTier(Number(r.n));
    if (tier) out.set(r.referrer_server_id, tier.label);
  }
  return out;
}

/** Who invited the visitor (shown on the server list before they add their server). */
export async function referrerOfCode(code: string | null | undefined): Promise<string | null> {
  if (!code || !REFERRAL_CODE_RE.test(code)) return null;
  const row = await db.get<{ server_id: string }>("SELECT server_id FROM referral_codes WHERE code = ?", [code]);
  return row ? (await getServer(row.server_id))?.name ?? null : null;
}
