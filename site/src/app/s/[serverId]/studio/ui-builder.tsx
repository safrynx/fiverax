"use client";
import { useMemo } from "react";
import { ArrowDown, ArrowUp, Copy, Image, Minus, MousePointerClick, Gauge, Heading, TextCursorInput, Trash2, Type } from "lucide-react";
import {
  ELEMENT_LABEL, FONTS, newElement, POSITIONS, STAT_LABEL, UI_KEYS, UI_TEMPLATES, uiFiles, uiId, uiTests,
  type UIDesign, type UIElement, type UIElementType
} from "@/lib/studio-ui";
import { useUI } from "@/app/ui";
import UIPreview from "./ui-preview";

type Props = { design: UIDesign; onChange: (design: UIDesign) => void; name: string; resource: string };

const ICONS: Record<UIElementType, typeof Type> = { title: Heading, text: Type, button: MousePointerClick, gauge: Gauge, input: TextCursorInput, image: Image, divider: Minus };
const POSITION_LABEL: Record<string, string> = { tl: "En haut à gauche", tc: "En haut", tr: "En haut à droite", ml: "À gauche", mc: "Au centre", mr: "À droite", bl: "En bas à gauche", bc: "En bas", br: "En bas à droite" };

/** The simple UI builder: settings and elements on the left, the page live on the right. */
export default function UIBuilder({ design: d, onChange, name, resource }: Props) {
  const { ask } = useUI();
  const set = (patch: Partial<UIDesign>) => onChange({ ...d, ...patch });
  const setEl = (id: string, patch: Partial<UIElement>) => set({ elements: d.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as UIElement) : e)) });
  const move = (i: number, by: number) => {
    const list = [...d.elements];
    const [e] = list.splice(i, 1);
    list.splice(Math.max(0, Math.min(list.length, i + by)), 0, e);
    set({ elements: list });
  };
  const html = useMemo(() => uiFiles(name, d).find((f) => f.path === "html/index.html")?.content ?? null, [name, d]);
  const tests = useMemo(() => uiTests(d), [d]);
  const autoSend = useMemo(() => [{ action: "open" }, { action: "stats", health: 80, armor: 50, speed: 90 }], []);

  async function applyTemplate(key: string) {
    const t = UI_TEMPLATES.find((x) => x.key === key);
    if (!t) return;
    if (d.elements.length && !(await ask({ title: `Partir du modèle « ${t.label} » ?`, message: "La fenêtre actuelle est remplacée (elle reste dans l'historique une fois enregistrée).", confirmLabel: "Remplacer" }))) return;
    onChange(t.make());
  }

  return (
    <div className="uib">
      <div className="uib-side">
        <div className="map-card">
          <b>Modèles</b>
          <div className="studio-examples">
            {UI_TEMPLATES.map((t) => <button key={t.key} type="button" className="perm" onClick={() => applyTemplate(t.key)}>{t.label}</button>)}
          </div>
        </div>

        <div className="map-card">
          <b>Ouverture</b>
          <div className="seg">
            {([["always", "Toujours affichée"], ["command", "Par une commande"], ["key", "Par une touche"]] as const).map(([k, l]) => (
              <button key={k} type="button" data-on={d.open === k} onClick={() => set({ open: k })}>{l}</button>
            ))}
          </div>
          {d.open !== "always" ? (
            <div className="uib-row">
              <label className="med-field"><small>Commande</small>
                <div className="uib-prefix"><span>/</span><input className="field" value={d.command} maxLength={32} onChange={(e) => set({ command: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} /></div>
              </label>
              {d.open === "key" && (
                <label className="med-field"><small>Touche</small>
                  <select className="field" value={d.key} onChange={(e) => set({ key: e.target.value })}>{UI_KEYS.map((k) => <option key={k}>{k}</option>)}</select>
                </label>
              )}
            </div>
          ) : (
            <small className="muted">Comme un HUD : visible tout le temps, on ne peut pas cliquer dessus (boutons et champs inutiles).</small>
          )}
          {d.open !== "always" && <small className="muted">Échap ferme la fenêtre.</small>}
        </div>

        <div className="map-card">
          <b>Apparence</b>
          <div className="uib-look">
            <div className="uib-pos" role="group" aria-label="Position">
              {POSITIONS.map((p) => <button key={p} type="button" title={POSITION_LABEL[p]} data-on={d.position === p} onClick={() => set({ position: p })} />)}
            </div>
            <div className="uib-look-fields">
              <label className="med-field"><small>Thème</small>
                <select className="field" value={d.theme} onChange={(e) => set({ theme: e.target.value as UIDesign["theme"] })}>
                  <option value="dark">Sombre</option><option value="light">Clair</option><option value="glass">Verre (transparent)</option>
                </select>
              </label>
              <label className="med-field"><small>Police</small>
                <select className="field" value={d.font} onChange={(e) => set({ font: e.target.value as UIDesign["font"] })}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select>
              </label>
            </div>
          </div>
          <div className="uib-row">
            <label className="med-field"><small>Couleur</small>
              <input type="color" className="uib-color" value={d.accent} onChange={(e) => set({ accent: e.target.value })} />
            </label>
            <label className="med-field" style={{ flex: 2 }}><small>Largeur : {d.width} px</small>
              <input type="range" min={160} max={900} step={10} value={d.width} onChange={(e) => set({ width: Number(e.target.value) })} style={{ accentColor: "var(--accent)" }} />
            </label>
            <label className="med-field" style={{ flex: 2 }}><small>Arrondi : {d.radius} px</small>
              <input type="range" min={0} max={32} value={d.radius} onChange={(e) => set({ radius: Number(e.target.value) })} style={{ accentColor: "var(--accent)" }} />
            </label>
          </div>
        </div>

        <div className="map-card">
          <b>Éléments <span className="muted" style={{ fontWeight: 400 }}>· {d.elements.length} / 40</span></b>
          <div className="uib-add">
            {(Object.keys(ELEMENT_LABEL) as UIElementType[]).map((t) => {
              const Icon = ICONS[t];
              return <button key={t} type="button" className="perm" disabled={d.elements.length >= 40} onClick={() => set({ elements: [...d.elements, newElement(t)] })}><Icon size={12} /> {ELEMENT_LABEL[t]}</button>;
            })}
          </div>
          {d.elements.length === 0 && <small className="muted">Ajoute un élément avec les boutons ci-dessus.</small>}
          <ul className="uib-list">
            {d.elements.map((e, i) => {
              const Icon = ICONS[e.type];
              return (
                <li key={e.id}>
                  <div className="uib-el-head">
                    <span><Icon size={13} /> {ELEMENT_LABEL[e.type]}</span>
                    <span className="uib-el-tools">
                      <button type="button" className="ibtn" title="Monter" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={12} /></button>
                      <button type="button" className="ibtn" title="Descendre" disabled={i === d.elements.length - 1} onClick={() => move(i, 1)}><ArrowDown size={12} /></button>
                      <button type="button" className="ibtn" title="Dupliquer" onClick={() => set({ elements: [...d.elements.slice(0, i + 1), { ...e, id: uiId() }, ...d.elements.slice(i + 1)] })}><Copy size={12} /></button>
                      <button type="button" className="ibtn bad" title="Supprimer" onClick={() => set({ elements: d.elements.filter((x) => x.id !== e.id) })}><Trash2 size={12} /></button>
                    </span>
                  </div>
                  <ElementFields e={e} onChange={(patch) => setEl(e.id, patch)} />
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="uib-preview">
        <UIPreview html={html} resource={resource} tests={tests} onLoadSend={autoSend} />
      </div>
    </div>
  );
}

function ElementFields({ e, onChange }: { e: UIElement; onChange: (patch: Partial<UIElement>) => void }) {
  switch (e.type) {
    case "title":
      return <input className="field" value={e.text} maxLength={120} onChange={(ev) => onChange({ text: ev.target.value })} />;
    case "text":
      return <textarea className="field" rows={2} value={e.text} maxLength={2000} onChange={(ev) => onChange({ text: ev.target.value })} />;
    case "divider":
      return null;
    case "image":
      return <input className="field" value={e.url} placeholder="https://… (adresse d'une image)" onChange={(ev) => onChange({ url: ev.target.value.trim() })} />;
    case "input":
      return (
        <div className="uib-row">
          <input className="field" value={e.label} maxLength={60} placeholder="Libellé" onChange={(ev) => onChange({ label: ev.target.value })} />
          <input className="field" value={e.placeholder} maxLength={60} placeholder="Exemple affiché" onChange={(ev) => onChange({ placeholder: ev.target.value })} />
        </div>
      );
    case "gauge":
      return (
        <div className="uib-row">
          <input className="field" value={e.label} maxLength={40} placeholder="Libellé" onChange={(ev) => onChange({ label: ev.target.value })} />
          <select className="field" value={e.stat} onChange={(ev) => onChange({ stat: ev.target.value as typeof e.stat })}>
            {Object.entries(STAT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input type="color" className="uib-color" value={e.color} onChange={(ev) => onChange({ color: ev.target.value })} />
        </div>
      );
    case "button":
      return (
        <div style={{ display: "grid", gap: 6 }}>
          <div className="uib-row">
            <input className="field" value={e.text} maxLength={60} placeholder="Texte du bouton" onChange={(ev) => onChange({ text: ev.target.value })} />
            <select className="field" value={e.style} onChange={(ev) => onChange({ style: ev.target.value as typeof e.style })}>
              <option value="primary">Plein</option><option value="ghost">Contour</option>
            </select>
          </div>
          <div className="uib-row">
            <select className="field" value={e.action} onChange={(ev) => onChange({ action: ev.target.value as typeof e.action })}>
              <option value="close">Ferme la fenêtre</option><option value="command">Lance une commande</option>
            </select>
            {e.action === "command" && (
              <div className="uib-prefix"><span>/</span><input className="field" value={e.command} maxLength={32} placeholder="repair" onChange={(ev) => onChange({ command: ev.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} /></div>
            )}
          </div>
          {e.action === "command" && <small className="muted">Ce qui est écrit dans les champs est ajouté après la commande (ex. /don 500).</small>}
        </div>
      );
  }
}
