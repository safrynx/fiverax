"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Boxes, Copy, Crosshair, Magnet, Maximize, RotateCcw, RotateCw, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { LIMITS, MODEL_RE, PROP_KITS, PROPS, propOf, type MapData, type MapObject } from "@/lib/studio-shared";

/** Starting points with a ground altitude close enough for objects to be put on the ground. */
export const PLACES_3D: { name: string; pos: [number, number, number] }[] = [
  { name: "Legion Square", pos: [195.2, -933.8, 30.7] },
  { name: "Commissariat Mission Row", pos: [428.1, -981.4, 30.7] },
  { name: "Hôpital Pillbox Hill", pos: [298.6, -584.5, 43.3] },
  { name: "Plage de Vespucci", pos: [-1390.4, -1520.6, 4.4] },
  { name: "Jetée de Del Perro", pos: [-1690.2, -1094.6, 13.2] },
  { name: "Aéroport LSIA", pos: [-1037.2, -2737.7, 20.2] },
  { name: "Sandy Shores", pos: [1853.4, 3686.9, 34.3] },
  { name: "Paleto Bay", pos: [-130.3, 6420.1, 31.5] },
  { name: "Grapeseed", pos: [1700.6, 4800.2, 41.9] }
];

const CATEGORIES = ["Tout", ...new Set(PROPS.map((p) => p.cat))];
const CAT_COLORS: Record<string, string> = {
  Route: "#f59e3b", "Événement": "#d4b06a", "Mobilier urbain": "#7dd3fc", "Décor": "#4ade80", Industriel: "#a78bfa", Caisses: "#c08457", "Intérieur": "#f472b6"
};

type Player = { id: number; name: string; pos: [number, number, number] };
/** `fitKey`: changes when the scene is replaced from outside (AI, restore), to frame it again. */
type Props = { data: MapData; onChange: (data: MapData) => void; players: Player[]; fitKey: number };
type View = [number, number, number, number];

