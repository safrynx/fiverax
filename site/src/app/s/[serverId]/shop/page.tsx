import Link from "next/link";
import { isOwner, requirePermissionPage } from "@/lib/auth";
import { fivemPlayersFor, getShopSettings, listCommunityGoals, listSales, listShopEvents, shopOverview } from "@/lib/tebex";
import { formatMoney } from "@/lib/tebex-shared";
import { formatDateTime } from "@/lib/format";
import Shell, { PageHead } from "@/app/shell";
import { AutoRefresh } from "../security-actions";
import { EventList, RevenueBars, ShopNotReady, TebexError } from "./common";

export const dynamic = "force-dynamic";

const FAMILIES = [["", "Tout"], ["payment", "Paiements"], ["recurring-payment", "Abonnements"], ["problems", "Problèmes"]] as const;

export default async function ShopPage({ params, searchParams }: { params: Promise<{ serverId: string }>; searchParams: Promise<{ f?: string; q?: string }> }) {
  const { user, server } = await requirePermissionPage((await params).serverId, "shop_view");
  const sp = await searchParams;
  const base = `/s/${server.id}/shop`;
  const settings = await getShopSettings(server.id);
  const owner = isOwner(user);

  if (!settings.configured) {
    return (
      <Shell user={user} server={server} active="shop">
        <PageHead kicker={server.name} title="Boutique">Ventes du webstore Tebex du serveur.</PageHead>
        <ShopNotReady settings={settings} owner={owner} serverId={server.id} />
      </Shell>
    );
  }

  const family = FAMILIES.some(([k]) => k === sp.f) ? sp.f : "";
  const q = sp.q?.trim().slice(0, 64) ?? "";
  const [overview, events, goals, sales] = await Promise.all([
    shopOverview(server.id),
    family || q ? listShopEvents(server.id, { family, q, limit: 100 }) : Promise.resolve(null),
    listCommunityGoals(server.id),
    listSales(server.id)
  ]);
  const shown = events ?? overview.recent;
  const players = await fivemPlayersFor(server.id, shown.map((e) => e.customerId));
  const cur = overview.currency ?? settings.account?.currency ?? "EUR";
  const net = overview.revenue30 - overview.refunded30;

  const stats: [string, string, string][] = [
    ["CA · 30 jours", formatMoney(overview.revenue30, cur), overview.refunded30 ? `${formatMoney(net, cur)} net des remboursements` : "aucun remboursement"],
    ["CA · 7 jours", formatMoney(overview.revenue7, cur), `${overview.orders7} vente${overview.orders7 > 1 ? "s" : ""}`],
    ["Panier moyen", formatMoney(overview.average30, cur), `${overview.orders30} ventes · ${overview.customers30} clients sur 30 j`],
    ["Problèmes · 30 jours", String(overview.problems30), "remboursements, litiges, fins d'abonnement"]
  ];

  return (
    <Shell user={user} server={server} active="shop">
      <AutoRefresh everyMs={30_000} />
      <PageHead
        kicker={server.name}
        title="Boutique"
        actions={settings.account?.domain && <a href={settings.account.domain} target="_blank" rel="noreferrer" className="btn">Ouvrir le webstore</a>}
      >
        {settings.account ? <>Webstore <b>{settings.account.name}</b> ({settings.account.currency}). </> : null}
        Chiffres calculés à partir des webhooks Tebex reçus.
      </PageHead>

      {!settings.webhookKey || !settings.hasWebhookSecret ? (
        <div className="banner">
          <b>Webhook Tebex pas encore branché.</b> Sans lui, les ventes ne remontent pas en direct (les pages Paiements, Catalogue et Clients marchent quand même).{" "}
          {owner && <Link href={`${base}/settings`} className="linkish">Le configurer</Link>}
        </div>
      ) : overview.totalEvents === 0 ? (
        <div className="banner"><b>Aucun webhook reçu pour l&apos;instant.</b> Vérifie que l&apos;adresse est bien enregistrée et validée dans Tebex (Developers &gt; Webhooks).</div>
      ) : null}

      <div className="strip">
        {stats.map(([label, value, hint], i) => (
          <div key={label} className={`rise rise-${i + 1}`}><div className="eyebrow">{label}</div><div className="num" style={{ fontSize: 24 }}>{value}</div><small>{hint}</small></div>
        ))}
      </div>

      <div className="cols two" style={{ gap: 36 }}>
        <section className="rise rise-2">
          <h2 className="h2" style={{ marginBottom: 12 }}>Chiffre d&apos;affaires par jour</h2>
          <RevenueBars daily={overview.daily} currency={cur} />
        </section>

        <section className="rise rise-2">
          <h2 className="h2" style={{ marginBottom: 12 }}>Meilleures ventes · 30 jours</h2>
          {overview.topPackages.length === 0 ? <p className="muted">Aucune vente sur la période.</p> : (
            <div className="tbl-wrap">
              <table className="tbl" style={{ minWidth: 420 }}>
                <thead><tr><th>Package</th><th style={{ textAlign: "right" }}>Quantité</th><th style={{ textAlign: "right" }}>CA</th></tr></thead>
                <tbody>
                  {overview.topPackages.map((p) => (
                    <tr key={p.name}><td style={{ fontWeight: 600 }}>{p.name}</td><td className="num-cell" style={{ textAlign: "right" }}>{p.quantity}</td><td className="num-cell" style={{ textAlign: "right" }}>{formatMoney(p.amount, cur)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {(goals.ok && goals.data.length > 0) || (sales.ok && sales.data.data.length > 0) ? (
        <div className="cols even sect" style={{ gap: 36 }}>
          {goals.ok && goals.data.length > 0 && (
            <section>
              <h2 className="h2" style={{ marginBottom: 12 }}>Objectifs communautaires</h2>
              <div style={{ display: "grid", gap: 12 }}>
                {goals.data.map((g) => {
                  const pct = Math.min(100, Math.round((Number(g.current) / Math.max(Number(g.target), 0.01)) * 100));
                  return (
                    <div key={g.id} className="shop-card">
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <b>{g.name}</b>
                        <span className="tag" data-tone={g.status === "active" ? "up" : "neutral"}>{g.status === "active" ? "En cours" : g.status}</span>
                      </div>
                      <div className="meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
                      <small className="muted">{formatMoney(g.current, cur)} sur {formatMoney(g.target, cur)} · {pct} %{g.times_achieved ? ` · atteint ${g.times_achieved} fois` : ""}</small>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          {sales.ok && sales.data.data.length > 0 && (
            <section>
              <h2 className="h2" style={{ marginBottom: 12 }}>Soldes en cours</h2>
              <div style={{ display: "grid", gap: 10 }}>
                {sales.data.data.map((s) => (
                  <div key={s.id} className="guild-row" style={{ flexWrap: "wrap" }}>
                    <span className="plate">−{s.discount.type === "percentage" ? `${s.discount.percentage} %` : formatMoney(s.discount.value, cur)}</span>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <b>{s.name}</b>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {s.effective.type === "package" ? `${s.effective.packages.length} package(s)` : s.effective.type === "category" ? `${s.effective.categories.length} catégorie(s)` : "Toute la boutique"} · jusqu&apos;au {formatDateTime(new Date(s.expire * 1000).toISOString())}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : null}
      {!goals.ok && <TebexError result={goals} />}

      <section className="sect">
        <h2 className="h2" style={{ marginBottom: 12 }}>Activité de la boutique</h2>
        <form className="filters" action={base}>
          <input name="q" defaultValue={q} placeholder="Client, transaction, ID Cfx.re…" className="field" style={{ minWidth: 260, width: "auto" }} />
          {family && <input type="hidden" name="f" value={family} />}
          <button className="btn primary">Rechercher</button>
          <span className="pill-tabs">
            {FAMILIES.map(([k, label]) => (
              <Link key={k} href={`${base}?${new URLSearchParams({ ...(k ? { f: k } : {}), ...(q ? { q } : {}) })}`} data-on={family === k}>{label}</Link>
            ))}
          </span>
        </form>
        <EventList events={shown} serverId={server.id} players={players} />
        {overview.lastEventAt && <p className="muted" style={{ fontSize: 12 }}>Dernier webhook : {formatDateTime(overview.lastEventAt)} · {overview.totalEvents} événement(s) gardé(s) (1 an).</p>}
      </section>
    </Shell>
  );
}
