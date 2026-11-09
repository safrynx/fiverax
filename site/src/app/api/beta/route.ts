import { NextRequest, NextResponse } from "next/server";
import { getIdentity } from "@/lib/auth";
import { BetaError, requestAccess, sendFeedback } from "@/lib/beta";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const STATUS: Record<string, number> = { already_partner: 409, request_refused_recently: 409, invalid_request: 400, invalid_link: 400, invalid_feedback: 400 };

/**
 * POST /api/beta?action=request {serverName, link?, players?, message?} — ask to join the private beta.
 * POST /api/beta?action=feedback {kind, message, page?, serverId?} — a bug report / idea from the panel.
 * Any logged-in account.
 */
export async function POST(req: NextRequest) {
  const identity = await getIdentity();
  if (!identity) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const action = req.nextUrl.searchParams.get("action");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const who = { discordId: identity.discordId, username: identity.username };
  try {
    if (action === "request") {
      if (!(await rateLimit(`beta_request:${identity.discordId}`, 5, 3600))) return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
      return NextResponse.json({ ok: true, request: await requestAccess(who, body) });
    }
    if (action === "feedback") {
      if (!(await rateLimit(`feedback:${identity.discordId}`, 10, 600))) return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
      return NextResponse.json({ ok: true, id: await sendFeedback(who, body) });
    }
    return NextResponse.json({ error: "validation" }, { status: 400 });
  } catch (error) {
    if (error instanceof BetaError) return NextResponse.json({ error: error.message }, { status: STATUS[error.message] ?? 400 });
    throw error;
  }
}
