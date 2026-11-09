import { aiConfigured, chatJson } from "./ai";
import { getLiveState } from "./agent";
import { auditStmt } from "./audit";
import { db, stmt } from "./db";
import { getServer, type Server } from "./servers";
import {
  BLOCKS, cleanStoreDesign, htmlToText, isValidStoreSlug, packageIndex, pruneDesign, starterDesign,
  type StoreData, type StoreDesign, type StorePackage
} from "./store-design";
import { call, getCatalog, HEADLESS_API, listCommunityGoals, settingsRow, type TebexResult } from "./tebex";

/**
 * Store Creator: the public store of a server (/store/<slug>), sold through the Tebex Headless API.
 *
 * - One site per server: a draft (saved as the editor changes it) and the published version (what visitors see).
 *   Publishing, AI changes and restores are kept as versions (40 latest).
 * - The page shows the live Tebex catalogue (public token), community goals (secret key, optional), the latest
 *   purchases and the top supporter from the webhooks, and the players online from the FiveM agent.
 * - Checkout: a Tebex basket is created for the visitor, they sign in with their Cfx.re account on Tebex, the packages
 *   are added, then the Tebex checkout opens. Prices are always Tebex's: the design only holds package ids.
 */

type Actor = { discordId: string; username: string };
const KEEP_VERSIONS = 40;

export class StoreError extends Error {}

// ---- site ----

export type StoreSite = { slug: string; draft: StoreDesign; published: StoreDesign | null; publishedAt: string | null; updatedAt: string; dirty: boolean };

type SiteRow = { slug: string; draft_json: string; published_json: string | null; published_at: string | null; updated_at: string };

const parseDesign = (raw: string | null): StoreDesign | null => {
  if (!raw) return null;
  try {
    return cleanStoreDesign(JSON.parse(raw));
  } catch {
    return null;
  }
};

const toSite = (r: SiteRow): StoreSite => {
  const draft = parseDesign(r.draft_json) ?? cleanStoreDesign({});
  const published = parseDesign(r.published_json);
  return { slug: r.slug, draft, published, publishedAt: r.published_at, updatedAt: r.updated_at, dirty: !published || JSON.stringify(published) !== JSON.stringify(draft) };
};

export async function getStoreSite(serverId: string): Promise<StoreSite | null> {
  const row = await db.get<SiteRow>("SELECT slug, draft_json, published_json, published_at, updated_at FROM store_sites WHERE server_id = ?", [serverId]);
  return row ? toSite(row) : null;
}

/** First free address from the server id ("gta-sun", "gta-sun-2"…). */
async function freeSlug(base: string): Promise<string> {
  let root = base.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 34);
  if (!isValidStoreSlug(root)) root = `boutique-${root}`.slice(0, 34).replace(/-$/, "");
  for (let i = 1; i < 50; i++) {
    const slug = i === 1 ? root : `${root}-${i}`;
    if (isValidStoreSlug(slug) && !(await db.get("SELECT 1 AS x FROM store_sites WHERE slug = ?", [slug]))) return slug;
  }
  return `${root}-${Date.now().toString(36)}`.slice(0, 40);
}

/** Pure: the package to put forward first: the most bought lately, else a middle-priced one of the first category. */
export function featuredPick(data: StoreData): number | null {
  const all = data.categories.flatMap((c) => c.packages);
  if (!all.length) return null;
  const counts = new Map<string, number>();
  for (const r of data.recent) for (const name of r.item.split(", ")) counts.set(name, (counts.get(name) ?? 0) + 1);
  const best = all.filter((p) => counts.has(p.name)).sort((a, b) => (counts.get(b.name) ?? 0) - (counts.get(a.name) ?? 0))[0];
  if (best) return best.id;
  const byPrice = [...(data.categories.find((c) => c.packages.length)?.packages ?? all)].sort((a, b) => a.price - b.price);
  return byPrice[Math.floor(byPrice.length / 2)].id;
}

/** The site of a server, created on first use with a starter page filled with the real catalogue. */
export async function ensureStoreSite(server: Server, data: StoreData, now = new Date()): Promise<StoreSite> {
  const existing = await getStoreSite(server.id);
  if (existing) return existing;
  const draft = starterDesign("gold", { name: server.name, firstPackageId: featuredPick(data), hasGoals: data.goals.length > 0 });
  await db.run(
    "INSERT OR IGNORE INTO store_sites (server_id, slug, draft_json, updated_at) VALUES (?, ?, ?, ?)",
    [server.id, await freeSlug(server.id), JSON.stringify(draft), now.toISOString()]
  );
  return (await getStoreSite(server.id)) as StoreSite;
}

