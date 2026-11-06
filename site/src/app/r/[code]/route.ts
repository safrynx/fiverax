import { NextRequest, NextResponse } from "next/server";
import { countClick } from "@/lib/referrals";
import { REF_COOKIE, REF_COOKIE_DAYS } from "@/lib/referrals-shared";

export const runtime = "nodejs";

/** Where a referral link may send the visitor (fixed list: never an open redirect). */
const TARGETS: Record<string, string> = { home: "/", scan: "/scan", login: "/login", annuaire: "/annuaire" };

/**
 * GET /r/<code>?to=scan — a referral link: counts the click, remembers the code 30 days (cookie read when the visitor
 * registers a server, see /api/servers), then opens the landing page (or the free scan, the login, the directory).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toLowerCase();
  const to = TARGETS[req.nextUrl.searchParams.get("to") ?? ""] ?? "/";
  const base = process.env.APP_URL || req.nextUrl.origin;
  const res = NextResponse.redirect(new URL(to, base));
  if (await countClick(code)) {
    res.cookies.set(REF_COOKIE, code, { httpOnly: true, sameSite: "lax", maxAge: REF_COOKIE_DAYS * 86_400, path: "/", secure: process.env.NODE_ENV === "production" });
  }
  return res;
}
