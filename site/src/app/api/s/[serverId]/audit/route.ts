import { NextRequest, NextResponse } from "next/server";
import { requirePermissionApi } from "@/lib/auth";
import { enqueueCommand, getLiveState } from "@/lib/agent";
import { AuditError, createScan, explainFinding, getScan, latestReport, listScans, runningScan, saveAuditSettings } from "@/lib/server-audit";
import type { ServerRouteContext } from "@/lib/route";

export const runtime = "nodejs";
export const maxDuration = 60;

/** GET ?scan=<id> — a report; without it: the running scan, the latest report and the history. */
export async function GET(req: NextRequest, { params }: ServerRouteContext) {
  const guard = await requirePermissionApi((await params).serverId, "view_security");
  if ("error" in guard) return guard.error;
  const id = Number(req.nextUrl.searchParams.get("scan"));
  if (id) {
    const scan = await getScan(guard.server.id, id);
    return scan ? NextResponse.json(scan) : NextResponse.json({ error: "unknown_scan" }, { status: 404 });
  }
  const [running, latest, history] = await Promise.all([runningScan(guard.server.id), latestReport(guard.server.id), listScans(guard.server.id)]);
  return NextResponse.json({ running, latest, history });
}

/**
 * POST ?action=run — start an audit (the agent collects, a few seconds to a few minutes).
 * POST ?action=settings {continuous, alert}
 * POST ?action=explain {scanId, index} — the AI on one finding (permission view_security).
 */
export async function POST(req: NextRequest, { params }: ServerRouteContext) {
  const serverId = (await params).serverId;
  const action = req.nextUrl.searchParams.get("action");
  const guard = await requirePermissionApi(serverId, action === "explain" ? "view_security" : "security_config");
  if ("error" in guard) return guard.error;
  const { user, server } = guard;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    if (action === "run") {
      if (await runningScan(server.id)) return NextResponse.json({ error: "audit_running" }, { status: 409 });
      if (!(await getLiveState(server.id)).online) return NextResponse.json({ error: "agent_offline" }, { status: 409 });
      const scanId = await createScan(server.id, user.discordId, "manual");
      await enqueueCommand(server.id, user, "audit", { scanId });
      return NextResponse.json({ ok: true, scanId });
    }
    if (action === "settings") {
      await saveAuditSettings(server.id, user, { continuous: body.continuous === true, alert: body.alert !== false });
      return NextResponse.json({ ok: true });
    }
    if (action === "explain") {
      return NextResponse.json(await explainFinding(server.id, Number(body.scanId), Number(body.index), user.discordId));
    }
    return NextResponse.json({ error: "validation" }, { status: 400 });
  } catch (error) {
    if (error instanceof AuditError) return NextResponse.json({ error: error.message }, { status: error.message.startsWith("ai_") ? 502 : 409 });
    throw error;
  }
}
