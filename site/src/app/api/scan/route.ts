import { NextRequest, NextResponse } from "next/server";
import { getIdentity } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { runPublicScan, scanIpHash, ScanError } from "@/lib/external-scan";
import { getPlatformSettings } from "@/lib/platform";
import { KIT } from "@/lib/protection-shared";
import { KIT_FILES } from "@/lib/protection-kit";
import { zip } from "@/lib/zip";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST {target, force?} — free scan of a FiveM server from its public endpoints (no login; rate limited per address).
 * With `Accept: application/x-ndjson` the answer is streamed, one JSON object per line: {step} as each step ends,
 * then {token} or {error}. Otherwise one JSON answer ({token} or {error}).
 * `force` (logged-in visitors only) scans again a server scanned more than a minute ago, to check a fix.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { target?: unknown; force?: unknown };
  if (typeof body.target !== "string") return NextResponse.json({ error: "invalid_target" }, { status: 400 });
  const target = body.target;
  if (!(await getPlatformSettings()).publicScanEnabled) return NextResponse.json({ error: "scan_disabled" }, { status: 503 });
  const identity = await getIdentity();
  const who = { ipHash: scanIpHash(clientIp(req.headers)), discordId: identity?.discordId ?? null };
  const force = body.force === true;

  if (!(req.headers.get("accept") ?? "").includes("application/x-ndjson")) {
    try {
      const scan = await runPublicScan(target, who, { force });
      return NextResponse.json({ token: scan.token });
    } catch (error) {
      if (error instanceof ScanError) return NextResponse.json({ error: error.message }, { status: error.message === "rate_limited" ? 429 : 422 });
      throw error;
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: Record<string, unknown>) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      try {
        const scan = await runPublicScan(target, who, { force, onStep: (step) => send({ step }) });
        send({ token: scan.token });
      } catch (error) {
        if (!(error instanceof ScanError)) console.error("[scan]", error instanceof Error ? error.message : error);
        send({ error: error instanceof ScanError ? error.message : "internal", status: error instanceof ScanError && error.message === "rate_limited" ? 429 : 422 });
      } finally {
        controller.close();
      }
    }
  });
  return new NextResponse(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}

/** GET ?kit=<resource> — a resource of the protection kit as a .zip (logged-in visitors: the scan's details are theirs). */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("kit") ?? "";
  const kit = KIT.some((k) => k.key === key) ? KIT_FILES[key as keyof typeof KIT_FILES] : null;
  if (!kit) return NextResponse.json({ error: "unknown_kit" }, { status: 404 });
  if (!(await getIdentity())) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const archive = zip(kit.files.map((f) => ({ path: `${key}/${f.path}`, content: f.content })));
  return new NextResponse(Buffer.from(archive), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${key}.zip"`, "Cache-Control": "no-store" }
  });
}
