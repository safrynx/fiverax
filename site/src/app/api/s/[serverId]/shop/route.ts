import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { can, isOwner, requireStaffApi } from "@/lib/auth";
import type { Permission } from "@/lib/permissions";
import type { ServerRouteContext } from "@/lib/route";
import {
  addPaymentNote, banFromStore, createCheckout, createCoupon, createGiftCard, createManualPayment, deleteCoupon, lookupGiftCard,
  refreshAccount, rotateWebhookKey, saveShopConfig, setPaymentStatus, topUpGiftCard, updatePackage, voidGiftCard, type TebexResult
} from "@/lib/tebex";
import { shopConfigSchema } from "@/lib/tebex-shared";

export const runtime = "nodejs";
export const maxDuration = 30;

const id = z.number().int().positive();
const txn = z.string().trim().min(3).max(80);
const username = z.string().trim().min(1).max(64);
const money = z.number().min(0).max(100_000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** "owner" = the server's owners only (store secrets). */
const SCHEMAS = {
  config: { permission: "owner", schema: shopConfigSchema },
  webhook_rotate: { permission: "owner", schema: z.object({}) },
  refresh: { permission: "owner", schema: z.object({}) },
  payment_note: { permission: "shop_manage", schema: z.object({ txn, note: z.string().trim().min(1).max(500) }) },
  payment_status: { permission: "shop_manage", schema: z.object({ txn, status: z.enum(["complete", "refund", "chargeback"]), username }) },
  payment_create: {
    permission: "shop_manage",
    schema: z.object({ username, packageIds: z.array(id).min(1).max(10), price: money, note: z.string().trim().max(200).default("") })
  },
  package_update: { permission: "shop_manage", schema: z.object({ id, name: z.string().trim().min(1).max(100), price: money, disabled: z.boolean() }) },
  checkout: { permission: "shop_manage", schema: z.object({ packageId: id, username }) },
  store_ban: { permission: "shop_manage", schema: z.object({ user: username, reason: z.string().trim().min(1).max(200), ip: z.string().trim().max(45).default("") }) },
  coupon_create: {
    permission: "shop_promos",
    schema: z.object({
      code: z.string().trim().regex(/^[\w-]{3,40}$/),
      discountType: z.enum(["percentage", "value"]),
      amount: z.number().positive().max(100_000),
      effectiveOn: z.enum(["cart", "package", "category"]).default("cart"),
      ids: z.array(id).max(50).default([]),
      basketType: z.enum(["single", "subscription", "both"]).default("both"),
      minimum: money.default(0),
      limit: z.number().int().min(1).max(1_000_000).nullable().default(null),
      expireDate: day.nullable().default(null),
      username: z.string().trim().max(64).default(""),
      note: z.string().trim().max(200).default("")
    }).refine((c) => c.discountType !== "percentage" || c.amount <= 100, { message: "100 % au maximum", path: ["amount"] })
      .refine((c) => c.effectiveOn === "cart" || c.ids.length > 0, { message: "choisis au moins un élément", path: ["ids"] })
  },
  coupon_delete: { permission: "shop_promos", schema: z.object({ id, code: z.string().max(60) }) },
  giftcard_create: { permission: "shop_promos", schema: z.object({ amount: z.number().positive().max(10_000), note: z.string().trim().max(200).default(""), expiresAt: day.nullable().default(null) }) },
  giftcard_void: { permission: "shop_promos", schema: z.object({ id }) },
  giftcard_topup: { permission: "shop_promos", schema: z.object({ id, amount: z.number().positive().max(10_000) }) },
  giftcard_lookup: { permission: "shop_promos", schema: z.object({ code: z.string().trim().regex(/^[\w-]{4,40}$/) }) }
} satisfies Record<string, { permission: Permission | "owner"; schema: z.ZodTypeAny }>;

type Kind = keyof typeof SCHEMAS;

function reply(result: TebexResult<unknown>, extra: Record<string, unknown> = {}) {
  // Tebex's own 401/403 must not read as "your panel session expired": they become a 502 with our error code.
  if (!result.ok) return NextResponse.json({ error: result.error, message: result.message }, { status: result.error === "tebex_not_found" ? 404 : result.status === 409 ? 409 : 502 });
  return NextResponse.json({ ok: true, ...extra, data: result.data ?? null });
}

/** POST /api/s/:serverId/shop?kind=… — Tebex store: settings, payments, catalogue, promotions, store bans. */
export async function POST(req: NextRequest, { params }: ServerRouteContext) {
  const guard = await requireStaffApi((await params).serverId);
  if ("error" in guard) return guard.error;
  const { user, server } = guard;
  const kind = req.nextUrl.searchParams.get("kind") ?? "";
  if (!Object.hasOwn(SCHEMAS, kind)) return NextResponse.json({ error: "unknown_kind" }, { status: 400 });
  const { permission, schema } = SCHEMAS[kind as Kind];
  if (permission === "owner" ? !isOwner(user) : !can(user, permission)) return NextResponse.json({ error: permission === "owner" ? "forbidden" : "forbidden_permission", permission }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation", issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  const actor = { discordId: user.discordId, username: user.username };
  const s = server.id;
  const d = parsed.data as never;

  switch (kind as Kind) {
    case "config": {
      const result = await saveShopConfig(s, actor, d);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json({ ok: true, account: result.account });
    }
    case "webhook_rotate":
      return NextResponse.json({ ok: true, key: await rotateWebhookKey(s, actor) });
    case "refresh":
      return reply(await refreshAccount(s));
    case "payment_note": {
      const x = d as { txn: string; note: string };
      return reply(await addPaymentNote(s, actor, x.txn, x.note));
    }
    case "payment_status": {
      const x = d as { txn: string; status: "complete" | "refund" | "chargeback"; username: string };
      return reply(await setPaymentStatus(s, actor, x.txn, x.status, x.username));
    }
    case "payment_create":
      return reply(await createManualPayment(s, actor, d));
    case "package_update":
      return reply(await updatePackage(s, actor, d));
    case "checkout": {
      const x = d as { packageId: number; username: string };
      return reply(await createCheckout(s, actor, x.packageId, x.username));
    }
    case "store_ban":
      return reply(await banFromStore(s, actor, d));
    case "coupon_create":
      return reply(await createCoupon(s, actor, d));
    case "coupon_delete": {
      const x = d as { id: number; code: string };
      return reply(await deleteCoupon(s, actor, x.id, x.code));
    }
    case "giftcard_create":
      return reply(await createGiftCard(s, actor, d));
    case "giftcard_void":
      return reply(await voidGiftCard(s, actor, (d as { id: number }).id));
    case "giftcard_topup": {
      const x = d as { id: number; amount: number };
      return reply(await topUpGiftCard(s, actor, x.id, x.amount));
    }
    case "giftcard_lookup":
      return reply(await lookupGiftCard(s, (d as { code: string }).code));
  }
}
