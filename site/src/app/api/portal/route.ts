import { NextRequest, NextResponse } from "next/server";
import { getIdentity } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { PortalError, submitAppeal } from "@/lib/portal";
import { enterGiveaway, leaveGiveaway, PortalSiteError, submitForm } from "@/lib/portal-site";

export const runtime = "nodejs";

/**
 * Player portal (/joueur), logged-in Discord account.
 * POST ?action=appeal {serverId, banId, body} — contest one of the account's active bans.
 * POST ?action=form {slug, blockId, answers} — answer a form of a server's portal (/joueur/<slug>).
 * POST ?action=enter | leave {slug, blockId} — enter (or leave) a giveaway of a server's portal.
 */
export async function POST(req: NextRequest) {
  const identity = await getIdentity();
  if (!identity) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  // Forms and giveaways have their own rules; this only stops a script from hammering them with one account.
  if (!(await rateLimit(`portal:${identity.discordId}`, 30, 600))) return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  const action = req.nextUrl.searchParams.get("action");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (action === "appeal") {
      const id = await submitAppeal(identity, String(body.serverId ?? ""), Number(body.banId), String(body.body ?? ""));
      return NextResponse.json({ ok: true, id });
    }
    const viewer = { discordId: identity.discordId, username: identity.username, avatarUrl: identity.avatarUrl ?? null };
    const slug = String(body.slug ?? "");
    const blockId = String(body.blockId ?? "");
    if (action === "form") return NextResponse.json({ ok: true, id: await submitForm(slug, viewer, blockId, body.answers) });
    if (action === "enter") return NextResponse.json(await enterGiveaway(slug, viewer, blockId));
    if (action === "leave") {
      await leaveGiveaway(slug, viewer, blockId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "validation" }, { status: 400 });
  } catch (error) {
    if (error instanceof PortalError || error instanceof PortalSiteError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