const round = (v: number, step: number) => Math.round(v / step) * step;
const fix = (v: number) => Number(v.toFixed(2));
const newId = () => `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** View box (SVG units = metres, y pointing south) that shows every object. */
function fitView(objects: MapObject[]): View {
  if (!objects.length) return [-15, -11, 30, 22];
  const xs = objects.map((o) => o.x);
  const ys = objects.map((o) => -o.y);
  const minX = Math.min(...xs) - 4;
  const minY = Math.min(...ys) - 4;
  const w = Math.max(16, Math.max(...xs) + 4 - minX);
  const h = Math.max(12, Math.max(...ys) + 4 - minY);
  return [minX + (Math.max(...xs) + 4 - minX - w) / 2, minY + (Math.max(...ys) + 4 - minY - h) / 2, w, h];
}

export default function MapEditor({ data, onChange, players, fitKey }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>(() => fitView(data.objects));
  const [snap, setSnap] = useState(true);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("Tout");
  const [custom, setCustom] = useState("");
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ mode: "pan" | "move"; id?: string; client: [number, number]; world: [number, number]; origin: [number, number]; view: View; scale: number } | null>(null);

  const objectsRef = useRef(data.objects);
  objectsRef.current = data.objects;
  useEffect(() => {
    setView(fitView(objectsRef.current));
  }, [fitKey]);

  const current = data.objects.find((o) => o.id === selected) ?? null;
  const step = snap ? 0.25 : 0.01;

  const set = (objects: MapObject[]) => onChange({ ...data, objects });
  const update = (id: string, patch: Partial<MapObject>) => set(data.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const remove = (id: string) => {
    set(data.objects.filter((o) => o.id !== id));
    setSelected(null);
  };
  const duplicate = (o: MapObject) => {
    if (data.objects.length >= LIMITS.objects) return;
    const copy = { ...o, id: newId(), x: fix(o.x + 1), y: fix(o.y - 1) };
    set([...data.objects, copy]);
    setSelected(copy.id);
  };
  /** Add a prop at a point (default: the middle of the view). */
  const add = (model: string, at: [number, number] = [view[0] + view[2] / 2, -(view[1] + view[3] / 2)]) => {
    if (!MODEL_RE.test(model) || data.objects.length >= LIMITS.objects) return;
    const o: MapObject = { id: newId(), model, x: fix(round(at[0], step)), y: fix(round(at[1], step)), z: 0, heading: 0, ground: true };
    set([...data.objects, o]);
    setSelected(o.id);
  };
  const addKit = (key: string, at: [number, number] = [view[0] + view[2] / 2, -(view[1] + view[3] / 2)]) => {
    const kit = PROP_KITS.find((k) => k.key === key);
    if (!kit) return;
    const added = kit.objects.slice(0, LIMITS.objects - data.objects.length).map((o): MapObject => ({
      id: newId(), model: o.model, x: fix(round(at[0] + o.x, step)), y: fix(round(at[1] + o.y, step)), z: 0, heading: o.heading ?? 0, ground: true
    }));
    if (!added.length) return;
    set([...data.objects, ...added]);
    setSelected(null);
  };
  // Drag from the catalog / kits onto the map.
  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData("application/x-fiverax-prop");
    if (!raw) return;
    e.preventDefault();
    const at = toWorld(e.clientX, e.clientY);
    if (raw.startsWith("kit:")) addKit(raw.slice(4), at);
    else add(raw, at);
  };
  const dragProp = (value: string) => (e: React.DragEvent) => {
    e.dataTransfer.setData("application/x-fiverax-prop", value);
    e.dataTransfer.effectAllowed = "copy";
  };

  // ---- pointer: pan the view, or move an object ----
  const toWorld = (clientX: number, clientY: number): [number, number] => {
    const ctm = svg.current?.getScreenCTM();
    if (!ctm) return [0, 0];
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return [p.x, -p.y];
  };
  const startDrag = (e: React.PointerEvent, id?: string) => {
    e.stopPropagation();
    svg.current?.setPointerCapture(e.pointerId);
    const o = id ? data.objects.find((x) => x.id === id) : undefined;
    if (id) setSelected(id);
    drag.current = {
      mode: o ? "move" : "pan",
      id,
      client: [e.clientX, e.clientY],
      world: toWorld(e.clientX, e.clientY),
      origin: o ? [o.x, o.y] : [0, 0],
      view,
      scale: svg.current?.getScreenCTM()?.a ?? 1
    };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === "pan") {
      setView([d.view[0] - (e.clientX - d.client[0]) / d.scale, d.view[1] - (e.clientY - d.client[1]) / d.scale, d.view[2], d.view[3]]);
      return;
    }
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    update(d.id as string, { x: fix(round(d.origin[0] + wx - d.world[0], step)), y: fix(round(d.origin[1] + wy - d.world[1], step)) });
  };
  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    // A click on the background (no movement) unselects.
    if (d?.mode === "pan" && Math.hypot(e.clientX - d.client[0], e.clientY - d.client[1]) < 3) setSelected(null);
  };

  const zoom = (factor: number, cx = view[0] + view[2] / 2, cy = view[1] + view[3] / 2) => {
    setView((v) => {
      const w = Math.min(600, Math.max(4, v[2] * factor));
      const h = (v[3] / v[2]) * w;
      return [cx - ((cx - v[0]) / v[2]) * w, cy - ((cy - v[1]) / v[3]) * h, w, h];
    });
  };
  // Native listener: React's wheel handler is passive and would scroll the page.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const ctm = el.getScreenCTM();
      if (!ctm) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      zoomRef.current(e.deltaY > 0 ? 1.15 : 1 / 1.15, p.x, p.y);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function onKey(e: React.KeyboardEvent) {
    if (!current || (e.target as HTMLElement).closest("input, select, textarea")) return;
    const nudge = e.shiftKey ? 1 : 0.1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-nudge, 0], ArrowRight: [nudge, 0], ArrowUp: [0, nudge], ArrowDown: [0, -nudge] };
    if (moves[e.key]) update(current.id, { x: fix(current.x + moves[e.key][0]), y: fix(current.y + moves[e.key][1]) });
    else if (e.key === "r" || e.key === "R") update(current.id, { heading: (current.heading + (e.shiftKey ? 345 : 15)) % 360 });
    else if (e.key === "Delete" || e.key === "Backspace") remove(current.id);
    else if (e.key === "d" && (e.ctrlKey || e.metaKey)) duplicate(current);
    else return;
    e.preventDefault();
  }

  // ---- grid ----
  const grid = useMemo(() => {
    const minor = view[2] > 160 ? 10 : view[2] > 60 ? 5 : 1;
    const major = minor * 5;
    // The frame rarely has the view's proportions ("meet" adds room on two sides): draw well beyond the view.
    const pad = Math.max(view[2], view[3]) * 1.5;
    const box: View = [view[0] - pad, view[1] - pad, view[2] + pad * 2, view[3] + pad * 2];
    const lines: { v: number; vertical: boolean; major: boolean }[] = [];
    for (let x = Math.floor(box[0] / minor) * minor; x <= box[0] + box[2]; x += minor) lines.push({ v: x, vertical: true, major: Math.round(x) % major === 0 });
    for (let y = Math.floor(box[1] / minor) * minor; y <= box[1] + box[3]; y += minor) lines.push({ v: y, vertical: false, major: Math.round(y) % major === 0 });
    return { lines, minor, box };
  }, [view]);

  const catalog = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return PROPS.filter((p) => (cat === "Tout" || p.cat === cat) && (!needle || p.label.toLowerCase().includes(needle) || p.model.includes(needle)));
  }, [query, cat]);

  const px = view[2] / 900;
  const setCenter = (pos: [number, number, number]) => onChange({ ...data, center: [fix(pos[0]), fix(pos[1]), fix(pos[2])] });

  return (
    <div className="med" tabIndex={0} onKeyDown={onKey}>
      <div className="med-stage">
        <svg
          ref={svg}
          viewBox={view.join(" ")}
          preserveAspectRatio="xMidYMid meet"
          className="med-svg"
          onPointerDown={(e) => startDrag(e)}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={() => { drag.current = null; }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-fiverax-prop")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
          onDrop={onDrop}
        >
          <g className="med-grid">
            {grid.lines.map((l) =>
              l.vertical
                ? <line key={`v${l.v}`} x1={l.v} y1={grid.box[1]} x2={l.v} y2={grid.box[1] + grid.box[3]} data-major={l.major} strokeWidth={px} />
                : <line key={`h${l.v}`} x1={grid.box[0]} y1={l.v} x2={grid.box[0] + grid.box[2]} y2={l.v} data-major={l.major} strokeWidth={px} />
            )}
          </g>
          <circle cx={0} cy={0} r={data.distance} className="med-range" strokeWidth={px * 1.5} />
          <g className="med-center" strokeWidth={px * 2}>
            <line x1={-1.5} y1={0} x2={1.5} y2={0} />
            <line x1={0} y1={-1.5} x2={0} y2={1.5} />
          </g>
          {data.objects.map((o) => {
            const p = propOf(o.model);
            const w = p?.w ?? 1;
            const d = p?.d ?? 1;
            const on = o.id === selected;
            // The label stays upright, under the rotated shape.
            const rad = (o.heading * Math.PI) / 180;
            const below = Math.abs((w / 2) * Math.sin(rad)) + Math.abs((d / 2) * Math.cos(rad));
            return (
              <g key={o.id} transform={`translate(${o.x} ${-o.y})`} className="med-obj" data-on={on} onPointerDown={(e) => startDrag(e, o.id)}>
                <g transform={`rotate(${-o.heading})`}>
                  <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={Math.min(w, d) * 0.15} fill={p ? CAT_COLORS[p.cat] ?? "#ddd" : "#9ca3af"} strokeWidth={px * (on ? 3 : 1)} />
                  <line x1={0} y1={0} x2={0} y2={-d / 2 - Math.max(0.3, d * 0.2)} strokeWidth={px * 2} />
                </g>
                {view[2] < 70 && <text y={below + px * 14} fontSize={px * 11} textAnchor="middle">{p?.label ?? o.model}</text>}
              </g>
            );
          })}
        </svg>
        <div className="map-tools">
          <button type="button" className="ibtn" title="Zoom +" onClick={() => zoom(1 / 1.3)}><ZoomIn size={14} /></button>
          <button type="button" className="ibtn" title="Zoom −" onClick={() => zoom(1.3)}><ZoomOut size={14} /></button>
          <button type="button" className="ibtn" title="Tout voir" onClick={() => setView(fitView(data.objects))}><Maximize size={14} /></button>
          <button type="button" className="ibtn" title="Aimanter (0,25 m)" data-on={snap} onClick={() => setSnap(!snap)}><Magnet size={14} /></button>
        </div>
        <div className="med-north">N ↑</div>
        <div className="map-hint">
          Glisse un prop du catalogue sur la carte · glisse pour déplacer · molette pour zoomer · objet sélectionné : flèches (Maj = 1 m), R / Maj+R pour tourner, Suppr, Ctrl+D · grille {grid.minor} m · cercle = zone d&apos;apparition
        </div>
      </div>

      <div className="med-side">
        {current ? (
          <div className="map-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <b>{propOf(current.model)?.label ?? "Objet"}</b>
              <span style={{ display: "inline-flex", gap: 6 }}>
                <button type="button" className="ibtn" title="Dupliquer (Ctrl+D)" onClick={() => duplicate(current)}><Copy size={13} /></button>
                <button type="button" className="ibtn bad" title="Supprimer" onClick={() => remove(current.id)}><Trash2 size={13} /></button>
              </span>
            </div>
            <label className="med-field"><small>Modèle</small>
              <input className="field" value={current.model} onChange={(e) => update(current.id, { model: e.target.value.trim() })} spellCheck={false} />
            </label>
            {!propOf(current.model) && <small style={{ color: "var(--warn)" }}>Hors catalogue : vérifie que ce modèle existe (sinon il est ignoré en jeu).</small>}
            <div className="med-xyz">
              {(["x", "y", "z"] as const).map((k) => (
                <label key={k} className="med-field"><small>{k.toUpperCase()} (m)</small>
                  <input className="field" type="number" step={0.1} value={current[k]} onChange={(e) => update(current.id, { [k]: Number(e.target.value) || 0 })} />
                </label>
              ))}
            </div>
            <label className="med-field"><small>Orientation : {Math.round(current.heading)}°</small>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button type="button" className="ibtn" onClick={() => update(current.id, { heading: (current.heading + 345) % 360 })}><RotateCcw size={13} /></button>
                <input type="range" min={0} max={359} value={Math.round(current.heading)} onChange={(e) => update(current.id, { heading: Number(e.target.value) })} style={{ flex: 1, accentColor: "var(--accent)" }} />
                <button type="button" className="ibtn" onClick={() => update(current.id, { heading: (current.heading + 15) % 360 })}><RotateCw size={13} /></button>
              </div>
            </label>
            <label className="check"><input type="checkbox" checked={current.ground} onChange={(e) => update(current.id, { ground: e.target.checked })} />Poser au sol automatiquement</label>
          </div>
        ) : (
          <div className="map-card">
            <b>Emplacement</b>
            <div className="med-xyz">
              {[0, 1, 2].map((i) => (
                <label key={i} className="med-field"><small>{"XYZ"[i]}</small>
                  <input className="field" type="number" step={0.1} value={data.center[i]} onChange={(e) => {
                    const c = [...data.center] as [number, number, number];
                    c[i] = Number(e.target.value) || 0;
                    onChange({ ...data, center: c });
                  }} />
                </label>
              ))}
            </div>
            <select className="field" value="" onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith("p")) {
                const p = players.find((x) => `p${x.id}` === v);
                if (p) setCenter([p.pos[0], p.pos[1], p.pos[2] - 1]);
              } else if (v) setCenter(PLACES_3D[Number(v.slice(5))].pos);
            }}>
              <option value="">Déplacer le centre vers…</option>
              {players.length > 0 && <optgroup label="Un joueur en jeu">{players.map((p) => <option key={p.id} value={`p${p.id}`}>{p.name} (#{p.id})</option>)}</optgroup>}
              <optgroup label="Lieux">{PLACES_3D.map((p, i) => <option key={p.name} value={`place${i}`}>{p.name}</option>)}</optgroup>
            </select>
            <label className="med-field"><small>Apparition à moins de {data.distance} m</small>
              <input type="range" min={20} max={500} step={10} value={data.distance} onChange={(e) => onChange({ ...data, distance: Number(e.target.value) })} style={{ accentColor: "var(--accent)" }} />
            </label>
            <small className="muted"><Crosshair size={12} style={{ verticalAlign: "-2px" }} /> Les objets sont placés par rapport à ce centre : déplace-le et toute la scène suit.</small>
          </div>
        )}

        <div className="map-card">
          <b><Boxes size={13} style={{ verticalAlign: "-2px" }} /> Kits prêts à poser</b>
          <div className="studio-examples">
            {PROP_KITS.map((k) => (
              <button key={k.key} type="button" className="perm" draggable onDragStart={dragProp(`kit:${k.key}`)} onClick={() => addKit(k.key)} title={`${k.objects.length} objets : clique (centre de la vue) ou glisse sur la carte`}>
                {k.label}
              </button>
            ))}
          </div>
        </div>

        <div className="map-card">
          <b>Catalogue <span className="muted" style={{ fontWeight: 400 }}>· {data.objects.length} / {LIMITS.objects} objets</span></b>
          <input className="field" placeholder="Chercher un prop" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="pill-tabs" style={{ gap: 4 }}>
            {CATEGORIES.map((c) => <a key={c} href="#" data-on={cat === c} style={{ padding: "3px 9px", fontSize: 11 }} onClick={(e) => { e.preventDefault(); setCat(c); }}>{c}</a>)}
          </div>
          <ul className="map-list" style={{ maxHeight: 260 }}>
            {catalog.map((p) => (
              <li key={p.model} draggable onDragStart={dragProp(p.model)} onClick={() => add(p.model)} title="Clique (centre de la vue) ou glisse sur la carte">
                <i className="med-swatch" style={{ background: CAT_COLORS[p.cat] }} />
                <span style={{ flex: 1, minWidth: 0 }}>{p.label}<br /><code className="muted" style={{ fontSize: 11 }}>{p.model}</code></span>
                <small className="muted">{p.w}×{p.d} m</small>
              </li>
            ))}
          </ul>
          <form style={{ display: "flex", gap: 6 }} onSubmit={(e) => { e.preventDefault(); add(custom.trim()); setCustom(""); }}>
            <input className="field" placeholder="Autre modèle (prop_…)" value={custom} onChange={(e) => setCustom(e.target.value)} spellCheck={false} />
            <button className="btn sm" disabled={!MODEL_RE.test(custom.trim())}>Ajouter</button>
          </form>
        </div>
      </div>
    </div>
  );
}
