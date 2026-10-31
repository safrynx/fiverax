import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermissionApi } from "@/lib/auth";
import { createCreation, listCreations, StudioError } from "@/lib/studio";
import { CREATION_KINDS, FRAMEWORKS, isCreationKind, RESOURCE_RE } from "@/lib/studio-shared";
import type { ServerRouteContext } from "@/lib/route";

export const runtime = "nodejs";

/** GET /api/s/:serverId/studio?kind=ui|script|map — the server's creations of that kind. */
export async function GET(req: NextRequest, { params }: ServerRouteContext) {
  const guard = await requirePermissionApi((await params).serverId, "studio");
  if ("error" in guard) return guard.error;
  const kind = req.nextUrl.searchParams.get("kind") ?? "";
  if (!isCreationKind(kind)) return NextResponse.json({ error: "validation" }, { status: 400 });
  return NextResponse.json({ creations: await listCreations(guard.server.id, kind) });
}

const createSchema = z.object({
  kind: z.enum(CREATION_KINDS),
  name: z.string().trim().min(2).max(60),
  resource: z.string().regex(RESOURCE_RE).optional(),
  framework: z.enum(FRAMEWORKS.map((f) => f.key) as [string, ...string[]]).default("standalone"),
  center: z.tuple([z.number(), z.number(), z.number()]).optional(),
  /** Start with blocks (script) or the simple builder (UI, from `template`) instead of code. */
  visual: z.boolean().optional(),
  template: z.string().max(20).optional()
});

/** POST /api/s/:serverId/studio — new creation (empty or visual; the editor then asks the AI with the description, if any). */
export async function POST(req: NextRequest, { params }: ServerRouteContext) {
  const guard = await requirePermissionApi((await params).serverId, "studio");
  if ("error" in guard) return guard.error;
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  try {
    const id = await createCreation(guard.server.id, guard.user, parsed.data as Parameters<typeof createCreation>[2]);
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    if (error instanceof StudioError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
