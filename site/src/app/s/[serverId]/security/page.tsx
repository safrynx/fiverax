import Link from "next/link";
import { ArrowRight, Ban, BadgeCheck, Bot, Eye, ListChecks, Radar, Server as ServerIcon, ShieldAlert, Siren, TriangleAlert, UserX } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth";
import { ONLINE_MS } from "@/lib/agent";
import { getServerStatus } from "@/lib/bot-status";
import { db } from "@/lib/db";
import { latestDiscordAudit } from "@/lib/discord-audit";
import { formatDateTime } from "@/lib/format";
import { getMembership } from "@/lib/network";
import { protectionStatus } from "@/lib/protection";
import { levelOf, levelRank } from "@/lib/protection-shared";
import { detectionStats, getSecuritySettings, recentSecurityEvents, riskPlayers, securityTimeline } from "@/lib/security";
import { AC_ACTION_LABELS, anticheatStrength, detectionLabel, INCIDENT_LABELS, type AcAction } from "@/lib/security-config";
import { posture, riskTier, tuningAdvice } from "@/lib/security-insights";
import { lastBackupAt } from "@/lib/security-live";
import Shell, { PageHead } from "@/app/shell";
import { scoreTier } from "@/app/score-ring";
import { AutoRefresh } from "../security-actions";
import SparkColumns from "./spark-columns";
import "@/app/growth.css";
import "@/app/security.css";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const BOT_ONLINE_MS = 3 * 60_000;
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", timeZone: "UTC" });
const RISK_LABEL = { high: "élevé", medium: "moyen", low: "faible" } as const;
const BAN_SOURCE: Record<string, string> = { manual: "par le staff", anticheat: "par l'anticheat", ai: "sur avis de l'IA" };

type Reco = { key: string; priority: number; title: string; text: string; href: string };

