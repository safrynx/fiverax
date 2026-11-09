import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, Handshake, LogOut, ShieldCheck } from "lucide-react";
import { adminUserDetail } from "@/lib/admin";
import { requirePlatformAdminPage } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { ADMIN_ACTIONS } from "@/lib/platform-shared";
import Avatar from "../../../avatar";
import { PageHead } from "../../../shell";
import { AdminAction } from "../../admin-actions";
import AdminFrame, { formatAgo, formatDay } from "../../admin-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Compte · Administration", robots: { index: false, follow: false } };

/** "Mozilla/5.0 (Windows NT 10.0; Win64; x64) … Chrome/131…" -> "Chrome · Windows" (enough to recognise a device). */
function device(ua: string | null): string {
  if (!ua) return "—";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Navigateur";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "?";
  return `${browser} · ${os}`;
}

export default async function AdminUser({ params }: { params: Promise<{ discordId: string }> }) {
  const identity = await requirePlatformAdminPage();
  const { discordId } = await params;
  if (!/^\d{17,20}$/.test(discordId)) notFound();
  const d = await adminUserDetail(discordId);
  const name = d.user?.username ?? discordId;
  const now = Date.now();
  const open = d.sessions.filter((s) => !s.revokedAt && Date.parse(s.expiresAt) > now);
  const self = discordId === identity.discordId;

  return (
    <AdminFrame identity={identity} active="users">
      <PageHead
        kicker={d.platformAdmin ? "Administrateur de la plateforme" : d.user?.partnerAt ? "Partenaire de la bêta" : "Compte Discord"}
        title={name}
        actions={
          <>
            {!d.platformAdmin && !d.user?.bannedAt && (d.user?.partnerAt ? (
              <AdminAction action="partner_remove" payload={{ discordId }} success="Partenaire retiré." className="btn sm"
                confirm={{ title: "Retirer de la bêta", message: `${name} ne pourra plus ajouter de serveur, et ses serveurs se ferment pendant la bêta (sauf si un autre propriétaire est partenaire). Rien n'est supprimé.`, confirmLabel: "Retirer", danger: true }}>
                <Handshake size={14} />Retirer des partenaires
              </AdminAction>
            ) : (
              <AdminAction action="partner_add" payload={{ discordId }} success="Partenaire ajouté : son accès à la bêta est ouvert." className="btn sm primary">
                <Handshake size={14} />Ajouter aux partenaires
              </AdminAction>
            ))}
            {open.length > 0 && (
              <AdminAction action="user_sessions_revoke" payload={{ discordId }} success="Sessions fermées" className="btn sm"
                confirm={{ title: "Fermer toutes ses sessions", message: `${name} est déconnecté partout (il peut se reconnecter, sauf s'il est banni).`, confirmLabel: "Fermer les sessions" }}>
                <LogOut size={14} />Déconnecter partout
              </AdminAction>
            )}
            {!d.platformAdmin && !self && (d.user?.bannedAt ? (
              <AdminAction action="user_unban" payload={{ discordId }} success="Compte débanni." className="btn sm primary"
                confirm={{ title: "Lever le bannissement", message: `${name} pourra de nouveau se connecter à Fiverax.`, confirmLabel: "Débannir" }}>
                <ShieldCheck size={14} />Débannir
              </AdminAction>
            ) : (
              <AdminAction action="user_ban" payload={{ discordId }} success="Compte banni" className="btn sm danger"
                confirm={{
                  title: "Bannir ce compte", danger: true, confirmLabel: "Bannir",
                  message: `${name} ne pourra plus se connecter (panel, avis, votes, portail) et ses sessions se ferment. Ses serveurs continuent de tourner : suspends-les à part si besoin.`,
                  input: { label: "Raison (gardée dans le journal)", field: "reason", multiline: true }
                }}>
                <Ban size={14} />Bannir
              </AdminAction>
            ))}
          </>
        }
      >
        <span className="muted">{discordId}</span>
      </PageHead>

      {d.user?.bannedAt && (
        <div className="banner" data-tone="danger"><b>Banni</b> le {formatDay(d.user.bannedAt)}{d.user.banReason ? ` : ${d.user.banReason}` : ""}</div>
      )}
      {!d.user && <div className="banner">Ce compte ne s&apos;est jamais connecté (ou avant le suivi des comptes).</div>}

      <div className="adm-kv rise rise-1">
        <div><small>Compte</small><b style={{ display: "flex", gap: 8, alignItems: "center" }}><Avatar url={d.user?.avatarUrl ?? null} name={name} size={22} />{name}</b></div>
        <div><small>Première connexion</small><b>{formatDay(d.user?.firstLoginAt)}</b></div>
        <div><small>Dernière connexion</small><b>{formatAgo(d.user?.lastLoginAt)}</b></div>
        <div><small>Connexions</small><b>{d.user?.loginCount ?? 0}</b></div>
        <div><small>Sessions ouvertes</small><b>{open.length}</b></div>
      </div>

      <div className="cols even">
        <section className="sect rise rise-2" style={{ marginTop: 0 }}>
          <header><h2 className="h2">Serveurs</h2></header>
          <div className="adm-list">
            {d.owned.length + d.created.length + d.access.length === 0 && <p className="muted">Aucun serveur.</p>}
            {d.owned.map((s) => (
              <div key={`o-${s.id}`}><Link href={`/admin/servers/${s.id}`} className="linkish">{s.name}</Link><span className="adm-actions">{s.suspended && <span className="tag" data-tone="danger">Suspendu</span>}<span className="tag" data-tone="info">Propriétaire</span></span></div>
            ))}
            {d.created.filter((s) => !d.owned.some((o) => o.id === s.id)).map((s) => (
              <div key={`c-${s.id}`}><Link href={`/admin/servers/${s.id}`} className="linkish">{s.name}</Link><span className="tag">Créé (plus propriétaire)</span></div>
            ))}
            {d.access.filter((s) => !d.owned.some((o) => o.id === s.id)).map((s) => (
              <div key={`a-${s.id}`}><Link href={`/admin/servers/${s.id}`} className="linkish">{s.name}</Link><span className="tag">Accès au panel</span></div>
            ))}
          </div>
        </section>

        <section className="sect rise rise-3" style={{ marginTop: 0 }}>
          <header><h2 className="h2">Journal de l&apos;administration</h2></header>
          <div className="adm-list">
            {d.journal.length === 0 && <p className="muted">Aucune action d&apos;administrateur sur ce compte.</p>}
            {d.journal.map((j) => (
              <div key={j.id}>
                <span><b>{ADMIN_ACTIONS[j.action] ?? j.action}</b> <span className="muted">· {j.actorName ?? j.actorId}{typeof j.details.reason === "string" ? ` · ${j.details.reason}` : ""}</span></span>
                <time className="muted num-cell">{formatDateTime(j.createdAt)}</time>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="sect rise rise-4">
        <header><h2 className="h2">Sessions</h2><span className="muted" style={{ fontSize: 12 }}>les 20 dernières · une session dure 8 h</span></header>
        <div className="tbl-wrap">
          <table className="tbl adm-tbl">
            <thead><tr><th>Ouverte</th><th>Dernière activité</th><th>Appareil</th><th>État</th><th /></tr></thead>
            <tbody>
              {d.sessions.length === 0 && <tr><td colSpan={5} className="muted" style={{ padding: "22px 14px" }}>Aucune session enregistrée.</td></tr>}
              {d.sessions.map((s) => {
                const active = !s.revokedAt && Date.parse(s.expiresAt) > now;
                return (
                  <tr key={s.id}>
                    <td className="num-cell">{formatDateTime(s.createdAt)}</td>
                    <td className="num-cell">{formatAgo(s.lastSeenAt, now)}</td>
                    <td title={s.userAgent ?? ""}>{device(s.userAgent)}</td>
                    <td>{active ? <span className="tag" data-tone="up">Ouverte</span> : s.revokedAt ? <span className="tag">Fermée ({s.revokedReason === "logout" ? "déconnexion" : s.revokedReason === "ban" ? "bannissement" : "administrateur"})</span> : <span className="tag">Expirée</span>}</td>
                    <td style={{ textAlign: "right" }}>
                      {active && (
                        <AdminAction action="session_revoke" payload={{ sessionId: s.id }} success="Session fermée." className="btn sm"
                          confirm={{ title: "Fermer cette session", message: "Cet appareil est déconnecté.", confirmLabel: "Fermer" }}>
                          Fermer
                        </AdminAction>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </AdminFrame>
  );
}
