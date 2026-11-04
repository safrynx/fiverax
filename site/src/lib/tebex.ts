import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { auditStmt } from "./audit";
import { db, stmt } from "./db";
import { DEFAULT_SHOP_ALERTS, EVENT_TYPES, eventMeta, formatMoney, shopAlertsSchema, type ShopAlerts, type ShopConfigInput } from "./tebex-shared";

/**
 * Shop of a server, through Tebex only.
 *
 * - Plugin API (https://plugin.tebex.io, header X-Tebex-Secret = secret key of the Tebex game server): payments,
 *   notes, manual payments, packages (rename / price / disable), checkout links, coupons, gift cards, Tebex bans,
 *   customer lookup, command queue, community goals, sales.
 * - Headless API (https://headless.tebex.io, public webstore token, no secret): the catalogue (categories and
 *   packages), which the Plugin API no longer lists.
 * - Webhooks (POST /api/tebex/webhook/<webhook key>, signed with the webhook secret): every payment, refund,
 *   dispute and subscription event is kept in tebex_events and feeds the sales figures; optional Discord alerts.
 *
 * The secret key and the webhook secret are stored encrypted (AES-256-GCM, key derived from TEBEX_ENCRYPTION_KEY,
 * else SESSION_SECRET: changing it means typing the secrets again). Delivery of the purchased commands stays the
 * job of the official Tebex resource on the FiveM server; the panel only shows the queue.
 */

const PLUGIN_API = "https://plugin.tebex.io";
/** TEBEX_HEADLESS_URL: tests and local previews only (a stand-in for the Headless API). */
export const HEADLESS_API = (process.env.TEBEX_HEADLESS_URL || "https://headless.tebex.io/api").replace(/\/+$/, "");
/** Tebex sends its webhooks from these addresses only (checked when TEBEX_WEBHOOK_IP_CHECK=1). */
export const TEBEX_WEBHOOK_IPS = ["18.209.80.3", "54.87.231.232"];

type Actor = { discordId: string; username: string };

// ---- secrets ----

function cipherKey(): Buffer {
  const base = process.env.TEBEX_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!base) throw new Error("SESSION_SECRET (or TEBEX_ENCRYPTION_KEY) must be set to store Tebex secrets");
  return createHash("sha256").update(`fiverax-tebex|${base}`).digest();
}

