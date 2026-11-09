import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { getIdentity, listAccessibleServers, requireIdentityApi } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/config";
import { rateLimit } from "@/lib/rate-limit";
import { recordReferral } from "@/lib/referrals";
import { REF_COOKIE } from "@/lib/referrals-shared";
import { createServerFor } from "@/lib/servers";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().trim().min(2).max(60),
  guildId: z.string().regex(/^\d{17,20}$/).nullable().optional()
});

/** GET /api/servers — the servers the logged-in user can open. */
export async function GET() {
  const identity = await getIdentity();
  if (!identity) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const servers = await listAccessibleServers(identity);
  return NextResponse.json({ servers: servers.map((s) => ({ id: s.id, name: s.name, guildId: s.guildId })) });
}

const STATUS: Record<string, number> = { guild_taken: 409, too_many_servers: 409, guild_required: 400, guild_not_managed: 403, registrations_closed: 403 };

/** POST /api/servers — register a Discord guild the user manages as a new server; they become its owner. */
export async function POST(req: NextRequest) {
  const guard = await requireIdentityApi();
  if ("error" in guard) return guard.error;
  const { identity } = guard;
  // Creating and deleting in a loop would spam the logs and the Discord API: a few creations per hour are plenty.
  if (!(await rateLimit(`server_create:${identity.discordId}`, 10, 3600))) return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation", issues: parsed.error.issues }, { status: 400 });

  const result = await createServerFor(
    { discordId: identity.discordId, platformOwner: isPlatformOwner(identity.discordId) },
    { name: parsed.data.name, guildId: parsed.data.guildId ?? null }
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS[result.error] ?? 400 });
  await audit(result.server.id, { discordId: identity.discordId, username: identity.username }, "server_create", null, {
    nom: result.server.name, guilde: result.server.guildId
  });
  // Came through a referral link (/r/<code>): the new server becomes that server's referral (checked in lib/referrals).
  const ref = req.cookies.get(REF_COOKIE)?.value;
  const referred = await recordReferral(ref, result.server.id, identity.discordId).catch(() => false);
  const res = NextResponse.json({ ok: true, server: result.server, referred });
  if (ref) res.cookies.delete(REF_COOKIE);
  return res;
}
