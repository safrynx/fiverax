import type { Metadata } from "next";
import Link from "next/link";
import { Clock, Gamepad2, LayoutPanelTop, LogIn, ShieldBan, ThumbsUp } from "lucide-react";
import { getIdentity } from "@/lib/auth";
import { OUTCOME_LABEL, STATUS_LABEL } from "@/lib/blackbox-shared";
import { formatDateTime, formatDuration } from "@/lib/format";
import { portalFor } from "@/lib/portal";
import { REWARD_LABEL } from "@/lib/votes-shared";
import { Logo } from "../annuaire/parts";
import AppealForm from "./appeal-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Espace joueur · Fiverax" },
  description: "Ton temps de jeu, tes votes et leurs récompenses, tes reports et tes sanctions sur tous les serveurs FiveM qui utilisent Fiverax.",
  robots: { index: false, follow: true }
};

const LOGIN = `/api/auth/discord?next=${encodeURIComponent("/joueur")}`;

export default async function PlayerPortal() {
  const identity = await getIdentity();
  if (!identity) return <Landing />;
  const portal = await portalFor(identity);
  const { servers, reports, votes, totals } = portal;

  return (
    <>
      <section className="pt-hero">
        {identity.avatarUrl ? <img src={identity.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <span className="dir-avatar" />}
        <div style={{ flex: 1, minWidth: 220 }}>
          <span className="lp-chip"><b>Espace joueur</b>Tous tes serveurs Fiverax</span>
          <h1 style={{ marginTop: 10 }}>Salut {identity.username}</h1>
          <p>Ton temps de jeu, tes votes, tes reports et tes sanctions, sur chaque serveur où ton Discord est relié à FiveM.</p>
        </div>
      </section>
      <div className="dir-facts">
        <span><b>{totals.servers}</b>serveur{totals.servers > 1 ? "s" : ""}</span>
        <span><b>{Math.floor(totals.playSeconds / 3600)} h</b>de jeu</span>
        <span><b>{totals.votesThisMonth}</b>vote{totals.votesThisMonth > 1 ? "s" : ""} ce mois</span>
        <span><b>{reports.length}</b>report{reports.length > 1 ? "s" : ""}</span>
      </div>

      <section className="dir-section">
        <header><h2>Tes serveurs</h2><Link href="/annuaire" className="linkish" style={{ fontSize: 13 }}>Trouver un serveur</Link></header>
        {servers.length === 0 ? <NotLinked /> : (
          <div className="pt-servers">
            {servers.map((s) => (
              <article key={s.serverId} className="pt-server">
                <header>
                  <Logo url={s.logoUrl ?? s.iconUrl} name={s.name} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3>{s.name}</h3>
                    <span className="muted" style={{ fontSize: 12 }}>{s.characterNames.slice(0, 3).join(", ")}</span>
                  </div>
                  {s.inGame && <span className="dir-tag" data-on="true">En jeu</span>}
                </header>
                <div className="pt-facts">
                  <div><b>{formatDuration(s.playSeconds)}</b><span>de jeu</span></div>
                  <div><b>{s.sessions}</b><span>session{s.sessions > 1 ? "s" : ""}</span></div>
                  <div><b>{new Date(s.firstSeenAt).toLocaleDateString("fr-FR", { month: "short", year: "numeric" })}</b><span>depuis</span></div>
                </div>
                {s.portalSlug && <Link href={`/joueur/${s.portalSlug}`} className="btn primary"><LayoutPanelTop size={14} />Espace joueurs du serveur</Link>}
                {s.slug && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {s.nextVoteAt
                      ? <span className="btn" aria-disabled="true" style={{ opacity: 0.7 }}><Clock size={14} />Prochain vote à {new Date(s.nextVoteAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                      : <Link href={`/annuaire/${s.slug}#vote`} className="btn primary"><ThumbsUp size={14} />Voter</Link>}
                    <Link href={`/annuaire/${s.slug}`} className="btn">Fiche du serveur</Link>
                  </div>
                )}
                {s.bans.map((b) => (
                  <div key={b.id} className="pt-ban" data-active={b.active}>
                    <div className="pt-row-head">
                      <ShieldBan size={14} style={{ color: b.active ? "var(--bad)" : "var(--muted)" }} />
                      <b>{b.active ? "Banni" : b.revoked ? "Ban levé" : "Ban terminé"}</b>
                      <span className="muted">le {formatDateTime(b.createdAt)} · {b.expiresAt ? `jusqu'au ${formatDateTime(b.expiresAt)}` : "définitif"}</span>
                    </div>
                    <span>Raison : {b.reason}</span>
                    {b.appeals.map((a) => (
                      <div key={a.id} className="pt-appeal" data-status={a.status}>
                        <b>{a.status === "open" ? "Contestation en attente du staff" : a.status === "accepted" ? "Contestation acceptée" : "Contestation refusée"}</b>
                        <span className="muted"> · {formatDateTime(a.createdAt)}</span>
                        {a.response && <p>Réponse du staff : {a.response}</p>}
                      </div>
                    ))}
                    {b.canAppeal && <AppealForm serverId={s.serverId} banId={b.id} />}
                    {b.appealAfter && <span className="muted" style={{ fontSize: 12 }}>Tu pourras recontester ce ban à partir du {formatDateTime(b.appealAfter)}.</span>}
                  </div>
                ))}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="dir-section">
        <header><h2>Tes reports</h2><span className="muted" style={{ fontSize: 13 }}>Fais <code>/report [id] raison</code> en jeu</span></header>
        {reports.length === 0 ? <p className="dir-empty" style={{ padding: "10px 0" }}>Aucun report. En jeu, <code>/report</code> envoie au staff le replay des dernières minutes : pas besoin de clip.</p> : (
          <div className="pt-list">
            {reports.map((r) => (
              <div key={`${r.serverId}-${r.id}`}>
                <div className="pt-row-head">
                  <b>#{r.id}</b>
                  <span>{r.serverName}</span>
                  <span className="dir-tag" data-on={r.status !== "closed"}>{r.status === "closed" && r.outcome ? OUTCOME_LABEL[r.outcome] : STATUS_LABEL[r.status]}</span>
                  <span className="muted">{formatDateTime(r.createdAt)}{r.targetName ? ` · contre ${r.targetName}` : ""}</span>
                </div>
                <span>{r.reason}</span>
                {r.verdict && <p className="pt-answer">Réponse du staff : {r.verdict}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="dir-section">
        <header><h2>Tes votes</h2><Link href="/annuaire?sort=votes" className="linkish" style={{ fontSize: 13 }}>Classement du mois</Link></header>
        {votes.length === 0 ? <p className="dir-empty" style={{ padding: "10px 0" }}>Pas encore de vote. Vote pour tes serveurs toutes les 2 h depuis leur fiche : beaucoup donnent une récompense en jeu.</p> : (
          <div className="pt-list">
            {votes.map((v, i) => (
              <div key={i}>
                <div className="pt-row-head">
                  {v.slug ? <Link href={`/annuaire/${v.slug}`}><b>{v.serverName}</b></Link> : <b>{v.serverName}</b>}
                  <span className="muted">{formatDateTime(v.votedAt)}</span>
                  {v.reward !== "none" && <span className="dir-tag" data-on={v.reward === "delivered"}>{REWARD_LABEL[v.reward]}</span>}
                </div>
                {v.rewards.length > 0 && <span className="muted" style={{ fontSize: 13 }}>Récompense : {v.rewards.join(", ")}</span>}
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="muted" style={{ fontSize: 12, marginTop: 32 }}>
        Fiverax ne montre ici que ce qui te concerne : jamais tes identifiants, ton adresse IP ni les notes du staff. Les données viennent des serveurs où ton Discord est relié à FiveM.
      </p>
    </>
  );
}

function Landing() {
  return (
    <>
      <section className="dir-hero">
        <span className="lp-chip"><b>Espace joueur</b>Gratuit, avec ton compte Discord</span>
        <h1>Tout ton parcours <span className="gold">FiveM</span>, au même endroit.</h1>
        <p>Ton temps de jeu sur chaque serveur Fiverax, tes votes et leurs récompenses en jeu, le suivi de tes <code>/report</code> et la contestation d&apos;un ban sans passer par un ticket Discord.</p>
        <div className="dir-actions"><a href={LOGIN} className="btn primary shine"><LogIn size={16} />Se connecter avec Discord</a><Link href="/annuaire" className="btn">Voir les serveurs</Link></div>
      </section>
      <section className="dir-section pt-steps">
        <div><b><Gamepad2 size={14} /> Temps de jeu</b>Sur chaque serveur, depuis ta première connexion.</div>
        <div><b><ThumbsUp size={14} /> Votes</b>Vote toutes les 2 h et reçois ta récompense directement en jeu.</div>
        <div><b><Clock size={14} /> Reports</b>Suis ce que le staff a décidé après ton <code>/report</code>.</div>
        <div><b><ShieldBan size={14} /> Bans</b>Vois la raison et la durée, et conteste en expliquant ta version.</div>
      </section>
    </>
  );
}

function NotLinked() {
  return (
    <div className="pt-steps">
      <div><b>1. Relie Discord à FiveM</b>Dans FiveM : Paramètres &gt; Comptes liés &gt; Discord.</div>
      <div><b>2. Joue sur un serveur Fiverax</b>Choisis-en un dans <Link href="/annuaire" className="linkish" style={{ fontSize: 14 }}>l&apos;annuaire</Link>.</div>
      <div><b>3. Reviens ici</b>Ton temps de jeu, tes votes et tes reports apparaissent dès ta première session.</div>
    </div>
  );
}
