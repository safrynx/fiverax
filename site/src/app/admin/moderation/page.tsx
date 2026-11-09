import type { Metadata } from "next";
import Link from "next/link";
import { Check, ExternalLink, X } from "lucide-react";
import { requirePlatformAdminPage } from "@/lib/auth";
import { reviewsToModerate } from "@/lib/directory";
import { formatDateTime } from "@/lib/format";
import { hiddenItems, itemReports } from "@/lib/library";
import { PageHead } from "../../shell";
import { AdminAction } from "../admin-actions";
import AdminFrame from "../admin-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Modération · Administration", robots: { index: false, follow: false } };

const KIND_LABEL = { ui: "UI", script: "Script", map: "Mapping" } as const;

/**
 * What the community flagged: directory reviews hidden after 3 reports, and library creations hidden after reports.
 * Republish (the reports are cleared) or remove for good.
 */
export default async function AdminModeration() {
  const identity = await requirePlatformAdminPage();
  const [reviews, items] = await Promise.all([reviewsToModerate(), hiddenItems()]);
  const reports = await Promise.all(items.map((i) => itemReports(i.id)));

  return (
    <AdminFrame identity={identity} active="moderation">
      <PageHead kicker="Administration" title="Modération">
        Les avis de l&apos;annuaire et les créations de la bibliothèque masqués après des signalements attendent ta décision.
      </PageHead>

      <section className="sect rise rise-1" style={{ marginTop: 0 }}>
        <header><h2 className="h2">Avis de l&apos;annuaire</h2><span className="muted" style={{ fontSize: 13 }}>{reviews.length} en attente</span></header>
        {reviews.length === 0 && <p className="muted" style={{ padding: "16px 0" }}>Rien à modérer.</p>}
        {reviews.map((r) => (
          <article key={r.id} className="adm-card">
            <header>
              <span><b>{r.author}</b> <span className="muted">sur</span> <Link href={`/annuaire/${r.slug}`} className="linkish adm-more" target="_blank">{r.serverName}<ExternalLink size={11} /></Link></span>
              <span className="muted num-cell">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)} · {formatDateTime(r.createdAt)} · {r.reports} signalement(s)</span>
            </header>
            <p>{r.body}</p>
            {r.reasons.length > 0 && <p className="muted" style={{ fontSize: 13 }}>Signalé pour : {r.reasons.map((x) => `« ${x} »`).join(", ")}</p>}
            <div className="adm-actions" style={{ marginTop: 10 }}>
              <AdminAction action="review_moderate" payload={{ reviewId: r.id, status: "published" }} success="Avis republié." className="btn sm primary"><Check size={14} />Republier</AdminAction>
              <AdminAction action="review_moderate" payload={{ reviewId: r.id, status: "removed" }} success="Avis retiré." className="btn sm danger"
                confirm={{ title: "Retirer cet avis", message: "Il disparaît de l'annuaire ; son auteur ne peut plus le republier.", danger: true, confirmLabel: "Retirer" }}>
                <X size={14} />Retirer
              </AdminAction>
            </div>
          </article>
        ))}
      </section>

      <section className="sect rise rise-2">
        <header><h2 className="h2">Bibliothèque du réseau</h2><span className="muted" style={{ fontSize: 13 }}>{items.length} en attente</span></header>
        {items.length === 0 && <p className="muted" style={{ padding: "16px 0" }}>Rien à modérer.</p>}
        {items.map((item, i) => (
          <article key={item.id} className="adm-card">
            <header>
              <span>
                <span className="tag">{KIND_LABEL[item.kind] ?? item.kind}</span> <b>{item.title}</b> <span className="muted">· {item.resource} v{item.version} · par {item.serverName}</span>
              </span>
              <Link href={`/s/${item.serverId}/library/${item.id}`} className="linkish adm-more">Voir la création<ExternalLink size={11} /></Link>
            </header>
            {item.description && <p className="muted">{item.description}</p>}
            {reports[i].length > 0 && (
              <p style={{ fontSize: 13 }}>Signalements : {reports[i].map((r) => `${r.serverName}${r.reason ? ` (« ${r.reason} »)` : ""}`).join(" · ")}</p>
            )}
            <div className="adm-actions" style={{ marginTop: 10 }}>
              <AdminAction action="library_moderate" payload={{ itemId: item.id, status: "published" }} success="Création republiée." className="btn sm primary"><Check size={14} />Republier</AdminAction>
              <AdminAction action="library_moderate" payload={{ itemId: item.id, status: "removed" }} success="Création retirée." className="btn sm danger"
                confirm={{ title: "Retirer cette création", message: "Elle disparaît de la bibliothèque (les serveurs qui l'ont installée la gardent).", danger: true, confirmLabel: "Retirer" }}>
                <X size={14} />Retirer
              </AdminAction>
            </div>
          </article>
        ))}
      </section>
    </AdminFrame>
  );
}
