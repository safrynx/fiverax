import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePermissionPage } from "@/lib/auth";
import { getLiveState } from "@/lib/agent";
import { reputation } from "@/lib/network";
import { getPlayer } from "@/lib/players";
import { isBanActive, listBans, listDetections, listScreenshots } from "@/lib/security";
import { detectionLabel } from "@/lib/security-config";
import { linkedAccounts } from "@/lib/security-live";
import { shopEventsForPlayer } from "@/lib/tebex";
import { eventMeta, formatMoney } from "@/lib/tebex-shared";
import { formatDateTime, formatDuration } from "@/lib/format";
import Shell from "@/app/shell";
import CopyButton from "@/app/copy-button";
import ReputationList from "../../network/reputation";
import PlayerActions from "./player-actions";

export const dynamic = "force-dynamic";

/** Readable name of each kind of identifier ("steam:…" -> Steam). */
const IDENTIFIER_LABELS: Record<string, string> = {
  license: "Rockstar", license2: "Rockstar (2)", discord: "Discord", steam: "Steam", fivem: "Cfx.re", xbl: "Xbox", live: "Microsoft", live2: "Microsoft (2)"
};

export default async function PlayerPage({ params }: { params: Promise<{ serverId: string; playerId: string }> }) {
  const { serverId, playerId } = await params;
  const { user, server } = await requirePermissionPage(serverId, "view_live");
  const id = Number(playerId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const security = can(user, "view_security");
  const [player, live, bans, detections, shots, linked] = await Promise.all([
    getPlayer(server.id, id),
    getLiveState(server.id),
    security ? listBans(server.id, { playerId: id, limit: 20 }) : Promise.resolve([]),
    security ? listDetections(server.id, { playerId: id, limit: 30 }) : Promise.resolve([]),
    security ? listScreenshots(server.id, { playerId: id, limit: 12 }) : Promise.resolve([]),
    security ? linkedAccounts(server.id, id) : Promise.resolve([])
  ]);
  if (!player) notFound();
  // Purchases come from the Tebex webhooks, matched on the player's Cfx.re account.
  // Fiverax network: bans of the other member servers matching this player (null: this server is not a member).
  const network = security ? await reputation(server.id, player.identifiers, player.tokens) : null;
  const purchases = can(user, "shop_view") ? await shopEventsForPlayer(server.id, player.identifiers, 15) : [];
  const activeBan = bans.find((b) => isBanActive(b)) ?? null;
  const inGame = live.players.find((p) => p.playerId === player.id) ?? null;

  const summary: [string, string][] = [
    ["Temps de jeu", formatDuration(player.playSeconds)],
    ["Connexions", String(player.connections)],
    ["Première venue", formatDateTime(player.firstSeenAt)],
    ["Dernière venue", inGame ? "En jeu" : formatDateTime(player.lastSeenAt)]
  ];

  return (
    <Shell user={user} server={server} active="players">
      <Link href={`/s/${server.id}/players`} className="linkish rise" style={{ display: "inline-block", marginBottom: 22 }}>← Retour aux joueurs</Link>

      <div className="head rise" style={{ alignItems: "center" }}>
        <div>
          <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className={`dot ${inGame ? "on" : ""}`} />{inGame ? `En jeu · ID #${inGame.id} · ${inGame.ping} ms` : "Hors ligne"}
          </div>
          <h1 className="h1" style={{ fontSize: "clamp(22px,3vw,34px)" }}>{player.name}</h1>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
            {player.staff && <Link href={`/s/${server.id}/staff/${player.discordId}`} className="plate"><span>Staff · {player.staff.grade || player.staff.username}</span></Link>}
            {network && network.servers > 0 && <span className="tag" data-tone="warn">Banni sur {network.servers} autre{network.servers > 1 ? "s" : ""} serveur{network.servers > 1 ? "s" : ""} du réseau</span>}
            {activeBan && <span className="tag" data-tone="danger">Banni{activeBan.expiresAt ? ` jusqu'au ${formatDateTime(activeBan.expiresAt)}` : " définitivement"}</span>}
            <span className="muted" style={{ fontSize: 12 }}>{player.license}</span>
          </div>
        </div>
        <PlayerActions
          playerId={player.id}
          target={inGame?.id ?? null}
          name={player.name}
          banned={Boolean(activeBan)}
          can={{ message: can(user, "player_message"), kick: can(user, "player_kick"), screenshot: can(user, "screenshot"), ban: can(user, "ban") }}
        />
      </div>

      <div className="strip">
        {summary.map(([label, value], i) => <div key={label} className={`rise rise-${i + 1}`}><div className="eyebrow">{label}</div><div className="num" style={{ fontSize: 22 }}>{value}</div></div>)}
      </div>

      <div className="cols even">
        <section className="rise rise-1">
          <header style={{ paddingBottom: 12, borderBottom: "1px solid var(--line-2)" }}><h2 className="h2">Identifiants</h2></header>
          <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0 }}>
            {player.identifiers.map((raw) => {
              const [kind, ...rest] = raw.split(":");
              return (
                <li key={raw} style={{ display: "flex", gap: 14, alignItems: "center", padding: "11px 0", borderBottom: "1px solid var(--line)" }}>
                  <span className="muted" style={{ width: 110, fontSize: 12, flex: "none" }}>{IDENTIFIER_LABELS[kind] ?? kind}</span>
                  <code style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", fontSize: 12 }}>{rest.join(":")}</code>
                  <CopyButton text={raw} label="Copier" />
                </li>
              );
            })}
          </ul>
          <p className="muted" style={{ fontSize: 12 }}>Les adresses IP ne sont jamais enregistrées.</p>
        </section>

        {security && (
          <section className="rise rise-2">
            <header style={{ paddingBottom: 12, borderBottom: "1px solid var(--line-2)" }}><h2 className="h2">Sécurité</h2></header>
            <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0 }}>
              {bans.length === 0 && detections.length === 0 && <li className="muted" style={{ padding: "16px 0" }}>Aucun ban ni détection.</li>}
              {bans.map((b) => (
                <li key={`b${b.id}`} style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "11px 0", borderBottom: "1px solid var(--line)" }}>
                  <div><b>Ban</b> — {b.reason}<div className="muted" style={{ fontSize: 12 }}>{formatDateTime(b.createdAt)} · {b.expiresAt ? `jusqu'au ${formatDateTime(b.expiresAt)}` : "définitif"}</div></div>
                  <span className="tag" data-tone={isBanActive(b) ? "danger" : "neutral"}>{isBanActive(b) ? "Actif" : b.revokedAt ? "Levé" : "Expiré"}</span>
                </li>
              ))}
              {detections.map((d) => (
                <li key={`d${d.id}`} style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "11px 0", borderBottom: "1px solid var(--line)" }}>
                  <div>{detectionLabel(d.kind)}<div className="muted" style={{ fontSize: 12 }}>{formatDateTime(d.at)}</div></div>
                  <span className="tag" data-tone={d.action === "ban" ? "danger" : d.action === "kick" ? "warn" : "info"}>{d.action === "log" ? "Signalé" : d.action}</span>
                </li>
              ))}
            </ul>
            {linked.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div className="eyebrow" style={{ marginBottom: 6 }}>Comptes liés · {linked.length}</div>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {linked.map((l) => (
                    <li key={l.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--line)" }}>
                      <Link href={`/s/${server.id}/players/${l.id}`} style={{ fontWeight: 600 }}>{l.name}</Link>
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <span className="muted" style={{ fontSize: 12 }}>même {l.shared.join(", ")}</span>
                        {l.banned && <span className="tag" data-tone="danger">banni</span>}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="muted" style={{ fontSize: 12 }}>Même PC (identifiants matériels) ou même compte Discord / Steam : double compte, contournement de ban ou PC partagé.</p>
              </div>
            )}
            {shots.length > 0 && (
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", marginTop: 14 }}>
                {shots.map((s) => (
                  <a key={s.id} href={`/api/s/${server.id}/screenshots/${s.id}`} target="_blank" rel="noreferrer" title={s.summary ?? ""} style={{ position: "relative" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/s/${server.id}/screenshots/${s.id}`} alt="" loading="lazy" style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", borderRadius: 8, display: "block" }} />
                    <span className="tag" data-tone={s.verdict === "cheat" ? "danger" : s.verdict === "suspicious" ? "warn" : s.verdict === "clean" ? "up" : "neutral"} style={{ position: "absolute", left: 6, bottom: 6, background: "rgba(0,0,0,0.7)" }}>{s.verdict}</span>
                  </a>
                ))}
              </div>
            )}
          </section>
        )}

        {network && (
          <section className="rise rise-2">
            <header style={{ paddingBottom: 12, borderBottom: "1px solid var(--line-2)", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h2 className="h2">Réseau Fiverax</h2>
              <Link href={`/s/${server.id}/network`} className="linkish" style={{ fontSize: 12 }}>Réglages →</Link>
            </header>
            <ReputationList rep={network} empty="Aucun ban sur les autres serveurs du réseau." />
          </section>
        )}

        <section className="rise rise-2">
          <header style={{ paddingBottom: 12, borderBottom: "1px solid var(--line-2)" }}><h2 className="h2">Dernières sessions</h2></header>
          <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0 }}>
            {player.sessions.length === 0 && <li className="muted" style={{ padding: "16px 0" }}>Aucune session.</li>}
            {player.sessions.map((s) => (
              <li key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "11px 0", borderBottom: "1px solid var(--line)" }}>
                <div>
                  <div className="num-cell">{formatDateTime(s.startedAt)}{s.endedAt ? ` → ${formatDateTime(s.endedAt)}` : ""}</div>
                  {s.leaveReason && <div className="muted" style={{ fontSize: 12 }}>{s.leaveReason}</div>}
                </div>
                {s.endedAt ? <span className="num-cell">{formatDuration(s.seconds)}</span> : <span className="tag" data-tone="up">En cours</span>}
              </li>
            ))}
          </ul>
        </section>

        {purchases.length > 0 && (
          <section className="rise rise-2">
            <header style={{ paddingBottom: 12, borderBottom: "1px solid var(--line-2)" }}><h2 className="h2">Boutique</h2></header>
            <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0 }}>
              {purchases.map((e) => (
                <li key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "11px 0", borderBottom: "1px solid var(--line)" }}>
                  <div>
                    <span className="tag" data-tone={eventMeta(e.type).tone}>{eventMeta(e.type).label}</span>{" "}
                    {e.txnId && e.type.startsWith("payment.") ? <Link href={`/s/${server.id}/shop/payments/${encodeURIComponent(e.txnId)}`}>{e.products.map((x) => x.name).join(", ") || e.txnId}</Link> : e.products.map((x) => x.name).join(", ")}
                    <div className="muted" style={{ fontSize: 12 }}>{formatDateTime(e.happenedAt)}</div>
                  </div>
                  {e.amount !== null && <span className="num-cell">{formatMoney(e.amount, e.currency)}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Shell>
  );
}
