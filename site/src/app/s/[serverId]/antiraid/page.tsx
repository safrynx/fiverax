import Link from "next/link";
import { Check, CircleHelp, Eye, Sparkles, X } from "lucide-react";
import { can, requirePermissionPage } from "@/lib/auth";
import { latestDiscordAudit } from "@/lib/discord-audit";
import { SEVERITY_LABEL } from "@/lib/audit-rules";
import ScoreRing, { scoreTier } from "@/app/score-ring";
import "@/app/growth.css";
import "@/app/security.css";
import { getServerStatus } from "@/lib/bot-status";
import { db } from "@/lib/db";
import { getSecuritySettings, listIncidents } from "@/lib/security";
import { listBackups, listBotActions } from "@/lib/security-live";
import { INCIDENT_LABELS, PUNISHMENT_LABELS } from "@/lib/security-config";
import { formatDateTime } from "@/lib/format";
import Shell, { PageHead } from "@/app/shell";
import { AutoRefresh } from "../security-actions";
import AntiraidSettingsForm from "./settings-form";
import RestoreButton from "./restore-button";
import DiscordControls, { DiscordAuditButton, RestoreBackupButton } from "./discord-controls";

const ACTION_LABELS: Record<string, string> = { lockdown: "Verrouillage", unlock: "Déverrouillage", backup: "Sauvegarde", restore: "Restauration", audit: "Audit" };
const TONE = { critical: "danger", high: "warn", medium: "info", info: undefined } as const;
const ACTION_STATUS: Record<string, [string, string]> = {
  pending: ["En attente du bot", "neutral"], sent: ["En cours", "info"], done: ["Fait", "up"], failed: ["Échec", "danger"], expired: ["Bot absent", "warn"]
};

export const dynamic = "force-dynamic";

