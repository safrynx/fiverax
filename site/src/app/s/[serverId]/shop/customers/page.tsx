import Link from "next/link";
import { can, isOwner, requirePermissionPage } from "@/lib/auth";
import { activePackages, fivemPlayersFor, getQueue, getShopSettings, listTebexBans, lookupCustomer, shopEventsForPlayer } from "@/lib/tebex";
import { formatMoney } from "@/lib/tebex-shared";
import { formatDateTime } from "@/lib/format";
import Shell, { PageHead } from "@/app/shell";
import { EventList, ShopNotReady, TebexError } from "../common";
import { StoreBanButton } from "./customer-actions";

export const dynamic = "force-dynamic";

/** Status codes of the player lookup (undocumented by Tebex; these are the ones of the payments). */
const LOOKUP_STATUS: Record<number, [string, string]> = { 1: ["Payé", "up"], 2: ["Remboursé", "warn"], 3: ["Chargeback", "danger"] };
const TABS = [["lookup", "Recherche"], ["bans", "Bannis de la boutique"], ["queue", "Livraisons en attente"]] as const;

export default async function CustomersPage({ params, searchParams }: { params: Promise<{ serverId: string }>; searchParams: Promise<{ q?: string; tab?: string }> }) {
  const { user, server } = await requirePermissionPage((await params).serverId, "shop_view");
  const sp = await searchParams;
  const settings = await getShopSettings(server.id);
  const base = `/s/${server.id}/shop/customers`;

  if (!settings.configured) {
    return (
      <Shell user={user} server={server} active="shop_customers">
        <PageHead kicker={server.name} title="Clients">Historique d&apos;achat des joueurs.</PageHead>
        <ShopNotReady settings={settings} owner={isOwner(user)} serverId={server.id} />
      </Shell>
    );
  }

  const tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as (typeof TABS)[number][0]) : "lookup";
  const q = sp.q?.trim().slice(0, 64) ?? "";
  const manage = can(user, "shop_manage");

  const lookup = tab === "lookup" && q ? await lookupCustomer(server.id, q) : null;
  const customer = lookup?.ok ? lookup.data : null;
  const [owned, history, linked, bans, queue] = await Promise.all([
    customer ? activePackages(server.id, customer.player.id) : Promise.resolve(null),
    customer ? shopEventsForPlayer(server.id, [`fivem:${customer.player.id}`]) : Promise.resolve([]),
    customer ? fivemPlayersFor(server.id, [customer.player.id]) : Promise.resolve(new Map<string, { id: number; name: string }>()),
    tab === "bans" ? listTebexBans(server.id) : Promise.resolve(null),
    tab === "queue" ? getQueue(server.id) : Promise.resolve(null)
  ]);
  const fivemPlayer = customer ? linked.get(String(customer.player.id)) : undefined;
  const totals = customer && !Array.isArray(customer.purchaseTotals) ? Object.entries(customer.purchaseTotals) : [];

  return (
    <Shell user={user} server={server} active="shop_customers">
      <PageHead kicker={server.name} title="Clients" actions={manage && tab === "bans" && <StoreBanButton />}>
        Historique d&apos;achat d&apos;un joueur sur Tebex, bans du webstore et commandes en attente de livraison sur le serveur FiveM.
      </PageHead>

      <div className="pill-tabs rise rise-1" style={{ marginBottom: 22 }}>
        {TABS.map(([k, label]) => <Link key={k} href={`${base}${k === "lookup" ? "" : `?tab=${k}`}`} data-on={tab === k}>{label}</Link>)}
      </div>

      {tab === "lookup" && (
        <>
          <form className="filters rise rise-1" action={base}>
            <input name="q" defaultValue={q} placeholder="Pseudo ou ID Cfx.re du joueur" className="field" style={{ minWidth: 300, width: "auto" }} required />
            <button className="btn primary">Rechercher</button>
          </form>
          {lookup && <TebexError result={lookup} />}
          {customer && (
            <>
              <div className="strip">
                <div className="rise rise-1"><div className="eyebrow">Client</div><div className="num" style={{ fontSize: 22 }}>{customer.player.username}</div><small>Cfx.re {customer.player.id}{fivemPlayer && <> · <Link href={`/s/${server.id}/players/${fivemPlayer.id}`} className="linkish">fiche joueur</Link></>}</small></div>
                <div className="rise rise-2"><div className="eyebrow">Total dépensé</div><div className="num" style={{ fontSize: 22 }}>{totals.length ? totals.map(([c, v]) => formatMoney(v, c)).join(" + ") : formatMoney(0, settings.account?.currency)}</div><small>{customer.payments.length} paiement(s)</small></div>
                <div className="rise rise-3"><div className="eyebrow">Taux de chargeback</div><div className="num" style={{ fontSize: 22 }}>{customer.chargebackRate} %</div><small>{customer.chargebackRate > 0 ? "à surveiller" : "aucun litige"}</small></div>
                <div className="rise rise-4"><div className="eyebrow">Bans boutique</div><div className="num" style={{ fontSize: 22 }}>{customer.banCount}</div><small>{customer.banCount ? "déjà banni du webstore" : "jamais banni"}</small></div>
              </div>
              {manage && <div className="filters"><StoreBanButton user={customer.player.username} /></div>}

              <div className="cols even" style={{ gap: 36 }}>
                <section>
                  <h2 className="h2" style={{ marginBottom: 12 }}>Paiements</h2>
                  {customer.payments.length === 0 ? <p className="muted">Aucun paiement.</p> : (
                    <div className="tbl-wrap">
                      <table className="tbl" style={{ minWidth: 420 }}>
                        <thead><tr><th>Transaction</th><th style={{ textAlign: "right" }}>Montant</th><th>Statut</th><th>Le</th></tr></thead>
                        <tbody>
                          {customer.payments.map((p) => {
                            const [label, tone] = LOOKUP_STATUS[p.status] ?? [`Statut ${p.status}`, "neutral"];
                            return (
                              <tr key={p.txn_id}>
                                <td className="num-cell"><Link href={`/s/${server.id}/shop/payments/${encodeURIComponent(p.txn_id)}`}>{p.txn_id}</Link></td>
                                <td className="num-cell" style={{ textAlign: "right" }}>{formatMoney(p.price, p.currency)}</td>
                                <td><span className="tag" data-tone={tone}>{label}</span></td>
                                <td className="num-cell muted">{formatDateTime(new Date(p.time * 1000).toISOString())}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
                <section>
                  <h2 className="h2" style={{ marginBottom: 12 }}>Packages actifs</h2>
                  {owned && <TebexError result={owned} />}
                  {owned?.ok && (owned.data.length === 0 ? <p className="muted">Aucun package actif.</p> : (
                    <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
                      {owned.data.map((o) => <li key={`${o.txn_id}-${o.package.id}`}><b>{o.package.name}</b>{o.quantity > 1 ? ` × ${o.quantity}` : ""} <span className="muted" style={{ fontSize: 12 }}>depuis le {formatDateTime(o.date)}</span></li>)}
                    </ul>
                  ))}
                </section>
              </div>

              {history.length > 0 && (
                <section className="sect">
                  <h2 className="h2" style={{ marginBottom: 12 }}>Événements reçus</h2>
                  <EventList events={history} serverId={server.id} />
                </section>
              )}
            </>
          )}
          {!q && <p className="muted">Cherche un joueur par son pseudo Tebex ou son ID Cfx.re (visible sur sa fiche joueur, identifiant <code>fivem:</code>).</p>}
        </>
      )}

      {tab === "bans" && bans && (
        <>
          <TebexError result={bans} />
          {bans.ok && (bans.data.data.length === 0 ? <p className="muted">Personne n&apos;est banni du webstore.</p> : (
            <div className="tbl-wrap rise rise-2">
              <table className="tbl" style={{ minWidth: 700 }}>
                <thead><tr><th>Joueur</th><th>Raison</th><th>IP</th><th>Le</th></tr></thead>
                <tbody>
                  {bans.data.data.map((b) => (
                    <tr key={b.id}>
                      <td style={{ fontWeight: 600 }}>{b.user?.ign ? <Link href={`${base}?q=${encodeURIComponent(b.user.uuid || b.user.ign)}`}>{b.user.ign}</Link> : "—"}</td>
                      <td>{b.reason}</td>
                      <td className="muted num-cell">{b.ip || "—"}</td>
                      <td className="muted num-cell">{formatDateTime(b.time)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <p className="muted" style={{ fontSize: 12 }}>Tebex ne permet pas de lever un ban par son API : passe par le panel Tebex (Customers &gt; Bans).</p>
        </>
      )}

      {tab === "queue" && queue && (
        <>
          <TebexError result={queue} />
          {queue.ok && (
            <>
              <p className="muted">
                Lecture seule : la ressource Tebex du serveur FiveM récupère ces commandes et les exécute ({queue.data.meta.execute_offline ? "y compris pour les joueurs hors ligne" : "joueurs connectés uniquement"}).
                Si la file grossit sans se vider, la ressource est arrêtée ou sa clé n&apos;est pas la bonne.
              </p>
              <div className="cols even" style={{ gap: 36 }}>
                <section>
                  <h2 className="h2" style={{ marginBottom: 12 }}>Joueurs à livrer en jeu ({queue.data.players.length}{queue.data.meta.more ? "+" : ""})</h2>
                  {queue.data.players.length === 0 ? <p className="muted">Personne en attente.</p> : (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>{queue.data.players.map((p) => <li key={p.id}><Link href={`${base}?q=${encodeURIComponent(p.uuid || p.name)}`}>{p.name}</Link> <span className="muted" style={{ fontSize: 12 }}>Cfx.re {p.uuid}</span></li>)}</ul>
                  )}
                </section>
                <section>
                  <h2 className="h2" style={{ marginBottom: 12 }}>Commandes hors ligne ({queue.data.offline.length})</h2>
                  {queue.data.offline.length === 0 ? <p className="muted">Aucune commande en attente.</p> : (
                    <div style={{ display: "grid", gap: 6 }}>
                      {queue.data.offline.slice(0, 100).map((c) => (
                        <div key={c.id} className="bubble"><div className="bubble-meta"><span>{c.player?.name ?? "?"}</span><span>paiement #{c.payment}{c.conditions?.delay ? ` · délai ${c.conditions.delay} s` : ""}</span></div><code>{c.command}</code></div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </>
      )}
    </Shell>
  );
}
