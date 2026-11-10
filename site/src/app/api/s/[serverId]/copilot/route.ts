import { NextRequest, NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/auth";
import { copilot, CopilotError, copilotSchema } from "@/lib/copilot";
import { AiQuotaError } from "@/lib/ai-quota";
import type { ServerRouteContext } from "@/lib/route";

export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * POST /api/s/:serverId/copilot {messages} — one question to the Copilote IA (whole panel). Any member of the panel
 * may ask; the actions it proposes are limited to their permissions, and the browser runs them through the usual
 * routes once confirmed (which check permissions and hierarchy again).
 */
export async function POST(req: NextRequest, { params }: ServerRouteContext) {
  const guard = await requireStaffApi((await params).serverId);
  if ("error" in guard) return guard.error;
  const { user, server } = guard;

  const parsed = copilotSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation", issues: parsed.error.issues.map((i) => i.path.join(".")) }, { status: 400 });
  if (parsed.data.messages.at(-1)?.role !== "user") return NextResponse.json({ error: "validation" }, { status: 400 });

  try {
    return NextResponse.json(await copilot(user, server, parsed.data));
  } catch (error) {
    if (error instanceof CopilotError || error instanceof AiQuotaError) {
      return NextResponse.json({ error: error.message }, { status: error.message === "ai_quota_exceeded" ? 429 : 502 });
    }
    throw error;
  }
}
