import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/auth";
import { DirectoryError } from "@/lib/directory";
import { redeemDays, ReferralError } from "@/lib/referrals";
import type { ServerRouteContext } from "@/lib/route";

export const runtime = "nodejs";

/** POST ?action=redeem {days} — spend featured days earned by referrals (owners of the server). */
export async function POST(req: NextRequest, { params }: ServerRouteContext) {
  const guard = await requireOwnerApi((await params).serverId);
  if ("error" in guard) return guard.error;
  if (req.nextUrl.searchParams.get("action") !== "redeem") return NextResponse.json({ error: "validation" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { days?: unknown };
  try {
    return NextResponse.json(await redeemDays(guard.server.id, guard.user, Number(body.days)));
  } catch (error) {
    if (error instanceof ReferralError || error instanceof DirectoryError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
