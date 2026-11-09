import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, PauseCircle, PlayCircle, RotateCcw, Trash2 } from "lucide-react";
import { adminServerDetail } from "@/lib/admin";
import { requirePlatformAdminPage } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { actionMeta } from "@/lib/logs";
import { ADMIN_ACTIONS } from "@/lib/platform-shared";
import { LEGACY_SERVER_ID } from "@/lib/servers";
import { PageHead } from "../../../shell";
import { AddOwnerForm, AdminAction } from "../../admin-actions";
import AdminFrame, { formatAgo, formatDay } from "../../admin-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Serveur · Administration", robots: { index: false, follow: false } };

export default async function AdminServer({ params }: { params: Promise<{ serverId: string }> }) {
  const identity = await requirePlatformAdminPage();
  const detail = await adminServerDetail((await params).serverId);
  if (!detail) notFound();
  const { server, row, owners, ai, logs, journal } = detail;

  return (
    <AdminFrame identity={identity} active="servers">
      <PageHead
        kicker="Serveur"
        title={server.name}
        actions={
          <>
            <Link href={`/s/${server.id}`} className="btn sm"><ExternalLink size={14} />Ouvrir son panel</Link>
            {server.suspended ? (
              <AdminAction action="server_unsuspend" payload={{ serverId: server.id }} success="Serveur rétabli." className="btn sm primary"
                confirm={{ title: "Rétablir ce serveur", message: "Son panel, son agent FiveM, le bot et ses pages publiques reprennent tout de suite.", confirmLabel: "Rétablir" }}>
                <PlayCircle size={14} />Rétablir
              </AdminAction>
            ) : (
              <AdminAction action="server_suspend" payload={{ serverId: server.id }} success="Serveur suspendu." className="btn sm danger"
                confirm={{
                  title: "Suspendre ce serveur", danger: true, confirmLabel: "Suspendre",
                  message: "Son panel se ferme à tous (sauf aux administrateurs), son agent FiveM est refusé, le bot cesse de le surveiller et ses pages publiques (annuaire, portail, boutique, badge) disparaissent. Rien n'est supprimé.",
                  input: { label: "Raison (montrée aux propriétaires)", field: "reason", multiline: true }
                }}>
                <PauseCircle size={14} />Suspendre
              </AdminAction>
            )}
          </>
        }
      >
        <span className="muted">{server.id}{server.guildId ? ` · Discord ${server.guildId}` : " · aucun serveur Discord lié"}</span>
      </PageHead>

      {server.suspended && <div className="banner" data-tone="danger"><b>Suspendu</b>{server.suspendedReason ? ` : ${server.suspendedReason}` : ""}</div>}

      <div className="adm-kv rise rise-1">
        <div><small>Créé le</small><b>{formatDay(row.createdAt)}</b></div>
        <div><small>Créé par</small><b>{row.createdBy && row.createdBy !== "system" ? <Link href={`/admin/users/${row.createdBy}`} className="linkish">{row.creatorName ?? row.createdBy}</Link> : "système"}</b></div>
        <div><small>Staff</small><b>{row.staff}</b></div>
        <div><small>Joueurs vus</small><b>{row.players}</b></div>
        <div><small>Agent FiveM</small><b>{!row.hasFivemToken ? "non relié" : row.agentOnline ? "en ligne" : `vu ${formatAgo(row.agentSeenAt)}`}</b></div>
        <div><small>Bot Discord</small><b>{!row.guildId ? "—" : row.botAlive ? "présent" : "absent"}</b></div>
        <div><small>IA aujourd&apos;hui</small><b>{ai.today}{ai.refusedToday ? ` (+${ai.refusedToday} refusés)` : ""}</b></div>
        <div><small>IA sur 30 jours</small><b>{ai.last30}</b></div>
      </div>

      <div className="cols even">
        <section className="sect rise rise-2" style={{ marginTop: 0 }}>
          <header><h2 className="h2">Propriétaires</h2><span className="muted" style={{ fontSize: 12 }}>tous les droits sur ce serveur</span></header>
          <div className="adm-list">
            {owners.length === 0 && <p className="muted">Aucun propriétaire (seuls les administrateurs y ont accès).</p>}
            {owners.map((o) => (
              <div key={o.discordId}>
                <Link href={`/admin/users/${o.discordId}`} className="linkish">{o.username ?? o.discordId}</Link>
                <span className="adm-actions">
                  {o.banned && <span className="tag" data-tone="danger">Banni</span>}
                  <AdminAction action="server_owner_remove" payload={{ serverId: server.id, discordId: o.discordId }} success="Propriétaire retiré." className="btn sm"
                    confirm={{ title: "Retirer ce propriétaire", message: `${o.username ?? o.discordId} perd tous ses droits de propriétaire sur ${server.name}.`, danger: true, confirmLabel: "Retirer" }}>
                    Retirer
                  </AdminAction>
                </span>
              </div>
            ))}
          </div>
          <AddOwnerForm serverId={server.id} />
        </section>

        <section className="sect rise rise-3" style={{ marginTop: 0 }}>
          <header><h2 className="h2">Zone sensible</h2></header>
          <div className="adm-list">
            <div>
              <span><b>Quota IA du jour</b><br /><small className="muted">Rend au serveur son quota d&apos;aujourd&apos;hui (après un pic légitime).</small></span>
              <AdminAction action="server_ai_reset" payload={{ serverId: server.id }} success="Quota IA remis à zéro." className="btn sm"
                confirm={{ title: "Remettre le quota IA à zéro", message: "Les appels d'aujourd'hui de ce serveur ne comptent plus. Les quotas des comptes ne changent pas.", confirmLabel: "Remettre à zéro" }}>
                <RotateCcw size={14} />Remettre à zéro
              </AdminAction>
            </div>
            {server.id !== LEGACY_SERVER_ID && (
              <div>
                <span><b>Supprimer le serveur</b><br /><small className="muted">Toutes ses données, définitivement.</small></span>
                <AdminAction action="server_delete" payload={{ serverId: server.id }} success="Serveur supprimé." redirectTo="/admin/servers" className="btn sm danger"
                  confirm={{
                    title: "Supprimer définitivement", danger: true, confirmLabel: "Supprimer",
                    message: `Staff, joueurs, bans, boutique, créations, logs… tout ce qui appartient à ${server.name} est effacé. Irréversible. Pour suspendre sans rien perdre, utilise « Suspendre ».`,
                    input: { label: `Tape l'identifiant du serveur pour confirmer : ${server.id}`, field: "confirm", placeholder: server.id }
                  }}>
                  <Trash2 size={14} />Supprimer
                </AdminAction>
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="cols even">
        <section className="sect rise rise-4">
          <header><h2 className="h2">Dernières actions sur ce serveur</h2><span className="muted" style={{ fontSize: 12 }}>ses logs</span></header>
          <div className="adm-list">
            {logs.length === 0 && <p className="muted">Rien pour le moment.</p>}
            {logs.map((l, i) => {
              const meta = actionMeta(l.action);
              return <div key={i}><span><span className="tag" data-tone={meta.tone}>{meta.label}</span> <span className="muted">· {l.actor}</span></span><time className="muted num-cell">{formatDateTime(l.createdAt)}</time></div>;
            })}
          </div>
        </section>
        <section className="sect rise rise-4">
          <header><h2 className="h2">Journal de l&apos;administration</h2></header>
          <div className="adm-list">
            {journal.length === 0 && <p className="muted">Aucune action d&apos;administrateur sur ce serveur.</p>}
            {journal.map((j) => (
              <div key={j.id}>
                <span><b>{ADMIN_ACTIONS[j.action] ?? j.action}</b> <span className="muted">· {j.actorName ?? j.actorId}{typeof j.details.reason === "string" ? ` · ${j.details.reason}` : ""}</span></span>
                <time className="muted num-cell">{formatDateTime(j.createdAt)}</time>
              </div>
            ))}
          </div>
        </section>
      </div>

      <p className="muted" style={{ marginTop: 30, fontSize: 12 }}>
        Les propriétaires voient la suspension et sa raison sur leur liste de serveurs ; chaque action d&apos;ici est aussi écrite dans les logs du serveur.
      </p>
    </AdminFrame>
  );
}
