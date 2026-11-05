"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Ban, Car, Crosshair, FastForward, Flag, Locate, Mic, Pause, Play, Radio as RadioIcon, Rewind, Skull, Target, UserCheck, ZoomIn, ZoomOut
} from "lucide-react";
import {
  clock, distance, KIND_LABEL, OUTCOME_LABEL, playersAt, relative, REPORT_OUTCOMES, STATUS_LABEL, trailOf, weaponLabel,
  type Capture, type CaptureEvent, type PlayerAt, type ReportSummary
} from "@/lib/blackbox-shared";
import { detectionLabel } from "@/lib/security-config";
import { describeApiError, useServerPaths, useUI } from "@/app/ui";
import { PLACES, toMap } from "../../map/map-view";
import { useBanDialog } from "../../security-actions";

type Props = { report: ReportSummary; mapImage: string | null; can: { ban: boolean } };

const SPEEDS = [1, 2, 4, 8];
const TRAIL_SECONDS = 30;

export default function ReplayView({ report: initial, mapImage, can }: Props) {
  const paths = useServerPaths();
  const [capture, setCapture] = useState<Capture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState(initial);

  useEffect(() => {
    if (!initial.hasCapture) return;
    let stopped = false;
    fetch(paths.api(`reports?capture=${initial.id}`))
      .then(async (res) => {
        if (!res.ok) throw new Error(describeApiError(await res.json().catch(() => ({})), res.status));
        return res.json() as Promise<Capture>;
      })
      .then((data) => { if (!stopped) setCapture(data); })
      .catch((e: Error) => { if (!stopped) setError(e.message || "Replay illisible."); });
    return () => { stopped = true; };
  }, [initial.id, initial.hasCapture, paths]);

  return (
    <div className="map-layout rise rise-1">
      <div>
        {!initial.hasCapture && <div className="replay-empty">Pas de replay pour ce report : supprimé après 30 jours, ou l&apos;agent n&apos;avait encore rien enregistré.</div>}
        {initial.hasCapture && !capture && !error && <div className="replay-empty"><span className="spinner" /> Chargement du replay…</div>}
        {error && <div className="replay-empty">{error}</div>}
        {capture && capture.frames.length > 0 && <Replay capture={capture} report={report} mapImage={mapImage} />}
        {capture && capture.frames.length === 0 && <div className="replay-empty">Le replay est vide : aucun joueur n&apos;était enregistré à ce moment.</div>}
      </div>
      <aside className="map-side">
        <ReportCard report={report} onChange={setReport} can={can} />
        {capture && <CaptureFacts capture={capture} />}
      </aside>
    </div>
  );
}

// ---- the replay ----

type Role = "reporter" | "target" | "center";
const ROLE_LABEL: Record<Role, string> = { reporter: "A signalé", target: "Signalé", center: "Ciblé" };

