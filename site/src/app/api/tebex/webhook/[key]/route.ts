import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/lib/client-ip";
import { receiveWebhook, TEBEX_WEBHOOK_IPS } from "@/lib/tebex";

export const runtime = "nodejs";

/**
 * POST /api/tebex/webhook/:key — webhooks of a server's Tebex store (address shown in Boutique > Réglages).
 * The key finds the server; the X-Signature header (HMAC of the raw body with the webhook secret) proves it is Tebex.
 * With TEBEX_WEBHOOK_IP_CHECK=1, only Tebex's two addresses are accepted.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!/^[\w-]{16,64}$/.test(key)) return NextResponse.json({ error: "unknown_webhook" }, { status: 404 });
  if (process.env.TEBEX_WEBHOOK_IP_CHECK === "1") {
    const ip = clientIp(req.headers) ?? "";
    if (!TEBEX_WEBHOOK_IPS.includes(ip)) return NextResponse.json({ error: "unknown_webhook" }, { status: 404 });
  }
  const raw = await req.text();
  if (raw.length > 512_000) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const outcome = await receiveWebhook(key, raw, req.headers.get("x-signature"));
  return NextResponse.json(outcome.body, { status: outcome.status });
}