/** Pure (given the env key): "v1.<iv>.<tag>.<data>", base64url. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cipherKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

/** Null when it cannot be read (other key, altered value). */
export function decryptSecret(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", cipherKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ---- settings ----

export type TebexAccount = { name: string; domain: string; currency: string; symbol: string; gameType: string; serverName: string };

export type ShopSettings = {
  configured: boolean;
  hasSecret: boolean;
  /** Stored secret that can no longer be decrypted (encryption key changed). */
  secretUnreadable: boolean;
  publicToken: string | null;
  webhookKey: string | null;
  hasWebhookSecret: boolean;
  alerts: ShopAlerts;
  account: TebexAccount | null;
  checkedAt: string | null;
};

type SettingsRow = {
  secret_enc: string | null; public_token: string | null; webhook_key: string | null; webhook_secret_enc: string | null;
  alerts_json: string; account_json: string | null; checked_at: string | null;
};

const parse = <T>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export async function settingsRow(serverId: string): Promise<SettingsRow | undefined> {
  return db.get<SettingsRow>(
    "SELECT secret_enc, public_token, webhook_key, webhook_secret_enc, alerts_json, account_json, checked_at FROM tebex_settings WHERE server_id = ?",
    [serverId]
  );
}

export async function getShopSettings(serverId: string): Promise<ShopSettings> {
  const row = await settingsRow(serverId);
  const secretUnreadable = Boolean(row?.secret_enc) && !decryptSecret(row?.secret_enc);
  const alerts = shopAlertsSchema.safeParse(parse(row?.alerts_json, {}));
  return {
    configured: Boolean(row?.secret_enc) && !secretUnreadable,
    hasSecret: Boolean(row?.secret_enc),
    secretUnreadable,
    publicToken: row?.public_token ?? null,
    webhookKey: row?.webhook_key ?? null,
    hasWebhookSecret: Boolean(row?.webhook_secret_enc),
    alerts: alerts.success ? alerts.data : DEFAULT_SHOP_ALERTS,
    account: parse<TebexAccount | null>(row?.account_json, null),
    checkedAt: row?.checked_at ?? null
  };
}

async function secretOf(serverId: string): Promise<string | null> {
  return decryptSecret((await settingsRow(serverId))?.secret_enc);
}

export type SaveConfigResult = { ok: true; account: TebexAccount | null } | { ok: false; error: string };

/**
 * Save the owner's settings. A new secret key is checked against Tebex first (GET /information) and refused
 * when Tebex does not accept it. A webhook key is created on the first save.
 */
export async function saveShopConfig(serverId: string, actor: Actor, input: ShopConfigInput, now = new Date()): Promise<SaveConfigResult> {
  const row = await settingsRow(serverId);
  let account: TebexAccount | null = parse(row?.account_json, null);
  let secretEnc = row?.secret_enc ?? null;
  if (input.secret === null) {
    secretEnc = null;
    account = null;
  } else if (input.secret) {
    const info = await fetchInformation(input.secret);
    if (!info.ok) return { ok: false, error: info.error };
    account = info.data;
    secretEnc = encryptSecret(input.secret);
  }
  const webhookSecretEnc = input.webhookSecret === null ? null : input.webhookSecret ? encryptSecret(input.webhookSecret) : row?.webhook_secret_enc ?? null;
  const publicToken = input.publicToken === undefined ? row?.public_token ?? null : input.publicToken;
  const alerts = input.alerts ?? shopAlertsSchema.parse(parse(row?.alerts_json, {}));
  const at = now.toISOString();
  await db.batch([
    stmt(
      `INSERT INTO tebex_settings (server_id, secret_enc, public_token, webhook_key, webhook_secret_enc, alerts_json, account_json, checked_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(server_id) DO UPDATE SET secret_enc = excluded.secret_enc, public_token = excluded.public_token,
         webhook_key = COALESCE(tebex_settings.webhook_key, excluded.webhook_key), webhook_secret_enc = excluded.webhook_secret_enc,
         alerts_json = excluded.alerts_json, account_json = excluded.account_json,
         checked_at = CASE WHEN ? THEN excluded.checked_at ELSE tebex_settings.checked_at END, updated_at = excluded.updated_at`,
      [serverId, secretEnc, publicToken, randomBytes(18).toString("base64url"), webhookSecretEnc, JSON.stringify(alerts), account ? JSON.stringify(account) : null, at, at, input.secret ? 1 : 0]
    ),
    auditStmt(serverId, actor, "shop_config", null, {
      secret: input.secret === null ? "removed" : input.secret ? "changed" : undefined,
      webhookSecret: input.webhookSecret === null ? "removed" : input.webhookSecret ? "changed" : undefined,
      publicToken: input.publicToken === undefined ? undefined : publicToken ? "set" : "removed",
      alerts: input.alerts ? Boolean(alerts.webhookUrl) : undefined
    })
  ]);
  invalidateShopCache(serverId);
  return { ok: true, account };
}

/** New webhook address (the old one stops working: update it in Tebex). */
export async function rotateWebhookKey(serverId: string, actor: Actor, now = new Date()): Promise<string> {
  const key = randomBytes(18).toString("base64url");
  const at = now.toISOString();
  await db.batch([
    stmt(
      `INSERT INTO tebex_settings (server_id, webhook_key, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(server_id) DO UPDATE SET webhook_key = excluded.webhook_key, updated_at = excluded.updated_at`,
      [serverId, key, at]
    ),
    auditStmt(serverId, actor, "shop_webhook_rotate", null, {})
  ]);
  return key;
}

/** Re-read the account (name, currency…) with the stored secret. */
export async function refreshAccount(serverId: string, now = new Date()): Promise<TebexResult<TebexAccount>> {
  const secret = await secretOf(serverId);
  if (!secret) return { ok: false, error: "tebex_not_configured", status: 409 };
  const info = await fetchInformation(secret);
  if (info.ok) await db.run("UPDATE tebex_settings SET account_json = ?, checked_at = ? WHERE server_id = ?", [JSON.stringify(info.data), now.toISOString(), serverId]);
  return info;
}

// ---- HTTP ----

export type TebexResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number; message?: string };

/** Pure: an HTTP failure of Tebex as one of our error codes. */
export function tebexError(status: number): string {
  if (status === 401 || status === 403) return "tebex_bad_secret";
  if (status === 404) return "tebex_not_found";
  if (status === 422 || status === 400) return "tebex_rejected";
  if (status === 429) return "tebex_rate_limited";
  return `tebex_http_${status}`;
}

export async function call<T>(url: string, init: { method?: string; secret?: string; body?: unknown }): Promise<TebexResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(init.secret ? { "X-Tebex-Secret": init.secret } : {}),
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {})
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(12_000),
      cache: "no-store"
    });
  } catch {
    return { ok: false, error: "tebex_unreachable", status: 502 };
  }
  const text = await res.text().catch(() => "");
  const json = text ? parse<unknown>(text, null) : null;
  if (!res.ok) {
    const body = (json ?? {}) as { error_message?: string; message?: string; detail?: string };
    return { ok: false, error: tebexError(res.status), status: res.status, message: (body.error_message ?? body.message ?? body.detail)?.slice(0, 300) };
  }
  return { ok: true, data: json as T };
}

/** Short-lived cache of the reads (several staff on the same pages must not hammer Tebex). */
const globalCache = globalThis as unknown as { tebexCache?: Map<string, { at: number; value: TebexResult<unknown> }> };
const cache = (globalCache.tebexCache ??= new Map());
const CACHE_MS = 30_000;

export function invalidateShopCache(serverId: string): void {
  for (const key of cache.keys()) if (key.startsWith(`${serverId}|`)) cache.delete(key);
}

