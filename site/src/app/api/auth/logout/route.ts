import { NextRequest, NextResponse } from "next/server";
import { decodeSession, revokeSession, sessionCookieName } from "@/lib/session";

export const runtime = "nodejs";

/** POST /api/auth/logout — ends the session for good (its row is revoked: a copied cookie stops working too). */
export async function POST(req: NextRequest) {
  const payload = decodeSession(req.cookies.get(sessionCookieName)?.value);
  if (payload) await revokeSession(payload.nonce, "logout").catch((error) => console.error("[auth] logout:", error instanceof Error ? error.message : error));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookieName, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/"
  });
  return res;
}