export default async function AntiraidPage({ params, searchParams }: { params: Promise<{ serverId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { user, server } = await requirePermissionPage((await params).serverId, "view_security");
  const canConfig = can(user, "security_config");
  const requested = (await searchParams).tab;
  const tab = requested === "settings" && canConfig ? "settings" : requested === "backups" ? "backups" : requested === "audit" ? "audit" : "incidents";
  const base = `/s/${server.id}/antiraid`;
  const [settings, incidents, heartbeat, roles, backups, actions, audit] = await Promise.all([
    getSecuritySettings(server.id),
    tab === "incidents" ? listIncidents(server.id, 150) : Promise.resolve([]),
    getServerStatus(server.id, "heartbeat"),
    db.all<{ id: string; name: string }>("SELECT id, name FROM discord_roles WHERE server_id = ? ORDER BY position DESC", [server.id]),
    tab === "backups" ? listBackups(server.id) : Promise.resolve([]),
    listBotActions(server.id, 5),
    latestDiscordAudit(server.id).catch(() => null)
  ]);
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const botOnline = Boolean(heartbeat && Date.now() - new Date(heartbeat).getTime() < 3 * 60_000);
  const ar = settings.antiraid;

  return (
    <Shell user={user} server={server} active="antiraid">
      <PageHead kicker={server.name} title="Anti-raid Discord" help="/guides/anti-raid" actions={canConfig ? <DiscordControls disabled={!server.guildId} /> : undefined}>
        Le bot surveille le journal d&apos;audit du Discord en temps réel : il annule les actions destructrices (rôles et salons supprimés, retraits de rôles en masse, bans en masse…) et sanctionne leur auteur.
      </PageHead>
      {tab !== "settings" && <AutoRefresh everyMs={10_000} />}

      {!server.guildId && <div className="banner"><b>Aucun serveur Discord lié.</b> Renseigne-le dans Configuration.</div>}
      {server.guildId && !botOnline && <div className="banner"><b>Le bot Discord ne répond pas.</b> L&apos;anti-raid ne fonctionne que si le bot tourne.</div>}
      {!ar.enabled && <div className="banner"><b>L&apos;anti-raid est désactivé.</b> {canConfig ? <Link href={`${base}?tab=settings`} className="linkish">L&apos;activer dans les réglages</Link> : "Un propriétaire doit l'activer."}</div>}
      {ar.enabled && ar.mode === "observe" && <div className="banner"><Eye size={14} style={{ verticalAlign: -2 }} /> <b>Mode observation :</b> le bot signale les raids sans rien annuler ni sanctionner. {canConfig && <Link href={`${base}?tab=settings`} className="linkish">Passer en Protection</Link>}</div>}

      <div className="strip">
        <div className="rise rise-1"><div className="eyebrow">Statut</div><div className="num" style={{ fontSize: 22, display: "flex", alignItems: "center", gap: 10 }}><span className={`dot ${ar.enabled && botOnline ? "on" : ""}`} />{ar.enabled ? (botOnline ? (ar.mode === "observe" ? "Observation" : "Protégé") : "Bot absent") : "Désactivé"}</div><small>bot {botOnline ? "en ligne" : "hors ligne"}</small></div>
        <div className="rise rise-2"><div className="eyebrow">Sanction</div><div className="num" style={{ fontSize: 18 }}>{PUNISHMENT_LABELS[ar.punishment].split(" (")[0]}</div><small>{ar.trusted.length} personne(s) de confiance</small></div>
        <div className="rise rise-3"><div className="eyebrow">Raid de comptes</div><div className="num" style={{ fontSize: 18 }}>{ar.joinRaid.enabled ? `${ar.joinRaid.joins} en ${ar.joinRaid.windowSec} s` : "Off"}</div><small>verrouillage {ar.joinRaid.lockdownMinutes} min</small></div>
        <div className="rise rise-4"><div className="eyebrow">Audit Discord</div><div className="num" style={{ fontSize: 22, color: audit ? scoreTier(audit.report.score)[1] : undefined }}>{audit ? `${audit.report.grade} · ${audit.report.score}/100` : "—"}</div><small>{audit ? `le ${formatDateTime(audit.createdAt)}` : <Link href={`${base}?tab=audit`} className="linkish">jamais lancé</Link>}</small></div>
      </div>

      {actions.length > 0 && (
        <div className="filters rise rise-1" style={{ gap: 8 }}>
          <span className="eyebrow">Dernières commandes</span>
          {actions.map((a) => {
            const [label, tone] = ACTION_STATUS[a.status] ?? [a.status, "neutral"];
            return <span key={a.id} className="tag" data-tone={tone} title={a.result ?? ""}>{ACTION_LABELS[a.kind] ?? a.kind} · {label} · {formatDateTime(a.created_at)}</span>;
          })}
        </div>
      )}

      <div className="pill-tabs rise rise-1" style={{ marginBottom: 22 }}>
        <Link href={base} data-on={tab === "incidents"}>Incidents</Link>
        <Link href={`${base}?tab=audit`} data-on={tab === "audit"}>Audit Discord</Link>
        <Link href={`${base}?tab=backups`} data-on={tab === "backups"}>Sauvegardes</Link>
        {canConfig && <Link href={`${base}?tab=settings`} data-on={tab === "settings"}>Réglages</Link>}
      </div>

      {tab === "incidents" && incidents.length === 0 && <p className="muted" style={{ padding: "30px 0" }}>Aucun incident. Tout ce que l&apos;anti-raid bloque ou annule apparaîtra ici.</p>}
      {tab === "incidents" && incidents.length > 0 && (
        <div className="tbl-wrap rise rise-2">
          <table className="tbl" style={{ minWidth: 900 }}>
            <thead><tr><th>Quand</th><th>Incident</th><th>Auteur</th><th>Ce que le bot a fait</th><th /></tr></thead>
            <tbody>
              {incidents.map((inc, i) => (
                <tr key={inc.id} className="row-in" style={{ ["--i" as string]: Math.min(i, 14), verticalAlign: "top" }}>
                  <td className="num-cell muted" style={{ whiteSpace: "nowrap" }}>{formatDateTime(inc.at)}</td>
                  <td style={{ maxWidth: 300 }}>
                    <b>{INCIDENT_LABELS[inc.kind] ?? inc.kind}</b>{inc.details.observe === true && <> <span className="tag" data-tone="warn">observation</span></>}
                    <div className="muted" style={{ fontSize: 12 }}>{inc.summary}</div>
                  </td>
                  <td>
                    {inc.actorName ?? "—"}{inc.actorBot && <> <span className="tag" data-tone="warn">bot</span></>}
                    {inc.actorId && <div className="muted" style={{ fontSize: 11 }}>{inc.actorId}</div>}
                  </td>
                  <td>
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
                      {inc.actions.slice(0, 8).map((a, j) => (
                        <li key={j} style={{ color: a.ok ? undefined : "var(--bad)" }}>{a.type}{a.detail ? ` — ${a.detail}` : ""}{a.ok ? "" : " (échec)"}</li>
                      ))}
                      {inc.actions.length > 8 && <li className="muted">+ {inc.actions.length - 8} autre(s)</li>}
                    </ul>
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {inc.removedRoles.length > 0 && (inc.restoredAt
                      ? <span className="tag" data-tone="up">Rôles rendus</span>
                      : canConfig && <RestoreButton id={inc.id} name={inc.actorName ?? "ce membre"} roles={inc.removedRoles.map((r) => roleName.get(r) ?? r)} />)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "audit" && (
        <>
          <section className="dc-head rise rise-2">
            {audit ? <ScoreRing score={audit.report.score} size={130} caption={`Note ${audit.report.grade}`} /> : <div className="dc-empty"><CircleHelp size={34} /></div>}
            <div style={{ minWidth: 0 }}>
              <div className="eyebrow">{audit ? `Audit du ${formatDateTime(audit.createdAt)} · ${audit.report.members} membres` : "Jamais audité"}</div>
              <h2 className="h2" style={{ margin: "6px 0 0" }}>{audit ? (audit.report.findings.some((f) => f.severity !== "info") ? `${audit.report.findings.filter((f) => f.severity !== "info").length} point(s) à corriger sur ton Discord` : "Ton Discord est bien protégé") : "Audit de sécurité du Discord"}</h2>
              <p className="muted" style={{ margin: "8px 0 0", maxWidth: 680 }}>
                Le bot vérifie qui détient les permissions dangereuses, les bots Administrateurs, ce que peut faire @everyone, la double authentification du staff, la vérification, les webhooks et la place de son propre rôle. Rien n&apos;est modifié ; refait chaque jour automatiquement.
              </p>
              {audit && audit.history.length > 1 && (
                <div className="dc-history">{audit.history.map((h, i) => <span key={h.id} style={{ color: scoreTier(h.score)[1] }} title={formatDateTime(h.createdAt)}>{i > 0 && <i>→</i>}{h.score}</span>)}</div>
              )}
            </div>
            {canConfig && <DiscordAuditButton disabled={!server.guildId || !botOnline} again={Boolean(audit)} />}
          </section>
          {audit && (
            <div className="dc-layout">
              <div className="gx-findings">
                {audit.report.findings.length === 0 && <p className="muted">Aucun problème trouvé.</p>}
                {audit.report.findings.map((f) => (
                  <details key={f.rule} className="gx-finding" data-severity={f.severity} open={f.severity === "critical" || f.severity === "high"}>
                    <summary><span className="tag" data-tone={TONE[f.severity]}>{SEVERITY_LABEL[f.severity]}</span><b>{f.title}</b></summary>
                    <div className="gx-finding-body">
                      {f.detail && <p>{f.detail}</p>}
                      <p className="gx-fix"><Sparkles size={13} />{f.fix}</p>
                    </div>
                  </details>
                ))}
              </div>
              <aside>
                <div className="sc-card">
                  <h2 className="h2" style={{ fontSize: 16, margin: "0 0 6px" }}>{audit.report.checks.filter((c) => c.status === "pass").length} / {audit.report.checks.length} vérifications réussies</h2>
                  <div className="gx-checklist" style={{ gridTemplateColumns: "1fr" }}>
                    <ul>
                      {audit.report.checks.map((c) => (
                        <li key={c.key} data-status={c.status}>{c.status === "pass" ? <Check size={14} /> : c.status === "fail" ? <X size={14} /> : <CircleHelp size={14} />}<span>{c.label}</span></li>
                      ))}
                    </ul>
                  </div>
                </div>
              </aside>
            </div>
          )}
        </>
      )}

      {tab === "backups" && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Copie des rôles (et permissions), des salons (et permissions) et des rôles de chaque membre. Automatique toutes les {ar.backupEveryHours || "—"} h{ar.backupEveryHours ? "" : " (désactivée)"}, les 15 dernières sont gardées.
            Après un nuke, une restauration recrée tout ce qui manque.
          </p>
          {backups.length === 0 && <p className="muted" style={{ padding: "20px 0" }}>Aucune sauvegarde pour l&apos;instant{canConfig ? " : clique sur « Sauvegarder »." : "."}</p>}
          {backups.length > 0 && (
            <div className="tbl-wrap rise rise-2">
              <table className="tbl" style={{ minWidth: 640 }}>
                <thead><tr><th>#</th><th>Date</th><th>Type</th><th>Rôles</th><th>Salons</th><th>Membres</th>{canConfig && <th />}</tr></thead>
                <tbody>
                  {backups.map((b) => (
                    <tr key={b.id}>
                      <td className="num-cell muted">#{b.id}</td>
                      <td className="num-cell">{formatDateTime(b.createdAt)}</td>
                      <td>{b.reason}</td>
                      <td className="num-cell">{b.roles}</td>
                      <td className="num-cell">{b.channels}</td>
                      <td className="num-cell">{b.members}</td>
                      {canConfig && <td style={{ textAlign: "right" }}><RestoreBackupButton id={b.id} disabled={!botOnline} /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "settings" && canConfig && <AntiraidSettingsForm initial={ar} roles={roles} />}
    </Shell>
  );
}
