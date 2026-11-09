import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOwnerApi } from "@/lib/auth";
import { updateGuildBotProfile } from "@/lib/bot-profile";
import { rateLimit } from "@/lib/rate-limit";
import type { ServerRouteContext } from "@/lib/route";

export const runtime = "nodejs";

/** undefined: unchanged · null: back to the bot's own · string: the new value (images as data URIs). */
const field = (max: number) => z.string().max(max).nullable().optional();
const schema = z.object({ nick: field(64), bio: field(400), avatar: field(2_100_000), banner: field(2_100_000) });

const STATUS: Record<string, number> = {
  no_guild: 409, bot_not_in_guild: 409, bot_forbidden: 403, bot_unavailable: 503, discord_unreachable: 502, discord_rate_limited: 429,
  discord_rejected: 400, invalid_image: 400, invalid_nick: 400, invalid_bio: 400, nothing_to_change: 400
};

/** POST /api/s/:serverId/bot-profile {nick?, bio?, avatar?, banner?} — the bot's look on this server's Discord. Owners only. */
export async function POST(req: NextRequest, { params }: ServerRouteContext) {
  const guard = await requireOwnerApi((await params).serverId);
  if ("error" in guard) return guard.error;
  // Discord limits profile changes: a few per hour per server is plenty for people, and keeps the shared bot in good standing.
  if (!(await rateLimit(`bot_profile:${guard.server.id}`, 10, 3600))) return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  const result = await updateGuildBotProfile(guard.server, { discordId: guard.user.discordId, username: guard.user.username }, parsed.data);
  if (!result.ok) return NextResponse.json(result, { status: STATUS[result.error] ?? 400 });
  return NextResponse.json({ ok: true, profile: result.profile });
}
