import { gunzipSync } from "node:zlib";
import { NextRequest, NextResponse } from "next/server";
import { agentFilesSchema, receiveFromAgent } from "@/lib/resource-files";
import { serverForFivemToken } from "@/lib/servers";

export const runtime = "nodejs";

const MAX_BODY = 4_000_000;
const MAX_JSON = 30_000_000;

/**
 * POST /api/fivem/agent/files — answer of the agent (files.js) to a "files" command: the file list or contents of a
 * resource, or the result of a write. Same token as the agent. Body may be gzipped (header x-fiverax-gzip: 1).
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const server = await serverForFivemToken(auth.startsWith("Bearer ") ? auth.slice(7) : null);
  if (!server) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    const raw = Buffer.from(await req.arrayBuffer());
    if (raw.length > MAX_BODY) return NextResponse.json({ error: "too_large" }, { status: 413 });
    body = JSON.parse((req.headers.get("x-fiverax-gzip") === "1" ? gunzipSync(raw, { maxOutputLength: MAX_JSON }) : raw).toString("utf8"));
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = agentFilesSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation", issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join(".")) }, { status: 400 });
  await receiveFromAgent(server.id, parsed.data);
  return NextResponse.json({ ok: true });
}
