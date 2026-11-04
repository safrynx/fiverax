import Link from "next/link";
import { can, isOwner, requirePermissionPage } from "@/lib/auth";
import { getShopSettings, listCoupons, listGiftCards } from "@/lib/tebex";
import { formatMoney } from "@/lib/tebex-shared";
import { formatDateTime } from "@/lib/format";
import Shell, { PageHead } from "@/app/shell";
import { ShopNotReady, TebexError } from "../common";
import { CouponForm, DeleteCouponButton, GiftCardActions, GiftCardForm, GiftCardLookup } from "./promo-forms";

export const dynamic = "force-dynamic";

const TABS = [["coupons", "Codes promo"], ["giftcards", "Cartes cadeaux"]] as const;
const truthy = (v: string | boolean) => v === true || v === "true" || v === "1";

export default async function PromosPage({ params, searchParams }: { params: Promise<{ serverId: string }>; searchParams: Promise<{ tab?: string; page?: string; voided?: string }> }) {
  const { user, server } = await requirePermissionPage((await params).serverId, "shop_view");
  const sp = await searchParams;
  const settings = await getShopSettings(server.id);
  const base = `/s/${server.id}/shop/promos`;

  if (!settings.configured) {
    return (
      <Shell user={user} server={server} active="shop_promos">
        <PageHead kicker={server.name} title="Promotions">Codes promo et cartes cadeaux du webstore.</PageHead>
        <ShopNotReady settings={settings} owner={isOwner(user)} serverId={server.id} />
      </Shell>
    );
  }

  const tab = sp.tab === "giftcards" ? "giftcards" : "coupons";
  const page = Math.max(1, Number(sp.page) || 1);
  const promos = can(user, "shop_promos");
  const cur = settings.account?.currency ?? "EUR";
  const [coupons, cards] = await Promise.all([
    tab === "coupons" ? listCoupons(server.id, page) : Promise.resolve(null),
    tab === "giftcards" ? listGiftCards(server.id) : Promise.resolve(null)
  ]);
  const showVoided = sp.voided === "1";
  const cardList = cards?.ok ? cards.data.data.filter((c) => showVoided || !c.void) : [];

  return (
    <Shell user={user} server={server} active="shop_promos">
      <PageHead kicker={server.name} title="Promotions">Codes de réduction et cartes cadeaux, créés directement sur Tebex.</PageHead>

      <div className="pill-tabs rise rise-1" style={{ marginBottom: 22 }}>
        {TABS.map(([k, label]) => <Link key={k} href={`${base}${k === "coupons" ? "" : `?tab=${k}`}`} data-on={tab === k}>{label}</Link>)}
      </div>

      {tab === "coupons" && coupons && (
        <>
          {promos && <CouponForm currency={cur} />}
          <TebexError result={coupons} />
          {coupons.ok && coupons.data.data.length === 0 && <p className="muted">Aucun code promo.</p>}
          {coupons.ok && coupons.data.data.length > 0 && (
            <div className="tbl-wrap rise rise-2">
              <table className="tbl" style={{ minWidth: 860 }}>
                <thead><tr><th>Code</th><th>Réduction</th><th>Sur</th><th>Utilisations</th><th>Expire</th><th>Note</th>{promos && <th />}</tr></thead>
                <tbody>
                  {coupons.data.data.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 600 }}><code>{c.code}</code>{c.username && <div className="muted" style={{ fontSize: 11 }}>réservé à {c.username}</div>}</td>
                      <td className="num-cell">−{c.discount.type === "percentage" ? `${c.discount.percentage} %` : formatMoney(c.discount.value, cur)}{c.minimum > 0 && <div className="muted" style={{ fontSize: 11 }}>dès {formatMoney(c.minimum, cur)}</div>}</td>
                      <td className="muted">{c.effective.type === "cart" ? "Tout le panier" : c.effective.type === "package" ? `${c.effective.packages.length} package(s)` : `${c.effective.categories.length} catégorie(s)`}</td>
                      <td className="num-cell">{truthy(c.expire.redeem_unlimited) ? "Illimitées" : `${c.expire.limit} max`}</td>
                      <td className="num-cell muted">{truthy(c.expire.expire_never) ? "Jamais" : formatDateTime(c.expire.date)}</td>
                      <td className="muted" style={{ maxWidth: 220 }}>{c.note}</td>
                      {promos && <td style={{ textAlign: "right" }}><DeleteCouponButton id={c.id} code={c.code} /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {coupons.ok && coupons.data.pagination?.lastPage > 1 && (
            <div className="filters" style={{ marginTop: 18 }}>
              {page > 1 && <Link href={`${base}?page=${page - 1}`} className="btn">← Précédents</Link>}
              <span className="muted" style={{ fontSize: 13 }}>Page {page} / {coupons.data.pagination.lastPage} · {coupons.data.pagination.totalResults} codes</span>
              {page < coupons.data.pagination.lastPage && <Link href={`${base}?page=${page + 1}`} className="btn">Suivants →</Link>}
            </div>
          )}
        </>
      )}

      {tab === "giftcards" && cards && (
        <>
          {promos && <div className="cols even" style={{ gap: 24, marginBottom: 24 }}><GiftCardForm currency={cur} /><GiftCardLookup /></div>}
          <TebexError result={cards} />
          <div className="filters">
            <span className="pill-tabs">
              <Link href={`${base}?tab=giftcards`} data-on={!showVoided}>Actives</Link>
              <Link href={`${base}?tab=giftcards&voided=1`} data-on={showVoided}>Toutes</Link>
            </span>
          </div>
          {cards.ok && cardList.length === 0 && <p className="muted">Aucune carte cadeau.</p>}
          {cardList.length > 0 && (
            <div className="tbl-wrap rise rise-2">
              <table className="tbl" style={{ minWidth: 760 }}>
                <thead><tr><th>Code</th><th style={{ textAlign: "right" }}>Solde</th><th style={{ textAlign: "right" }}>Montant initial</th><th>Note</th><th>Statut</th>{promos && <th />}</tr></thead>
                <tbody>
                  {cardList.map((g) => (
                    <tr key={g.id}>
                      <td style={{ fontWeight: 600 }}><code>{g.code}</code></td>
                      <td className="num-cell" style={{ textAlign: "right" }}>{formatMoney(g.balance.remaining, g.balance.currency)}</td>
                      <td className="num-cell muted" style={{ textAlign: "right" }}>{formatMoney(g.balance.starting, g.balance.currency)}</td>
                      <td className="muted" style={{ maxWidth: 260 }}>{g.note}</td>
                      <td>{g.void ? <span className="tag">Annulée</span> : Number(g.balance.remaining) > 0 ? <span className="tag" data-tone="up">Active</span> : <span className="tag">Épuisée</span>}</td>
                      {promos && <td style={{ textAlign: "right" }}>{!g.void && <GiftCardActions id={g.id} code={g.code} />}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
