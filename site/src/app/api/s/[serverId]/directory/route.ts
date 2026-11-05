import { NextRequest, NextResponse } from "next/server";
import { requirePermissionApi } from "@/lib/auth";
import { addFeatured, DirectoryError, removeFeatured, replyReview, saveListing, setPublished } from "@/lib/directory";
import type { ServerRouteContext } from "@/lib/route";
import { saveVoteSettings, VoteError } from "@/lib/votes";

export const runtime = "nodejs";

/**
 * The server's listing in the public directory (permission `directory_edit`).
 * POST ?action=save {listing} · publish · unpublish · reply {reviewId, reply} ·
 * feature {days, note} · unfeature {id} (these two: platform owners only, no payment yet) · votes {settings} (rewards of the votes).
 */
export async function POST(req: NextRequest, { params }: ServerRouteContext) {
  const guard = await requirePermissionApi((await params).serverId, "directory_edit");
  if ("error" in guard) return guard.error;
  const { user, server } = guard;
  const actor = { discordId: user.discordId, username: user.username };
  const action = req.nextUrl.searchParams.get("action");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    switch (action) {
      case "save":
        return NextResponse.json(await saveListing(server.id, actor, body.listing));
      case "publish":
      case "unpublish":
        return NextResponse.json(await setPublished(server.id, actor, action === "publish"));
      case "reply":
        await replyReview(server.id, actor, Number(body.reviewId), typeof body.reply === "string" ? body.reply : null);
        return NextResponse.json({ ok: true });
      case "votes":
        return NextResponse.json(await saveVoteSettings(server.id, actor, body.settings));
      case "feature":
      case "unfeature": {
        if (!user.platformOwner) return NextResponse.json({ error: "forbidden" }, { status: 403 });
        if (action === "unfeature") {
          await removeFeatured(server.id, actor, Number(body.id));
          return NextResponse.json({ ok: true });
        }
        return NextResponse.json({ slots: await addFeatured(server.id, actor, Number(body.days), typeof body.note === "string" ? body.note : null) });
      }
      default:
        return NextResponse.json({ error: "validation" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof DirectoryError || error instanceof VoteError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
