import { NextRequest, NextResponse } from "next/server";
import { ingestCapture, parseUpload } from "@/lib/blackbox";
import { serverForFivemToken } from "@/lib/servers";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/fivem/agent/blackbox — the agent's black box (blackbox.lua): a /report made in game, a capture asked from
 * the panel or an anticheat kick / ban, with the minutes before. Answers the report id (shown to the player in game).
 * Authenticated with the server's agent token. Idempotent on `ref`: the agent retries when it got no answer.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const server = await serverForFivemToken(auth.startsWith("Bearer ") ? auth.slice(7) : null);
  if (!server) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const upload = parseUpload(await req.json().catch(() => null));
  if (!upload) return NextResponse.json({ error: "validation" }, { status: 400 });
  const { id, created } = await ingestCapture(server.id, upload);
  return NextResponse.json({ ok: true, id, created });
}