/** Save the draft (frequent: the editor auto-saves, so no log entry). */
export async function saveDraft(serverId: string, actor: Actor, design: unknown, now = new Date()): Promise<StoreSite> {
  const clean = cleanStoreDesign(design);
  const { changes } = await db.run("UPDATE store_sites SET draft_json = ?, updated_at = ?, updated_by = ? WHERE server_id = ?", [JSON.stringify(clean), now.toISOString(), actor.discordId, serverId]);
  if (!changes) throw new StoreError("unknown_store");
  return (await getStoreSite(serverId)) as StoreSite;
}

const versionStmt = (serverId: string, actor: Actor, source: string, design: StoreDesign, extra: { prompt?: string; summary?: string } = {}, now = new Date()) =>
  stmt(
    "INSERT INTO store_versions (server_id, source, prompt, summary, design_json, author_discord_id, author_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [serverId, source, extra.prompt ?? null, extra.summary ?? null, JSON.stringify(design), actor.discordId, actor.username, now.toISOString()]
  );
const pruneVersionsStmt = (serverId: string) =>
  stmt(`DELETE FROM store_versions WHERE server_id = ? AND id NOT IN (SELECT id FROM store_versions WHERE server_id = ? ORDER BY id DESC LIMIT ${KEEP_VERSIONS})`, [serverId, serverId]);

/** The draft becomes the public page. */
export async function publishStore(serverId: string, actor: Actor, now = new Date()): Promise<StoreSite> {
  const site = await getStoreSite(serverId);
  if (!site) throw new StoreError("unknown_store");
  await db.batch([
    stmt("UPDATE store_sites SET published_json = draft_json, published_at = ?, updated_at = ? WHERE server_id = ?", [now.toISOString(), now.toISOString(), serverId]),
    versionStmt(serverId, actor, "publish", site.draft, {}, now),
    pruneVersionsStmt(serverId),
    auditStmt(serverId, actor, "store_publish", null, { slug: site.slug, blocks: site.draft.blocks.length })
  ]);
  return (await getStoreSite(serverId)) as StoreSite;
}

export async function unpublishStore(serverId: string, actor: Actor): Promise<StoreSite> {
  const site = await getStoreSite(serverId);
  if (!site) throw new StoreError("unknown_store");
  await db.batch([
    stmt("UPDATE store_sites SET published_json = NULL, published_at = NULL WHERE server_id = ?", [serverId]),
    auditStmt(serverId, actor, "store_unpublish", null, { slug: site.slug })
  ]);
  return (await getStoreSite(serverId)) as StoreSite;
}

export async function setStoreSlug(serverId: string, actor: Actor, slug: string): Promise<StoreSite> {
  const site = await getStoreSite(serverId);
  if (!site) throw new StoreError("unknown_store");
  if (!isValidStoreSlug(slug)) throw new StoreError("invalid_slug");
  if (slug === site.slug) return site;
  const taken = await db.get("SELECT 1 AS x FROM store_sites WHERE slug = ? AND server_id != ?", [slug, serverId]);
  if (taken) throw new StoreError("slug_taken");
  await db.batch([
    stmt("UPDATE store_sites SET slug = ? WHERE server_id = ?", [slug, serverId]),
    auditStmt(serverId, actor, "store_slug", null, { from: site.slug, to: slug })
  ]);
  return (await getStoreSite(serverId)) as StoreSite;
}

export type StoreVersion = { id: number; source: string; prompt: string | null; summary: string | null; author: string | null; createdAt: string };

export async function listStoreVersions(serverId: string): Promise<StoreVersion[]> {
  const rows = await db.all<{ id: number; source: string; prompt: string | null; summary: string | null; author_name: string | null; created_at: string }>(
    "SELECT id, source, prompt, summary, author_name, created_at FROM store_versions WHERE server_id = ? ORDER BY id DESC LIMIT ?",
    [serverId, KEEP_VERSIONS]
  );
  return rows.map((r) => ({ id: r.id, source: r.source, prompt: r.prompt, summary: r.summary, author: r.author_name, createdAt: r.created_at }));
}