function Replay({ capture, report, mapImage }: { capture: Capture; report: ReportSummary; mapImage: string | null }) {
  const paths = useServerPaths();
  const { frames, events } = capture;
  const from = frames[0].t;
  const to = frames[frames.length - 1].t;
  const names = useMemo(() => new Map(capture.players.map((p) => [p.id, p])), [capture.players]);
  const nameOf = useCallback((id: number | undefined) => (id === undefined || id === 0 ? null : names.get(id)?.name ?? `#${id}`), [names]);
  const roles = useMemo(() => {
    const m = new Map<number, Role>();
    if (capture.center != null) m.set(capture.center, "center");
    if (capture.target != null) m.set(capture.target, "target");
    if (capture.reporter != null) m.set(capture.reporter, "reporter");
    return m;
  }, [capture.center, capture.target, capture.reporter]);

  const [t, setT] = useState(() => Math.max(from, Math.min(to, capture.at - 45)));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<number | null>(capture.target ?? capture.center ?? capture.reporter ?? null);
  const [follow, setFollow] = useState(false);
  const [showHits, setShowHits] = useState(true);
  const [allTrails, setAllTrails] = useState(false);

  // ---- playback ----
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setT((prev) => {
        const next = prev + dt * speed;
        if (next >= to) {
          setPlaying(false);
          return to;
        }
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, to]);

  const seek = useCallback((value: number) => setT(Math.max(from, Math.min(to, value))), [from, to]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.code === "Space") { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setT((v) => Math.max(from, v - 5)); }
      else if (e.key === "ArrowRight") { e.preventDefault(); setT((v) => Math.min(to, v + 5)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [from, to]);

  const now = useMemo(() => playersAt(frames, t), [frames, t]);
  const byId = useMemo(() => new Map(now.map((p) => [p.id, p])), [now]);
  const current = selected !== null ? byId.get(selected) ?? null : null;

  // ---- view (pan & zoom), starting on where the people involved were in the last minute before the report ----
  const initialView = useMemo<[number, number, number, number]>(() => {
    const focus = [...roles.keys()];
    const collect = (fromT: number, toT: number) => {
      const pts: [number, number][] = [];
      for (const f of frames) {
        if (f.t < fromT || f.t > toT) continue;
        for (const p of f.p) if (!focus.length || focus.includes(p[0])) pts.push(toMap(p[1], p[2]));
      }
      return pts;
    };
    let pts = collect(capture.at - 60, capture.at + 10);
    if (!pts.length) pts = collect(from, to);
    if (!pts.length) return [110, 20, 740, 960];
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const w = Math.min(900, Math.max(14, (Math.max(...xs) - Math.min(...xs)) * 1.8, (Math.max(...ys) - Math.min(...ys)) * 1.8));
    return [cx - w / 2, cy - w / 2, w, w];
  }, [frames, roles, capture.at, from, to]);
  const [view, setView] = useState(initialView);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; view: typeof view } | null>(null);

  useEffect(() => {
    if (!follow || !current) return;
    const [mx, my] = toMap(current.x, current.y);
    setView((v) => [mx - v[2] / 2, my - v[3] / 2, v[2], v[3]]);
  }, [follow, current]);

  const unitsPerPixel = () => {
    const box = svg.current?.getBoundingClientRect();
    return box ? Math.max(view[2] / box.width, view[3] / box.height) : 1;
  };
  const zoom = (factor: number, cx = view[0] + view[2] / 2, cy = view[1] + view[3] / 2) => {
    const w = Math.min(1200, Math.max(8, view[2] * factor));
    const h = (view[3] / view[2]) * w;
    setView([cx - ((cx - view[0]) / view[2]) * w, cy - ((cy - view[1]) / view[3]) * h, w, h]);
  };
  const onWheel = (e: React.WheelEvent) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const k = unitsPerPixel();
    zoom(e.deltaY > 0 ? 1.2 : 1 / 1.2, view[0] + view[2] / 2 + (e.clientX - box.left - box.width / 2) * k, view[1] + view[3] / 2 + (e.clientY - box.top - box.height / 2) * k);
  };

  // ---- what to draw ----
  const r = view[2] / 110;
  const showNames = view[2] < 45; // one map unit is about 12 m: names when less than ~500 m wide
  const posAt = useCallback((id: number | undefined, time: number): PlayerAt | null => (id ? playersAt(frames, time).find((p) => p.id === id) ?? null : null), [frames]);
  const recentHits = showHits ? events.filter((e) => e.k === "hit" && e.t <= t && e.t > t - 1.5) : [];
  const deaths = useMemo(() => events.filter((e) => e.k === "death").map((e) => ({ e, at: posAt(e.b, e.t) })), [events, posAt]);
  const detections = events.filter((e) => e.k === "detection" && e.t <= t && e.t > t - 12);
  const trailIds = allTrails ? now.map((p) => p.id) : [...new Set([...roles.keys(), ...(selected !== null ? [selected] : [])])];
  const atReport = Math.abs(t - capture.at) < 2.5;

  return (
    <>
      <div className="map-frame replay-frame">
        <svg
          ref={svg}
          viewBox={view.join(" ")}
          preserveAspectRatio="xMidYMid meet"
          onWheel={onWheel}
          onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, view }; setFollow(false); }}
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
              {Array.from({ length: 21 }, (_, i) => i * 50).map((v) => <g key={v}><line x1={v} y1={0} x2={v} y2={1000} /><line x1={0} y1={v} x2={1000} y2={v} /></g>)}
              {PLACES.map(([name, x, y]) => {
                const [mx, my] = toMap(x, y);
                return <text key={name} x={mx} y={my} fontSize={view[2] / 55} textAnchor="middle">{name}</text>;
              })}
            </g>
          )}

          {trailIds.map((id) => {
            const pts = trailOf(frames, id, t - TRAIL_SECONDS, t).map(([x, y]) => toMap(x, y));
            const p = byId.get(id);
            if (p) pts.push(toMap(p.x, p.y));
            if (pts.length < 2) return null;
            return <polyline key={`tr${id}`} points={pts.map((q) => q.join(",")).join(" ")} className={`replay-trail ${roles.get(id) ?? ""}`} strokeWidth={r * 0.35} />;
          })}

          {deaths.filter(({ e, at }) => at && e.t <= t).map(({ e, at }) => {
            const [mx, my] = toMap(at!.x, at!.y);
            const fresh = t - e.t < 15;
            const s = r * (fresh ? 1.3 : 0.9);
            return (
              <g key={`death${e.t}-${e.b}`} transform={`translate(${mx} ${my})`} opacity={fresh ? 1 : 0.4}>
                <title>{`${nameOf(e.b)} mort${e.a ? `, tué par ${nameOf(e.a)}` : ""}${weaponLabel(e.w) ? ` (${weaponLabel(e.w)})` : ""} · ${clock(e.t)}`}</title>
                {fresh && <circle r={r * 3} className="replay-death-ring" strokeWidth={r * 0.2} />}
                <path d={`M${-s} ${-s} L${s} ${s} M${s} ${-s} L${-s} ${s}`} className="replay-death" strokeWidth={r * 0.5} />
              </g>
            );
          })}

          {recentHits.map((e, i) => {
            const a = byId.get(e.a ?? -1), b = byId.get(e.b ?? -1);
            if (!a || !b) return null;
            const [ax, ay] = toMap(a.x, a.y), [bx, by] = toMap(b.x, b.y);
            return <line key={`hit${i}-${e.t}`} x1={ax} y1={ay} x2={bx} y2={by} className="replay-shot" strokeWidth={r * 0.3} opacity={Math.max(0.15, 1 - (t - e.t) / 1.5)} />;
          })}

          {detections.map((e, i) => {
            const p = byId.get(e.a ?? -1);
            if (!p) return null;
            const [mx, my] = toMap(p.x, p.y);
            return <circle key={`det${i}`} cx={mx} cy={my} r={r * 3.2} className="map-det-ring" strokeWidth={r * 0.3}><title>{`Anticheat : ${detectionLabel(e.x ?? "")}`}</title></circle>;
          })}

          {now.map((p) => {
            const [mx, my] = toMap(p.x, p.y);
            const role = roles.get(p.id);
            const isSel = p.id === selected;
            return (
              <g key={p.id} transform={`translate(${mx} ${my})`} onClick={(e) => { e.stopPropagation(); setSelected(p.id); }} style={{ cursor: "pointer" }}>
                {p.talking && <circle r={r * 2.2} className="map-talk" />}
                {role && <circle r={r * 1.9} className={`replay-role ${role}`} strokeWidth={r * 0.3} />}
                {!p.dead && <g transform={`rotate(${-p.heading})`}><path d={`M0 ${-r * 1.9} L${r * 0.8} ${-r * 0.7} L${-r * 0.8} ${-r * 0.7} Z`} className="map-heading" /></g>}
                <circle r={isSel ? r * 1.35 : r} className={`map-dot ${p.inVehicle ? "veh" : ""} ${p.dead ? "dead" : ""} ${isSel ? "sel" : ""}`} strokeWidth={r * 0.35} />
                {(showNames || isSel || role) && <text y={-r * 2.5} fontSize={r * 1.6} textAnchor="middle" className="map-name" style={{ strokeWidth: r * 0.3 }}>{nameOf(p.id)}</text>}
              </g>
            );
          })}
        </svg>
        <div className="map-tools">
          <button className="ibtn" title="Zoomer" onClick={() => zoom(1 / 1.4)}><ZoomIn size={14} /></button>
          <button className="ibtn" title="Dézoomer" onClick={() => zoom(1.4)}><ZoomOut size={14} /></button>
          <button className="ibtn" title="Recadrer sur l'incident" onClick={() => { setFollow(false); setView(initialView); }}><Locate size={14} /></button>
          <button className="ibtn" title="Suivre le joueur sélectionné" data-on={follow} disabled={!current} onClick={() => setFollow((f) => !f)}><Crosshair size={14} /></button>
        </div>
        <div className="replay-clock">
          <b>{clock(t)}</b>
          <span data-at={atReport}>{report.kind === "manual" ? `${relative(t - capture.at)} avant la demande` : `${relative(t - capture.at)} ${t < capture.at ? "avant" : "après"} le ${report.kind === "report" ? "report" : "déclenchement"}`}</span>
        </div>
        {!mapImage && <div className="map-hint">Fond de carte : ajoute <code>MAP_IMAGE_URL</code> (atlas GTA V 8192 px) aux variables du site.</div>}
      </div>

      <Timeline capture={capture} t={t} onSeek={(v) => { setPlaying(false); seek(v); }} showHits={showHits} />

      <div className="replay-controls">
        <button className="btn" onClick={() => seek(t - 10)} title="−10 s (flèche gauche : −5 s)"><Rewind size={14} />10 s</button>
        <button className="btn primary" onClick={() => { if (t >= to) seek(from); setPlaying((p) => !p); }} title="Espace">
          {playing ? <><Pause size={14} />Pause</> : <><Play size={14} />Lecture</>}
        </button>
        <button className="btn" onClick={() => seek(t + 10)} title="+10 s (flèche droite : +5 s)">10 s<FastForward size={14} /></button>
        <button className="btn" onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])} title="Vitesse">× {speed}</button>
        <button className="btn" onClick={() => { setPlaying(false); seek(capture.at - 5); }}><Flag size={14} />{report.kind === "manual" ? "Fin" : "Moment du report"}</button>
        <label className="check"><input type="checkbox" checked={showHits} onChange={(e) => setShowHits(e.target.checked)} />Tirs et coups</label>
        <label className="check"><input type="checkbox" checked={allTrails} onChange={(e) => setAllTrails(e.target.checked)} />Trajets de tout le monde</label>
      </div>

      <div className="cols even" style={{ marginTop: 22 }}>
        <section>
          <h2 className="h2" style={{ marginBottom: 10 }}>À cet instant</h2>
          {current ? (
            <div className="map-card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                <b style={{ fontSize: 16 }}>
                  {names.get(current.id)?.playerId ? <Link href={paths.page(`/players/${names.get(current.id)!.playerId}`)}>{nameOf(current.id)}</Link> : nameOf(current.id)}
                </b>
                <span className="muted">#{current.id}</span>
              </div>
              <div className="map-facts">
                {roles.get(current.id) && <span className="tag" data-tone={roles.get(current.id) === "target" ? "danger" : "info"}>{ROLE_LABEL[roles.get(current.id)!]}</span>}
                {current.dead && <span className="tag" data-tone="danger"><Skull size={11} /> à terre</span>}
                {current.talking && <span className="tag" data-tone="up"><Mic size={11} /> parle</span>}
                {current.inVehicle && <span className="tag"><Car size={11} /> {current.vehicle || "véhicule"}</span>}
                {current.radio > 0 && <span className="tag" data-tone="info"><RadioIcon size={11} /> Radio {current.radio}</span>}
                {current.call > 0 && <span className="tag" data-tone="info">Appel {current.call}</span>}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Vie {Math.max(0, current.health - 100)} · armure {current.armour} · {Math.round(current.x)}, {Math.round(current.y)}, {Math.round(current.z)}
              </div>
              <Distances current={current} roles={roles} byId={byId} nameOf={nameOf} />
            </div>
          ) : <p className="muted" style={{ fontSize: 13 }}>Clique sur un joueur de la carte ou de la liste.</p>}

          <h2 className="h2" style={{ margin: "18px 0 10px" }}>Joueurs du replay · {capture.players.length}</h2>
          <ul className="map-list">
            {[...capture.players].sort((a, b) => Number(roles.has(b.id)) - Number(roles.has(a.id)) || a.name.localeCompare(b.name)).map((p) => {
              const at = byId.get(p.id);
              const role = roles.get(p.id);
              return (
                <li key={p.id} data-on={p.id === selected} onClick={() => { setSelected(p.id); setFollow(true); }}>
                  <span className={`dot ${at?.talking ? "on" : ""}`} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: at ? 1 : 0.5 }}>{p.name}</span>
                  {role && <span className="tag" data-tone={role === "target" ? "danger" : "info"}>{ROLE_LABEL[role]}</span>}
                  {at?.dead && <Skull size={12} className="muted" />}
                  <span className="muted num-cell">#{p.id}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <h2 className="h2" style={{ marginBottom: 10 }}>Chronologie</h2>
          <EventList capture={capture} t={t} nameOf={nameOf} showHits={showHits} onPick={(time) => { setPlaying(false); seek(time - 3); }} />
        </section>
      </div>
    </>
  );
}

