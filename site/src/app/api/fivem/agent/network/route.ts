import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkConnection } from "@/lib/network";
import { serverForFivemToken } from "@/lib/servers";

export const runtime = "nodejs";

/** Lua's json.encode turns an empty table into `{}`. */
const list = (max: number) =>
  z.preprocess((v) => (v && typeof v === "object" && !Array.isArray(v) ? [] : v ?? []), z.array(z.string().max(200)).max(max));

const schema = z.object({ identifiers: list(30), tokens: list(30) });

/**
 * POST /api/fivem/agent/network — asked by the agent at each connection when the server's network mode is "block":
 * may this player join? Answers { blocked, message }. The agent lets the player in if this does not answer quickly.
 * Never logs the body (player identifiers).
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const server = await serverForFivemToken(auth.startsWith("Bearer ") ? auth.slice(7) : null);
  if (!server) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  const identifiers = parsed.data.identifiers.filter((id) => !id.startsWith("ip:"));
  const verdict = await checkConnection(server.id, identifiers, parsed.data.tokens);
  return NextResponse.json({ blocked: verdict.blocked, servers: verdict.blockingServers, message: verdict.message });
}
