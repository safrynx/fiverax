import { NextRequest, NextResponse } from "next/server";
import { getIdentity } from "@/lib/auth";
import { PortalError, submitAppeal } from "@/lib/portal";

export const runtime = "nodejs";

/**
 * Player portal (/joueur), logged-in Discord account.
 * POST ?action=appeal {serverId, banId, body} — contest one of the account's active bans.
 */
export async function POST(req: NextRequest) {
  const identity = await getIdentity();
  if (!identity) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const action = req.nextUrl.searchParams.get("action");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (action === "appeal") {
      const id = await submitAppeal(identity, String(body.serverId ?? ""), Number(body.banId), String(body.body ?? ""));
      return NextResponse.json({ ok: true, id });
    }
    return NextResponse.json({ error: "validation" }, { status: 400 });
  } catch (error) {
    if (error instanceof PortalError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