function Distances({ current, roles, byId, nameOf }: { current: PlayerAt; roles: Map<number, Role>; byId: Map<number, PlayerAt>; nameOf: (id: number) => string | null }) {
  const others = [...roles.keys()].filter((id) => id !== current.id).map((id) => byId.get(id)).filter((p): p is PlayerAt => Boolean(p));
  if (!others.length) return null;
  return (
    <div style={{ fontSize: 12, display: "grid", gap: 2 }}>
      {others.map((o) => <span key={o.id} className="replay-who"><Target size={11} /> à {Math.round(distance(current, o))} m de {nameOf(o.id)}</span>)}
    </div>
  );
}

// ---- timeline and events ----

const TICK: Partial<Record<CaptureEvent["k"], string>> = { death: "death", report: "report", detection: "detection", hit: "hit" };

function Timeline({ capture, t, onSeek, showHits }: { capture: Capture; t: number; onSeek: (v: number) => void; showHits: boolean }) {
  const from = capture.frames[0].t;
  const to = capture.frames[capture.frames.length - 1].t;
  const span = Math.max(1, to - from);
  const pct = (v: number) => `${((v - from) / span) * 100}%`;
  return (
    <div className="replay-timeline">
      <div className="replay-ticks">
        {capture.events.filter((e) => TICK[e.k] && (showHits || e.k !== "hit") && e.t >= from && e.t <= to).map((e, i) => (
          <i key={i} className={TICK[e.k]} style={{ left: pct(e.t) }} />
        ))}
        {capture.at >= from && capture.at <= to && <i className="moment" style={{ left: pct(capture.at) }} title="Moment du report" />}
        <i className="cursor" style={{ left: pct(t) }} />
      </div>
      <input type="range" min={from} max={to} step={0.1} value={t} onChange={(e) => onSeek(Number(e.target.value))} aria-label="Position dans le replay" />
      <div className="replay-range-labels"><span>{clock(from)}</span><span>{Math.round(span / 60)} min · {capture.frames.length} images</span><span>{clock(to)}</span></div>
    </div>
  );
}

