import { NextRequest, NextResponse } from "next/server";
import { getIdentity } from "@/lib/auth";
import { runPublicScan, scanIpHash, ScanError } from "@/lib/external-scan";
import { KIT } from "@/lib/protection-shared";
import { KIT_FILES } from "@/lib/protection-kit";
import { zip } from "@/lib/zip";

export const runtime = "nodejs";
export const maxDuration = 30;

/** POST {target} — free scan of a FiveM server from its public endpoints (no login; rate limited per address). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { target?: unknown };
  if (typeof body.target !== "string") return NextResponse.json({ error: "invalid_target" }, { status: 400 });
  const identity = await getIdentity();
  try {
    const scan = await runPublicScan(body.target, {
      ipHash: scanIpHash(req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip")),
      discordId: identity?.discordId ?? null
    });
    return NextResponse.json({ token: scan.token });
  } catch (error) {
    if (error instanceof ScanError) return NextResponse.json({ error: error.message }, { status: error.message === "rate_limited" ? 429 : 422 });
    throw error;
  }
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