/** A version back into the draft (the published page does not change until "Publier"). */
export async function restoreStoreVersion(serverId: string, actor: Actor, versionId: number, now = new Date()): Promise<StoreSite> {
  const row = await db.get<{ design_json: string }>("SELECT design_json FROM store_versions WHERE server_id = ? AND id = ?", [serverId, versionId]);
  const design = parseDesign(row?.design_json ?? null);
  if (!design) throw new StoreError("unknown_version");
  await db.batch([
    stmt("UPDATE store_sites SET draft_json = ?, updated_at = ?, updated_by = ? WHERE server_id = ?", [JSON.stringify(design), now.toISOString(), actor.discordId, serverId]),
    versionStmt(serverId, actor, "restore", design, { summary: `Version #${versionId} restaurée` }, now),
    pruneVersionsStmt(serverId),
    auditStmt(serverId, actor, "store_restore", null, { version: versionId })
  ]);
  return (await getStoreSite(serverId)) as StoreSite;
}

// ---- data shown ----

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

/** Catalogue, goals, latest purchases, top supporter and players online, for the store of a server. */
export async function loadStoreData(serverId: string, now = new Date()): Promise<StoreData> {
  const settings = await settingsRow(serverId);
  const since = new Date(now.getTime() - 30 * 86400_000).toISOString();
  const [catalog, goals, live, recentRows, topRow] = await Promise.all([
    getCatalog(serverId),
    settings?.secret_enc ? listCommunityGoals(serverId) : Promise.resolve(null),
    getLiveState(serverId),
    db.all<{ customer_name: string | null; products_json: string; happened_at: string }>(
      "SELECT customer_name, products_json, happened_at FROM tebex_events WHERE server_id = ? AND type = 'payment.completed' ORDER BY happened_at DESC LIMIT 12",
      [serverId]
    ),
    db.get<{ name: string; total: number }>(
      `SELECT customer_name AS name, SUM(amount) AS total FROM tebex_events
       WHERE server_id = ? AND type = 'payment.completed' AND happened_at >= ? AND customer_name IS NOT NULL
       GROUP BY COALESCE(customer_id, customer_name) ORDER BY total DESC LIMIT 1`,
      [serverId, since]
    )
  ]);
  const account = settings?.account_json ? (JSON.parse(settings.account_json) as { currency?: string }) : null;
  const categories = catalog.ok
    ? catalog.data.map((c) => ({
        id: c.id,
        name: c.name,
        description: htmlToText(c.description).slice(0, 600),
        packages: (c.packages ?? []).map((p): StorePackage => ({
          id: p.id,
          name: p.name,
          description: htmlToText(p.description).slice(0, 1500),
          image: typeof p.image === "string" && p.image.startsWith("https://") ? p.image : "",
          price: num(p.total_price ?? p.base_price),
          basePrice: num(p.base_price),
          discount: num(p.discount),
          currency: p.currency || account?.currency || "EUR",
          type: p.type,
          quantity: !(p as { disable_quantity?: boolean }).disable_quantity,
          categoryId: c.id,
          expires: Boolean(p.expiration_date)
        }))
      }))
    : [];
  const currency = categories.flatMap((c) => c.packages)[0]?.currency ?? account?.currency ?? "EUR";
  return {
    currency,
    categories,
    goals: goals?.ok
      ? goals.data.filter((g) => g.status === "active").map((g) => ({ id: g.id, name: g.name, current: num(g.current), target: num(g.target), achieved: g.times_achieved ?? 0 }))
      : [],
    recent: recentRows.map((r) => {
      let item = "";
      try {
        item = (JSON.parse(r.products_json) as { name: string }[]).map((p) => p.name).join(", ");
      } catch { /* keep empty */ }
      return { name: r.customer_name, item: item.slice(0, 120), at: r.happened_at };
    }),
    top: topRow?.name ? { name: topRow.name, amount: Math.round(num(topRow.total) * 100) / 100 } : null,
    server: live.linked ? { online: live.online, players: live.online ? live.players.length : 0, max: live.maxClients } : null,
    error: catalog.ok ? null : catalog.error
  };
}

/** Pure: the design without references to packages / categories / goals gone from Tebex. */
export function designFor(design: StoreDesign, data: StoreData): StoreDesign {
  if (data.error) return design; // catalogue unreadable right now: keep everything
  return pruneDesign(design, {
    packages: new Set(packageIndex(data).keys()),
    categories: new Set(data.categories.map((c) => c.id)),
    goals: new Set(data.goals.map((g) => g.id))
  });
}

