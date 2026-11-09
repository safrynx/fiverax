import type { Metadata } from "next";
import Link from "next/link";
import { Check, ExternalLink, X } from "lucide-react";
import { requirePlatformAdminPage } from "@/lib/auth";
import { listPartners, listRequests } from "@/lib/beta";
import { formatDateTime } from "@/lib/format";
import { getPlatformSettings } from "@/lib/platform";
import Avatar from "../../avatar";
import { PageHead } from "../../shell";
import { AddPartnerForm, AdminAction } from "../admin-actions";
import AdminFrame, { formatDay } from "../admin-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bêta · Administration", robots: { index: false, follow: false } };

/** A link of a request, made clickable only when it is a safe https / cfx.re / discord.gg address. */
function RequestLink({ link }: { link: string | null }) {
  if (!link) return null;
  const href = /^https:\/\//i.test(link) ? link : /^(cfx\.re\/join\/|discord\.gg\/)/i.test(link) ? `https://${link}` : null;
  return href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="linkish adm-more">{link}<ExternalLink size={11} /></a> : <span className="muted">{link}</span>;
}

/** Private beta: who is in (partners), who asks (requests), and the switch itself. */
export default async function AdminBeta() {
  const identity = await requirePlatformAdminPage();
  const [settings, requests, history, partners] = await Promise.all([getPlatformSettings(), listRequests("pending"), listRequests("all", 60), listPartners()]);
  const decided = history.filter((r) => r.status !== "pending").slice(0, 20);

  return (
    <AdminFrame identity={identity} active="beta">
      <PageHead kicker="Administration" title="Bêta & partenaires" actions={<AddPartnerForm />}>
        Pendant la bêta, seuls les partenaires ajoutent un serveur, et un serveur ne s&apos;ouvre que si un de ses propriétaires est partenaire (son équipe y accède alors normalement).
      </PageHead>

      {settings.beta.active
        ? <div className="banner" data-tone="info"><b>Bêta privée active.</b> Pour l&apos;ouvrir à tout le monde : <Link href="/admin/settings" className="linkish">Réglages</Link>.</div>
        : <div className="banner"><b>Bêta désactivée</b> : tout le monde peut ajouter son serveur. <Link href="/admin/settings" className="linkish">Réglages</Link></div>}

      <section className="sect rise rise-1" style={{ marginTop: 0 }}>
        <header><h2 className="h2">Demandes d&apos;accès</h2><span className="muted" style={{ fontSize: 13 }}>{requests.length} en attente</span></header>
        {requests.length === 0 && <p className="muted" style={{ padding: "14px 0" }}>Aucune demande en attente.</p>}
        {requests.map((r) => (
          <article key={r.discordId} className="adm-card">
            <header>
              <span><b>{r.serverName}</b> <span className="muted">· par</span> <Link href={`/admin/users/${r.discordId}`} className="linkish">{r.username}</Link></span>
              <span className="muted num-cell">{formatDateTime(r.updatedAt)}</span>
            </header>
            <p style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <RequestLink link={r.link} />
              {r.players && <span className="muted">{r.players} joueurs</span>}
            </p>
            {r.message && <p className="muted">{r.message}</p>}
            <div className="adm-actions" style={{ marginTop: 10 }}>
              <AdminAction action="beta_approve" payload={{ discordId: r.discordId }} success="Accès accordé : il peut ajouter son serveur." className="btn sm primary"><Check size={14} />Accepter</AdminAction>
              <AdminAction action="beta_refuse" payload={{ discordId: r.discordId }} success="Demande refusée." className="btn sm"
                confirm={{ title: "Refuser cette demande", message: "Il pourra en refaire une dans 7 jours.", confirmLabel: "Refuser", danger: true }}>
                <X size={14} />Refuser
              </AdminAction>
            </div>
          </article>
        ))}
      </section>

      <section className="sect rise rise-2">
        <header><h2 className="h2">Partenaires</h2><span className="muted" style={{ fontSize: 13 }}>{partners.length} compte(s) · les administrateurs le sont d&apos;office</span></header>
        <div className="adm-list">
          {partners.length === 0 && <p className="muted">Aucun partenaire pour le moment : accepte une demande ou ajoute un ID Discord.</p>}
          {partners.map((p) => (
            <div key={p.discordId}>
              <Link href={`/admin/users/${p.discordId}`} className="adm-who" style={{ textDecoration: "none", color: "inherit" }}>
                <Avatar url={p.avatarUrl} name={p.username} size={30} />
                <div><b>{p.username}</b><small>{p.discordId} · depuis le {formatDay(p.partnerAt)} · {p.servers} serveur(s)</small></div>
              </Link>
              <AdminAction action="partner_remove" payload={{ discordId: p.discordId }} success="Partenaire retiré." className="btn sm"
                confirm={{ title: "Retirer ce partenaire", message: `${p.username} ne pourra plus ajouter de serveur, et ses serveurs se ferment pendant la bêta (sauf si un autre propriétaire est partenaire). Rien n'est supprimé.`, confirmLabel: "Retirer", danger: true }}>
                Retirer
              </AdminAction>
            </div>
          ))}
        </div>
      </section>

      {decided.length > 0 && (
        <section className="sect rise rise-3">
          <header><h2 className="h2">Demandes traitées</h2></header>
          <div className="adm-list">
            {decided.map((r) => (
              <div key={r.discordId}>
                <span><b>{r.serverName}</b> <span className="muted">· {r.username}</span></span>
                <span className="adm-actions">
                  <span className="tag" data-tone={r.status === "approved" ? "up" : "warn"}>{r.status === "approved" ? "Acceptée" : "Refusée"}</span>
                  <time className="muted num-cell">{r.decidedAt ? formatDateTime(r.decidedAt) : ""}</time>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </AdminFrame>
  );
}
