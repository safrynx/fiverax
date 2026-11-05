import Link from "next/link";
import { redirect } from "next/navigation";
import { Film, Megaphone, ShieldAlert, Users } from "lucide-react";
import { can, requireStaffPage } from "@/lib/auth";
import { getLiveState } from "@/lib/agent";
import { countOpenReports, listReports } from "@/lib/blackbox";
import { KIND_LABEL, OUTCOME_LABEL, STATUS_LABEL } from "@/lib/blackbox-shared";
import { countOpenAppeals, listAppeals } from "@/lib/portal";
import { formatDateTime } from "@/lib/format";
import Shell, { PageHead } from "@/app/shell";
import { AppealActions, AutoRefresh, CaptureButton } from "./report-actions";

export const dynamic = "force-dynamic";

const AGENT_MIN = [3, 7];
const outdated = (version: string | null) => {
  if (!version) return false;
  const [a, b] = version.split(".").map(Number);
  return a < AGENT_MIN[0] || (a === AGENT_MIN[0] && b < AGENT_MIN[1]);
};

type Search = { tab?: string; status?: string };

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ serverId: string }>; searchParams: Promise<Search> }) {
  const { user, server } = await requireStaffPage((await params).serverId);
  const canReports = can(user, "reports");
  const canAppeals = can(user, "ban") || can(user, "view_security");
  if (!canReports && !canAppeals) redirect(`/s/${server.id}`);
  const sp = await searchParams;
  const tab = sp.tab === "appeals" && canAppeals ? "appeals" : canReports ? "reports" : "appeals";
  const closed = sp.status === "closed";
  const base = `/s/${server.id}/reports`;

  const [live, reports, counts, appeals, openAppeals] = await Promise.all([
    getLiveState(server.id),
    tab === "reports" ? listReports(server.id, { status: closed ? "closed" : "active", limit: 150 }) : Promise.resolve([]),
    canReports ? countOpenReports(server.id) : Promise.resolve({ open: 0, claimed: 0 }),
    tab === "appeals" ? listAppeals(server.id, "all", 100) : Promise.resolve([]),
    canAppeals ? countOpenAppeals(server.id) : Promise.resolve(0)
  ]);
  const players = live.players.map((p) => ({ id: p.id, name: p.name }));

  return (
    <Shell user={user} server={server} active="reports">
      <PageHead
        kicker={server.name}
        title="Reports & boîte noire"
        actions={tab === "reports" && canReports ? <CaptureButton players={players} online={live.online} /> : undefined}
      >
        Chaque <code>/report</code> fait en jeu arrive ici avec le <b>replay des minutes d&apos;avant</b> : positions, tirs, morts, qui parlait. Les kicks et bans de l&apos;anticheat
        aussi. Tu peux capturer les dernières minutes à tout moment. Les joueurs suivent leurs reports et contestent leurs bans depuis leur espace joueur.
      </PageHead>

      {live.linked && outdated(live.agentVersion) && (
        <div className="banner"><b>Agent {live.agentVersion} :</b> mets à jour <code>fiverax_agent</code> en 3.7 pour la boîte noire, <code>/report</code> et les récompenses de vote.</div>
      )}

      <div className="filters rise rise-1">
        <span className="pill-tabs">
          {canReports && <Link href={base} data-on={tab === "reports"}>Reports{counts.open + counts.claimed ? ` · ${counts.open + counts.claimed}` : ""}</Link>}
          {canAppeals && <Link href={`${base}?tab=appeals`} data-on={tab === "appeals"}>Contestations de ban{openAppeals ? ` · ${openAppeals}` : ""}</Link>}
        </span>
        {tab === "reports" && (
          <span className="pill-tabs" style={{ marginLeft: "auto" }}>
            <Link href={base} data-on={!closed}>À traiter</Link>
            <Link href={`${base}?status=closed`} data-on={closed}>Clos</Link>
          </span>
        )}
      </div>
      <AutoRefresh everyMs={15_000} />

      {tab === "reports" && (
        <section className="rise rise-2">
          {reports.length === 0 && (
            <p className="muted" style={{ padding: "30px 0" }}>
              {closed ? "Aucun report clos." : <>Rien à traiter. Les joueurs font <code>/report [id] raison</code> en jeu ; le staff (ACE <code>fiverax.staff</code>) est prévenu en jeu et sur le webhook d&apos;alertes de l&apos;anticheat.</>}
            </p>
          )}
          {reports.map((r) => (
            <Link key={r.id} href={`${base}/${r.id}`} className="report-row">
              <span className="report-icon" data-kind={r.kind}>{r.kind === "detection" ? <ShieldAlert size={18} /> : r.kind === "manual" ? <Film size={18} /> : <Megaphone size={18} />}</span>
              <span style={{ minWidth: 0 }}>
                <b>{r.reason}</b>
                <span className="report-meta">
                  <span className="tag">{KIND_LABEL[r.kind]}</span>
                  {r.reporterName && <span>par <b>{r.reporterName}</b></span>}
                  {r.targetName && <span>contre <b>{r.targetName}</b></span>}
                  <span>{formatDateTime(r.createdAt)}</span>
                  {r.hasCapture
                    ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Users size={12} />{r.capturePlayers} joueur{r.capturePlayers > 1 ? "s" : ""} dans le replay</span>
                    : <span>sans replay</span>}
                </span>
              </span>
              <span style={{ display: "grid", justifyItems: "end", gap: 4 }}>
                <span className="tag" data-tone={r.status === "open" ? "warn" : r.status === "claimed" ? "info" : "up"}>{r.status === "closed" && r.outcome ? OUTCOME_LABEL[r.outcome] : STATUS_LABEL[r.status]}</span>
                {r.status === "claimed" && r.claimedName && <span className="muted" style={{ fontSize: 12 }}>{r.claimedName}</span>}
                {r.status === "closed" && r.closedName && <span className="muted" style={{ fontSize: 12 }}>{r.closedName}</span>}
              </span>
            </Link>
          ))}
        </section>
      )}

      {tab === "appeals" && (
        <section className="rise rise-2">
          {appeals.length === 0 && <p className="muted" style={{ padding: "30px 0" }}>Aucune contestation. Les joueurs bannis contestent depuis leur espace joueur Fiverax (<code>/joueur</code>), connectés avec Discord.</p>}
          {appeals.map((a) => (
            <article key={a.id} className="appeal">
              <div className="report-meta" style={{ marginTop: 0 }}>
                <span className="tag" data-tone={a.status === "open" ? "warn" : a.status === "accepted" ? "up" : "neutral"}>{a.status === "open" ? "À traiter" : a.status === "accepted" ? "Acceptée : débanni" : "Refusée"}</span>
                <span><b>{a.playerId ? <Link href={`/s/${server.id}/players/${a.playerId}`}>{a.playerName}</Link> : a.playerName}</b> · Discord {a.username}</span>
                <span>{formatDateTime(a.createdAt)}</span>
              </div>
              <div style={{ fontSize: 13 }}>
                Ban du {formatDateTime(a.banCreatedAt)} · <b>{a.banReason}</b> · {a.banExpiresAt ? `jusqu'au ${formatDateTime(a.banExpiresAt)}` : "définitif"}{!a.banActive && a.status === "open" ? " · déjà levé" : ""}
              </div>
              <blockquote>{a.body}</blockquote>
              {a.status !== "open" && (a.response || a.decidedName) && (
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>{a.decidedName ? `${a.decidedName} : ` : ""}{a.response ?? "sans réponse écrite"}</p>
              )}
              {a.status === "open" && can(user, "ban") && <AppealActions id={a.id} name={a.playerName} />}
            </article>
          ))}
        </section>
      )}
    </Shell>
  );
}
