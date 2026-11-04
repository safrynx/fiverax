import Link from "next/link";
import type { ShopSettings, TebexResult } from "@/lib/tebex";
import { eventMeta, formatMoney, tebexErrorMessage } from "@/lib/tebex-shared";
import type { ShopEvent } from "@/lib/tebex";
import { formatDateTime } from "@/lib/format";

/** Shown instead of a shop page while no readable secret key is stored. */
export function ShopNotReady({ settings, owner, serverId }: { settings: ShopSettings; owner: boolean; serverId: string }) {
  return (
    <div className="panel rise rise-1" style={{ maxWidth: 720 }}>
      <h2 className="h2" style={{ margin: 0 }}>{settings.secretUnreadable ? "Clé Tebex illisible" : "Boutique non reliée à Tebex"}</h2>
      <p className="muted">
        {settings.secretUnreadable
          ? "La clé secrète enregistrée ne peut plus être déchiffrée (SESSION_SECRET ou TEBEX_ENCRYPTION_KEY a changé). Il faut la saisir à nouveau."
          : "Relie le webstore Tebex du serveur pour suivre les ventes, gérer les paiements, le catalogue, les codes promo et les cartes cadeaux depuis le panel."}
      </p>
      {owner
        ? <Link href={`/s/${serverId}/shop/settings`} className="btn primary">Configurer la boutique</Link>
        : <p className="muted" style={{ marginBottom: 0 }}>Demande à un propriétaire du serveur de la configurer.</p>}
    </div>
  );
}

/** A failed Tebex read, explained. */
export function TebexError({ result }: { result: TebexResult<unknown> }) {
  if (result.ok) return null;
  return <div className="error rise" style={{ marginBottom: 18 }}>{tebexErrorMessage(result.error, result.message)}</div>;
}

/** Webhook events (purchases, refunds, disputes, subscriptions), newest first. */
export function EventList({ events, serverId, players }: { events: ShopEvent[]; serverId: string; players?: Map<string, { id: number; name: string }> }) {
  if (!events.length) return <p className="muted">Aucun événement reçu pour l&apos;instant.</p>;
  return (
    <div className="tbl-wrap">
      <table className="tbl" style={{ minWidth: 760 }}>
        <thead><tr><th>Événement</th><th>Client</th><th>Contenu</th><th style={{ textAlign: "right" }}>Montant</th><th>Le</th></tr></thead>
        <tbody>
          {events.map((e, i) => {
            const meta = eventMeta(e.type);
            const player = e.customerId ? players?.get(e.customerId) : undefined;
            const isPayment = e.type.startsWith("payment.") && e.txnId;
            return (
              <tr key={e.id} className="row-in" style={{ ["--i" as string]: Math.min(i, 14) }}>
                <td>
                  <span className="tag" data-tone={meta.tone}>{meta.label}</span>
                  {e.txnId && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{isPayment ? <Link href={`/s/${serverId}/shop/payments/${encodeURIComponent(e.txnId)}`}>{e.txnId}</Link> : e.txnId}</div>}
                </td>
                <td style={{ fontWeight: 600 }}>
                  {e.customerName ?? "—"}
                  {player && <div style={{ fontSize: 11, fontWeight: 400 }}><Link href={`/s/${serverId}/players/${player.id}`} className="linkish">fiche joueur</Link></div>}
                </td>
                <td style={{ maxWidth: 320 }} className="muted">{e.products.map((p) => `${p.quantity > 1 ? `${p.quantity} × ` : ""}${p.name}`).join(", ") || "—"}</td>
                <td className="num-cell" style={{ textAlign: "right" }}>{e.amount !== null ? formatMoney(e.amount, e.currency) : "—"}</td>
                <td className="num-cell muted">{formatDateTime(e.happenedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Daily revenue over 30 days: one series, thin bars, a tooltip per bar, the busiest day labelled. */
export function RevenueBars({ daily, currency }: { daily: { day: string; amount: number; orders: number }[]; currency: string | null }) {
  const max = Math.max(...daily.map((d) => d.amount), 0);
  const peak = daily.findIndex((d) => d.amount === max && max > 0);
  const label = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  return (
    <figure className="bars" aria-label="Chiffre d'affaires par jour sur 30 jours">
      <div className="bars-plot">
        {daily.map((d, i) => (
          <div key={d.day} className="bars-col" tabIndex={0} data-tip={`${label(d.day)} · ${formatMoney(d.amount, currency)} · ${d.orders} vente${d.orders > 1 ? "s" : ""}`}>
            {i === peak && <span className="bars-peak">{formatMoney(d.amount, currency)}</span>}
            <i style={{ height: max ? `${Math.max((d.amount / max) * 100, d.amount > 0 ? 2 : 0)}%` : 0 }} />
          </div>
        ))}
      </div>
      <figcaption className="bars-axis"><span>{label(daily[0]?.day ?? "")}</span><span>{label(daily[daily.length - 1]?.day ?? "")}</span></figcaption>
    </figure>
  );
}