type Line = { t: number; kind: string; text: string; strong?: boolean };

/** Readable events, consecutive hits between the same two players grouped. */
function lines(capture: Capture, nameOf: (id: number | undefined) => string | null, showHits: boolean): Line[] {
  const out: Line[] = [];
  let burst: { t: number; a?: number; b?: number; w?: number; n: number; last: number; damage: number } | null = null;
  const flush = () => {
    if (!burst) return;
    const weapon = weaponLabel(burst.w);
    out.push({ t: burst.t, kind: "hit", text: `${nameOf(burst.a)} touche ${nameOf(burst.b)}${burst.n > 1 ? ` ×${burst.n}` : ""}${weapon ? ` · ${weapon}` : ""}${burst.damage ? ` · ${burst.damage} dégâts` : ""}` });
    burst = null;
  };
  for (const e of capture.events) {
    if (e.k === "hit") {
      if (!showHits) continue;
      if (burst && burst.a === e.a && burst.b === e.b && e.t - burst.last <= 3) {
        burst.n++;
        burst.last = e.t;
        burst.damage += e.d ?? 0;
        continue;
      }
      flush();
      burst = { t: e.t, a: e.a, b: e.b, w: e.w, n: 1, last: e.t, damage: e.d ?? 0 };
      continue;
    }
    flush();
    const weapon = weaponLabel(e.w);
    if (e.k === "death") out.push({ t: e.t, kind: "death", strong: true, text: e.a ? `${nameOf(e.a)} tue ${nameOf(e.b)}${weapon ? ` · ${weapon}` : ""}` : `${nameOf(e.b)} meurt${weapon ? ` · ${weapon}` : ""}` });
    else if (e.k === "report") out.push({ t: e.t, kind: "report", strong: true, text: `${nameOf(e.a)} fait un report${e.b ? ` contre ${nameOf(e.b)}` : ""}${e.x ? ` : « ${e.x} »` : ""}` });
    else if (e.k === "detection") out.push({ t: e.t, kind: "detection", strong: true, text: `Anticheat : ${detectionLabel(e.x ?? "")} (${nameOf(e.a)})` });
    else if (e.k === "join") out.push({ t: e.t, kind: "join", text: `${nameOf(e.a)} se connecte` });
    else if (e.k === "leave") out.push({ t: e.t, kind: "leave", text: `${nameOf(e.a)} se déconnecte${e.x ? ` (${e.x})` : ""}` });
  }
  flush();
  return out;
}

