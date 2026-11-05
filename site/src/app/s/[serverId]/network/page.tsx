import Link from "next/link";
import { ExternalLink, EyeOff, Fingerprint, Network, ShieldCheck } from "lucide-react";
import { isOwner, requirePermissionPage } from "@/lib/auth";
import { db } from "@/lib/db";
import { getMembership, listMembers, lookupIdentifiers, networkOverview, recentNetworkBans, reputation } from "@/lib/network";
import { categoryLabel, DEFAULT_NETWORK_SETTINGS, NETWORK_MODES } from "@/lib/network-shared";
import { formatDateTime } from "@/lib/format";
import Shell, { PageHead } from "@/app/shell";
import { GuildIcon } from "@/app/new-server-form";
import NetworkSettingsForm from "./network-settings";
import ReputationList from "./reputation";

export const dynamic = "force-dynamic";

type FlagRow = { id: number; player_id: number | null; player_name: string; kind: string; details_json: string; at: string };

export default async function NetworkPage({ params, searchParams }: { params: Promise<{ serverId: string }>; searchParams: Promise<{ q?: string }> }) {
  const { user, server } = await requirePermissionPage((await params).serverId, "view_security");
  const q = (await searchParams).q?.trim() ?? "";
  const owner = isOwner(user);
  const [membership, overview, members] = await Promise.all([getMembership(server.id), networkOverview(), listMembers()]);
  const member = Boolean(membership);
  const [recent, flags, lookup] = member
    ? await Promise.all([
        recentNetworkBans(server.id, 25),
        db.all<FlagRow>(
          `SELECT id, player_id, player_name, kind, details_json, at FROM ac_detections
           WHERE server_id = ? AND (kind = 'network_flag' OR (kind = 'connection_refused' AND details_json LIKE '%réseau Fiverax%'))
           ORDER BY id DESC LIMIT 20`,
          [server.id]
        ),
        q && lookupIdentifiers(q).length ? reputation(server.id, lookupIdentifiers(q), []) : Promise.resolve(null)
      ])
    : [[], [], null];
  const base = `/s/${server.id}`;
  const mode = NETWORK_MODES.find((m) => m.key === membership?.settings.mode);

  return (
    <Shell user={user} server={server} active="network">
      <PageHead kicker="Réseau Fiverax" title="Réseau">
        Les serveurs Fiverax mettent leurs bans en commun : un cheater banni sur un serveur est reconnu sur tous les autres, même sous un autre pseudo,
        par sa license Rockstar, ses comptes liés ou son PC. Les identifiants ne quittent jamais ton serveur : seule une empreinte (hash) est comparée.
      </PageHead>

      <div className="strip">
        <div className="rise rise-1"><div className="eyebrow">Serveurs membres</div><div className="num">{overview.members}</div></div>
        <div className="rise rise-2"><div className="eyebrow">Bans partagés actifs</div><div className="num">{overview.sharedBans}</div></div>
        <div className="rise rise-3"><div className="eyebrow">Créations partagées</div><div className="num">{overview.libraryItems}</div><small><Link href={`${base}/library`} className="linkish">Bibliothèque →</Link></small></div>
        <div className="rise rise-4"><div className="eyebrow">Installations</div><div className="num">{overview.installs}</div></div>
      </div>

      {!member && (
        <section className="panel rise rise-2" style={{ marginBottom: 34 }}>
          <div className="panel-head">
            <h2 className="h2" style={{ display: "flex", gap: 10, alignItems: "center" }}><Network size={18} />Rejoindre le réseau</h2>
            <p className="muted">Gratuit, réciproque : tu partages tes bans, tu vois ceux des autres.</p>
          </div>
          <div className="form-grid" style={{ margin: "18px 0 24px", gap: 22 }}>
            <div><Fingerprint size={18} style={{ color: "var(--accent)" }} /><p style={{ margin: "6px 0 0" }}><b>Réputation des joueurs.</b> Sur chaque fiche joueur : sur combien d&apos;autres serveurs il est banni, pourquoi, et par quel identifiant il est reconnu.</p></div>
            <div><ShieldCheck size={18} style={{ color: "var(--accent)" }} /><p style={{ margin: "6px 0 0" }}><b>Protection à la connexion.</b> Alerte quand un joueur banni ailleurs arrive, ou refus automatique au-delà d&apos;un seuil que tu fixes.</p></div>
            <div><EyeOff size={18} style={{ color: "var(--accent)" }} /><p style={{ margin: "6px 0 0" }}><b>Vie privée.</b> Partagé : pseudo, raison, catégorie et date du ban. Jamais les identifiants ni l&apos;IP. Un ban peut rester privé.</p></div>
          </div>
          {owner ? <NetworkSettingsForm initial={DEFAULT_NETWORK_SETTINGS} member={false} /> : <p className="muted">Seul un propriétaire du serveur peut le faire rejoindre le réseau.</p>}
        </section>
      )}

      {member && membership && (
        <div className="cols two">
          <div>
            <section className="rise rise-1">
              <header style={{ paddingBottom: 12, borderBottom: "1px solid var(--line-2)" }}><h2 className="h2">Vérifier un joueur</h2></header>
              <form className="filters" action={`${base}/network`} style={{ marginTop: 14 }}>
                <input name="q" defaultValue={q} className="field" style={{ minWidth: 320, flex: 1 }} placeholder="license:…, discord:…, steam:… ou ID Discord" />
                <button className="btn primary">Vérifier</button>
              </form>
              {q && !lookup && <p className="muted">Identifiant non reconnu : colle un identifiant FiveM complet (license:…, discord:…, steam:…) ou un ID Discord.</p>}
              {lookup && <ReputationList rep={lookup} empty="Aucun ban sur les autres serveurs du réseau." />}
              <p className="muted" style={{ fontSize: 12 }}>Les joueurs de ton serveur ont leur réputation directement sur leur fiche (Joueurs).</p>
            </section>

            <section className="sect rise rise-2">
              <header><h2 className="h2">Arrivées signalées par le réseau</h2></header>
              {flags.length === 0 && <p className="muted" style={{ padding: "14px 0" }}>{membership.settings.mode === "off" ? "Mode « Consulter » : rien n'est vérifié à la connexion." : "Aucun joueur banni ailleurs ne s'est présenté."}</p>}
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {flags.map((f) => {
                  let d: Record<string, unknown> = {};
                  try { d = JSON.parse(f.details_json) as Record<string, unknown>; } catch { /* none */ }
                  const refused = f.kind === "connection_refused";
                  return (
                    <li key={f.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "11px 0", borderBottom: "1px solid var(--line)" }}>
                      <div>
                        {f.player_id ? <Link href={`${base}/players/${f.player_id}`} style={{ fontWeight: 600 }}>{f.player_name}</Link> : <b>{f.player_name}</b>}
                        <div className="muted" style={{ fontSize: 12 }}>
                          {formatDateTime(f.at)}{!refused && d.serveurs ? ` · banni sur ${d.serveurs} serveur(s) · ${d.categories ?? ""}` : ""}
                        </div>
                      </div>
                      <span className="tag" data-tone={refused ? "danger" : "warn"} style={{ alignSelf: "center" }}>{refused ? "Refusé" : "Signalé"}</span>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="sect rise rise-3">
              <header><h2 className="h2">Derniers bans du réseau</h2><span className="muted" style={{ fontSize: 12 }}>autres serveurs</span></header>
              {recent.length === 0 && <p className="muted" style={{ padding: "14px 0" }}>Rien pour l&apos;instant : le réseau grandit avec chaque serveur.</p>}
              {recent.length > 0 && (
                <div className="tbl-wrap">
                  <table className="tbl" style={{ minWidth: 640 }}>
                    <thead><tr><th>Joueur</th><th>Catégorie</th><th>Raison</th><th>Serveur</th><th>Le</th></tr></thead>
                    <tbody>
                      {recent.map((b, i) => (
                        <tr key={b.banId} className="row-in" style={{ ["--i" as string]: Math.min(i, 14) }}>
                          <td style={{ fontWeight: 600 }}>{b.playerName}</td>
                          <td><span className="tag">{categoryLabel(b.category)}</span></td>
                          <td style={{ maxWidth: 260 }}>{b.reason}</td>
                          <td className="muted">{b.serverName}</td>
                          <td className="num-cell muted" style={{ whiteSpace: "nowrap" }}>{formatDateTime(b.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <div>
            <section className="panel rise rise-1">
              <div className="panel-head">
                <h2 className="h2">Ton serveur dans le réseau</h2>
                <p className="muted">Membre depuis le {formatDateTime(membership.joinedAt)} · mode <b>{mode?.label}</b>{membership.settings.mode === "block" ? ` dès ${membership.settings.minServers} serveur(s)` : ""}</p>
              </div>
              <div style={{ marginTop: 16 }}>
                {owner ? <NetworkSettingsForm initial={membership.settings} member /> : <p className="muted">{mode?.hint} Seul un propriétaire peut changer ces réglages.</p>}
              </div>
              <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
                Le blocage demande l&apos;agent Fiverax 3.4 ou plus. Si le panel ne répond pas à temps, le joueur entre : une panne ne bloque jamais ton serveur.
                Pour garder un ban sur ce serveur seulement, change son partage dans <Link href={`${base}/bans`} className="linkish">Bans</Link>.
              </p>
            </section>

            <section className="sect rise rise-2">
              <header><h2 className="h2">Annuaire</h2><span className="muted" style={{ fontSize: 12 }}>{members.length} serveur(s)</span></header>
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {members.map((m) => (
                  <div key={m.serverId} className="guild-row" style={{ alignItems: "flex-start" }}>
                    <GuildIcon url={m.iconUrl} name={m.name} size={36} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <b>{m.name}</b>
                        {m.serverId === server.id && <span className="tag" data-tone="info">Toi</span>}
                      </div>
                      {m.description && <div style={{ fontSize: 13, marginTop: 2 }}>{m.description}</div>}
                      <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{m.sharedBans} ban(s) partagé(s) · {m.libraryItems} création(s) partagée(s)</div>
                    </div>
                    {m.inviteUrl && <a href={m.inviteUrl} target="_blank" rel="noreferrer noopener" className="ibtn" title="Rejoindre son Discord"><ExternalLink size={13} /></a>}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
    </Shell>
  );
}
