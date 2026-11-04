import Link from "next/link";
import { can, isOwner, requirePermissionPage } from "@/lib/auth";
import { eventsForTransaction, fivemPlayersFor, getPayment, getShopSettings } from "@/lib/tebex";
import { eventMeta, formatMoney, paymentStatusMeta } from "@/lib/tebex-shared";
import { formatDateTime } from "@/lib/format";
import Shell, { PageHead } from "@/app/shell";
import { ShopNotReady, TebexError } from "../../common";
import { NoteButton, StatusButtons } from "../payment-actions";

export const dynamic = "force-dynamic";

export default async function PaymentPage({ params }: { params: Promise<{ serverId: string; txn: string }> }) {
  const p = await params;
  const { user, server } = await requirePermissionPage(p.serverId, "shop_view");
  const txn = decodeURIComponent(p.txn).slice(0, 80);
  const settings = await getShopSettings(server.id);
  const back = <Link href={`/s/${server.id}/shop/payments`} className="btn">← Paiements</Link>;

  if (!settings.configured) {
    return (
      <Shell user={user} server={server} active="shop_payments">
        <PageHead kicker={server.name} title={txn} actions={back} />
        <ShopNotReady settings={settings} owner={isOwner(user)} serverId={server.id} />
      </Shell>
    );
  }

  const [result, events] = await Promise.all([getPayment(server.id, txn), eventsForTransaction(server.id, txn)]);
  const pay = result.ok ? result.data : null;
  const player = pay?.player?.uuid ? (await fivemPlayersFor(server.id, [pay.player.uuid])).get(String(pay.player.uuid)) : undefined;
  const status = pay ? paymentStatusMeta(pay.status) : null;
  const manage = can(user, "shop_manage");
  // Details only the webhook carries (payment method, country, coupons…).
  const hookDetails = events.find((e) => e.type === "payment.completed")?.details ?? events[0]?.details;

  return (
    <Shell user={user} server={server} active="shop_payments">
      <PageHead kicker="Paiement" title={pay ? `${formatMoney(pay.amount, pay.currency?.iso_4217)} · ${pay.player?.name ?? "?"}` : txn} actions={back}>
        {pay && <>Transaction <code>{txn}</code> du {formatDateTime(pay.date)}.</>}
      </PageHead>
      <TebexError result={result} />

      {pay && status && (
        <>
          <div className="strip">
            <div className="rise rise-1"><div className="eyebrow">Statut</div><div style={{ marginTop: 10 }}><span className="tag" data-tone={status.tone}>{status.label}</span></div></div>
            <div className="rise rise-2"><div className="eyebrow">Client</div><div className="num" style={{ fontSize: 20 }}>{pay.player?.name ?? "—"}</div><small>{pay.player?.uuid ? `Cfx.re ${pay.player.uuid}` : ""}{player ? " · " : ""}{player && <Link href={`/s/${server.id}/players/${player.id}`} className="linkish">fiche joueur</Link>}</small></div>
            <div className="rise rise-3"><div className="eyebrow">Moyen de paiement</div><div className="num" style={{ fontSize: 20 }}>{pay.gateway?.name ?? String(hookDetails?.method ?? "—")}</div><small>{pay.creator_code ? `code créateur ${pay.creator_code}` : hookDetails?.country ? `pays ${String(hookDetails.country)}` : ""}</small></div>
          </div>

          {manage && (
            <div className="filters rise rise-2">
              <NoteButton txn={txn} />
              <StatusButtons txn={txn} username={pay.player?.name ?? ""} current={pay.status} />
              {pay.player?.name && <Link href={`/s/${server.id}/shop/customers?q=${encodeURIComponent(pay.player.uuid || pay.player.name)}`} className="linkish">Historique du client</Link>}
            </div>
          )}

          <div className="cols even" style={{ gap: 36 }}>
            <section>
              <h2 className="h2" style={{ marginBottom: 12 }}>Packages</h2>
              <ul style={{ margin: 0, paddingLeft: 18 }}>{pay.packages.map((x) => <li key={x.id}>{x.name} <span className="muted" style={{ fontSize: 12 }}>#{x.id}</span></li>)}</ul>
              {Array.isArray(hookDetails?.coupons) && hookDetails.coupons.length > 0 && <p className="muted" style={{ fontSize: 13 }}>Codes promo : {(hookDetails.coupons as string[]).join(", ")}</p>}
            </section>
            <section>
              <h2 className="h2" style={{ marginBottom: 12 }}>Notes</h2>
              {pay.notes?.length ? (
                <div style={{ display: "grid", gap: 8 }}>{pay.notes.map((n, i) => <div key={i} className="bubble"><div className="bubble-meta"><span>{n.created_at}</span></div>{n.note}</div>)}</div>
              ) : <p className="muted">Aucune note.</p>}
            </section>
          </div>
        </>
      )}

      {events.length > 0 && (
        <section className="sect">
          <h2 className="h2" style={{ marginBottom: 12 }}>Historique reçu par webhook</h2>
          {events.map((e) => (
            <div key={e.id} className="log">
              <span className="muted num-cell" style={{ fontSize: 12 }}>{formatDateTime(e.happenedAt)}</span>
              <div><span className="tag" data-tone={eventMeta(e.type).tone}>{eventMeta(e.type).label}</span> {e.amount !== null && formatMoney(e.amount, e.currency)} {typeof e.details.declineReason === "string" && <span className="muted">· {e.details.declineReason}</span>}</div>
            </div>
          ))}
        </section>
      )}
    </Shell>
  );
}
