import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enqueueCommand, playerOfSession } from "@/lib/agent";
import { sendAnticheatAlert } from "@/lib/alerts";
import { banExpiry, decodeImage, getSecuritySettings, recordDetection, setScreenshotVerdict, storeScreenshot, SYSTEM_ACTOR } from "@/lib/security";
import { serverForFivemToken } from "@/lib/servers";
import { analyzeScreenshot } from "@/lib/vision";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  session: z.string().min(1).max(128).optional(),
  /** Server id of the player (to kick them if the AI bans). */
  target: z.number().int().nonnegative().optional(),
  name: z.string().max(100),
  /** Detection kind that asked for it, "manual" (panel) or "random". */
  reason: z.string().regex(/^[a-z_]{2,40}$/),
  requestedBy: z.string().regex(/^\d{17,20}$/).optional(),
  /** data:image/jpeg;base64,… (screenshot-basic) */
  image: z.string().min(30).max(4_000_000)
});

/**
 * POST /api/fivem/agent/screenshot — a player's screenshot taken by the agent (screenshot-basic). Stored, then analysed
 * by the vision model; a "cheat" verdict is recorded as a detection and may ban the player (setting ai.autoBanScore).
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const server = await serverForFivemToken(auth.startsWith("Bearer ") ? auth.slice(7) : null);
  if (!server) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation", issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join(".")) }, { status: 400 });
  const data = parsed.data;
  const image = decodeImage(data.image);
  if (!image) return NextResponse.json({ error: "invalid_image" }, { status: 400 });

  const playerId = await playerOfSession(server.id, data.session);
  const id = await storeScreenshot(server.id, { playerId, playerName: data.name, reason: data.reason, bytes: image.bytes, mime: image.mime, requestedBy: data.requestedBy ?? null });

  const { anticheat } = await getSecuritySettings(server.id);
  if (!anticheat.ai.enabled) {
    await setScreenshotVerdict(server.id, id, { verdict: "skipped", score: null, summary: "Analyse IA désactivée" });
    return NextResponse.json({ ok: true, id, verdict: "skipped" });
  }
  // Counted against this server only: requestedBy comes from the agent, so it must not charge anyone's own quota.
  const verdict = await analyzeScreenshot(image.bytes, image.mime, { serverId: server.id, userId: null });
  await setScreenshotVerdict(server.id, id, verdict);

  if (verdict.verdict === "cheat") {
    const setting = anticheat.detections.ai_screenshot;
    const autoBan = anticheat.ai.autoBanScore > 0 && (verdict.score ?? 0) >= anticheat.ai.autoBanScore;
    const action = autoBan ? "ban" : setting.action === "off" ? null : setting.action;
    if (action) {
      await recordDetection(
        server.id,
        { playerId, playerName: data.name, kind: "ai_screenshot", details: { score: verdict.score, summary: verdict.summary }, action, screenshotId: id },
        new Date(),
        { source: "ai", reason: `IA : ${verdict.summary ?? "triche visible à l'écran"}`, expiresAt: banExpiry(anticheat.banHours) }
      );
      await sendAnticheatAlert(anticheat, server.name, {
        kind: "ai_screenshot", action, playerName: data.name, note: `${verdict.summary ?? ""} (confiance ${verdict.score ?? "?"} %)`,
        url: playerId ? `${(process.env.APP_URL || "").replace(/\/+$/, "")}/s/${server.id}/players/${playerId}` : null
      });
      if ((action === "ban" || action === "kick") && data.target !== undefined) {
        await enqueueCommand(server.id, SYSTEM_ACTOR, "kick", { target: data.target, reason: action === "ban" ? anticheat.banMessage : "Anticheat : triche détectée" }, { playerName: data.name });
      }
    }
  }
  return NextResponse.json({ ok: true, id, verdict: verdict.verdict });
}
