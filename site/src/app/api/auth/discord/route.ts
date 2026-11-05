import { NextResponse } from "next/server";
import { buildAuthorizeUrl, getDiscordConfig } from "@/lib/discord";
import { isSafeNext } from "@/lib/next-url";
import { generateState, storeState } from "@/lib/session";

export const runtime = "nodejs";

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
  if (isSafeNext(next)) res.cookies.set(NEXT_COOKIE, next, { httpOnly: true, sameSite: "lax", maxAge: 900, path: "/", secure: process.env.NODE_ENV === "production" });
  return res;
}
