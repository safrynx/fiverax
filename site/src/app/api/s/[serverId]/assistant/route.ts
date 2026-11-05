import { NextRequest, NextResponse } from "next/server";
import { can, requirePermissionApi } from "@/lib/auth";
import {
  applyChange, discardChange, FilesError, getChange, listChanges, proposeChange, readStatus, requestRead, revertChange
} from "@/lib/resource-files";
import { allowedSet } from "@/lib/troubleshoot-perms";
import { troubleshoot, TroubleshootError, troubleshootSchema } from "@/lib/troubleshoot";
import type { ServerRouteContext } from "@/lib/route";

export const runtime = "nodejs";
export const maxDuration = 60;

function fail(error: unknown) {
  if (error instanceof TroubleshootError || error instanceof FilesError) {
    return NextResponse.json({ error: error.message }, { status: error.message.startsWith("ai_") ? 502 : 409 });
  }
  throw error;
}

/**
 * GET ?read=<command id> — a file read of the agent · ?change=<id> — a change · (nothing) — recent changes.
 * Permission `console`, plus `server_files` for anything about files.
 */
export async function GET(req: NextRequest, { params }: ServerRouteContext) {
  const sp = req.nextUrl.searchParams;
  const guard = await requirePermissionApi((await params).serverId, "server_files");
  if ("error" in guard) return guard.error;
  const serverId = guard.server.id;
  if (sp.get("read")) {
    const status = await readStatus(serverId, Number(sp.get("read")));
    return status ? NextResponse.json(status) : NextResponse.json({ error: "unknown_command" }, { status: 404 });
  }
  if (sp.get("change")) {
    const change = await getChange(serverId, Number(sp.get("change")));
    return change ? NextResponse.json(change) : NextResponse.json({ error: "unknown_change" }, { status: 404 });
  }
  return NextResponse.json({ changes: await listChanges(serverId) });
}

/**
 * POST (no action) {messages, resource?, files?, listed?} — one turn of the troubleshooting AI. When it asks for files
 * they are requested from the agent (`reads`, to follow with GET ?read=); its edits become a change to validate.
 * POST ?action=apply {id, restart} · revert {id} · discard {id} — the changes (permission `server_files`).
 */
export async function POST(req: NextRequest, { params }: ServerRouteContext) {
  const serverId = (await params).serverId;
  const action = req.nextUrl.searchParams.get("action");
  const guard = await requirePermissionApi(serverId, action ? "server_files" : "console");
  if ("error" in guard) return guard.error;
  const { user, server } = guard;
  const actor = { discordId: user.discordId, username: user.username };
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    if (action === "apply") return NextResponse.json(await applyChange(server.id, actor, Number(body.id), body.restart !== false));
    if (action === "revert") return NextResponse.json(await revertChange(server.id, actor, Number(body.id)));
    if (action === "discard") {
      await discardChange(server.id, Number(body.id));
      return NextResponse.json({ ok: true });
    }
    if (action) return NextResponse.json({ error: "validation" }, { status: 400 });

    const parsed = troubleshootSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "validation", issues: parsed.error.issues.map((i) => i.path.join(".")) }, { status: 400 });
    if (parsed.data.messages.at(-1)?.role !== "user") return NextResponse.json({ error: "validation" }, { status: 400 });
    const files = can(user, "server_files");
    const reply = await troubleshoot(server.id, parsed.data, { files, allowed: allowedSet(user) });

    const reads: { commandId: number; resource: string; paths?: string[] }[] = [];
    const rejected: string[] = [];
    for (const r of reply.read) {
      try {
        reads.push({ commandId: await requestRead(server.id, actor, r.resource, r.paths), resource: r.resource, paths: r.paths });
      } catch (error) {
        if (!(error instanceof FilesError)) throw error;
        rejected.push(`${r.resource} : lecture impossible (${error.message})`);
      }
    }
    const proposal = reply.edits.length ? await proposeChange(server.id, actor, reply.summary, reply.edits) : { change: null, rejected: [] };
    return NextResponse.json({ answer: reply.answer, actions: reply.actions, reads, change: proposal.change, rejected: [...rejected, ...proposal.rejected] });
  } catch (error) {
    return fail(error);
  }
}
