import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp } from "@/lib/client-ip";
import { finishCheckout, startCheckout } from "@/lib/store";
import { isValidStoreSlug } from "@/lib/store-design";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/store/:slug/checkout — public (store visitors, no panel account).
 * step "start": a Tebex basket and its Cfx.re sign-in links. step "finish": packages and codes into the basket,
 * then what the page needs to open the Tebex checkout. Only the public Tebex token is used; prices are Tebex's.
 */

const item = z.object({ packageId: z.number().int().positive(), quantity: z.number().int().min(1).max(99) });
const code = z.string().trim().max(60).optional().default("");
const schema = z.discriminatedUnion("step", [
  z.object({ step: z.literal("start") }),
  z.object({ step: z.literal("finish"), ident: z.string().regex(/^[\w-]{6,80}$/), items: z.array(item).min(1).max(20), coupon: code, giftCard: code, creatorCode: code })
]);

/** Per visitor: 12 baskets and 40 calls in 10 minutes, per instance (enough for people, not for scripts). */
const WINDOW_MS = 10 * 60_000;
const globalHits = globalThis as unknown as { storeHits?: Map<string, number[]> };
const hits = (globalHits.storeHits ??= new Map<string, number[]>());

function limited(key: string, max: number, now = Date.now()): boolean {
  const list = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  return list.length > max;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isValidStoreSlug(slug)) return NextResponse.json({ error: "store_unavailable" }, { status: 404 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation" }, { status: 400 });
  const ip = clientIp(req.headers);
  const who = ip ?? "unknown";
  if (limited(`all:${who}`, 40) || (parsed.data.step === "start" && limited(`start:${who}`, 12))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const result = parsed.data.step === "start"
    ? await startCheckout(slug, ip)
    : await finishCheckout(slug, parsed.data.ident, parsed.data.items, parsed.data);
  if (!result.ok) {
    const status = result.status === 404 || result.status === 409 || result.status === 400 ? result.status : 502;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json(result.data);
}
