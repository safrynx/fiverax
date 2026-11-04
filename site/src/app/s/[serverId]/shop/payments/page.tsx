import Link from "next/link";
import { redirect } from "next/navigation";
import { can, isOwner, requirePermissionPage } from "@/lib/auth";
import { fivemPlayersFor, getShopSettings, listPayments } from "@/lib/tebex";
import { formatMoney, paymentStatusMeta } from "@/lib/tebex-shared";
import { formatDateTime } from "@/lib/format";
import Shell, { PageHead } from "@/app/shell";
import { ShopNotReady, TebexError } from "../common";
import { ManualPaymentButton } from "./payment-actions";

export const dynamic = "force-dynamic";

export default async function PaymentsPage({ params, searchParams }: { params: Promise<{ serverId: string }>; searchParams: Promise<{ page?: string; txn?: string }> }) {
  const { user, server } = await requirePermissionPage((await params).serverId, "shop_view");
  const sp = await searchParams;
  const base = `/s/${server.id}/shop/payments`;
  // Search by transaction: straight to its page.
  const txn = sp.txn?.trim();
  if (txn) redirect(`${base}/${encodeURIComponent(txn)}`);
  const settings = await getShopSettings(server.id);

  if (!settings.configured) {
    return (
      <Shell user={user} server={server} active="shop_payments">
        <PageHead kicker={server.name} title="Paiements">Les paiements du webstore Tebex.</PageHead>
        <ShopNotReady settings={settings} owner={isOwner(user)} serverId={server.id} />
      </Shell>
    );
  }

  const page = Math.max(1, Math.min(10_000, Number(sp.page) || 1));
  const result = await listPayments(server.id, page);
  const payments = result.ok ? result.data.data ?? [] : [];
  const players = await fivemPlayersFor(server.id, payments.map((p) => p.player?.uuid));
  const lastPage = result.ok ? result.data.last_page : 1;

  return (
    <Shell user={user} server={server} active="shop_payments">
      <PageHead kicker={server.name} title="Paiements" actions={can(user, "shop_manage") && <ManualPaymentButton />}>
        Lus en direct sur Tebex, 25 par page.{result.ok ? ` ${result.data.total} paiement(s) au total.` : ""} Ouvre un paiement pour ses notes, son statut et ses packages.
      </PageHead>

      <form className="filters rise rise-1" action={base}>
        <input name="txn" placeholder="ID de transaction (tbx-…)" className="field" style={{ minWidth: 280, width: "auto" }} />
        <button className="btn primary">Ouvrir</button>
        <Link href={`/s/${server.id}/shop/customers`} className="linkish">Chercher un client</Link>
      </form>

      <TebexError result={result} />
      {result.ok && payments.length === 0 && <p className="muted" style={{ padding: "30px 0" }}>Aucun paiement.</p>}
      {payments.length > 0 && (
        <div className="tbl-wrap rise rise-2">
          <table className="tbl" style={{ minWidth: 900 }}>
            <thead><tr><th>Transaction</th><th>Client</th><th>Packages</th><th style={{ textAlign: "right" }}>Montant</th><th>Moyen</th><th>Statut</th><th>Le</th></tr></thead>
            <tbody>
              {payments.map((p, i) => {
                const status = paymentStatusMeta(p.status);
                const player = p.player?.uuid ? players.get(String(p.player.uuid)) : undefined;
                return (
                  <tr key={p.id} className="row-in" style={{ ["--i" as string]: Math.min(i, 14) }}>
                    <td className="num-cell"><Link href={`${base}/${p.id}`} style={{ fontWeight: 600 }}>#{p.id}</Link>{p.creator_code && <div className="muted" style={{ fontSize: 11 }}>code créateur {p.creator_code}</div>}</td>
                    <td style={{ fontWeight: 600 }}>
                      {p.player?.name ?? "—"}
                      {player && <div style={{ fontSize: 11, fontWeight: 400 }}><Link href={`/s/${server.id}/players/${player.id}`} className="linkish">fiche joueur</Link></div>}
                    </td>
                    <td className="muted" style={{ maxWidth: 300 }}>{p.packages.map((x) => x.name).join(", ")}</td>
                    <td className="num-cell" style={{ textAlign: "right" }}>{formatMoney(p.amount, p.currency?.iso_4217)}</td>
                    <td className="muted">{p.gateway?.name ?? "—"}</td>
                    <td><span className="tag" data-tone={status.tone}>{status.label}</span></td>
                    <td className="num-cell muted">{formatDateTime(p.date)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {result.ok && lastPage > 1 && (
        <div className="filters" style={{ marginTop: 18 }}>
          {page > 1 && <Link href={`${base}?page=${page - 1}`} className="btn">← Plus récents</Link>}
          <span className="muted" style={{ fontSize: 13 }}>Page {page} / {lastPage}</span>
          {page < lastPage && <Link href={`${base}?page=${page + 1}`} className="btn">Plus anciens →</Link>}
        </div>
      )}
    </Shell>
  );
}
