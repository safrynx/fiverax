import { NextRequest, NextResponse } from "next/server";
import { can, requirePermissionApi } from "@/lib/auth";
import { enqueueCommand, getLiveState } from "@/lib/agent";
import { generatePlan, installKit, ProtectionError, setBadgeEnabled } from "@/lib/protection";
import { KIT, type KitKey } from "@/lib/protection-shared";
import { getCreation, markDeploy, StudioError } from "@/lib/studio";
import type { ServerRouteContext } from "@/lib/route";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST ?action=badge {enabled} — turn the public badge on / off (permission security_config).
 * POST ?action=plan — the AI writes the action plan of the latest scan (permission view_security).
 * POST ?action=kit {key, deploy} — copy a kit resource into the Studio (permission studio), and deploy it
 *   (permission studio_deploy, agent online).
 */
export async function POST(req: NextRequest, { params }: ServerRouteContext) {
  const serverId = (await params).serverId;
  const action = req.nextUrl.searchParams.get("action");
  const permission = action === "badge" ? "security_config" : action === "kit" ? "studio" : "view_security";
  const guard = await requirePermissionApi(serverId, permission);
  if ("error" in guard) return guard.error;
  const { user, server } = guard;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    if (action === "badge") return NextResponse.json(await setBadgeEnabled(server, user, body.enabled === true));
    if (action === "plan") return NextResponse.json(await generatePlan(server.id, user));
    if (action === "kit") {
      const key = String(body.key ?? "") as KitKey;
      if (!KIT.some((k) => k.key === key)) return NextResponse.json({ error: "unknown_kit" }, { status: 404 });
      const deploy = body.deploy === true;
      if (deploy && !can(user, "studio_deploy")) return NextResponse.json({ error: "forbidden_permission", permission: "studio_deploy" }, { status: 403 });
      if (deploy && !(await getLiveState(server.id)).online) return NextResponse.json({ error: "agent_offline" }, { status: 409 });
      const { creationId, created } = await installKit(server.id, user, key);
      let commandId: number | null = null;
      if (deploy) {
        const creation = await getCreation(server.id, creationId);
        if (creation?.files.length) {
          commandId = await enqueueCommand(server.id, user, "deploy", { resource: creation.resource, files: creation.files });
          await markDeploy(server.id, creationId, commandId, creation.files);
        }
      }
      return NextResponse.json({ ok: true, creationId, created, commandId });
    }
    return NextResponse.json({ error: "validation" }, { status: 400 });
  } catch (error) {
    if (error instanceof ProtectionError) return NextResponse.json({ error: error.message }, { status: error.message.startsWith("ai_") ? 502 : 409 });
    if (error instanceof StudioError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
