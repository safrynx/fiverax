import { NextRequest, NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/auth";
import { leaveNetwork, saveMembership } from "@/lib/network";
import { networkSettingsSchema } from "@/lib/network-shared";
import type { ServerRouteContext } from "@/lib/route";

export const runtime = "nodejs";

/**
 * POST /api/s/:serverId/network?kind=save|leave — join the Fiverax network / change its settings, or leave it.
 * Owners only: joining shares the server's bans with every other member.
 */
export async function POST(req: NextRequest, { params }: ServerRouteContext) {
  const guard = await requireOwnerApi((await params).serverId);
  if ("error" in guard) return guard.error;
  const actor = { discordId: guard.user.discordId, username: guard.user.username };
  const kind = req.nextUrl.searchParams.get("kind");

  if (kind === "leave") {
    if (!(await leaveNetwork(guard.server.id, actor))) return NextResponse.json({ error: "not_member" }, { status: 409 });
    return NextResponse.json({ ok: true });
  }
  if (kind !== "save") return NextResponse.json({ error: "unknown_kind" }, { status: 400 });
  const parsed = networkSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation", issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  await saveMembership(guard.server.id, actor, parsed.data);
  return NextResponse.json({ ok: true });
}
