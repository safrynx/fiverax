import { NextRequest } from "next/server";
import { z } from "zod";
import { handleBotRequest } from "@/lib/bot-guard";
import { lastDiscordAuditAt, storeDiscordAudit } from "@/lib/discord-audit";
import { discordSnapshotSchema } from "@/lib/discord-audit-shared";
import { activeServerByGuild } from "@/lib/servers";

export const runtime = "nodejs";

const snowflake = z.string().regex(/^\d{17,20}$/);
const schema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("store"), guildId: snowflake, data: discordSnapshotSchema }),
  /** When the last audit was made (the bot audits each guild once a day). */
  z.object({ op: z.literal("last"), guildId: snowflake })
]);

/** POST /api/bot/discord-audit — store the bot's security audit of a guild (scored here), or ask its date. */
export function POST(req: NextRequest) {
  return handleBotRequest(req, schema, async (body) => {
    const server = await activeServerByGuild(body.guildId);
    if (!server) return { ignored: "unknown_guild" };
    if (body.op === "last") return { at: await lastDiscordAuditAt(server.id) };
    return storeDiscordAudit(server.id, body.data);
  });
}