export type PublicStore = { server: Server; slug: string; design: StoreDesign; data: StoreData; draft: boolean };

/** The published page at /store/<slug> (or the draft, for its editors). */
export async function getPublicStore(slug: string, opts: { draft?: boolean } = {}): Promise<PublicStore | null> {
  if (!isValidStoreSlug(slug)) return null;
  const row = await db.get<SiteRow & { server_id: string }>("SELECT server_id, slug, draft_json, published_json, published_at, updated_at FROM store_sites WHERE slug = ?", [slug]);
  if (!row) return null;
  const design = opts.draft ? parseDesign(row.draft_json) : parseDesign(row.published_json);
  if (!design) return null;
  const server = await getServer(row.server_id);
  if (!server || server.suspended) return null;
  const data = await loadStoreData(server.id);
  return { server, slug: row.slug, design: designFor(design, data), data, draft: Boolean(opts.draft) };
}

// ---- AI ----

export function storeAIConfigured(): boolean {
  return aiConfigured();
}

function aiSystem(): string {
  const blocks = Object.entries(BLOCKS)
    .map(([type, b]) => `- "${type}" (${b.label}) : ${b.fields.map((f) => `${f.key}${"options" in f ? ` [${f.options.map((o) => o[0]).join("|")}]` : ""}${f.kind === "list" ? ` [{${f.fields.map((x) => x.key).join(",")}}]` : ""} (${f.kind})`).join(", ")}`)
    .join("\n");
  return `Tu es directeur artistique et rédacteur e-commerce, spécialiste des boutiques de serveurs FiveM (GTA RP).
Tu conçois la page boutique d'un serveur sous forme d'un objet JSON (jamais de HTML, CSS ni JavaScript).
Structure : {"preset":"gold|neon|sunset|police|street|clean","theme":{...},"brand":{...},"blocks":[...],"checkout":{...},"legal":{...},"seo":{...},"branding":true}
theme : bg, surface, text, muted, accent, accent2 (couleurs "#rrggbb"), radius (0-28), font et headingFont parmi Inter, Poppins, Montserrat, Space Grotesk, Rajdhani, Bebas Neue, Orbitron, Unbounded, Playfair Display, Russo One ; background parmi plain|gradient|glow|grid|image ; backgroundImage (https) ; buttons parmi solid|gradient|outline ; cards parmi flat|glass|bordered|elevated ; caps (titres en majuscules, booléen).
brand : name, tagline, logo (https), discord (lien https d'invitation), website, connect (ex. cfx.re/join/abc123), announcement (bandeau en haut, court).
seo : title, description. legal : terms, privacy (liens https), notice.
Chaque bloc : {"id":"…","type":"…","p":{…}}. Types et champs :
${blocks}
Règles :
- Les champs package / packages / categories / goal contiennent UNIQUEMENT des IDs numériques présents dans le catalogue fourni. N'invente jamais de package, de prix ni d'ID.
- Garde les "id" des blocs existants que tu conserves ; les nouveaux blocs n'ont pas besoin d'id.
- Textes en français, percutants, adaptés au RP et au serveur ; jamais de fausses promesses (pas de « gratuit », pas de chiffres inventés).
- Contraste lisible : texte clair sur fond sombre ou l'inverse. Une page complète a 6 à 12 blocs, commence par "hero".
- Ne mets aucune URL d'image inventée : laisse "" si tu n'as pas de vraie image.
Réponds UNIQUEMENT par un objet JSON valide : {"summary":"ce que tu as fait, 1 à 3 phrases en français","design":{…la page COMPLÈTE…}}`;
}

/** Pure: the catalogue as the model sees it (ids, names, prices). */
export function catalogForAI(data: StoreData): string {
  const cats = data.categories.map((c) => `Catégorie ${c.id} « ${c.name} » : ${c.packages.map((p) => `${p.id} « ${p.name} » ${p.price} ${p.currency}${p.type === "subscription" ? " (abonnement)" : ""}`).join(" ; ") || "vide"}`);
  const goals = data.goals.map((g) => `Objectif ${g.id} « ${g.name} » (${g.current}/${g.target})`);
  return [...cats, ...goals].join("\n") || "Catalogue vide ou illisible pour l'instant.";
}

