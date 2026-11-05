import { NextRequest, NextResponse } from "next/server";
import { getIdentity } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/config";
import { deleteOwnReview, DirectoryError, moderateReview, reportReview, track, upsertReview } from "@/lib/directory";
import { STAT_KINDS, type StatKind } from "@/lib/directory-shared";

export const runtime = "nodejs";

/**
 * Public directory (/annuaire).
 * POST ?action=track {slug, kind} — a view or a click (no login).
 * POST ?action=review {slug, rating, body} · delete {slug} · report {reviewId, reason} — logged-in Discord account.
 * POST ?action=moderate {reviewId, status} — platform owners.
 */
export async function POST(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action");
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (action === "track") {
    const kind = String(body.kind ?? "");
    if (kind === "cta" || STAT_KINDS.includes(kind as StatKind)) await track(String(body.slug ?? ""), kind as StatKind | "cta");
    return NextResponse.json({ ok: true });
  }

  const identity = await getIdentity();
  if (!identity) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const viewer = { discordId: identity.discordId, username: identity.username, avatarUrl: identity.avatarUrl ?? null };

  try {
    switch (action) {
      case "review":
        return NextResponse.json(await upsertReview(String(body.slug ?? ""), viewer, { rating: Number(body.rating), body: body.body }));
      case "delete":
        return NextResponse.json({ ok: await deleteOwnReview(String(body.slug ?? ""), viewer) });
      case "report":
        return NextResponse.json(await reportReview(Number(body.reviewId), viewer, String(body.reason ?? "")));
      case "moderate": {
        if (!isPlatformOwner(identity.discordId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
        const status = body.status === "published" ? "published" : "removed";
        return NextResponse.json({ ok: await moderateReview(Number(body.reviewId), status) });
      }
      default:
        return NextResponse.json({ error: "validation" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof DirectoryError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
