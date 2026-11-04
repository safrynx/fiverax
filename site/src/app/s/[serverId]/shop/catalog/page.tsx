import Link from "next/link";
import { can, isOwner, requirePermissionPage } from "@/lib/auth";
import { getCatalog, getShopSettings, listDisabledPackages, listSales } from "@/lib/tebex";
import { formatMoney } from "@/lib/tebex-shared";
import Shell, { PageHead } from "@/app/shell";
import { ShopNotReady, TebexError } from "../common";
import { PackageActions } from "./package-actions";

export const dynamic = "force-dynamic";

/** Package descriptions are HTML written in Tebex: shown as plain text here. */
const plain = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

export default async function CatalogPage({ params }: { params: Promise<{ serverId: string }> }) {
  const { user, server } = await requirePermissionPage((await params).serverId, "shop_view");
  const settings = await getShopSettings(server.id);
  const owner = isOwner(user);

  if (!settings.configured) {
    return (
      <Shell user={user} server={server} active="shop_catalog">
        <PageHead kicker={server.name} title="Catalogue">Catégories et packages du webstore.</PageHead>
        <ShopNotReady settings={settings} owner={owner} serverId={server.id} />
      </Shell>
    );
  }

  const [catalog, disabled, sales] = await Promise.all([getCatalog(server.id), listDisabledPackages(server.id), listSales(server.id)]);
  const manage = can(user, "shop_manage");
  const onSale = new Set<number>();
  if (sales.ok) for (const s of sales.data.data) for (const id of s.effective.packages) onSale.add(id);
  const listed = new Set(catalog.ok ? catalog.data.flatMap((c) => c.packages.map((p) => p.id)) : []);
  // A package disabled here and still listed by Tebex was re-enabled from Tebex itself: not shown as disabled.
  const stillDisabled = disabled.filter((d) => !listed.has(d.packageId));
  const cur = settings.account?.currency ?? "EUR";
  const total = catalog.ok ? catalog.data.reduce((n, c) => n + c.packages.length, 0) : 0;

  return (
    <Shell user={user} server={server} active="shop_catalog">
      <PageHead kicker={server.name} title="Catalogue">
        {catalog.ok ? `${catalog.data.length} catégorie(s), ${total} package(s) en vente.` : "Catégories et packages du webstore."}{" "}
        Les commandes, images et descriptions se modifient dans Tebex ; ici : nom, prix, mise en vente, et liens d&apos;achat directs.
      </PageHead>

      {catalog.ok ? null : catalog.error === "tebex_no_public_token" ? (
        <div className="banner"><b>Token public manquant.</b> Il sert à lire le catalogue (l&apos;API Tebex privée ne liste plus les packages). {owner && <Link href={`/s/${server.id}/shop/settings`} className="linkish">L&apos;ajouter</Link>}</div>
      ) : <TebexError result={catalog} />}

      {catalog.ok && catalog.data.map((cat) => (
        <section key={cat.id} className="sect rise">
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
            <h2 className="h2">{cat.name}</h2>
            <span className="muted" style={{ fontSize: 12 }}>{cat.packages.length} package(s){cat.parent ? " · sous-catégorie" : ""}</span>
          </div>
          {cat.packages.length === 0 ? <p className="muted">Aucun package en vente.</p> : (
            <div className="shop-grid">
              {cat.packages.map((p) => (
                <article key={p.id} className="shop-card">
                  {p.image && /^https:\/\//.test(p.image) && <img src={p.image} alt="" loading="lazy" />}
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                    <b>{p.name}</b>
                    <span className="num-cell">{formatMoney(p.total_price ?? p.base_price, p.currency ?? cur)}</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    <span className="tag">#{p.id}</span>
                    {p.type === "subscription" && <span className="tag" data-tone="info">Abonnement</span>}
                    {p.type === "both" && <span className="tag" data-tone="info">Unique ou abonnement</span>}
                    {(p.discount > 0 || onSale.has(p.id)) && <span className="tag" data-tone="up">En solde</span>}
                    {p.expiration_date && <span className="tag" data-tone="warn">Expire</span>}
                  </div>
                  {p.description && <p className="muted" style={{ margin: 0, fontSize: 12.5, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{plain(p.description)}</p>}
                  {manage && <PackageActions id={p.id} name={p.name} price={p.base_price} disabled={false} currency={p.currency ?? cur} />}
                </article>
              ))}
            </div>
          )}
        </section>
      ))}

      {stillDisabled.length > 0 && (
        <section className="sect">
          <h2 className="h2" style={{ marginBottom: 12 }}>Retirés de la vente depuis le panel</h2>
          <div className="shop-grid">
            {stillDisabled.map((d) => (
              <article key={d.packageId} className="shop-card" data-off="true">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b>{d.name}</b><span className="num-cell">{formatMoney(d.price, cur)}</span></div>
                <span className="tag">#{d.packageId} · désactivé</span>
                {manage && <PackageActions id={d.packageId} name={d.name} price={d.price} disabled currency={cur} />}
              </article>
            ))}
          </div>
        </section>
      )}
    </Shell>
  );
}
