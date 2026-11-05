"use client";
import { useMemo, useState } from "react";
import type { CreationData } from "@/lib/studio";
import { cleanMap, propOf, type CreationKind, type StudioFile } from "@/lib/studio-shared";
import { cleanUIDesign, uiTests } from "@/lib/studio-ui";
import CodeEditor from "../studio/code-editor";
import UIPreview from "../studio/ui-preview";

/** Read-only look at a library item: the UI running, the mapping seen from above, and every file. */
export default function ItemPreview({ kind, resource, files, data }: { kind: CreationKind; resource: string; files: StudioFile[]; data: CreationData }) {
  const [tab, setTab] = useState<string>(kind === "script" ? `file:${files[0]?.path ?? ""}` : "preview");
  const html = files.find((f) => f.path.endsWith("index.html"))?.content ?? files.find((f) => f.path.endsWith(".html"))?.content ?? null;
  const tests = useMemo(() => (kind === "ui" && data.mode === "visual" ? uiTests(cleanUIDesign(data.ui)) : data.tests ?? []), [kind, data]);
  const open = tab.startsWith("file:") ? files.find((f) => f.path === tab.slice(5)) ?? null : null;

  return (
    <div className="studio-main">
      <div className="studio-tabs">
        {kind !== "script" && <button type="button" data-on={tab === "preview"} onClick={() => setTab("preview")}>Aperçu</button>}
        {files.map((f) => <button key={f.path} type="button" data-on={tab === `file:${f.path}`} onClick={() => setTab(`file:${f.path}`)}>{f.path}</button>)}
      </div>
      {tab === "preview" && kind === "ui" && <UIPreview html={html} resource={resource} tests={tests} />}
      {tab === "preview" && kind === "map" && <MapPlot data={data} />}
      {open && <CodeEditor value={open.content} readOnly />}
    </div>
  );
}

/** The mapping's objects seen from above, to scale (north up). */
function MapPlot({ data }: { data: CreationData }) {
  const map = useMemo(() => cleanMap(data.map), [data.map]);
  const extent = Math.max(10, ...map.objects.map((o) => Math.max(Math.abs(o.x), Math.abs(o.y)) + 3));
  if (map.objects.length === 0) return <p className="muted">Mapping vide.</p>;
  return (
    <div style={{ border: "1px solid var(--line-2)", borderRadius: 14, overflow: "hidden", background: "radial-gradient(circle at 50% 50%, rgba(var(--accent-rgb),0.06), transparent 70%), #0d0b07" }}>
      <svg viewBox={`${-extent} ${-extent} ${extent * 2} ${extent * 2}`} style={{ display: "block", width: "100%", height: "min(62vh, 560px)" }}>
        <line x1={-extent} y1={0} x2={extent} y2={0} stroke="rgba(255,255,255,0.06)" strokeWidth={extent / 300} />
        <line x1={0} y1={-extent} x2={0} y2={extent} stroke="rgba(255,255,255,0.06)" strokeWidth={extent / 300} />
        {map.objects.map((o) => {
          const p = propOf(o.model);
          const w = p?.w ?? 1;
          const d = p?.d ?? 1;
          return (
            <g key={o.id} transform={`translate(${o.x} ${-o.y}) rotate(${-o.heading})`}>
              <rect x={-w / 2} y={-d / 2} width={w} height={d} rx={Math.min(w, d) / 6} fill="rgba(var(--accent-rgb),0.35)" stroke="var(--accent)" strokeWidth={extent / 400}>
                <title>{p?.label ?? o.model}</title>
              </rect>
            </g>
          );
        })}
        <text x={-extent + extent / 30} y={-extent + extent / 12} fill="var(--muted)" fontSize={extent / 16}>N ↑</text>
      </svg>
      <p className="muted" style={{ fontSize: 12, margin: 0, padding: "8px 12px" }}>{map.objects.length} objet(s) · vue de dessus · la position est choisie à l&apos;installation, dans le Mapping Creator.</p>
    </div>
  );
}
