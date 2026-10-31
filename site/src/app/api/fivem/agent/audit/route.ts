import { gunzipSync } from "node:zlib";
import { NextRequest, NextResponse } from "next/server";
import { AuditError, failScan, filesSchema, finishScan, inventorySchema, receiveFiles, receiveInventory, shouldAutoScan } from "@/lib/server-audit";
import { serverForFivemToken } from "@/lib/servers";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY = 4_000_000;
const MAX_JSON = 60_000_000;

/**
 * POST /api/fivem/agent/audit?phase=ping|inventory|files|done|error — the server audit collected by the agent
 * (audit.js), see lib/server-audit.ts. Same token as the agent. Bodies may be gzipped (header x-fiverax-gzip: 1).
 * Code sent here is analysed then dropped, never stored nor logged.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const server = await serverForFivemToken(auth.startsWith("Bearer ") ? auth.slice(7) : null);
  if (!server) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    const raw = Buffer.from(await req.arrayBuffer());
    if (raw.length > MAX_BODY) return NextResponse.json({ error: "too_large" }, { status: 413 });
    const text = (req.headers.get("x-fiverax-gzip") === "1" ? gunzipSync(raw, { maxOutputLength: MAX_JSON }) : raw).toString("utf8");
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const phase = req.nextUrl.searchParams.get("phase");
  try {
    switch (phase) {
      case "ping":
        return NextResponse.json({ go: await shouldAutoScan(server.id) });
      case "inventory": {
        const parsed = inventorySchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: "validation", issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join(".")) }, { status: 400 });
        return NextResponse.json(await receiveInventory(server.id, parsed.data));
      }
      case "files": {
        const parsed = filesSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
        return NextResponse.json({ ok: true, analyzed: await receiveFiles(server.id, parsed.data) });
      }
      case "done": {
        const report = await finishScan(server.id, Number(body.scanId));
        return NextResponse.json({ ok: true, score: report.score, findings: report.findings.length });
      }
      case "error":
        await failScan(server.id, Number(body.scanId), String(body.message ?? "Erreur de l'agent"));
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: "unknown_phase" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof AuditError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
