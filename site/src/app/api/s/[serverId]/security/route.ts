import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { can, requireStaffApi } from "@/lib/auth";
import { enqueueCommand, getLiveState } from "@/lib/agent";
import { changeMemberRoles } from "@/lib/discord";
import { BAN_CATEGORY_KEYS, type BanCategory } from "@/lib/network-shared";
import type { Permission } from "@/lib/permissions";
import type { ServerRouteContext } from "@/lib/route";
import {
  banPlayer, getIncident, setBanSharing, getScreenshotImage, getSecuritySettings, markIncidentRestored, reviewDetection, revokeBan, saveSecuritySettings, setScreenshotVerdict
} from "@/lib/security";
import { anticheatSchema, antiraidSchema } from "@/lib/security-config";
import { enqueueBotAction, type BotActionKind } from "@/lib/security-live";
import { analyzeScreenshot } from "@/lib/vision";

export const runtime = "nodejs";
export const maxDuration = 60;

const id = z.number().int().positive();

const SCHEMAS = {
  anticheat_config: { permission: "security_config", schema: anticheatSchema },
  antiraid_config: { permission: "security_config", schema: antiraidSchema },
  ban: {
    permission: "ban",
    schema: z.object({
      playerId: id, reason: z.string().trim().min(1).max(300), hours: z.number().int().min(1).max(24 * 3650).nullable(),
      category: z.enum(BAN_CATEGORY_KEYS).default("other"),
      shared: z.boolean().default(true)
    })
  },
  ban_sharing: { permission: "ban", schema: z.object({ banId: id, shared: z.boolean().optional(), category: z.enum(BAN_CATEGORY_KEYS).optional() }) },
  unban: { permission: "ban", schema: z.object({ banId: id }) },
  detection_review: { permission: "view_security", schema: z.object({ id, status: z.enum(["open", "confirmed", "dismissed"]) }) },
  incident_restore: { permission: "security_config", schema: z.object({ id }) },
  screenshot_analyze: { permission: "screenshot", schema: z.object({ id }) },
  discord_lockdown: { permission: "security_config", schema: z.object({ minutes: z.number().int().min(1).max(1440), lockChannels: z.boolean() }) },
  discord_unlock: { permission: "security_config", schema: z.object({}) },
  discord_backup: { permission: "security_config", schema: z.object({}) },
  discord_restore: { permission: "security_config", schema: z.object({ backupId: id }) }
} satisfies Record<string, { permission: Permission; schema: z.ZodTypeAny }>;

type Kind = keyof typeof SCHEMAS;

/** POST /api/s/:serverId/security?kind=… — bans, anticheat / anti-raid settings, review of detections and incidents. */
export async function POST(req: NextRequest, { params }: ServerRouteContext) {
  const guard = await requireStaffApi((await params).serverId);
  if ("error" in guard) return guard.error;
  const { user, server } = guard;
  const kind = req.nextUrl.searchParams.get("kind") ?? "";
  if (!Object.hasOwn(SCHEMAS, kind)) return NextResponse.json({ error: "unknown_kind" }, { status: 400 });
  const { permission, schema } = SCHEMAS[kind as Kind];
  if (!can(user, permission)) return NextResponse.json({ error: "forbidden_permission", permission }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation", issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  const actor = { discordId: user.discordId, username: user.username };
  const data = parsed.data as Record<string, unknown>;

  switch (kind as Kind) {
    case "anticheat_config":
    case "antiraid_config":
      await saveSecuritySettings(server.id, actor, kind === "anticheat_config" ? "anticheat" : "antiraid", parsed.data as never);
      return NextResponse.json({ ok: true });

    case "ban": {
      const { playerId, reason, hours, category, shared } = data as { playerId: number; reason: string; hours: number | null; category: BanCategory; shared: boolean };
      const expiresAt = hours ? new Date(Date.now() + hours * 3600_000).toISOString() : null;
      if (!(await banPlayer(server.id, actor, { playerId, reason, source: "manual", expiresAt, category, shared }))) return NextResponse.json({ error: "unknown_player" }, { status: 404 });
      // In game right now: drop them at once (the agent also refuses them at their next connection).
      const live = await getLiveState(server.id);
      const inGame = live.online ? live.players.find((p) => p.playerId === playerId) : undefined;
      if (inGame) {
        const { anticheat } = await getSecuritySettings(server.id);
        await enqueueCommand(server.id, actor, "kick", { target: inGame.id, reason: `${anticheat.banMessage}\nRaison : ${reason}` }, { playerName: inGame.name, targetDiscordId: inGame.discordId });
      }
      return NextResponse.json({ ok: true, kicked: Boolean(inGame) });
    }

    case "ban_sharing": {
      const { banId, shared, category } = data as { banId: number; shared?: boolean; category?: BanCategory };
      if (!(await setBanSharing(server.id, actor, banId, { shared, category }))) return NextResponse.json({ error: "unknown_ban" }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    case "unban":
      if (!(await revokeBan(server.id, actor, (data as { banId: number }).banId))) return NextResponse.json({ error: "unknown_ban" }, { status: 404 });
      return NextResponse.json({ ok: true });

    case "detection_review": {
      const { id: detectionId, status } = data as { id: number; status: "open" | "confirmed" | "dismissed" };
      if (!(await reviewDetection(server.id, actor, detectionId, status))) return NextResponse.json({ error: "unknown_detection" }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    case "incident_restore": {
      const incident = await getIncident(server.id, (data as { id: number }).id);
      if (!incident || !incident.actorId) return NextResponse.json({ error: "unknown_incident" }, { status: 404 });
      if (incident.restoredAt || incident.removedRoles.length === 0) return NextResponse.json({ error: "nothing_to_restore" }, { status: 409 });
      const result = await changeMemberRoles(server.guildId, incident.actorId, incident.removedRoles, [], `Fiverax : rôles rendus par ${user.username}`);
      if (!result.ok) return NextResponse.json({ error: "discord_role_update_failed", discordStatus: result.status }, { status: 502 });
      await markIncidentRestored(server.id, actor, incident.id);
      return NextResponse.json({ ok: true });
    }

    case "discord_lockdown":
    case "discord_unlock":
    case "discord_backup":
    case "discord_restore": {
      if (!server.guildId) return NextResponse.json({ error: "no_guild" }, { status: 409 });
      const action = kind.slice("discord_".length) as BotActionKind;
      return NextResponse.json({ ok: true, id: await enqueueBotAction(server.id, actor, action, data) });
    }

    case "screenshot_analyze": {
      const shotId = (data as { id: number }).id;
      const shot = await getScreenshotImage(server.id, shotId);
      if (!shot) return NextResponse.json({ error: "unknown_screenshot" }, { status: 404 });
      const verdict = await analyzeScreenshot(shot.image, shot.mime);
      await setScreenshotVerdict(server.id, shotId, verdict);
      return NextResponse.json({ ok: true, ...verdict });
    }
  }
}
