import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { adminOverview, systemChecks } from "@/lib/admin";
import { aiUsageSummary } from "@/lib/ai-quota";
import { requirePlatformAdminPage } from "@/lib/auth";
import { countOpenFeedback, countPendingRequests } from "@/lib/beta";
import { getPlatformSettings } from "@/lib/platform";
import { AI_KINDS, type AiKind } from "@/lib/platform-shared";
import Avatar from "../avatar";
import { GuildIcon } from "../new-server-form";
import { PageHead } from "../shell";
import AdminFrame, { formatAgo, formatDay } from "./admin-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Administration", robots: { index: false, follow: false } };

/** Platform administration: the state of the platform at a glance. */
export default async function AdminHome() {
  const identity = await requirePlatformAdminPage();
  const [o, ai, system, settings, pendingRequests, newFeedback] = await Promise.all([
    adminOverview(), aiUsageSummary(7), systemChecks(), getPlatformSettings(), countPendingRequests(), countOpenFeedback()
  ]);
  const moderation = o.moderation.reviews + o.moderation.library;

  return (
    <AdminFrame identity={identity} active="overview">
      <PageHead kicker="Administration Fiverax" title="Vue d'ensemble">
        Toute la plateforme : comptes, serveurs, agents, IA et modération. Réservé aux administrateurs (PANEL_OWNER_IDS).
      </PageHead>

      {system.warnings.length > 0 && (
        <div className="banner" data-tone="danger">
          <b>{system.warnings.length} point(s) de configuration à corriger</b> : {system.warnings.map((w) => w.label).join(" · ")}. <Link href="/admin/system" className="linkish">Voir le détail</Link>
        </div>
      )}
      {pendingRequests > 0 && (
        <div className="banner" data-tone="info"><b>{pendingRequests} demande(s) d&apos;accès à la bêta</b> en attente. <Link href="/admin/beta" className="linkish">Les traiter</Link></div>
      )}
      {newFeedback > 0 && (
        <div className="banner"><b>{newFeedback} nouveau(x) retour(s)</b> (bugs, idées) envoyés depuis le panel. <Link href="/admin/feedback" className="linkish">Lire</Link></div>
      )}
      {moderation > 0 && (
        <div className="banner">
          <b>{moderation} élément(s) en attente de modération</b> (avis masqués après signalements, créations de la bibliothèque). <Link href="/admin/moderation" className="linkish">Modérer</Link>
        </div>
      )}
      {settings.maintenance.active && <div className="banner" data-tone="danger">Le panel est en <b>maintenance</b> pour tous les autres comptes. <Link href="/admin/settings" className="linkish">Réglages</Link></div>}
      {!settings.registrationsOpen && <div className="banner">Les <b>inscriptions</b> de nouveaux serveurs sont fermées.</div>}
      {settings.beta.active && <div className="banner" data-tone="info"><b>Bêta privée active</b> : seuls les partenaires ajoutent un serveur. <Link href="/admin/beta" className="linkish">Gérer les partenaires</Link></div>}

      <div className="strip adm-strip rise rise-1">
        <div><small>Comptes</small><div className="num">{o.users.total}</div><small>+{o.users.new7d} en 7 jours · {o.users.banned} banni(s)</small></div>
        <div><small>Actifs 24 h</small><div className="num">{o.users.active24h}</div><small>{o.sessions.open} session(s) ouverte(s)</small></div>
        <div><small>Serveurs</small><div className="num">{o.servers.total}</div><small>+{o.servers.new7d} en 7 jours · {o.servers.suspended} suspendu(s)</small></div>
        <div><small>Agents FiveM en ligne</small><div className="num">{o.servers.agentsOnline}</div><small>sur {o.servers.withAgent} serveur(s) reliés · bot sur {o.servers.botAlive}</small></div>
        <div><small>Appels IA aujourd&apos;hui</small><div className="num">{ai.today}</div><small>{ai.refusedToday} refusé(s) par les quotas</small></div>
        <div><small>Scans gratuits</small><div className="num">{o.scans.last24h}</div><small>{o.scans.last7d} sur 7 jours</small></div>
      </div>

      <div className="cols even">
        <section className="sect rise rise-2" style={{ marginTop: 0 }}>
          <header><h2 className="h2">Nouveaux serveurs</h2><Link href="/admin/servers" className="linkish adm-more">Tous<ArrowRight size={12} /></Link></header>
          <div className="adm-list">
            {o.recentServers.length === 0 && <p className="muted">Aucun serveur.</p>}
            {o.recentServers.map((s) => (
              <div key={s.id}>
                <Link href={`/admin/servers/${s.id}`} className="adm-who" style={{ textDecoration: "none", color: "inherit" }}>
                  <GuildIcon url={s.iconUrl} name={s.name} size={32} />
                  <div><b>{s.name}</b><small>{s.creatorName ?? s.createdBy ?? "?"} · {formatDay(s.createdAt)}</small></div>
                </Link>
                {s.suspended && <span className="tag" data-tone="danger">Suspendu</span>}
              </div>
            ))}
          </div>
        </section>

        <section className="sect rise rise-3" style={{ marginTop: 0 }}>
          <header><h2 className="h2">Nouveaux comptes</h2><Link href="/admin/users" className="linkish adm-more">Tous<ArrowRight size={12} /></Link></header>
          <div className="adm-list">
            {o.recentUsers.length === 0 && <p className="muted">Aucun compte.</p>}
            {o.recentUsers.map((u) => (
              <div key={u.discordId}>
                <Link href={`/admin/users/${u.discordId}`} className="adm-who" style={{ textDecoration: "none", color: "inherit" }}>
                  <Avatar url={u.avatarUrl} name={u.username} size={32} />
                  <div><b>{u.username}</b><small>première connexion {formatAgo(u.firstLoginAt)}</small></div>
                </Link>
                {u.bannedAt && <span className="tag" data-tone="danger">Banni</span>}
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="sect rise rise-4">
        <header>
          <h2 className="h2">IA sur 7 jours</h2>
          <span className="muted" style={{ fontSize: 13 }}>
            Quotas : {settings.ai.enabled ? `${settings.ai.perServerDaily || "∞"} / serveur, ${settings.ai.perUserDaily || "∞"} / compte, ${settings.ai.globalDaily || "∞"} au total par jour` : "IA désactivée"}
          </span>
        </header>
        <div className="cols even" style={{ gap: 28 }}>
          <div className="tbl-wrap">
            <table className="tbl" style={{ minWidth: 0 }}>
              <thead><tr><th>Jour</th><th>Appels</th><th>Refusés</th></tr></thead>
              <tbody>
                {[...ai.days].reverse().map((d) => (
                  <tr key={d.day}><td>{formatDay(d.day)}</td><td className="num-cell">{d.count}</td><td className="num-cell">{d.refused || ""}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="eyebrow" style={{ margin: "12px 0 8px" }}>Aujourd&apos;hui, par usage</h3>
            {ai.byKind.length === 0 && <p className="muted">Aucun appel aujourd&apos;hui.</p>}
            <div className="adm-list">
              {ai.byKind.map((k) => <div key={k.kind}><span>{AI_KINDS[k.kind as AiKind] ?? k.kind}</span><b className="num-cell">{k.count}</b></div>)}
            </div>
            <h3 className="eyebrow" style={{ margin: "22px 0 8px" }}>Serveurs les plus gourmands aujourd&apos;hui</h3>
            {ai.topServers.length === 0 && <p className="muted">—</p>}
            <div className="adm-list">
              {ai.topServers.map((s) => (
                <div key={s.serverId}>
                  <Link href={`/admin/servers/${s.serverId}`} className="linkish">{s.serverId}</Link>
                  <span className="num-cell">{s.count}{s.refused ? <span className="muted"> · {s.refused} refusé(s)</span> : null}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </AdminFrame>
  );
}