/** Pure: read the model's JSON reply. */
export function parseStoreAIReply(text: string): { summary: string; design: StoreDesign } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const data = JSON.parse(text.slice(start, end + 1)) as { summary?: unknown; design?: unknown };
    if (!data.design || typeof data.design !== "object") return null;
    return {
      summary: typeof data.summary === "string" && data.summary.trim() ? data.summary.trim().slice(0, 600) : "Boutique modifiée par l'IA",
      design: cleanStoreDesign(data.design)
    };
  } catch {
    return null;
  }
}

/** Ask the AI to create or change the store; the result becomes the draft (and a version). */
export async function generateStoreDesign(server: Server, actor: Actor, instruction: string, now = new Date()): Promise<{ site: StoreSite; summary: string }> {
  if (!storeAIConfigured()) throw new StoreError("ai_not_configured");
  const data = await loadStoreData(server.id);
  const site = await ensureStoreSite(server, data);
  const user = `Serveur : « ${server.name} ».\nCatalogue Tebex :\n${catalogForAI(data)}\n\nPage actuelle :\n${JSON.stringify(site.draft)}\n\nDemande : ${instruction}`;
  let reply: string;
  try {
    reply = await chatJson(aiSystem(), user, {
      quota: { serverId: server.id, userId: actor.discordId, kind: "store" },
      model: process.env.AI_CODE_MODEL, maxTokens: Number(process.env.AI_CODE_MAX_TOKENS) || 8000, temperature: 0.6
    });
  } catch (error) {
    throw new StoreError(error instanceof Error ? error.message : "ai_error");
  }
  const parsed = parseStoreAIReply(reply);
  if (!parsed) throw new StoreError("ai_unreadable");
  const design = designFor(parsed.design, data);
  if (!design.blocks.length) throw new StoreError("ai_unreadable");
  await db.batch([
    stmt("UPDATE store_sites SET draft_json = ?, updated_at = ?, updated_by = ? WHERE server_id = ?", [JSON.stringify(design), now.toISOString(), actor.discordId, server.id]),
    versionStmt(server.id, actor, "ai", design, { prompt: instruction.slice(0, 1000), summary: parsed.summary }, now),
    pruneVersionsStmt(server.id),
    auditStmt(server.id, actor, "store_ai", null, { prompt: instruction.slice(0, 300) })
  ]);
  return { site: (await getStoreSite(server.id)) as StoreSite, summary: parsed.summary };
}

// ---- checkout (Tebex Headless) ----

type Basket = {
  ident: string; complete: boolean; username: string | null; username_id: number | null; total_price: number; currency: string;
  packages: { id: number; name: string; in_basket: { quantity: number; price: number } }[];
  coupons: { code: string }[]; giftcards: { card_number: string }[]; creator_code: string | null;
  links: { checkout?: string; payment?: string };
};
export type CheckoutItem = { packageId: number; quantity: number };
export type CodeResult = { kind: "coupon" | "giftcard" | "creator"; code: string; ok: boolean; message: string | null };

async function storeContext(slug: string): Promise<{ serverId: string; token: string; design: StoreDesign; data: StoreData } | null> {
  const store = await getPublicStore(slug);
  if (!store) return null;
  const token = (await settingsRow(store.server.id))?.public_token;
  return token ? { serverId: store.server.id, token, design: store.design, data: store.data } : null;
}

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
const acct = (token: string) => `${HEADLESS_API}/accounts/${encodeURIComponent(token)}`;

/** Pure: keep only packages the store sells, once each, with a quantity in 1..99. */
export function cleanItems(items: CheckoutItem[], data: StoreData): CheckoutItem[] {
  const known = packageIndex(data);
  const out = new Map<number, number>();
  for (const it of items) {
    const pkg = known.get(it.packageId);
    if (!pkg) continue;
    const q = pkg.quantity ? Math.min(99, Math.max(1, Math.floor(it.quantity) || 1)) : 1;
    out.set(pkg.id, q);
  }
  return [...out.entries()].slice(0, 20).map(([packageId, quantity]) => ({ packageId, quantity }));
}

export type StartResult = { ident: string; auth: { name: string; url: string }[] };

