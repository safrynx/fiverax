import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AdminError, adminAddOwner, adminBanUser, adminDeleteServer, adminModerateLibrary, adminModerateReview, adminRemoveOwner, adminResetAi,
  adminRevokeSession, adminRevokeUserSessions, adminSuspendServer, adminUnbanUser, adminUnsuspendServer
} from "@/lib/admin";
import { requirePlatformOwnerApi } from "@/lib/auth";
import { addPartner, approveRequest, BetaError, refuseRequest, removePartner, setFeedbackStatus } from "@/lib/beta";
import { updateBotIdentity } from "@/lib/bot-profile";
import { saveBotPresence, savePlatformSettings } from "@/lib/platform";
import { platformSettingsSchema } from "@/lib/platform-shared";
import { SERVER_ID_PATTERN } from "@/lib/servers";

export const runtime = "nodejs";

const serverId = z.string().regex(SERVER_ID_PATTERN);
const discordId = z.string().regex(/^\d{17,20}$/);
const reason = z.string().trim().min(3).max(300);
const moderation = z.enum(["published", "removed"]);

const SCHEMAS = {
  settings_save: z.object({ settings: platformSettingsSchema }),
  server_suspend: z.object({ serverId, reason }),
  server_unsuspend: z.object({ serverId }),
  server_delete: z.object({ serverId, confirm: z.string().max(60) }),
  server_owner_add: z.object({ serverId, discordId }),
  server_owner_remove: z.object({ serverId, discordId }),
  server_ai_reset: z.object({ serverId }),
  user_ban: z.object({ discordId, reason }),
  user_unban: z.object({ discordId }),
  user_sessions_revoke: z.object({ discordId }),
  session_revoke: z.object({ sessionId: z.string().regex(/^[\w-]{16,64}$/) }),
  review_moderate: z.object({ reviewId: z.number().int().positive(), status: moderation }),
  library_moderate: z.object({ itemId: z.number().int().positive(), status: moderation }),
  partner_add: z.object({ discordId }),
  partner_remove: z.object({ discordId }),
  beta_approve: z.object({ discordId }),
  beta_refuse: z.object({ discordId }),
  feedback_status: z.object({ id: z.number().int().positive(), status: z.enum(["new", "seen", "done"]), note: z.string().max(500).nullable().default(null) }),
  bot_identity: z.object({
    username: z.string().trim().min(2).max(32).optional(),
    description: z.string().max(400).optional(),
    avatar: z.string().max(2_100_000).nullable().optional(),
    banner: z.string().max(2_100_000).nullable().optional()
  }),
  bot_presence: z.object({ presence: platformSettingsSchema.shape.bot })
} satisfies Record<string, z.ZodTypeAny>;

type Action = keyof typeof SCHEMAS;
type Actor = { discordId: string; username: string };
type Result = Record<string, unknown> | void;

/** One handler per action, typed by its schema. */
const HANDLERS: { [K in Action]: (data: z.infer<(typeof SCHEMAS)[K]>, actor: Actor) => Promise<Result> } = {
  settings_save: async (d, actor) => ({ settings: await savePlatformSettings(actor, d.settings) }),
  server_suspend: (d, actor) => adminSuspendServer(actor, d.serverId, d.reason),
  server_unsuspend: (d, actor) => adminUnsuspendServer(actor, d.serverId),
  server_delete: (d, actor) => adminDeleteServer(actor, d.serverId, d.confirm),
  server_owner_add: (d, actor) => adminAddOwner(actor, d.serverId, d.discordId),
  server_owner_remove: (d, actor) => adminRemoveOwner(actor, d.serverId, d.discordId),
  server_ai_reset: (d, actor) => adminResetAi(actor, d.serverId),
  user_ban: async (d, actor) => ({ sessionsClosed: await adminBanUser(actor, d.discordId, d.reason) }),
  user_unban: (d, actor) => adminUnbanUser(actor, d.discordId),
  user_sessions_revoke: async (d, actor) => ({ sessionsClosed: await adminRevokeUserSessions(actor, d.discordId) }),
  session_revoke: (d, actor) => adminRevokeSession(actor, d.sessionId),
  review_moderate: (d, actor) => adminModerateReview(actor, d.reviewId, d.status),
  library_moderate: (d, actor) => adminModerateLibrary(actor, d.itemId, d.status),
  partner_add: (d, actor) => addPartner(actor, d.discordId),
  partner_remove: (d, actor) => removePartner(actor, d.discordId),
  beta_approve: (d, actor) => approveRequest(actor, d.discordId),
  beta_refuse: (d, actor) => refuseRequest(actor, d.discordId),
  feedback_status: (d, actor) => setFeedbackStatus(actor, d.id, d.status, d.note),
  bot_identity: async (d, actor) => {
    const result = await updateBotIdentity(actor, d);
    return result.ok ? { identity: result.identity } : { failure: result };
  },
  bot_presence: async (d, actor) => ({ presence: (await saveBotPresence(actor, d.presence)).bot })
};

const STATUS: Record<string, number> = {
  unknown_server: 404, unknown_session: 404, unknown_review: 404, unknown_item: 404, not_found: 404, unknown_request: 404, unknown_feedback: 404,
  already_exists: 409, last_owner: 409, not_banned: 409, legacy_server: 409, not_partner: 409,
  confirm_mismatch: 400, cannot_ban_self: 400, cannot_ban_admin: 400,
  bot_unavailable: 503, discord_unreachable: 502, discord_rate_limited: 429, discord_rejected: 400, invalid_image: 400
};

/** POST /api/admin?action=… — the actions of the platform administration (/admin). Platform owners only, each one journaled. */
export async function POST(req: NextRequest) {
  const guard = await requirePlatformOwnerApi();
  if ("error" in guard) return guard.error;
  const actor = { discordId: guard.identity.discordId, username: guard.identity.username };

  const action = req.nextUrl.searchParams.get("action") ?? "";
  if (!Object.hasOwn(SCHEMAS, action)) return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  const parsed = SCHEMAS[action as Action].safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  }
  try {
    const handler = HANDLERS[action as Action] as (data: unknown, actor: Actor) => Promise<Result>;
    const result = await handler(parsed.data, actor);
    // Discord refused (bot profile): its error code, and its own message when it helps.
    const failure = result?.failure as { error: string } | undefined;
    if (failure) return NextResponse.json(failure, { status: STATUS[failure.error] ?? 400 });
    return NextResponse.json({ ok: true, ...(result ?? {}) });
  } catch (error) {
    if (error instanceof AdminError || error instanceof BetaError) return NextResponse.json({ error: error.message }, { status: STATUS[error.message] ?? 400 });
    throw error;
  }
}
