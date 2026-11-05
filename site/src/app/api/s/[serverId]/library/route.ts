import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { can, requireStaffApi } from "@/lib/auth";
import {
  installItem, LibraryError, moderateItem, publishCreation, reportItem, toggleLike, unpublishItem, updateInstalled
} from "@/lib/library";
import type { Permission } from "@/lib/permissions";
import type { ServerRouteContext } from "@/lib/route";
import { StudioError } from "@/lib/studio";

export const runtime = "nodejs";

const id = z.number().int().positive();

const SCHEMAS = {
  publish: {
    permission: "library_publish",
    schema: z.object({
      creationId: id,
      title: z.string().trim().min(3).max(60),
      description: z.string().trim().min(10).max(2000),
      tags: z.array(z.string().max(30)).max(10).default([]),
      changelog: z.string().trim().max(500).nullable().optional()
    })
  },
  unpublish: { permission: "library_publish", schema: z.object({ itemId: id }) },
  install: { permission: "studio", schema: z.object({ itemId: id }) },
  update: { permission: "studio", schema: z.object({ creationId: id }) },
  like: { permission: "studio", schema: z.object({ itemId: id }) },
  report: { permission: "studio", schema: z.object({ itemId: id, reason: z.string().trim().min(5).max(300) }) },
  /** Platform owners only (checked below). */
  moderate: { permission: "studio", schema: z.object({ itemId: id, status: z.enum(["published", "removed"]) }) }
} satisfies Record<string, { permission: Permission; schema: z.ZodTypeAny }>;

type Kind = keyof typeof SCHEMAS;

/** POST /api/s/:serverId/library?kind=… — publish to / install from the network library, likes and reports. */
export async function POST(req: NextRequest, { params }: ServerRouteContext) {
  const guard = await requireStaffApi((await params).serverId);
  if ("error" in guard) return guard.error;
  const { user, server } = guard;
  const kind = req.nextUrl.searchParams.get("kind") ?? "";
  if (!Object.hasOwn(SCHEMAS, kind)) return NextResponse.json({ error: "unknown_kind" }, { status: 400 });
  const { permission, schema } = SCHEMAS[kind as Kind];
  if (!can(user, permission)) return NextResponse.json({ error: "forbidden_permission", permission }, { status: 403 });
  if (kind === "moderate" && !user.platformOwner) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation", issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  const actor = { discordId: user.discordId, username: user.username };
  const data = parsed.data as unknown as { itemId: number; creationId: number; reason: string; status: "published" | "removed" };

  try {
    switch (kind as Kind) {
      case "publish": {
        const d = parsed.data as z.infer<typeof SCHEMAS.publish.schema>;
        return NextResponse.json({ ok: true, ...(await publishCreation(server.id, actor, d.creationId, d)) });
      }
      case "unpublish":
        if (!(await unpublishItem(server.id, actor, data.itemId))) return NextResponse.json({ error: "unknown_item" }, { status: 404 });
        return NextResponse.json({ ok: true });
      case "install":
        return NextResponse.json({ ok: true, ...(await installItem(server.id, actor, data.itemId)) });
      case "update":
        return NextResponse.json({ ok: true, creation: await updateInstalled(server.id, actor, data.creationId) });
      case "like":
        return NextResponse.json({ ok: true, ...(await toggleLike(server.id, actor, data.itemId)) });
      case "report":
        return NextResponse.json({ ok: true, ...(await reportItem(server.id, actor, data.itemId, data.reason)) });
      case "moderate":
        if (!(await moderateItem(data.itemId, data.status))) return NextResponse.json({ error: "unknown_item" }, { status: 404 });
        return NextResponse.json({ ok: true });
    }
  } catch (error) {
    if (error instanceof LibraryError) {
      const status = error.message.startsWith("unknown") || error.message === "not_installed" ? 404 : 409;
      return NextResponse.json({ error: error.message, details: error.details }, { status });
    }
    if (error instanceof StudioError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
