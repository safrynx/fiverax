"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Ban, Camera, Car, Locate, Mic, Monitor, Phone, Radio as RadioIcon, Snowflake, UserX, ZoomIn, ZoomOut } from "lucide-react";
import type { LivePlayer, LiveState } from "@/lib/agent";
import { detectionLabel } from "@/lib/security-config";
import type { MapDetection } from "@/lib/security-live";
import { useServerPaths, useUI } from "@/app/ui";
import { useCommand, usePolling } from "../use-command";
import { AgentBanner } from "../live/live-view";
import { useBanDialog } from "../security-actions";
import ScreenViewer from "../screen-viewer";

type Props = {
  initial: LiveState;
  /** Background: the usual 8192 px GTA V atlas (MAP_IMAGE_URL); without it, a grid with the main places. */
  mapImage: string | null;
  settingsHref: string | null;
  can: { screenshot: boolean; kick: boolean; ban: boolean; security: boolean };
  /** Anticheat detections of the last 30 min with a position. */
  detections: MapDetection[];
};

/** Game coordinates -> map units (0-1000), calibrated on the standard GTA V atlas. */
export function toMap(x: number, y: number): [number, number] {
  return [((0.02072 * x + 117.3) / 256) * 1000, ((-0.0205 * y + 172.8) / 256) * 1000];
}

export const PLACES: [string, number, number][] = [
  ["Los Santos", 150, -900], ["Vinewood", 300, 250], ["LSIA", -1100, -2800], ["Vespucci", -1300, -1300], ["Port de LS", 900, -3000],
  ["Mirror Park", 1100, -600], ["Chumash", -3150, 1000], ["Fort Zancudo", -2200, 3150], ["Sandy Shores", 1800, 3700], ["Alamo Sea", 900, 4100],
  ["Grapeseed", 1800, 4850], ["Mont Chiliad", 450, 5600], ["Paleto Bay", -200, 6400], ["Humane Labs", 3550, 3700], ["Centrale", 2700, 1550]
];

const INITIAL_VIEW: [number, number, number, number] = [110, 20, 740, 960];

