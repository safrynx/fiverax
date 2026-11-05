import { NextResponse } from "next/server";
import { buildAuthorizeUrl, getDiscordConfig } from "@/lib/discord";
import { generateState, storeState } from "@/lib/session";

export const runtime = "nodejs";

/** Where the user goes back after logging in: only directory pages (no open redirect). */
const NEXT_RE = /^\/annuaire(?:\/[a-z0-9-]{3,40})?(?:#avis)?$/;
const NEXT_COOKIE = "fvx_next";

export async function GET(req: Request) {
  const config = getDiscordConfig();
  if ("missing" in config) {
    return NextResponse.redirect(
      new URL(`/login?error=missing_config&missing=${encodeURIComponent(config.missing.join(","))}`, process.env.APP_URL || "http://localhost:3000")
    );
  }
  const state = generateState();
  await storeState(state);
  const res = NextResponse.redirect(buildAuthorizeUrl(state));
  const next = new URL(req.url).searchParams.get("next");
  if (next && NEXT_RE.test(next)) res.cookies.set(NEXT_COOKIE, next, { httpOnly: true, sameSite: "lax", maxAge: 900, path: "/", secure: process.env.NODE_ENV === "production" });
  return res;
}
