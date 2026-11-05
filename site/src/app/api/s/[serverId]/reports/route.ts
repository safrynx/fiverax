import { NextRequest, NextResponse } from "next/server";
import { can, requirePermissionApi } from "@/lib/auth";
import { COMMANDS, enqueueCommand, getLiveState } from "@/lib/agent";
import { countOpenReports, getCapture, listReports, ReportError, updateReport } from "@/lib/blackbox";
import { REPORT_OUTCOMES, REPORT_STATUSES, type ReportOutcome, type ReportStatus } from "@/lib/blackbox-shared";
import { countOpenAppeals, decideAppeal, PortalError } from "@/lib/portal";
import type { ServerRouteContext } from "@/lib/route";

export const runtime = "nodejs";

/**
 * Reports, black box replays and ban appeals of a server.
 * GET  ?status=open|claimed|closed|active        list (permission `reports`), with the counters
 * GET  ?capture=<id>                              the replay of a report (permission `reports`)
 * POST ?action=claim|unclaim|reopen {id}          · close {id, outcome, verdict}   (permission `reports`)
 * POST ?action=capture {seconds?, center?, reason?}  ask the agent for its black box now (permission `reports`)
 * POST ?action=appeal {id, accept, response}      decide a ban appeal (permission `ban`)
 */
export async function GET(req: NextRequest, { params }: ServerRouteContext) {
  const guard = await requirePermissionApi((await params).serverId, "reports");
  if ("error" in guard) return guard.error;
  const { server } = guard;
  const sp = req.nextUrl.searchParams;
  const captureId = Number(sp.get("capture"));
  if (captureId) {
    const capture = await getCapture(server.id, captureId);
    if (!capture) return NextResponse.json({ error: "unknown_capture" }, { status: 404 });
    return NextResponse.json(capture);
  }
  const raw = sp.get("status") ?? "active";
  const status = raw === "active" || REPORT_STATUSES.includes(raw as ReportStatus) ? (raw as ReportStatus | "active") : "active";
  const [reports, counts, appeals] = await Promise.all([
    listReports(server.id, { status, limit: 150 }), countOpenReports(server.id),
    can(guard.user, "view_security") || can(guard.user, "ban") ? countOpenAppeals(server.id) : Promise.resolve(0)
  ]);
  return NextResponse.json({ reports, counts: { ...counts, appeals } });
}

export async function POST(req: NextRequest, { params }: ServerRouteContext) {
  const serverId = (await params).serverId;
  const action = req.nextUrl.searchParams.get("action") ?? "";
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (action === "appeal") {
    const guard = await requirePermissionApi(serverId, "ban");
    if ("error" in guard) return guard.error;
    try {
      await decideAppeal(guard.server.id, guard.user, Number(body.id), body.accept === true, typeof body.response === "string" ? body.response : null);
      return NextResponse.json({ ok: true });
    } catch (error) {
      if (error instanceof PortalError) return NextResponse.json({ error: error.message }, { status: 409 });
      throw error;
    }
  }

  const guard = await requirePermissionApi(serverId, "reports");
  if ("error" in guard) return guard.error;
  const { user, server } = guard;

  if (action === "capture") {
    const parsed = COMMANDS.blackbox.schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
    const live = await getLiveState(server.id);
    if (!live.online) return NextResponse.json({ error: "agent_offline" }, { status: 409 });
    const center = parsed.data.center !== undefined ? live.players.find((p) => p.id === parsed.data.center) : undefined;
    const id = await enqueueCommand(server.id, user, "blackbox", parsed.data, { playerName: center?.name ?? null, targetDiscordId: center?.discordId ?? null });
    return NextResponse.json({ ok: true, id });
  }

  try {
    const id = Number(body.id);
    if (action === "claim" || action === "unclaim" || action === "reopen") return NextResponse.json(await updateReport(server.id, user, id, { action }));
    if (action === "close") {
      const outcome = REPORT_OUTCOMES.find((o) => o === body.outcome) as ReportOutcome | undefined;
      if (!outcome) return NextResponse.json({ error: "validation" }, { status: 400 });
      return NextResponse.json(await updateReport(server.id, user, id, { action, outcome, verdict: typeof body.verdict === "string" ? body.verdict : null }));
    }
    return NextResponse.json({ error: "validation" }, { status: 400 });
  } catch (error) {
    if (error instanceof ReportError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