export default function MapView({ initial, mapImage, settingsHref, can, detections: initialDetections }: Props) {
  const paths = useServerPaths();
  const { ask } = useUI();
  const { send, busy } = useCommand();
  const { ban } = useBanDialog();
  const { data: live } = usePolling<LiveState>(paths.api("live"), initial, 2000);
  const { data: detections } = usePolling<MapDetection[]>(can.security ? paths.api("detections") : "", initialDetections, can.security ? 10_000 : 3_600_000);
  const [showDetections, setShowDetections] = useState(true);
  const [screen, setScreen] = useState<LivePlayer | null>(null);
  const [frozen, setFrozen] = useState<Set<number>>(new Set());
  const [view, setView] = useState(INITIAL_VIEW);
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState<"players" | "voice">("players");
  const [query, setQuery] = useState("");
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; view: typeof view } | null>(null);

  const placed = live.players.filter((p) => p.pos);
  const current = live.players.find((p) => p.id === selected) ?? null;
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return live.players.filter((p) => !needle || p.name.toLowerCase().includes(needle) || String(p.id) === needle);
  }, [live.players, query]);

  // ---- pan & zoom ----
  const unitsPerPixel = () => {
    const box = svg.current?.getBoundingClientRect();
    return box ? Math.max(view[2] / box.width, view[3] / box.height) : 1;
  };
  const zoom = (factor: number, cx = view[0] + view[2] / 2, cy = view[1] + view[3] / 2) => {
    const w = Math.min(1200, Math.max(25, view[2] * factor));
    const h = (view[3] / view[2]) * w;
    setView([cx - ((cx - view[0]) / view[2]) * w, cy - ((cy - view[1]) / view[3]) * h, w, h]);
  };
  const onWheel = (e: React.WheelEvent) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const k = unitsPerPixel();
    const cx = view[0] + view[2] / 2 + (e.clientX - box.left - box.width / 2) * k;
    const cy = view[1] + view[3] / 2 + (e.clientY - box.top - box.height / 2) * k;
    zoom(e.deltaY > 0 ? 1.2 : 1 / 1.2, cx, cy);
  };
  const focus = (p: LivePlayer) => {
    setSelected(p.id);
    if (!p.pos) return;
    const [mx, my] = toMap(p.pos[0], p.pos[1]);
    const w = Math.min(view[2], 160);
    const h = (view[3] / view[2]) * w;
    setView([mx - w / 2, my - h / 2, w, h]);
  };

  // ---- actions ----
  async function screenshot(p: LivePlayer) {
    await send("screenshot", { target: p.id }, `Capture de ${p.name} envoyée à l'analyse (onglet Captures IA de l'anticheat)`);
  }
  async function freeze(p: LivePlayer) {
    const on = !frozen.has(p.id);
    if (await send("freeze", { target: p.id, on }, on ? `${p.name} est gelé` : `${p.name} est dégelé`)) {
      setFrozen((prev) => {
        const next = new Set(prev);
        if (on) next.add(p.id); else next.delete(p.id);
        return next;
      });
    }
  }
  async function kick(p: LivePlayer) {
    const answer = await ask({ title: `Kick ${p.name}`, message: "Le joueur est déconnecté avec ce message.", confirmLabel: "Kick", danger: true, input: { label: "Raison", required: true } });
    if (answer) await send("kick", { target: p.id, reason: answer.value }, `${p.name} a été expulsé`);
  }

  const r = view[2] / 110;
  const showNames = view[2] < 330;
  const talking = live.players.filter((p) => p.talking);
  const groupBy = (key: "radio" | "call") => {
    const groups = new Map<number, LivePlayer[]>();
    for (const p of live.players) {
      const v = p[key];
      if (v) groups.set(v, [...(groups.get(v) ?? []), p]);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  };

  return (
    <>
      <AgentBanner live={live} settingsHref={settingsHref} />
      {live.online && live.players.length > 0 && placed.length === 0 && (
        <div className="banner"><b>Aucune position reçue.</b> Mets à jour <code>fiverax_agent</code> (version 3) : les positions et le vocal viennent de son module client.</div>
      )}
      <div className="map-layout rise rise-1">
        <div className="map-frame">
          <svg
            ref={svg}
            viewBox={view.join(" ")}
            preserveAspectRatio="xMidYMid meet"
            onWheel={onWheel}
            onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, view }; }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              const k = unitsPerPixel();
              const v = drag.current.view;
              setView([v[0] - (e.clientX - drag.current.x) * k, v[1] - (e.clientY - drag.current.y) * k, v[2], v[3]]);
            }}
            onPointerUp={() => { drag.current = null; }}
            className="map-svg"
          >
            {mapImage ? (
              <image href={mapImage} x={0} y={0} width={1000} height={1000} preserveAspectRatio="none" />
            ) : (
              <g className="map-grid">
                {Array.from({ length: 21 }, (_, i) => i * 50).map((v) => (
                  <g key={v}><line x1={v} y1={0} x2={v} y2={1000} /><line x1={0} y1={v} x2={1000} y2={v} /></g>
                ))}
                {PLACES.map(([name, x, y]) => {
                  const [mx, my] = toMap(x, y);
                  return <text key={name} x={mx} y={my} fontSize={view[2] / 55} textAnchor="middle">{name}</text>;
                })}
              </g>
            )}
            {can.security && showDetections && detections.map((d) => {
              const [mx, my] = toMap(d.pos[0], d.pos[1]);
              return (
                <g key={`d${d.id}`} transform={`translate(${mx} ${my})`}>
                  <title>{`${detectionLabel(d.kind)} · ${d.playerName} · ${new Date(d.at).toLocaleTimeString("fr-FR")}`}</title>
                  <circle r={r * 2.6} className="map-det-ring" strokeWidth={r * 0.25} />
                  <path d={`M${-r} ${-r} L${r} ${r} M${r} ${-r} L${-r} ${r}`} className="map-det" strokeWidth={r * 0.55} stroke="var(--bad)" />
                </g>
              );
            })}
            {placed.map((p) => {
              const [mx, my] = toMap(p.pos![0], p.pos![1]);
              const isSel = p.id === selected;
              return (
                <g key={p.id} transform={`translate(${mx} ${my})`} onClick={(e) => { e.stopPropagation(); setSelected(p.id); }} style={{ cursor: "pointer" }}>
                  {p.talking && <circle r={r * 2.2} className="map-talk" />}
                  <g transform={`rotate(${-p.heading})`}><path d={`M0 ${-r * 1.9} L${r * 0.8} ${-r * 0.7} L${-r * 0.8} ${-r * 0.7} Z`} className="map-heading" /></g>
                  <circle r={isSel ? r * 1.4 : r} className={`map-dot ${p.staff ? "staff" : ""} ${p.vehicle ? "veh" : ""} ${isSel ? "sel" : ""}`} strokeWidth={r * 0.35} />
                  {(showNames || isSel) && <text y={-r * 2.4} fontSize={r * 1.7} textAnchor="middle" className="map-name">{p.name} #{p.id}</text>}
                </g>
              );
            })}
          </svg>
          <div className="map-tools">
            <button className="ibtn" title="Zoomer" onClick={() => zoom(1 / 1.4)}><ZoomIn size={14} /></button>
            <button className="ibtn" title="Dézoomer" onClick={() => zoom(1.4)}><ZoomOut size={14} /></button>
            <button className="ibtn" title="Vue d'ensemble" onClick={() => setView(INITIAL_VIEW)}><Locate size={14} /></button>
          </div>
          {can.security && (
            <label className="check map-toggle">
              <input type="checkbox" checked={showDetections} onChange={(e) => setShowDetections(e.target.checked)} />Détections (30 min) · {detections.length}
            </label>
          )}
          {!mapImage && <div className="map-hint">Fond de carte : ajoute <code>MAP_IMAGE_URL</code> (atlas GTA V 8192 px) aux variables du site.</div>}
        </div>

        <aside className="map-side">
          {current && (
            <div className="map-card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                <b style={{ fontSize: 16 }}>{current.playerId ? <Link href={paths.page(`/players/${current.playerId}`)}>{current.name}</Link> : current.name}</b>
                <span className="muted">#{current.id} · {current.ping} ms</span>
              </div>
              <div className="map-facts">
                {current.staff && <span className="plate"><span>{current.staff.grade || "Staff"}</span></span>}
                {current.talking && <span className="tag" data-tone="up"><Mic size={11} /> parle</span>}
                {current.vehicle && <span className="tag"><Car size={11} /> {current.vehicle}</span>}
                {current.radio && <span className="tag" data-tone="info">Radio {current.radio}</span>}
                {current.call && <span className="tag" data-tone="info">Appel {current.call}</span>}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {current.zone ?? "Zone inconnue"}
                {current.health !== null && ` · vie ${Math.max(0, Math.round(current.health - 100))} · armure ${current.armour ?? 0}`}
                {current.pos && ` · ${current.pos.map((v) => Math.round(v)).join(", ")}`}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {current.pos && <button className="btn" onClick={() => focus(current)}><Locate size={14} />Centrer</button>}
                {can.screenshot && <button className="btn" onClick={() => setScreen(current)}><Monitor size={14} />Écran</button>}
                {can.screenshot && <button className="btn" disabled={busy} onClick={() => screenshot(current)}><Camera size={14} />Capture</button>}
                {can.kick && <button className="btn" disabled={busy} onClick={() => freeze(current)}><Snowflake size={14} />{frozen.has(current.id) ? "Dégeler" : "Geler"}</button>}
                {can.kick && <button className="btn" disabled={busy} onClick={() => kick(current)}><UserX size={14} />Kick</button>}
                {can.ban && current.playerId && <button className="btn danger" onClick={() => ban(current.playerId as number, current.name)}><Ban size={14} />Ban</button>}
              </div>
            </div>
          )}

          <div className="pill-tabs" style={{ margin: "4px 0 12px" }}>
            <a href="#" data-on={tab === "players"} onClick={(e) => { e.preventDefault(); setTab("players"); }}>Joueurs · {live.players.length}</a>
            <a href="#" data-on={tab === "voice"} onClick={(e) => { e.preventDefault(); setTab("voice"); }}>Vocal · {talking.length}</a>
          </div>

          {tab === "players" && (
            <>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom ou ID…" className="field" style={{ marginBottom: 8 }} />
              <ul className="map-list">
                {visible.map((p) => (
                  <li key={p.id} data-on={p.id === selected} onClick={() => focus(p)}>
                    <span className={`dot ${p.talking ? "on" : ""}`} />
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    {p.staff && <span className="tag" data-tone="info">staff</span>}
                    <span className="muted num-cell">#{p.id}</span>
                  </li>
                ))}
                {visible.length === 0 && <li className="muted">Personne.</li>}
              </ul>
            </>
          )}

          {tab === "voice" && (
            <div style={{ display: "grid", gap: 18 }}>
              <VoiceGroup icon={<Mic size={14} />} title="Parlent maintenant" players={talking} onPick={focus} empty="Silence radio." />
              {groupBy("radio").map(([freq, players]) => <VoiceGroup key={`r${freq}`} icon={<RadioIcon size={14} />} title={`Radio ${freq}`} players={players} onPick={focus} />)}
              {groupBy("call").map(([id, players]) => <VoiceGroup key={`c${id}`} icon={<Phone size={14} />} title={`Appel ${id}`} players={players} onPick={focus} />)}
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>Radio et appels lus sur pma-voice. L&apos;audio n&apos;est jamais enregistré ni transmis au panel.</p>
            </div>
          )}
        </aside>
      </div>
      {screen && <ScreenViewer target={screen.id} name={screen.name} onClose={() => setScreen(null)} />}
    </>
  );
}

function VoiceGroup({ icon, title, players, onPick, empty }: { icon: React.ReactNode; title: string; players: LivePlayer[]; onPick: (p: LivePlayer) => void; empty?: string }) {
  return (
    <div>
      <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>{icon}{title}</div>
      <ul className="map-list">
        {players.map((p) => (
          <li key={p.id} onClick={() => onPick(p)}>
            <span className={`dot ${p.talking ? "on" : ""}`} />
            <span style={{ flex: 1 }}>{p.name}</span>
            <span className="muted num-cell">#{p.id}</span>
          </li>
        ))}
        {players.length === 0 && empty && <li className="muted">{empty}</li>}
      </ul>
    </div>
  );
}