/** Create the visitor's basket and the sign-in links (they come back to the store with ?basket=<ident>). */
export async function startCheckout(slug: string, ip: string | null): Promise<TebexResult<StartResult>> {
  const ctx = await storeContext(slug);
  if (!ctx) return { ok: false, error: "store_unavailable", status: 404 };
  const base = `${appUrl()}/store/${slug}`;
  const created = await call<{ data: Basket }>(`${acct(ctx.token)}/baskets`, {
    method: "POST",
    body: {
      complete_url: `${base}?paid=1`,
      cancel_url: base,
      complete_auto_redirect: true,
      custom: { source: "fiverax-store", server: ctx.serverId },
      ...(ip ? { ip_address: ip } : {})
    }
  });
  if (!created.ok) return created;
  const ident = created.data?.data?.ident;
  if (!ident) return { ok: false, error: "tebex_rejected", status: 502 };
  const auth = await call<{ name: string; url: string }[]>(`${acct(ctx.token)}/baskets/${encodeURIComponent(ident)}/auth?returnUrl=${encodeURIComponent(`${base}?basket=${ident}`)}`, {});
  const links = auth.ok && Array.isArray(auth.data) ? auth.data.filter((l) => typeof l?.url === "string" && l.url.startsWith("https://")).map((l) => ({ name: String(l.name ?? "Tebex"), url: l.url })) : [];
  return { ok: true, data: { ident, auth: links } };
}

export type FinishResult = {
  ident: string; username: string | null; total: number; currency: string; checkoutUrl: string | null;
  lines: { name: string; quantity: number; price: number }[]; codes: CodeResult[]; needsLogin: boolean;
};

/**
 * After sign-in: put the packages in the basket (idempotent: those already there are left as they are), apply the codes,
 * and return what Tebex.js needs to open the checkout.
 */
export async function finishCheckout(
  slug: string,
  ident: string,
  items: CheckoutItem[],
  codes: { coupon?: string; giftCard?: string; creatorCode?: string }
): Promise<TebexResult<FinishResult>> {
  const ctx = await storeContext(slug);
  if (!ctx) return { ok: false, error: "store_unavailable", status: 404 };
  const basketUrl = `${acct(ctx.token)}/baskets/${encodeURIComponent(ident)}`;
  const current = await call<{ data: Basket }>(basketUrl, {});
  if (!current.ok) return current;
  let basket = current.data.data;
  if (basket.complete) return { ok: false, error: "basket_complete", status: 409 };
  const wanted = cleanItems(items, ctx.data);
  if (!wanted.length) return { ok: false, error: "empty_basket", status: 400 };
  if (!basket.username && !basket.username_id) {
    return { ok: true, data: { ident, username: null, total: 0, currency: ctx.data.currency, checkoutUrl: null, lines: [], codes: [], needsLogin: true } };
  }

  const inBasket = new Set((basket.packages ?? []).map((p) => p.id));
  for (const it of wanted) {
    if (inBasket.has(it.packageId)) continue;
    const added = await call<{ data: Basket }>(`${HEADLESS_API}/baskets/${encodeURIComponent(ident)}/packages`, { method: "POST", body: { package_id: String(it.packageId), quantity: it.quantity } });
    if (!added.ok) return { ...added, error: added.error === "tebex_rejected" ? "package_refused" : added.error };
  }

  const results: CodeResult[] = [];
  const applyCode = async (kind: CodeResult["kind"], code: string | undefined, path: string, field: string) => {
    const value = code?.trim().slice(0, 60);
    if (!value) return;
    const r = await call<{ success?: boolean; message?: string }>(`${basketUrl}/${path}`, { method: "POST", body: { [field]: value } });
    results.push({ kind, code: value, ok: r.ok && r.data?.success !== false, message: r.ok ? r.data?.message ?? null : r.message ?? null });
  };
  if (ctx.design.checkout.coupon) await applyCode("coupon", codes.coupon, "coupons", "coupon_code");
  if (ctx.design.checkout.giftCard) await applyCode("giftcard", codes.giftCard, "giftcards", "card_number");
  if (ctx.design.checkout.creatorCode) await applyCode("creator", codes.creatorCode, "creator-codes", "creator_code");

  const fresh = await call<{ data: Basket }>(basketUrl, {});
  if (!fresh.ok) return fresh;
  basket = fresh.data.data;
  return {
    ok: true,
    data: {
      ident,
      username: basket.username,
      total: num(basket.total_price),
      currency: basket.currency || ctx.data.currency,
      checkoutUrl: basket.links?.checkout ?? null,
      lines: (basket.packages ?? []).map((p) => ({ name: p.name, quantity: p.in_basket?.quantity ?? 1, price: num(p.in_basket?.price) })),
      codes: results,
      needsLogin: false
    }
  };
}
