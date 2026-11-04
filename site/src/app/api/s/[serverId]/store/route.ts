import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermissionApi } from "@/lib/auth";
import type { ServerRouteContext } from "@/lib/route";
import {
  ensureStoreSite, generateStoreDesign, getStoreSite, loadStoreData, publishStore, restoreStoreVersion, saveDraft, setStoreSlug, StoreError, unpublishStore, type StoreSite
} from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 120;

const SCHEMAS = {
  save: z.object({ design: z.record(z.unknown()) }),
  publish: z.object({}),
  unpublish: z.object({}),
  slug: z.object({ slug: z.string().trim().toLowerCase().max(40) }),
  restore: z.object({ versionId: z.number().int().positive() }),
  ai: z.object({ prompt: z.string().trim().min(3).max(1500) })
};
type Kind = keyof typeof SCHEMAS;

const out = (site: StoreSite, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: true, slug: site.slug, draft: site.draft, publishedAt: site.publishedAt, dirty: site.dirty, ...extra });

/** POST /api/s/:serverId/store?kind=… — Store Creator: draft, publication, address, versions, AI. Permission store_edit. */
export async function POST(req: NextRequest, { params }: ServerRouteContext) {
  const guard = await requirePermissionApi((await params).serverId, "store_edit");
  if ("error" in guard) return guard.error;
  const { user, server } = guard;
  const kind = req.nextUrl.searchParams.get("kind") ?? "";
  if (!Object.hasOwn(SCHEMAS, kind)) return NextResponse.json({ error: "unknown_kind" }, { status: 400 });
  const parsed = SCHEMAS[kind as Kind].safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  const actor = { discordId: user.discordId, username: user.username };
  const data = parsed.data as Record<string, unknown>;

  try {
    // The site exists from the first visit of the editor; created here too for API-only use.
    if (!(await getStoreSite(server.id))) await ensureStoreSite(server, await loadStoreData(server.id));
    switch (kind as Kind) {
      case "save":
        return out(await saveDraft(server.id, actor, data.design));
      case "publish":
        return out(await publishStore(server.id, actor));
      case "unpublish":
        return out(await unpublishStore(server.id, actor));
      case "slug":
        return out(await setStoreSlug(server.id, actor, String(data.slug)));
      case "restore":
        return out(await restoreStoreVersion(server.id, actor, Number(data.versionId)));
      case "ai": {
        const { site, summary } = await generateStoreDesign(server, actor, String(data.prompt));
        return out(site, { summary });
      }
    }
  } catch (error) {
    if (error instanceof StoreError) {
      const status = error.message.startsWith("ai_") ? (error.message === "ai_not_configured" ? 409 : 502) : error.message === "slug_taken" ? 409 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    throw error;
  }
}