async function plugin<T>(serverId: string, method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<TebexResult<T>> {
  const key = `${serverId}|${path}`;
  if (method === "GET") {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as TebexResult<T>;
  }
  const secret = await secretOf(serverId);
  if (!secret) return { ok: false, error: "tebex_not_configured", status: 409 };
  const result = await call<T>(`${PLUGIN_API}${path}`, { method, secret, body });
  if (method === "GET" && result.ok) cache.set(key, { at: Date.now(), value: result });
  if (method !== "GET" && result.ok) invalidateShopCache(serverId);
  return result;
}

const enc = encodeURIComponent;

// ---- account ----

type RawInformation = {
  account: { id: number; domain: string; name: string; currency: { iso_4217: string; symbol: string }; game_type: string };
  server: { id: number; name: string };
};

async function fetchInformation(secret: string): Promise<TebexResult<TebexAccount>> {
  const r = await call<RawInformation>(`${PLUGIN_API}/information`, { secret });
  if (!r.ok) return r;
  const a = r.data.account;
  return { ok: true, data: { name: a.name, domain: a.domain, currency: a.currency?.iso_4217 ?? "EUR", symbol: a.currency?.symbol ?? "€", gameType: a.game_type, serverName: r.data.server?.name ?? "" } };
}

// ---- payments ----

export type TebexPlayer = { id: number | string; name: string; uuid: string };
export type TebexPayment = {
  id: number; amount: string; date: string; status: string; email?: string; creator_code?: string | null;
  currency: { iso_4217: string; symbol: string }; gateway?: { id: number; name: string };
  player: TebexPlayer | null; packages: { id: number; name: string }[]; notes?: { created_at: string; note: string }[];
};
export type PaymentPage = { total: number; current_page: number; last_page: number; data: TebexPayment[] };

export const listPayments = (serverId: string, page = 1) => plugin<PaymentPage>(serverId, "GET", `/payments?paged=1&page=${Math.max(1, Math.floor(page))}`);
export const getPayment = (serverId: string, txn: string) => plugin<TebexPayment>(serverId, "GET", `/payments/${enc(txn)}`);
export const paymentFields = (serverId: string, packageId: number) =>
  plugin<{ name: string; description?: string; type: string; options?: { label: string; value: string | number }[] | false }[]>(serverId, "GET", `/payments/fields/${packageId}`);

export async function addPaymentNote(serverId: string, actor: Actor, txn: string, note: string): Promise<TebexResult<null>> {
  const r = await plugin<null>(serverId, "POST", `/payments/${enc(txn)}/note`, { note: `${note} — ${actor.username} (Fiverax)` });
  if (r.ok) await logShop(serverId, actor, "shop_payment_note", { txn, note });
  return r;
}

/** Mark a payment refunded / charged back / complete on Tebex (the money itself is refunded from the Tebex panel). */
export async function setPaymentStatus(serverId: string, actor: Actor, txn: string, status: "complete" | "refund" | "chargeback", username: string): Promise<TebexResult<null>> {
  const r = await plugin<null>(serverId, "PUT", `/payments/${enc(txn)}`, { status, username });
  if (r.ok) await logShop(serverId, actor, "shop_payment_status", { txn, status, player: username });
  return r;
}

/** Give packages without payment (the commands are delivered as for a purchase). */
export async function createManualPayment(serverId: string, actor: Actor, input: { username: string; packageIds: number[]; price: number; note: string }): Promise<TebexResult<null>> {
  const r = await plugin<null>(serverId, "POST", "/payments", {
    ign: input.username,
    price: input.price,
    note: `${input.note || "Paiement manuel"} — ${actor.username} (Fiverax)`,
    packages: input.packageIds.map((id) => ({ id, options: {} }))
  });
  if (r.ok) await logShop(serverId, actor, "shop_manual_payment", { player: input.username, packages: input.packageIds, price: input.price, note: input.note });
  return r;
}

// ---- catalogue ----

export type CatalogPackage = {
  id: number; name: string; description: string; image: string | null; type: string;
  base_price: number; total_price: number; currency: string; discount: number; expiration_date: string | null;
  category: { id: number; name: string } | null;
};
export type CatalogCategory = { id: number; name: string; slug: string; description: string; order: number; parent: { id: number } | null; packages: CatalogPackage[] };

/** Categories and their packages, from the public Headless API (disabled packages are not listed by Tebex). */
export async function getCatalog(serverId: string): Promise<TebexResult<CatalogCategory[]>> {
  const token = (await settingsRow(serverId))?.public_token;
  if (!token) return { ok: false, error: "tebex_no_public_token", status: 409 };
  const key = `${serverId}|headless:categories`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as TebexResult<CatalogCategory[]>;
  const r = await call<{ data: CatalogCategory[] }>(`${HEADLESS_API}/accounts/${enc(token)}/categories?includePackages=1`, {});
  const result: TebexResult<CatalogCategory[]> = r.ok ? { ok: true, data: (r.data?.data ?? []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) } : r;
  if (result.ok) cache.set(key, { at: Date.now(), value: result });
  return result;
}

export type DisabledPackage = { packageId: number; name: string; price: number; disabledAt: string };

export async function listDisabledPackages(serverId: string): Promise<DisabledPackage[]> {
  const rows = await db.all<{ package_id: number; name: string; price: number; disabled_at: string }>(
    "SELECT package_id, name, price, disabled_at FROM tebex_disabled_packages WHERE server_id = ? ORDER BY name COLLATE NOCASE",
    [serverId]
  );
  return rows.map((r) => ({ packageId: r.package_id, name: r.name, price: r.price, disabledAt: r.disabled_at }));
}

/**
 * Rename, re-price, disable or re-enable a package. Tebex needs the three fields together. A package disabled
 * here is remembered, since Tebex no longer lists it, so it can be enabled again from the panel.
 */
export async function updatePackage(serverId: string, actor: Actor, input: { id: number; name: string; price: number; disabled: boolean }, now = new Date()): Promise<TebexResult<null>> {
  const r = await plugin<null>(serverId, "PUT", `/package/${input.id}`, { name: input.name, price: input.price, disabled: input.disabled });
  if (!r.ok) return r;
  await db.batch([
    input.disabled
      ? stmt(
          `INSERT INTO tebex_disabled_packages (server_id, package_id, name, price, disabled_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(server_id, package_id) DO UPDATE SET name = excluded.name, price = excluded.price`,
          [serverId, input.id, input.name, input.price, now.toISOString()]
        )
      : stmt("DELETE FROM tebex_disabled_packages WHERE server_id = ? AND package_id = ?", [serverId, input.id]),
    auditStmt(serverId, actor, "shop_package", null, input)
  ]);
  return r;
}

/** One-time link sending a player to the webstore with this package in the basket. */
export async function createCheckout(serverId: string, actor: Actor, packageId: number, username: string): Promise<TebexResult<{ url: string; expires: string }>> {
  const r = await plugin<{ url: string; expires: string }>(serverId, "POST", "/checkout", { package_id: String(packageId), username });
  if (r.ok) await logShop(serverId, actor, "shop_checkout", { packageId, player: username });
  return r;
}

export type TebexSale = {
  id: number; name: string; start: number; expire: number;
  effective: { type: string; packages: number[]; categories: number[] }; discount: { type: string; percentage: number; value: number };
};
export const listSales = (serverId: string) => plugin<{ data: TebexSale[] }>(serverId, "GET", "/sales");

export type CommunityGoal = { id: number; name: string; description: string; image: string; target: string; current: string; status: string; times_achieved: number; repeatable: number };
export const listCommunityGoals = (serverId: string) => plugin<CommunityGoal[]>(serverId, "GET", "/community_goals");

// ---- promotions ----

export type Coupon = {
  id: number; code: string; note: string; username: string; minimum: number; basket_type: string; start_date: string; user_limit: number;
  effective: { type: string; packages: number[]; categories: number[] };
  discount: { type: "percentage" | "value"; percentage: number; value: number };
  expire: { redeem_unlimited: string | boolean; expire_never: string | boolean; limit: number; date: string };
};
export type CouponPage = { pagination: { totalResults: number; currentPage: number; lastPage: number }; data: Coupon[] };

export const listCoupons = (serverId: string, page = 1) => plugin<CouponPage>(serverId, "GET", `/coupons?page=${Math.max(1, Math.floor(page))}`);

export type NewCoupon = {
  code: string; discountType: "percentage" | "value"; amount: number; effectiveOn: "cart" | "package" | "category"; ids: number[];
  basketType: "single" | "subscription" | "both"; minimum: number; limit: number | null; expireDate: string | null; username: string; note: string;
};

export async function createCoupon(serverId: string, actor: Actor, c: NewCoupon, now = new Date()): Promise<TebexResult<{ data: Coupon }>> {
  const r = await plugin<{ data: Coupon }>(serverId, "POST", "/coupons", {
    code: c.code,
    effective_on: c.effectiveOn,
    ...(c.effectiveOn === "package" ? { packages: c.ids } : {}),
    ...(c.effectiveOn === "category" ? { categories: c.ids } : {}),
    discount_type: c.discountType,
    discount_amount: c.discountType === "value" ? c.amount : 0,
    discount_percentage: c.discountType === "percentage" ? c.amount : 0,
    redeem_unlimited: c.limit === null,
    ...(c.limit !== null ? { expire_limit: c.limit } : {}),
    expire_never: c.expireDate === null,
    ...(c.expireDate ? { expire_date: c.expireDate } : {}),
    start_date: now.toISOString().slice(0, 10),
    basket_type: c.basketType,
    minimum: c.minimum,
    discount_application_method: 0,
    username: c.username,
    note: c.note || `Créé par ${actor.username} (Fiverax)`
  });
  if (r.ok) await logShop(serverId, actor, "shop_coupon_create", { code: c.code, discount: c.discountType === "percentage" ? `${c.amount} %` : c.amount, limit: c.limit, expireDate: c.expireDate });
  return r;
}

export async function deleteCoupon(serverId: string, actor: Actor, id: number, code: string): Promise<TebexResult<null>> {
  const r = await plugin<null>(serverId, "DELETE", `/coupons/${id}`);
  if (r.ok) await logShop(serverId, actor, "shop_coupon_delete", { code });
  return r;
}

export type GiftCard = { id: number; code: string; note: string; void: boolean; balance: { starting: string; remaining: string; currency: string } };

export const listGiftCards = (serverId: string) => plugin<{ data: GiftCard[] }>(serverId, "GET", "/gift-cards");
export const lookupGiftCard = (serverId: string, code: string) => plugin<{ data: GiftCard }>(serverId, "GET", `/gift-cards/lookup/${enc(code)}`);

export async function createGiftCard(serverId: string, actor: Actor, input: { amount: number; note: string; expiresAt: string | null }): Promise<TebexResult<{ data: GiftCard }>> {
  const r = await plugin<{ data: GiftCard }>(serverId, "POST", "/gift-cards", {
    amount: input.amount,
    note: input.note || `Créée par ${actor.username} (Fiverax)`,
    ...(input.expiresAt ? { expires_at: `${input.expiresAt} 23:59:59` } : {})
  });
  if (r.ok) await logShop(serverId, actor, "shop_giftcard_create", { amount: input.amount, note: input.note, card: r.data?.data?.id });
  return r;
}

export async function voidGiftCard(serverId: string, actor: Actor, id: number): Promise<TebexResult<{ data: GiftCard }>> {
  const r = await plugin<{ data: GiftCard }>(serverId, "DELETE", `/gift-cards/${id}`);
  if (r.ok) await logShop(serverId, actor, "shop_giftcard_void", { card: id });
  return r;
}

export async function topUpGiftCard(serverId: string, actor: Actor, id: number, amount: number): Promise<TebexResult<{ data: GiftCard }>> {
  const r = await plugin<{ data: GiftCard }>(serverId, "PUT", `/gift-cards/${id}`, { amount: amount.toFixed(2) });
  if (r.ok) await logShop(serverId, actor, "shop_giftcard_topup", { card: id, amount });
  return r;
}

// ---- customers ----

export type CustomerLookup = {
  player: { id: string; username: string; plugin_username_id: number };
  banCount: number; chargebackRate: number; purchaseTotals: Record<string, number> | [];
  payments: { txn_id: string; time: number; price: number; currency: string; status: number }[];
};
export const lookupCustomer = (serverId: string, user: string) => plugin<CustomerLookup>(serverId, "GET", `/user/${enc(user)}`);

export type ActivePackage = { txn_id: string; date: string; quantity: number; package: { id: number; name: string } };
export const activePackages = (serverId: string, playerId: string) => plugin<ActivePackage[]>(serverId, "GET", `/player/${enc(playerId)}/packages`);

export type TebexBan = { id: number; time: string; ip: string; payment_email: string; reason: string; user: { ign: string; uuid: string } | null };
export const listTebexBans = (serverId: string) => plugin<{ data: TebexBan[] }>(serverId, "GET", "/bans");

/** Ban someone from the webstore (they can no longer buy). Tebex has no "unban" in its API: lift it from the Tebex panel. */
export async function banFromStore(serverId: string, actor: Actor, input: { user: string; reason: string; ip: string }): Promise<TebexResult<{ data: TebexBan }>> {
  const r = await plugin<{ data: TebexBan }>(serverId, "POST", "/bans", input);
  if (r.ok) await logShop(serverId, actor, "shop_ban", { player: input.user, reason: input.reason });
  return r;
}

export type QueueState = {
  meta: { execute_offline: boolean; next_check: number; more: boolean };
  players: TebexPlayer[];
  offline: { id: number; command: string; payment: number; package: number; conditions: { delay: number }; player: TebexPlayer }[];
};

/**
 * Commands waiting to be delivered. Read-only: the panel never fetches commands for execution nor deletes them,
 * so the official Tebex resource still delivers everything.
 */
export async function getQueue(serverId: string): Promise<TebexResult<QueueState>> {
  const [due, offline] = await Promise.all([
    plugin<{ meta: QueueState["meta"]; players: TebexPlayer[] }>(serverId, "GET", "/queue"),
    plugin<{ commands: QueueState["offline"] }>(serverId, "GET", "/queue/offline-commands")
  ]);
  if (!due.ok) return due;
  return { ok: true, data: { meta: due.data.meta, players: due.data.players ?? [], offline: offline.ok ? offline.data.commands ?? [] : [] } };
}

async function logShop(serverId: string, actor: Actor, action: string, details: Record<string, unknown>): Promise<void> {
  const s = auditStmt(serverId, actor, action, null, details);
  await db.run(s.sql, s.args);
}

// ---- FiveM players ----

/**
 * FiveM players of the panel matching Tebex customers. On FiveM, Tebex identifies a buyer by their Cfx.re account
 * id, which the agent reports as the "fivem:<id>" identifier.
 */
export async function fivemPlayersFor(serverId: string, cfxIds: (string | number | null | undefined)[]): Promise<Map<string, { id: number; name: string }>> {
  const ids = [...new Set(cfxIds.map((v) => String(v ?? "")).filter((v) => /^\d{1,12}$/.test(v)))].slice(0, 100);
  const out = new Map<string, { id: number; name: string }>();
  if (!ids.length) return out;
  const rows = await db.all<{ id: number; name: string; identifiers_json: string }>(
    `SELECT id, name, identifiers_json FROM players WHERE server_id = ? AND (${ids.map(() => "identifiers_json LIKE ?").join(" OR ")})`,
    [serverId, ...ids.map((id) => `%"fivem:${id}"%`)]
  );
  for (const row of rows) {
    for (const ident of parse<string[]>(row.identifiers_json, [])) {
      if (ident.startsWith("fivem:") && ids.includes(ident.slice(6))) out.set(ident.slice(6), { id: row.id, name: row.name });
    }
  }
  return out;
}

/** Tebex activity of one FiveM player of the panel (from the webhooks). */
export async function shopEventsForPlayer(serverId: string, identifiers: string[], limit = 30): Promise<ShopEvent[]> {
  const cfx = identifiers.filter((i) => i.startsWith("fivem:")).map((i) => i.slice(6));
  if (!cfx.length) return [];
  const rows = await db.all<EventRow>(
    `SELECT * FROM tebex_events WHERE server_id = ? AND customer_id IN (${cfx.map(() => "?").join(",")}) ORDER BY happened_at DESC LIMIT ?`,
    [serverId, ...cfx, limit]
  );
  return rows.map(toEvent);
}

// ---- webhooks ----

/** Pure: Tebex signature = hex HMAC-SHA256(key = webhook secret, message = hex SHA-256 of the raw body). */
export function tebexSignature(rawBody: string, secret: string): string {
  const bodyHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  return createHmac("sha256", secret).update(bodyHash).digest("hex");
}

export function verifyTebexSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const a = Buffer.from(tebexSignature(rawBody, secret));
  const b = Buffer.from(signature.trim().toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

type Money = { amount?: number; currency?: string };
type RawPayment = {
  transaction_id?: string; status?: { id?: number; description?: string }; price?: Money; price_paid?: Money; created_at?: string;
  payment_method?: { name?: string }; creator_code?: string | null; recurring_payment_reference?: string | null;
  decline_reason?: { code?: string; message?: string } | null;
  customer?: { username?: { id?: string | number; username?: string }; country?: string };
  products?: { id?: number; name?: string; quantity?: number; paid_price?: Money }[];
  coupons?: { code?: string }[]; gift_cards?: { card_number?: string }[];
};
type RawRecurring = {
  reference?: string; status?: { description?: string }; price?: Money; next_payment_at?: string | null;
  cancel_reason?: string | null; fail_count?: number; initial_payment?: RawPayment; last_payment?: RawPayment;
};
export type TebexWebhook = { id: string; type: string; date?: string; subject?: unknown };

export type ShopEventProduct = { id: number | null; name: string; quantity: number; amount: number | null };
export type ShopEvent = {
  id: string; type: string; txnId: string | null; status: string | null; amount: number | null; currency: string | null;
  customerName: string | null; customerId: string | null; products: ShopEventProduct[]; details: Record<string, unknown>; happenedAt: string;
};

/**
 * Pure: the row kept for a webhook. Personal data Tebex sends (e-mail, name, IP, address) is dropped: only the
 * game username and account id are kept, to link the purchase to the player.
 */
export function eventFromWebhook(hook: TebexWebhook, now = new Date()): ShopEvent {
  const happenedAt = hook.date && !Number.isNaN(Date.parse(hook.date)) ? new Date(hook.date).toISOString() : now.toISOString();
  const recurring = hook.type.startsWith("recurring-payment.");
  const r = (recurring ? hook.subject : {}) as RawRecurring;
  const p = ((recurring ? r.last_payment ?? r.initial_payment : hook.subject) ?? {}) as RawPayment;
  const money = recurring ? r.price ?? p.price_paid ?? p.price : p.price_paid ?? p.price;
  const products = (p.products ?? []).slice(0, 30).map((x) => ({
    id: typeof x.id === "number" ? x.id : null,
    name: String(x.name ?? "?").slice(0, 120),
    quantity: Number(x.quantity ?? 1) || 1,
    amount: typeof x.paid_price?.amount === "number" ? x.paid_price.amount : null
  }));
  const details: Record<string, unknown> = recurring
    ? { nextPaymentAt: r.next_payment_at ?? null, cancelReason: r.cancel_reason ?? null, failCount: r.fail_count ?? 0, lastTxn: p.transaction_id ?? null }
    : {
        method: p.payment_method?.name ?? null,
        country: p.customer?.country ?? null,
        creatorCode: p.creator_code ?? null,
        coupons: (p.coupons ?? []).map((c) => c.code).filter(Boolean),
        giftCards: (p.gift_cards ?? []).length,
        declineReason: p.decline_reason?.message ?? null,
        recurring: p.recurring_payment_reference ?? null
      };
  const customerId = p.customer?.username?.id;
  return {
    id: String(hook.id).slice(0, 80),
    type: hook.type.slice(0, 60),
    txnId: (recurring ? r.reference : p.transaction_id) ?? null,
    status: (recurring ? r.status?.description : p.status?.description) ?? null,
    amount: typeof money?.amount === "number" ? money.amount : null,
    currency: money?.currency ?? null,
    customerName: p.customer?.username?.username ?? null,
    customerId: customerId === undefined || customerId === null ? null : String(customerId),
    products,
    details,
    happenedAt
  };
}

type EventRow = {
  id: string; type: string; txn_id: string | null; status: string | null; amount: number | null; currency: string | null;
  customer_name: string | null; customer_id: string | null; products_json: string; details_json: string; happened_at: string;
};

const toEvent = (r: EventRow): ShopEvent => ({
  id: r.id, type: r.type, txnId: r.txn_id, status: r.status, amount: r.amount, currency: r.currency,
  customerName: r.customer_name, customerId: r.customer_id, products: parse(r.products_json, []), details: parse(r.details_json, {}), happenedAt: r.happened_at
});

export type WebhookOutcome =
  | { status: 200; body: Record<string, unknown> }
  | { status: 401 | 404 | 400; body: { error: string } };

/** Handle one webhook delivery for the server owning `webhookKey`. Deliveries are idempotent (by webhook id). */
export async function receiveWebhook(webhookKey: string, rawBody: string, signature: string | null, now = new Date()): Promise<WebhookOutcome> {
  const row = await db.get<{ server_id: string; webhook_secret_enc: string | null; alerts_json: string; name: string }>(
    "SELECT t.server_id, t.webhook_secret_enc, t.alerts_json, s.name FROM tebex_settings t JOIN servers s ON s.id = t.server_id WHERE t.webhook_key = ?",
    [webhookKey]
  );
  if (!row) return { status: 404, body: { error: "unknown_webhook" } };
  const hook = parse<TebexWebhook | null>(rawBody, null);
  if (!hook || typeof hook.id !== "string" || typeof hook.type !== "string") return { status: 400, body: { error: "invalid_body" } };
  const secret = decryptSecret(row.webhook_secret_enc);
  // The validation ping only echoes its id (no side effect): answered even before the secret is typed in the panel.
  if (hook.type === "validation.webhook") {
    if (secret && signature && !verifyTebexSignature(rawBody, signature, secret)) return { status: 401, body: { error: "bad_signature" } };
    return { status: 200, body: { id: hook.id } };
  }
  if (!secret || !verifyTebexSignature(rawBody, signature, secret)) return { status: 401, body: { error: "bad_signature" } };

  const event = eventFromWebhook(hook, now);
  const { changes } = await db.run(
    `INSERT OR IGNORE INTO tebex_events (id, server_id, type, txn_id, status, amount, currency, customer_name, customer_id, products_json, details_json, happened_at, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [event.id, row.server_id, event.type, event.txnId, event.status, event.amount, event.currency, event.customerName, event.customerId,
      JSON.stringify(event.products), JSON.stringify(event.details), event.happenedAt, now.toISOString()]
  );
  if (changes > 0) {
    const alerts = shopAlertsSchema.safeParse(parse(row.alerts_json, {}));
    if (alerts.success) await sendShopAlert(alerts.data, row.name, row.server_id, event);
  }
  return { status: 200, body: { ok: true, duplicate: changes === 0 } };
}

/** Pure: should this event be posted on Discord? */
export function shouldAlertShop(alerts: ShopAlerts, type: string): boolean {
  if (!alerts.webhookUrl) return false;
  if (type === "payment.completed" || type === "recurring-payment.started" || type === "recurring-payment.renewed") return alerts.purchases;
  return alerts.problems && Boolean(eventMeta(type).problem);
}

const ALERT_COLORS: Record<string, number> = { up: 0x4ade80, danger: 0xfb7185, warn: 0xf59e3b, info: 0xc9a36a, neutral: 0x7c8aa0 };

async function sendShopAlert(alerts: ShopAlerts, serverName: string, serverId: string, e: ShopEvent): Promise<void> {
  if (!shouldAlertShop(alerts, e.type) || !alerts.webhookUrl) return;
  const meta = eventMeta(e.type);
  const appUrl = (process.env.APP_URL || "").replace(/\/+$/, "");
  const lines = [
    `**${e.customerName ?? "Client inconnu"}**${e.amount !== null ? ` · ${formatMoney(e.amount, e.currency)}` : ""}`,
    e.products.map((p) => `• ${p.quantity > 1 ? `${p.quantity} × ` : ""}${p.name}`).join("\n"),
    e.txnId ? `Transaction \`${e.txnId}\`` : "",
    typeof e.details.declineReason === "string" ? e.details.declineReason : ""
  ];
  try {
    await fetch(alerts.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Fiverax Boutique",
        allowed_mentions: { parse: [] },
        embeds: [{
          title: `🛒 ${meta.label}`,
          url: appUrl && e.txnId && !e.type.startsWith("recurring") ? `${appUrl}/s/${serverId}/shop/payments/${encodeURIComponent(e.txnId)}` : undefined,
          color: ALERT_COLORS[meta.tone] ?? ALERT_COLORS.neutral,
          description: lines.filter(Boolean).join("\n").slice(0, 3500),
          footer: { text: serverName },
          timestamp: e.happenedAt
        }]
      }),
      signal: AbortSignal.timeout(5000)
    });
  } catch {
    /* a down Discord webhook must not make Tebex retry */
  }
}

