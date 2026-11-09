import { NextResponse } from "next/server";
import { buildAuthorizeUrl, getDiscordConfig } from "@/lib/discord";
import { clientIp, hashIp } from "@/lib/client-ip";
import { isSafeNext } from "@/lib/next-url";
import { rateLimit } from "@/lib/rate-limit";
import { generateState, STATE_COOKIE, STATE_COOKIE_PATH, storeState } from "@/lib/session";

export const runtime = "nodejs";

const NEXT_COOKIE = "fvx_next";
const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");

export async function GET(req: Request) {
  const config = getDiscordConfig();
  if ("missing" in config) {
    return NextResponse.redirect(`${appUrl()}/login?error=missing_config&missing=${encodeURIComponent(config.missing.join(","))}`);
  }
  // Each call writes an OAuth state: a script hammering this route would only fill that table.
  const ip = hashIp(clientIp(req.headers), "login");
  if (ip && !(await rateLimit(`login:${ip}`, 30, 600))) return NextResponse.redirect(`${appUrl()}/login?error=rate_limited`);

  const state = generateState();
  await storeState(state);
  const res = NextResponse.redirect(buildAuthorizeUrl(state));
  const secure = process.env.NODE_ENV === "production";
  // The callback only accepts the state of the browser that started the login (see STATE_COOKIE).
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", maxAge: 900, path: STATE_COOKIE_PATH, secure });
  const next = new URL(req.url).searchParams.get("next");
  if (isSafeNext(next)) res.cookies.set(NEXT_COOKIE, next, { httpOnly: true, sameSite: "lax", maxAge: 900, path: "/", secure });
  return res;
}
