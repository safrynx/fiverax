import { NextRequest } from "next/server";
import { z } from "zod";
import { handleBotRequest } from "@/lib/bot-guard";
import { getBackupData, lastBackupAt, storeBackup } from "@/lib/security-live";
import { activeServerByGuild } from "@/lib/servers";

export const runtime = "nodejs";

const snowflake = z.string().regex(/^\d{17,20}$/);
const overwrite = z.object({ id: snowflake, type: z.number().int(), allow: z.string().max(30), deny: z.string().max(30) });

const backupSchema = z.object({
  roles: z.array(z.object({
    id: snowflake, name: z.string().max(100), color: z.number().int(), hoist: z.boolean(), mentionable: z.boolean(),
    permissions: z.string().max(30), position: z.number().int(), managed: z.boolean()
  })).max(300),
  channels: z.array(z.object({
    id: snowflake, name: z.string().max(100), type: z.number().int(), parentId: snowflake.nullable(), position: z.number().int(),
    topic: z.string().max(1100).nullable().optional(), nsfw: z.boolean().optional(), bitrate: z.number().int().optional(), userLimit: z.number().int().optional(),
    rateLimitPerUser: z.number().int().optional(), overwrites: z.array(overwrite).max(200)
  })).max(600),
  /** member id -> role ids */
  members: z.record(snowflake, z.array(snowflake).max(250))
});

const schema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("store"), guildId: snowflake, reason: z.string().max(60), data: backupSchema }),
  z.object({ op: z.literal("get"), guildId: snowflake, id: z.number().int().positive() }),
  /** When the last backup was taken (the bot backs up every N hours). */
  z.object({ op: z.literal("last"), guildId: snowflake })
]);

/** POST /api/bot/backup — store a backup of a guild's roles and channels, read one back (restore), or ask its date. */
export function POST(req: NextRequest) {
  return handleBotRequest(req, schema, async (body) => {
    const server = await activeServerByGuild(body.guildId);
    if (!server) return { ignored: "unknown_guild" };
    if (body.op === "store") return { id: await storeBackup(server.id, body.reason, body.data) };
    if (body.op === "last") return { at: await lastBackupAt(server.id) };
    const data = await getBackupData(server.id, body.id);
    return data ? { data } : { error: "unknown_backup" };
  });
}
