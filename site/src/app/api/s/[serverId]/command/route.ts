import { NextRequest, NextResponse } from "next/server";
import { requirePermissionApi, requireStaffApi } from "@/lib/auth";
import { COMMANDS, enqueueCommand, getCommandStatus, getLiveState, isCommandKind } from "@/lib/agent";
import type { ServerRouteContext } from "@/lib/route";

export const runtime = "nodejs";

/**
 * POST /api/s/:serverId/command?kind=kick|dm|announce|resource|refresh|console — queue an action for the FiveM agent.
 * Each kind needs its own permission. The agent picks it up on its next call (a few seconds).
 */
export async function POST(req: NextRequest, { params }: ServerRouteContext) {
  const serverId = (await params).serverId;
  const kind = req.nextUrl.searchParams.get("kind") ?? "";
  // Deployments and audits are queued by their own APIs (saved files, a scan row).
  if (!isCommandKind(kind) || kind === "deploy" || kind === "audit") return NextResponse.json({ error: "unknown_kind" }, { status: 400 });
  const guard = await requirePermissionApi(serverId, COMMANDS[kind].permission);
  if ("error" in guard) return guard.error;
  const { user, server } = guard;

  const parsed = COMMANDS[kind].schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation", issues: parsed.error.issues.map((i) => i.path.join(".")) }, { status: 400 });
  const payload = parsed.data as Record<string, unknown>;

  const live = await getLiveState(server.id);
  if (!live.online) return NextResponse.json({ error: "agent_offline" }, { status: 409 });
  // Player actions: the target must be connected now (server ids are reused after a player leaves).
  let context: { playerName?: string; targetDiscordId?: string | null } = {};
  if ("target" in payload) {
    const player = live.players.find((p) => p.id === payload.target);
    if (!player) return NextResponse.json({ error: "player_offline" }, { status: 409 });
    context = { playerName: player.name, targetDiscordId: player.discordId };
  }

  const id = await enqueueCommand(server.id, user, kind, payload, context);
  return NextResponse.json({ ok: true, id });
}

/** GET /api/s/:serverId/command?id=<id> — what became of a queued action. */
export async function GET(req: NextRequest, { params }: ServerRouteContext) {
  const guard = await requireStaffApi((await params).serverId);
  if ("error" in guard) return guard.error;
  const status = await getCommandStatus(guard.server.id, Number(req.nextUrl.searchParams.get("id")));
  if (!status) return NextResponse.json({ error: "unknown_command" }, { status: 404 });
  return NextResponse.json(status);
}