export default async function SecurityCenterPage({ params }: { params: Promise<{ serverId: string }> }) {
  const { user, server } = await requirePermissionPage((await params).serverId, "view_security");
  const base = `/s/${server.id}`;
  const now = new Date();
  const [settings, status, audit, agent, heartbeat, backupAt, membership, timeline, risky, events, stats] = await Promise.all([
    getSecuritySettings(server.id),
    protectionStatus(server.id, now),
    latestDiscordAudit(server.id, now).catch(() => null),
    db.get<{ seen_at: string }>("SELECT seen_at FROM fivem_state WHERE server_id = ?", [server.id]),
    getServerStatus(server.id, "heartbeat"),
    lastBackupAt(server.id),
    getMembership(server.id),
    securityTimeline(server.id, 14, now),
    riskPlayers(server.id, 7, 6, now),
    recentSecurityEvents(server.id, 10),
    detectionStats(server.id, 7, now)
  ]);
  const ac = settings.anticheat;
  const ar = settings.antiraid;
  const agentOnline = Boolean(agent && now.getTime() - new Date(agent.seen_at).getTime() < ONLINE_MS * 4);
  const botOnline = Boolean(heartbeat && now.getTime() - new Date(heartbeat).getTime() < BOT_ONLINE_MS);
  const strength = anticheatStrength(ac);
  const p = posture({
    scan: status.score !== null && status.lastScanAt ? { score: status.score, ageDays: (now.getTime() - new Date(status.lastScanAt).getTime()) / DAY } : null,
    anticheatStrength: strength,
    agentOnline,
    guildLinked: Boolean(server.guildId),
    botOnline,
    antiraidEnabled: ar.enabled,
    antiraidObserve: ar.mode === "observe",
    discordScore: audit?.report.score ?? null,
    alerts: Boolean(ac.alerts.webhookUrl),
    backupRecent: Boolean(backupAt && now.getTime() - new Date(backupAt).getTime() < 7 * DAY),
    network: Boolean(membership)
  });
  const [, tierColor] = scoreTier(p.score);
  const level = levelOf(status.level);

  // ---- what to do first: missing protection checks, Discord audit, anticheat tuning ----
  const recos: Reco[] = [];
  for (const c of status.next?.missing ?? []) {
    // Without a scan, "no critical problem" and the score checks all say "run a scan": the scan check says it once.
    if (status.score === null && ["no_critical", "no_high", "score80", "score92"].includes(c.key)) continue;
    recos.push({ key: `check:${c.key}`, priority: levelRank(c.level) * 2 - 2, title: c.label, text: c.hint, href: `${base}/${c.page}` });
  }
  for (const f of audit?.report.findings ?? []) {
    if (f.severity !== "critical" && f.severity !== "high") continue;
    recos.push({ key: `discord:${f.rule}`, priority: f.severity === "critical" ? -1 : 1, title: `Discord : ${f.title.charAt(0).toLowerCase()}${f.title.slice(1)}`, text: f.fix, href: `${base}/antiraid?tab=audit` });
  }
  if (server.guildId && !audit) recos.push({ key: "discord:audit", priority: 1, title: "Auditer les permissions du Discord", text: "Le bot vérifie en quelques secondes qui peut nuker ton serveur : admins, bots, @everyone, A2F, place de son rôle.", href: `${base}/antiraid?tab=audit` });
  if (ar.enabled && ar.mode === "observe") recos.push({ key: "antiraid:observe", priority: 2, title: "Passer l'anti-raid en Protection", text: "Il ne fait que signaler : si les incidents observés sont justes, laisse-le annuler et sanctionner.", href: `${base}/antiraid?tab=settings` });
  if (ac.enabled && strength < 55) recos.push({ key: "ac:strength", priority: 2, title: `Renforcer l'anticheat (couverture ${strength}/100)`, text: "Choisis le préréglage Équilibré, active le cumul de détections et les alertes Discord.", href: `${base}/anticheat?tab=settings` });
  for (const a of tuningAdvice(stats, ac).filter((x) => x.tone === "warn")) recos.push({ key: `tune:${a.kind}`, priority: 2, title: a.title, text: a.text, href: `${base}/anticheat?tab=settings` });
  const seen = new Set<string>();
  const todo = recos.sort((a, b) => a.priority - b.priority).filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true))).slice(0, 6);

  // ---- 7 days against the 7 before ----
  const last = timeline.slice(-7);
  const before = timeline.slice(0, 7);
  const sum = (days: typeof timeline, k: "detections" | "refused" | "incidents" | "bans") => days.reduce((n, d) => n + d[k], 0);
  const tiles = ([
    ["detections", "Détections en jeu", "détection(s)", ShieldAlert],
    ["refused", "Connexions refusées", "connexion(s) refusée(s)", UserX],
    ["incidents", "Incidents Discord", "incident(s)", Siren],
    ["bans", "Bans", "ban(s)", Ban]
  ] as const).map(([key, label, unit, Icon]) => ({ key, label, unit, Icon, total: sum(last, key), delta: sum(last, key) - sum(before, key), values: last.map((d) => d[key]) }));
  const verdict = p.score >= 85
    ? "Ton serveur est solidement protégé. Garde le scan continu et les audits quotidiens actifs."
    : p.score >= 65
      ? `Bonne base. Point faible : ${p.weakest.label.toLowerCase()}. ${p.weakest.summary}`
      : `Ton serveur est exposé. Commence par : ${p.weakest.label.toLowerCase()}. ${p.weakest.summary}`;
  const pills: [string, boolean, string, React.ComponentType<{ size?: number }>][] = [
    ["Agent FiveM", agentOnline, agentOnline ? "en ligne" : "hors ligne", ServerIcon],
    ["Anticheat", ac.enabled && agentOnline, ac.enabled ? (agentOnline ? "actif" : "en attente de l'agent") : "désactivé", ShieldAlert],
    ["Bot Discord", botOnline, server.guildId ? (botOnline ? "en ligne" : "hors ligne") : "aucun Discord", Bot],
    ["Anti-raid", ar.enabled && botOnline && ar.mode !== "observe", ar.enabled ? (ar.mode === "observe" ? "observation" : "protection") : "désactivé", ar.mode === "observe" ? Eye : ShieldAlert]
  ];

  return (
    <Shell user={user} server={server} active="security">
      <PageHead kicker={server.name} title="Centre de sécurité">
        Toute la sécurité de ton serveur au même endroit : le code (scanner), le jeu (anticheat), le Discord (anti-raid et audit) et la réaction de ton staff.
      </PageHead>
      <AutoRefresh everyMs={30_000} />

      <section className="sc-hero rise rise-1">
        <div className="gx-grade" style={{ ["--tier" as string]: tierColor }} aria-label={`Note ${p.grade}`}>{p.grade}</div>
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">Sécurité globale</div>
          <div className="sc-score"><b>{p.score}</b><span>/100</span></div>
          <p className="sc-verdict">{verdict}</p>
          <div className="sc-status">
            {pills.map(([label, ok, state, Icon]) => (
              <span key={label} data-ok={ok}><Icon size={13} /><b>{label}</b>{state}</span>
            ))}
          </div>
        </div>
        <Link href={`${base}/protection`} className="sc-level" style={{ ["--lvl" as string]: level.color }}>
          <BadgeCheck size={22} />
          <div>
            <div className="eyebrow">Niveau Fiverax</div>
            <b>{level.label}</b>
            <small>{status.next ? `${status.next.missing.length} étape(s) pour « ${levelOf(status.next.level).label} »` : "Niveau maximum atteint"}</small>
          </div>
          <ArrowRight size={15} />
        </Link>
      </section>

      <div className="sc-pillars rise rise-2">
        {p.pillars.map((pl) => {
          const [, color] = scoreTier(pl.score);
          const href = pl.key === "discord" && audit === null && server.guildId ? `${base}/antiraid?tab=audit` : `${base}/${pl.page}`;
          return (
            <article key={pl.key} data-weakest={pl.key === p.weakest.key && pl.score < 80}>
              <header><b>{pl.label}</b><span style={{ color }}>{pl.score}</span></header>
              <div className="audit-meter"><i style={{ width: `${pl.score}%`, background: color }} /></div>
              <p>{pl.summary}</p>
              <Link href={href} className="linkish">{pl.cta} <ArrowRight size={12} /></Link>
            </article>
          );
        })}
      </div>

      <div className="sc-tiles rise rise-3">
        {tiles.map((t) => (
          <div key={t.key}>
            <div className="sc-tile-head"><t.Icon size={14} /><span>{t.label} · 7 jours</span></div>
            <b>{t.total}</b>
            <small className="muted">{t.delta === 0 ? "comme les 7 jours d'avant" : `${t.delta > 0 ? "+" : ""}${t.delta} par rapport aux 7 jours d'avant`}</small>
            <SparkColumns values={t.values} labels={last.map((d) => dayLabel(d.day))} unit={t.unit} />
          </div>
        ))}
      </div>

      <div className="sc-grid">
        <section className="sc-card rise rise-3">
          <header><ListChecks size={16} /><h2 className="h2">À faire en priorité</h2></header>
          {todo.length === 0 ? (
            <p className="muted">Rien d&apos;urgent : tout ce que Fiverax sait vérifier est en place.</p>
          ) : (
            <ol className="sc-reco">
              {todo.map((r) => (
                <li key={r.key}>
                  <div><b>{r.title}</b><p>{r.text}</p></div>
                  <Link href={r.href} className="btn sm">Corriger</Link>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="sc-card rise rise-4">
          <header><Radar size={16} /><h2 className="h2">Joueurs à surveiller</h2><span className="muted">7 jours</span></header>
          {risky.length === 0 ? (
            <p className="muted">Aucun joueur suspect ces 7 derniers jours.</p>
          ) : (
            <ul className="sc-risk">
              {risky.map((r) => {
                const tier = riskTier(r.score);
                return (
                  <li key={r.playerId}>
                    <span className="sc-risk-score" data-tier={tier} title={`Risque ${RISK_LABEL[tier]}`}>{r.score}</span>
                    <div style={{ minWidth: 0 }}>
                      <Link href={`${base}/players/${r.playerId}`}><b>{r.name}</b></Link>
                      {r.banned && <> <span className="tag" data-tone="danger">banni</span></>}
                      <p>{r.kinds} · risque {RISK_LABEL[tier]}</p>
                    </div>
                    <small className="muted">{formatDateTime(r.lastAt)}</small>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>Score de 0 à 100 : chaque détection compte selon sa gravité (×1,5 si confirmée), les captures jugées « cheat » par l&apos;IA en plus ; les faux positifs ne comptent pas.</p>
        </section>
      </div>

      <section className="sc-card rise rise-4" style={{ marginTop: 18 }}>
        <header><TriangleAlert size={16} /><h2 className="h2">Derniers événements</h2></header>
        {events.length === 0 ? (
          <p className="muted">Aucun événement de sécurité pour l&apos;instant.</p>
        ) : (
          <ul className="sc-feed">
            {events.map((e) => {
              const label = e.source === "detection" ? detectionLabel(e.kind) : e.source === "incident" ? INCIDENT_LABELS[e.kind] ?? e.kind : `Ban ${BAN_SOURCE[e.kind] ?? ""}`.trim();
              const href = e.source === "incident" ? `${base}/antiraid` : e.playerId ? `${base}/players/${e.playerId}` : e.source === "ban" ? `${base}/bans` : `${base}/anticheat`;
              const Icon = e.source === "detection" ? ShieldAlert : e.source === "incident" ? Siren : Ban;
              return (
                <li key={`${e.source}-${e.id}`} data-source={e.source}>
                  <Icon size={14} />
                  <Link href={href}><b>{label}</b></Link>
                  <span className="muted">{e.who ?? "—"}{e.source === "ban" && e.action ? ` · ${e.action}` : ""}</span>
                  {e.source === "detection" && e.action && e.action in AC_ACTION_LABELS && <span className="tag">{AC_ACTION_LABELS[e.action as AcAction]}</span>}
                  <small className="muted">{formatDateTime(e.at)}</small>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Shell>
  );
}
