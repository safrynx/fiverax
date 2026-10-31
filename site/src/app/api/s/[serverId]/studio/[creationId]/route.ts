import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermissionApi } from "@/lib/auth";
import { enqueueCommand, getLiveState } from "@/lib/agent";
import { deleteCreation, generateCreation, getCreation, markDeploy, restoreVersion, saveCreation, StudioError } from "@/lib/studio";
import { FRAMEWORKS, LIMITS } from "@/lib/studio-shared";

export const runtime = "nodejs";
/** An AI generation writes whole files: it can take a minute on a free model. */
export const maxDuration = 120;

type Ctx = { params: Promise<{ serverId: string; creationId: string }> };

function fail(error: unknown) {
  if (!(error instanceof StudioError)) throw error;
  const status = error.message.startsWith("unknown_") ? 404 : error.message.startsWith("ai_") ? 502 : 400;
  return NextResponse.json({ error: error.message }, { status });
}

/** GET — the creation with its files, data and versions. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { serverId, creationId } = await params;
  const guard = await requirePermissionApi(serverId, "studio");
  if ("error" in guard) return guard.error;
  const creation = await getCreation(guard.server.id, Number(creationId));
  if (!creation) return NextResponse.json({ error: "unknown_creation" }, { status: 404 });
  return NextResponse.json(creation);
}

const saveSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  framework: z.enum(FRAMEWORKS.map((f) => f.key) as [string, ...string[]]).optional(),
  files: z.array(z.object({ path: z.string().max(120), content: z.string().max(LIMITS.fileBytes) })).max(LIMITS.files).optional(),
  data: z.object({
    tests: z.array(z.unknown()).max(12).optional(),
    map: z.unknown().optional(),
    mode: z.enum(["visual", "code"]).optional(),
    blocks: z.unknown().optional(),
    ui: z.unknown().optional()
  }).optional(),
  summary: z.string().max(300).optional()
});

/** PUT — save a hand edit as a new version. */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const { serverId, creationId } = await params;
  const guard = await requirePermissionApi(serverId, "studio");
  if ("error" in guard) return guard.error;
  const parsed = saveSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  const { summary, ...change } = parsed.data;
  try {
    const creation = await saveCreation(guard.server.id, guard.user, Number(creationId), change as Parameters<typeof saveCreation>[3], {
      source: "manual", summary: summary ?? "Modification manuelle"
    });
    return NextResponse.json(creation);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { serverId, creationId } = await params;
  const guard = await requirePermissionApi(serverId, "studio");
  if ("error" in guard) return guard.error;
  if (!(await deleteCreation(guard.server.id, guard.user, Number(creationId)))) return NextResponse.json({ error: "unknown_creation" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/**
 * POST ?action=generate {instruction} — ask the AI (new version).
 * POST ?action=restore {versionId} — back to a version (as a new version).
 * POST ?action=deploy — send the saved files to the FiveM agent (permission studio_deploy); answers the command id.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { serverId, creationId } = await params;
  const action = req.nextUrl.searchParams.get("action");
  const guard = await requirePermissionApi(serverId, action === "deploy" ? "studio_deploy" : "studio");
  if ("error" in guard) return guard.error;
  const { user, server } = guard;
  const id = Number(creationId);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    if (action === "generate") {
      const instruction = typeof body.instruction === "string" ? body.instruction.trim().slice(0, 2000) : "";
      if (instruction.length < 3) return NextResponse.json({ error: "validation" }, { status: 400 });
      return NextResponse.json(await generateCreation(server.id, user, id, instruction));
    }
    if (action === "restore") {
      return NextResponse.json(await restoreVersion(server.id, user, id, Number(body.versionId)));
    }
    if (action === "deploy") {
      const creation = await getCreation(server.id, id);
      if (!creation) return NextResponse.json({ error: "unknown_creation" }, { status: 404 });
      if (!creation.files.length) return NextResponse.json({ error: "nothing_to_deploy" }, { status: 400 });
      if (!(await getLiveState(server.id)).online) return NextResponse.json({ error: "agent_offline" }, { status: 409 });
      const commandId = await enqueueCommand(server.id, user, "deploy", { resource: creation.resource, files: creation.files });
      await markDeploy(server.id, id, commandId, creation.files);
      return NextResponse.json({ ok: true, id: commandId });
    }
    return NextResponse.json({ error: "validation" }, { status: 400 });
  } catch (error) {
    return fail(error);
  }
}