function EventList({ capture, t, nameOf, showHits, onPick }: { capture: Capture; t: number; nameOf: (id: number | undefined) => string | null; showHits: boolean; onPick: (t: number) => void }) {
  const items = useMemo(() => lines(capture, nameOf, showHits), [capture, nameOf, showHits]);
  if (!items.length) return <p className="muted" style={{ fontSize: 13 }}>Aucun tir, mort ou connexion dans cette fenêtre : les joueurs ont seulement bougé et parlé.</p>;
  return (
    <ul className="replay-events">
      {items.map((l, i) => (
        <li key={i} data-kind={l.kind} data-past={l.t <= t} data-strong={Boolean(l.strong)} onClick={() => onPick(l.t)}>
          <span className="num-cell">{clock(l.t)}</span>
          <span>{l.text}</span>
          <span className="muted num-cell">{relative(l.t - capture.at)}</span>
        </li>
      ))}
    </ul>
  );
}

function CaptureFacts({ capture }: { capture: Capture }) {
  const deaths = capture.events.filter((e) => e.k === "death").length;
  const hits = capture.events.filter((e) => e.k === "hit").length;
  return (
    <div className="map-card" style={{ fontSize: 13 }}>
      <div className="eyebrow">Le replay</div>
      <div>{Math.max(1, Math.round((capture.frames[capture.frames.length - 1].t - capture.frames[0].t) / 60))} min · {capture.players.length} joueur{capture.players.length > 1 ? "s" : ""} · {deaths} mort{deaths > 1 ? "s" : ""} · {hits} coup{hits > 1 ? "s" : ""}</div>
      <div className="muted" style={{ fontSize: 12 }}>Positions toutes les 2 s, lissées. Les joueurs loin des personnes concernées ne sont pas enregistrés. Aucun son n&apos;est capté : seulement qui parle.</div>
      <div className="muted" style={{ fontSize: 12 }}>Raccourcis : espace (lecture), flèches (± 5 s).</div>
    </div>
  );
}

