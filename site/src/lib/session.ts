import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { db } from "./db";

const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours

export type SessionPayload = {
  discordId: string;
  username: string;
  avatarUrl: string | null;
  /** Roles of the single-server version; ignored now (roles are resolved per server). */
  roles?: string[];
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 characters long");
  }
  return secret;
}

function sign(data: string): string {
  return createHmac("sha256", getSecret()).update(data).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Encode a session as `<payload-b64url>.<hmac>` */
export function encodeSession(payload: Omit<SessionPayload, "issuedAt" | "expiresAt" | "nonce">): string {
  const now = Math.floor(Date.now() / 1000);
  const full: SessionPayload = {
    ...payload,
    issuedAt: now,
    expiresAt: now + SESSION_TTL_SECONDS,
    nonce: randomBytes(16).toString("base64url")
  };
  const body = Buffer.from(JSON.stringify(full)).toString("base64url");
  const mac = sign(body);
  return `${body}.${mac}`;
}

export function decodeSession(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!safeEqual(sign(body), mac)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (!payload.discordId || typeof payload.expiresAt !== "number") return null;
    if (payload.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Generate a random state for OAuth CSRF protection. */
export function generateState(): string {
  return randomBytes(24).toString("base64url");
}

export const sessionCookieName = "gtasun_session";
export const SESSION_MAX_AGE = SESSION_TTL_SECONDS;

/**
 * Persist OAuth state so the callback can verify it (defense against CSRF).
 * Stored in the database keyed by the state value, single-use, valid 15 minutes.
 */
export async function storeState(state: string): Promise<void> {
  await db.run("INSERT INTO oauth_states (state) VALUES (?)", [state]);
  await db.run("DELETE FROM oauth_states WHERE created_at < datetime('now', '-15 minutes')"); // prune
}

export async function verifyAndConsumeState(state: string | null): Promise<boolean> {
  if (!state) return false;
  const { changes } = await db.run("DELETE FROM oauth_states WHERE state = ? AND created_at >= datetime('now', '-15 minutes')", [state]);
  return changes === 1;
}

/**
 * The OAuth state is also kept in a cookie of the browser that started the login: the callback only accepts the
 * state of *this* browser (login CSRF: without it, someone could send a victim their own callback link and log the
 * victim into the attacker's account). Scoped to the auth routes.
 */
export const STATE_COOKIE = "fvx_oauth_state";
export const STATE_COOKIE_PATH = "/api/auth/discord";

export function sameState(cookie: string | null | undefined, state: string | null | undefined): boolean {
  return Boolean(cookie && state) && safeEqual(cookie as string, state as string);
}

// ---- server-side sessions ----
//
// The cookie stays a signed payload (no lookup needed to know who it claims to be), and its nonce is the id of a row
// of auth_sessions: logging out, a platform ban or an admin revokes the row, and the cookie stops working everywhere
// within SESSION_CHECK_MS (each instance caches the answer that long). Cookies without a row are refused.

export type SessionMeta = { ipHash: string | null; userAgent: string | null };

const isoFromSeconds = (seconds: number) => new Date(seconds * 1000).toISOString();
const checkMs = () => Number(process.env.SESSION_CHECK_MS ?? 15_000);
/** last_seen_at is refreshed at most this often (one write per session every few minutes). */
const TOUCH_MS = 5 * 60_000;

type CheckEntry = { valid: boolean; at: number };
const globalSessions = globalThis as unknown as { fvxSessionChecks?: Map<string, CheckEntry> };
const checks = (globalSessions.fvxSessionChecks ??= new Map<string, CheckEntry>());

/** Sign a new session for this identity and record it. Returns the cookie value. */
export async function createSession(identity: { discordId: string; username: string; avatarUrl: string | null }, meta: SessionMeta): Promise<string> {
  const token = encodeSession(identity);
  const payload = decodeSession(token) as SessionPayload;
  await db.run(
    "INSERT INTO auth_sessions (id, discord_id, created_at, expires_at, last_seen_at, ip_hash, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [payload.nonce, identity.discordId, isoFromSeconds(payload.issuedAt), isoFromSeconds(payload.expiresAt), isoFromSeconds(payload.issuedAt), meta.ipHash, meta.userAgent?.slice(0, 200) ?? null]
  );
  return token;
}

/** Is this (already signature-checked) session still open: recorded, not revoked, not expired, account not banned? */
export async function isSessionActive(payload: SessionPayload, now = Date.now()): Promise<boolean> {
  const hit = checks.get(payload.nonce);
  if (hit && now - hit.at < checkMs()) return hit.valid;
  const row = await db.get<{ discord_id: string; revoked_at: string | null; expires_at: string; last_seen_at: string; banned_at: string | null }>(
    `SELECT s.discord_id, s.revoked_at, s.expires_at, s.last_seen_at, u.banned_at
     FROM auth_sessions s LEFT JOIN platform_users u ON u.discord_id = s.discord_id WHERE s.id = ?`,
    [payload.nonce]
  );
  const valid = Boolean(row && row.discord_id === payload.discordId && !row.revoked_at && !row.banned_at && Date.parse(row.expires_at) > now);
  if (valid && row && now - Date.parse(row.last_seen_at) > TOUCH_MS) {
    await db.run("UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?", [new Date(now).toISOString(), payload.nonce]).catch(() => undefined);
  }
  checks.set(payload.nonce, { valid, at: now });
  if (checks.size > 10_000) for (const [key, entry] of checks) if (now - entry.at >= checkMs()) checks.delete(key);
  return valid;
}

/** End one session (logout, or an admin). */
export async function revokeSession(id: string, reason: string, now = new Date()): Promise<boolean> {
  const { changes } = await db.run("UPDATE auth_sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL", [now.toISOString(), reason.slice(0, 100), id]);
  checks.delete(id);
  return changes > 0;
}

/** End every open session of an account (ban, or "log out everywhere"). Returns how many were open. */
export async function revokeUserSessions(discordId: string, reason: string, now = new Date()): Promise<number> {
  const { changes } = await db.run(
    "UPDATE auth_sessions SET revoked_at = ?, revoked_reason = ? WHERE discord_id = ? AND revoked_at IS NULL AND expires_at > ?",
    [now.toISOString(), reason.slice(0, 100), discordId, now.toISOString()]
  );
  checks.clear(); // entries are keyed by session: simplest is to forget them all on this instance
  return changes;
}

export type SessionRow = { id: string; createdAt: string; expiresAt: string; lastSeenAt: string; revokedAt: string | null; revokedReason: string | null; userAgent: string | null };

export async function listUserSessions(discordId: string, limit = 20): Promise<SessionRow[]> {
  const rows = await db.all<{ id: string; created_at: string; expires_at: string; last_seen_at: string; revoked_at: string | null; revoked_reason: string | null; user_agent: string | null }>(
    "SELECT id, created_at, expires_at, last_seen_at, revoked_at, revoked_reason, user_agent FROM auth_sessions WHERE discord_id = ? ORDER BY created_at DESC LIMIT ?",
    [discordId, limit]
  );
  return rows.map((r) => ({ id: r.id, createdAt: r.created_at, expiresAt: r.expires_at, lastSeenAt: r.last_seen_at, revokedAt: r.revoked_at, revokedReason: r.revoked_reason, userAgent: r.user_agent }));
}

/** Forget sessions that ended more than 30 days ago (kept a while for the admin's history). */
export async function pruneSessions(now = new Date()): Promise<number> {
  const { changes } = await db.run("DELETE FROM auth_sessions WHERE expires_at < ?", [new Date(now.getTime() - 30 * 86_400_000).toISOString()]);
  return changes;
}