// ---- figures ----

export type ShopOverview = {
  currency: string | null;
  revenue30: number; refunded30: number; orders30: number; orders7: number; revenue7: number; average30: number;
  problems30: number; customers30: number; lastEventAt: string | null; totalEvents: number;
  daily: { day: string; amount: number; orders: number }[];
  topPackages: { name: string; quantity: number; amount: number }[];
  recent: ShopEvent[];
};

/** Sales figures from the received webhooks (main currency: the most used one over 30 days). */
export async function shopOverview(serverId: string, now = new Date()): Promise<ShopOverview> {
  const since30 = new Date(now.getTime() - 30 * 86400_000).toISOString();
  const since7 = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const [rows, recent, totals] = await db.batch(
    [
      stmt("SELECT * FROM tebex_events WHERE server_id = ? AND happened_at >= ? ORDER BY happened_at", [serverId, since30]),
      stmt("SELECT * FROM tebex_events WHERE server_id = ? ORDER BY happened_at DESC LIMIT 25", [serverId]),
      stmt("SELECT COUNT(*) AS n, MAX(happened_at) AS last FROM tebex_events WHERE server_id = ?", [serverId])
    ],
    "read"
  );
  const events = (rows.rows as unknown as EventRow[]).map(toEvent);
  const counts = new Map<string, number>();
  for (const e of events) if (e.currency) counts.set(e.currency, (counts.get(e.currency) ?? 0) + 1);
  const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const inCurrency = (e: ShopEvent) => !currency || e.currency === currency;
  const sales = events.filter((e) => (e.type === "payment.completed" || e.type === "recurring-payment.renewed") && inCurrency(e));
  const refunds = events.filter((e) => e.type === "payment.refunded" && inCurrency(e));
  const sum = (list: ShopEvent[]) => Math.round(list.reduce((s, e) => s + (e.amount ?? 0), 0) * 100) / 100;

  const days = new Map<string, { amount: number; orders: number }>();
  for (let i = 29; i >= 0; i--) days.set(new Date(now.getTime() - i * 86400_000).toISOString().slice(0, 10), { amount: 0, orders: 0 });
  const packages = new Map<string, { name: string; quantity: number; amount: number }>();
  for (const e of sales) {
    const d = days.get(e.happenedAt.slice(0, 10));
    if (d) {
      d.amount += e.amount ?? 0;
      d.orders += 1;
    }
    for (const p of e.products) {
      const key = p.id !== null ? `#${p.id}` : p.name;
      const cur = packages.get(key) ?? { name: p.name, quantity: 0, amount: 0 };
      cur.quantity += p.quantity;
      cur.amount += p.amount ?? 0;
      packages.set(key, cur);
    }
  }
  const revenue30 = sum(sales);
  const total = totals.rows[0] as { n: number; last: string | null } | undefined;
  return {
    currency,
    revenue30,
    refunded30: sum(refunds),
    orders30: sales.length,
    orders7: sales.filter((e) => e.happenedAt >= since7).length,
    revenue7: sum(sales.filter((e) => e.happenedAt >= since7)),
    average30: sales.length ? Math.round((revenue30 / sales.length) * 100) / 100 : 0,
    problems30: events.filter((e) => eventMeta(e.type).problem && e.type !== "payment.declined").length,
    customers30: new Set(sales.map((e) => e.customerId ?? e.customerName)).size,
    lastEventAt: total?.last ?? null,
    totalEvents: Number(total?.n ?? 0),
    daily: [...days.entries()].map(([day, v]) => ({ day, amount: Math.round(v.amount * 100) / 100, orders: v.orders })),
    topPackages: [...packages.values()].sort((a, b) => b.amount - a.amount || b.quantity - a.quantity).slice(0, 8).map((p) => ({ ...p, amount: Math.round(p.amount * 100) / 100 })),
    recent: (recent.rows as unknown as EventRow[]).map(toEvent)
  };
}

