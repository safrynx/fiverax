"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Camera, Eye, Maximize2, MonitorPlay, Search, ShieldAlert, X } from "lucide-react";
import { useServerPaths } from "@/app/ui";
import ScreenViewer from "../screen-viewer";
import { useCommand } from "../use-command";
import { screenStatus, useLiveScreen } from "../use-live-screen";
import "./screens.css";

export type WallPlayer = {
  id: number;
  name: string;
  ping: number;
  playerId: number | null;
  staff: string | null;
  /** Anticheat detections of the last 24 h, and the latest kind. */
  detections: number;
  lastKind: string | null;
};

const MAX_TILES = 4;

/** One live screen of the wall. */
function Tile({ player, onRemove, onExpand }: { player: { id: number; name: string; playerId: number | null }; onRemove: () => void; onExpand: () => void }) {
  const { serverId, page } = useServerPaths();
  const screen = useLiveScreen(serverId, player.id);
  const { send, busy } = useCommand();
  const live = Boolean(screen.src && !screen.error && (screen.age ?? 99) <= 8);
  return (
    <div className="sw-tile">
      <header>
        <span className={`dot ${live ? "on" : ""}`} />
        <b>{player.name}</b><span className="muted">#{player.id}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <button type="button" className="ibtn" title="Agrandir" onClick={onExpand}><Maximize2 size={13} /></button>
          <button type="button" className="ibtn" title="Retirer du mur" onClick={onRemove}><X size={13} /></button>
        </span>
      </header>
      <div className="sw-screen">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {screen.src ? <img src={screen.src} alt={`Écran de ${player.name}`} /> : <div className="screen-wait">{screen.error ?? screenStatus(screen)}</div>}
      </div>
      <footer>
        <small className="muted">{screenStatus(screen)}</small>
        <span style={{ display: "flex", gap: 6 }}>
          <button type="button" className="btn sm" disabled={busy || Boolean(screen.error)} onClick={() => send("screenshot", { target: player.id }, "Capture gardée et envoyée à l'analyse IA")}><Camera size={13} />Capture</button>
          {player.playerId && <Link href={page(`/players/${player.playerId}`)} className="btn sm">Fiche</Link>}
        </span>
      </footer>
    </div>
  );
}

/**
 * "Écrans en direct" tab of the anticheat page: the players online (suspects first), each one's screen in a window,
 * or up to four of them side by side to watch several suspects at once.
 */
export default function ScreenWall({ players, online, agentLinked }: { players: WallPlayer[]; online: boolean; agentLinked: boolean }) {
  const { page } = useServerPaths();
  const [wall, setWall] = useState<{ id: number; name: string; playerId: number | null }[]>([]);
  const [open, setOpen] = useState<{ id: number; name: string } | null>(null);
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return players
      .filter((p) => !needle || p.name.toLowerCase().includes(needle) || String(p.id) === needle)
      .sort((a, b) => b.detections - a.detections || a.name.localeCompare(b.name));
  }, [players, q]);

  const onWall = (id: number) => wall.some((w) => w.id === id);
  const toggle = (p: WallPlayer) => setWall((w) => (onWall(p.id) ? w.filter((x) => x.id !== p.id) : w.length >= MAX_TILES ? w : [...w, { id: p.id, name: p.name, playerId: p.playerId }]));

  if (!agentLinked) {
    return <div className="banner">Aucun agent FiveM relié : installe <code>fiverax_agent</code> (page Configuration) pour voir les écrans des joueurs. <Link href="/guides/agent-fivem" className="linkish">Tutoriel</Link></div>;
  }

  return (
    <div className="sw rise rise-1">
      {!online && <div className="banner">Le serveur FiveM ne répond pas en ce moment : les écrans reviennent dès que l&apos;agent se reconnecte.</div>}
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Chaque écran ouvert demande environ une image par seconde au serveur FiveM (<code>screenshot-basic</code> doit être démarré). {MAX_TILES} écrans au maximum sur le mur.
        Rien n&apos;est enregistré, sauf les captures que tu gardes (elles partent à l&apos;analyse IA).
      </p>

      {wall.length > 0 && (
        <section className="sw-wall" data-count={wall.length}>
          {wall.map((p) => <Tile key={p.id} player={p} onRemove={() => setWall((w) => w.filter((x) => x.id !== p.id))} onExpand={() => setOpen({ id: p.id, name: p.name })} />)}
        </section>
      )}

      <div className="filters" style={{ marginTop: wall.length ? 22 : 0 }}>
        <label className="sw-search"><Search size={14} /><input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un joueur (pseudo ou #id)" /></label>
        <span className="muted" style={{ fontSize: 13 }}>{players.length} joueur(s) en ligne · suspects en premier</span>
      </div>

      {list.length === 0 && <p className="muted" style={{ padding: "18px 0" }}>{players.length ? "Aucun joueur ne correspond." : "Aucun joueur en ligne."}</p>}
      <div className="sw-list">
        {list.map((p) => (
          <div key={p.id} className="sw-row" data-hot={p.detections >= 3 || undefined}>
            <div className="sw-who">
              <b>{p.name}</b>
              <small className="muted">#{p.id} · {p.ping} ms{p.staff ? ` · staff (${p.staff})` : ""}</small>
            </div>
            <div className="sw-flags">
              {p.detections > 0
                ? <span className="tag" data-tone={p.detections >= 3 ? "danger" : "warn"} title={p.lastKind ? `Dernière : ${p.lastKind}` : undefined}><ShieldAlert size={11} /> {p.detections} détection(s) · 24 h</span>
                : <span className="tag">aucune détection</span>}
            </div>
            <div className="sw-actions">
              <button type="button" className="btn sm" onClick={() => setOpen({ id: p.id, name: p.name })}><Eye size={13} />Voir l&apos;écran</button>
              <button type="button" className="btn sm" data-on={onWall(p.id) || undefined} disabled={!onWall(p.id) && wall.length >= MAX_TILES} onClick={() => toggle(p)}>
                <MonitorPlay size={13} />{onWall(p.id) ? "Retirer du mur" : "Mettre au mur"}
              </button>
              {p.playerId && <Link href={page(`/players/${p.playerId}`)} className="linkish">Fiche</Link>}
            </div>
          </div>
        ))}
      </div>

      {open && <ScreenViewer target={open.id} name={open.name} onClose={() => setOpen(null)} />}
    </div>
  );
}
