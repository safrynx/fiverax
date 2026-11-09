import { NextResponse } from "next/server";
import { getIdentity } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/config";
import { systemChecks } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — is the site configured and is the database reachable? 200 or 503, for uptime monitors.
 * Anyone gets the verdict only; a logged-in platform admin also gets the details (missing variables, database
 * error), which used to be public and told strangers how the site is set up. The same report is on /admin/system.
 */
export async function GET() {
  const report = await systemChecks();
  const identity = await getIdentity().catch(() => null);
  const body = identity && isPlatformOwner(identity.discordId)
    ? { ok: report.ok, app: "fiverax", missingEnv: report.missingEnv, database: report.database, warnings: report.warnings.map((w) => w.label) }
    : { ok: report.ok, app: "fiverax" };
  return NextResponse.json(body, { status: report.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