/** Events received for one transaction (newest first). */
export async function eventsForTransaction(serverId: string, txn: string): Promise<ShopEvent[]> {
  return (await db.all<EventRow>("SELECT * FROM tebex_events WHERE server_id = ? AND txn_id = ? ORDER BY happened_at DESC", [serverId, txn])).map(toEvent);
}

/** Received events, newest first, optionally of one family ("payment", "recurring-payment", "problems"). */
export async function listShopEvents(serverId: string, opts: { family?: string; q?: string; limit?: number } = {}): Promise<ShopEvent[]> {
  const where = ["server_id = ?"];
  const args: (string | number)[] = [serverId];
  if (opts.family === "problems") {
    const types = Object.keys(EVENT_TYPES).filter((t) => EVENT_TYPES[t].problem);
    where.push(`type IN (${types.map(() => "?").join(",")})`);
    args.push(...types);
  } else if (opts.family) {
    where.push("type LIKE ?");
    args.push(`${opts.family}.%`);
  }
  if (opts.q) {
    where.push("(LOWER(customer_name) LIKE ? OR txn_id LIKE ? OR customer_id = ?)");
    args.push(`%${opts.q.toLowerCase()}%`, `%${opts.q}%`, opts.q);
  }
  return (await db.all<EventRow>(`SELECT * FROM tebex_events WHERE ${where.join(" AND ")} ORDER BY happened_at DESC LIMIT ?`, [...args, opts.limit ?? 100])).map(toEvent);
}

/** Old events are useless for the figures shown (30 days): keep one year. */
export async function pruneShopEvents(now = new Date()): Promise<number> {
  const { changes } = await db.run("DELETE FROM tebex_events WHERE happened_at < ?", [new Date(now.getTime() - 365 * 86400_000).toISOString()]);
  return changes;
}
