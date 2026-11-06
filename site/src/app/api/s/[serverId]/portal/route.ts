import { NextRequest, NextResponse } from "next/server";
import { requirePermissionApi } from "@/lib/auth";
import { decideResponse, drawGiveaway, PortalSiteError, publishSite, saveDraft, setSlug, unpublishSite } from "@/lib/portal-site";
import type { ResponseStatus } from "@/lib/portal-site-shared";
import type { ServerRouteContext } from "@/lib/route";

export const runtime = "nodejs";

/**
 * Player portal of the server (permission portal_edit).
 * POST ?action=save {design} · publish · unpublish · slug {slug}
 * POST ?action=respond {id, status, reply} — answer a form response (seen / accepted / refused).
 * POST ?action=draw {blockId} — draw a giveaway now (closes its entries).
 */
export async function POST(req: NextRequest, { params }: ServerRouteContext) {
  const guard = await requirePermissionApi((await params).serverId, "portal_edit");
  if ("error" in guard) return guard.error;
  const { user, server } = guard;
  const action = req.nextUrl.searchParams.get("action");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    switch (action) {
      case "save": return NextResponse.json(await saveDraft(server, user, body.design));
      case "publish": return NextResponse.json(await publishSite(server, user));
      case "unpublish": return NextResponse.json(await unpublishSite(server, user));
      case "slug": return NextResponse.json(await setSlug(server, user, String(body.slug ?? "")));
      case "respond":
        await decideResponse(server.id, user, Number(body.id), String(body.status) as ResponseStatus, typeof body.reply === "string" ? body.reply : null);
        return NextResponse.json({ ok: true });
      case "draw": return NextResponse.json({ winners: await drawGiveaway(server.id, user, String(body.blockId ?? "")) });
      default: return NextResponse.json({ error: "validation" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof PortalSiteError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
