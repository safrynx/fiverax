import { NextRequest, NextResponse } from "next/server";
import { avatarUrl, exchangeCode, fetchDiscordUser, fetchUserGuilds, getDiscordConfig } from "@/lib/discord";
import { listAccessibleServers } from "@/lib/auth";
import { clientIp, hashIp } from "@/lib/client-ip";
import { refreshMemberships, storeUserGuilds } from "@/lib/memberships";
import { isSafeNext } from "@/lib/next-url";
import { isUserBanned, recordLogin } from "@/lib/platform";
import { createSession, sameState, sessionCookieName, SESSION_MAX_AGE, STATE_COOKIE, STATE_COOKIE_PATH, verifyAndConsumeState } from "@/lib/session";

export const runtime = "nodejs";

function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** Every answer of the callback forgets the OAuth state of this browser (single use). */
function redirect(target: string): NextResponse {
  const res = NextResponse.redirect(`${appUrl()}${target}`);
  res.cookies.set(STATE_COOKIE, "", { httpOnly: true, sameSite: "lax", maxAge: 0, path: STATE_COOKIE_PATH, secure: process.env.NODE_ENV === "production" });
  return res;
}

function fail(error: string, extra = "") {
  return redirect(`/login?error=${error}${extra}`);
}

/**
 * Any Discord user may log in: they land on their servers, or on the page to register their first one.
 * Their guild list (and which ones they manage) and their roles on the registered servers are refreshed here.
 * Accounts banned from the platform (/admin) are refused.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const config = getDiscordConfig();

  if ("missing" in config) return fail("missing_config", `&missing=${encodeURIComponent(config.missing.join(","))}`);
  if (url.searchParams.get("error")) return fail("access_denied");

  // CSRF: the state must be the one this browser started with, exist, be single-use, and not be expired.
  if (!code || !sameState(req.cookies.get(STATE_COOKIE)?.value, state) || !(await verifyAndConsumeState(state))) return fail("invalid_state");

  const token = await exchangeCode(code);
  if (!token?.access_token) return fail("oauth_exchange");

  const user = await fetchDiscordUser(token.access_token);
  if (!user) return fail("oauth_identity");
  if (await isUserBanned(user.id)) return fail("banned");
  const guilds = await fetchUserGuilds(token.access_token);
  if (!guilds) return fail("oauth_identity");

  const identity = { discordId: user.id, username: user.global_name || user.username, avatarUrl: avatarUrl(user) };
  await recordLogin(identity);
  await storeUserGuilds(identity.discordId, guilds);
  // Fresh roles on every registered server the user is in, before deciding where they may go.
  await refreshMemberships(identity, guilds.map((g) => g.id));
  const servers = await listAccessibleServers(identity);

  // Back to the public page they came from (review, vote, player portal); else one server: straight to it; none or several: the list.
  const next = req.cookies.get("fvx_next")?.value;
  const target = isSafeNext(next) ? next : servers.length === 1 ? `/s/${servers[0].id}` : "/servers";
  const res = redirect(target);
  if (next) res.cookies.delete("fvx_next");
  const session = await createSession(identity, { ipHash: hashIp(clientIp(req.headers), "session"), userAgent: req.headers.get("user-agent") });
  res.cookies.set(sessionCookieName, session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/"
  });
  return res;
}
