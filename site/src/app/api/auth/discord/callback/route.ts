import { NextRequest, NextResponse } from "next/server";
import { avatarUrl, exchangeCode, fetchDiscordUser, fetchUserGuilds, getDiscordConfig } from "@/lib/discord";
import { listAccessibleServers } from "@/lib/auth";
import { refreshMemberships, storeUserGuilds } from "@/lib/memberships";
import { encodeSession, sessionCookieName, SESSION_MAX_AGE, verifyAndConsumeState } from "@/lib/session";

export const runtime = "nodejs";

function appUrl(): string {
  return process.env.APP_URL || "http://localhost:3000";
}

function fail(error: string, extra = "") {
  return NextResponse.redirect(`${appUrl()}/login?error=${error}${extra}`);
}

/**
 * Any Discord user may log in: they land on their servers, or on the page to register their first one.
 * Their guild list (and which ones they manage) and their roles on the registered servers are refreshed here.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const config = getDiscordConfig();

  if ("missing" in config) return fail("missing_config", `&missing=${encodeURIComponent(config.missing.join(","))}`);
  if (url.searchParams.get("error")) return fail("access_denied");

  // CSRF: state must exist, be single-use, and not be expired.
  if (!code || !(await verifyAndConsumeState(state))) return fail("invalid_state");

  const token = await exchangeCode(code);
  if (!token?.access_token) return fail("oauth_exchange");

  const user = await fetchDiscordUser(token.access_token);
  if (!user) return fail("oauth_identity");
  const guilds = await fetchUserGuilds(token.access_token);
  if (!guilds) return fail("oauth_identity");

  const identity = { discordId: user.id, username: user.global_name || user.username, avatarUrl: avatarUrl(user) };
  await storeUserGuilds(identity.discordId, guilds);
  // Fresh roles on every registered server the user is in, before deciding where they may go.
  await refreshMemberships(identity, guilds.map((g) => g.id));
  const servers = await listAccessibleServers(identity);

  // Back to the directory page they came from (to leave a review); else one server: straight to it; none or several: the list.
  const next = req.cookies.get("fvx_next")?.value;
  const target = next && /^\/annuaire(?:\/[a-z0-9-]{3,40})?(?:#avis)?$/.test(next) ? next : servers.length === 1 ? `/s/${servers[0].id}` : "/servers";
  const res = NextResponse.redirect(`${appUrl()}${target}`);
  if (next) res.cookies.delete("fvx_next");
  res.cookies.set(sessionCookieName, encodeSession(identity), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/"
  });
  return res;
}