// ---- the report itself ----

function ReportCard({ report, onChange, can }: { report: ReportSummary; onChange: (r: ReportSummary) => void; can: { ban: boolean } }) {
  const paths = useServerPaths();
  const router = useRouter();
  const { ask, toast } = useUI();
  const { ban } = useBanDialog();
  const [busy, setBusy] = useState(false);

  async function post(action: string, body: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      const res = await fetch(paths.api(`reports?action=${action}`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: report.id, ...body }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast(describeApiError(data, res.status), "error");
      onChange(data as ReportSummary);
      toast(success, "ok");
      router.refresh();
    } catch {
      toast("Impossible de joindre le panel.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    const answer = await ask({
      title: `Clore le report #${report.id}`,
      message: report.kind === "report" ? "La réponse est visible par le joueur qui a fait le report, dans son espace joueur Fiverax." : undefined,
      confirmLabel: "Clore",
      select: { label: "Décision", options: REPORT_OUTCOMES.map((o) => ({ value: o, label: OUTCOME_LABEL[o] })), initial: "sanctioned" },
      input: { label: report.kind === "report" ? "Réponse au joueur" : "Note", multiline: true, placeholder: "Merci pour ton report : le joueur a été sanctionné." }
    });
    if (answer) await post("close", { outcome: answer.choice ?? "no_action", verdict: answer.value }, `Report #${report.id} clos`);
  }

  return (
    <div className="map-card">
      <div className="map-facts">
        <span className="tag" data-tone={report.kind === "detection" ? "danger" : "info"}>{KIND_LABEL[report.kind]}</span>
        <span className="tag" data-tone={report.status === "open" ? "warn" : report.status === "claimed" ? "info" : "up"}>{STATUS_LABEL[report.status]}</span>
        <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>#{report.id}</span>
      </div>
      <b style={{ fontSize: 15, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{report.reason}</b>
      <div style={{ fontSize: 13, display: "grid", gap: 4 }}>
        {report.reporterName && <span className="replay-who" title="A fait le report"><UserCheck size={12} /> {report.reporterPlayerId ? <Link href={paths.page(`/players/${report.reporterPlayerId}`)}>{report.reporterName}</Link> : report.reporterName}</span>}
        {report.targetName && <span className="replay-who" title="Signalé"><Target size={12} /> {report.targetPlayerId ? <Link href={paths.page(`/players/${report.targetPlayerId}`)}>{report.targetName}</Link> : report.targetName}</span>}
        {report.detection && <span className="muted">Détection : {detectionLabel(report.detection)}</span>}
        <span className="muted">{new Date(report.createdAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}{report.claimedName && report.status !== "closed" ? ` · pris par ${report.claimedName}` : ""}</span>
      </div>
      {report.status === "closed" && (
        <div className="replay-verdict">
          <b>{report.outcome ? OUTCOME_LABEL[report.outcome] : "Clos"}</b>{report.closedName ? ` · ${report.closedName}` : ""}
          {report.verdict && <p>{report.verdict}</p>}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {report.status === "open" && <button className="btn primary" disabled={busy} onClick={() => post("claim", {}, "Report pris en charge")}>Je m&apos;en occupe</button>}
        {report.status === "claimed" && <button className="btn" disabled={busy} onClick={() => post("unclaim", {}, "Report relâché")}>Relâcher</button>}
        {report.status !== "closed" && <button className="btn" disabled={busy} onClick={close}>Clore</button>}
        {report.status === "closed" && <button className="btn" disabled={busy} onClick={() => post("reopen", {}, "Report rouvert")}>Rouvrir</button>}
        {can.ban && report.targetPlayerId && <button className="btn danger" onClick={() => ban(report.targetPlayerId as number, report.targetName ?? "ce joueur")}><Ban size={14} />Bannir {report.targetName}</button>}
      </div>
    </div>
  );
}
