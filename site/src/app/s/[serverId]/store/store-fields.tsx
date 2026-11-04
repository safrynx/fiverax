"use client";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { cleanUrl, type Field, type FieldValue, type ListItem, type StoreData } from "@/lib/store-design";
import { formatMoney } from "@/lib/tebex-shared";

type Props = { field: Field; value: FieldValue; data: StoreData; onChange: (value: FieldValue) => void };

/** One control per field kind of a block (text, link, package picker, list…). */
export function FieldInput({ field: f, value, data, onChange }: Props) {
  const hint = f.hint ? <small className="se-hint">{f.hint}</small> : null;
  const packages = data.categories.flatMap((c) => c.packages.map((p) => ({ ...p, category: c.name })));

  switch (f.kind) {
    case "text":
      return <label className="se-field"><span>{f.label}</span><input className="field" value={String(value ?? "")} maxLength={f.max} onChange={(e) => onChange(e.target.value)} />{hint}</label>;
    case "textarea":
      return <label className="se-field"><span>{f.label}</span><textarea className="field" rows={f.max > 500 ? 6 : 3} value={String(value ?? "")} maxLength={f.max} onChange={(e) => onChange(e.target.value)} />{hint}</label>;
    case "url":
      return <label className="se-field"><span>{f.label}</span><input className="field" type="url" inputMode="url" placeholder="https://…" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />{value && !cleanUrl(value) ? <small className="se-bad">Lien https complet requis (ignoré sinon)</small> : hint}</label>;
    case "date":
      return <label className="se-field"><span>{f.label}</span><input className="field" type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />{hint}</label>;
    case "select":
      return (
        <label className="se-field"><span>{f.label}</span>
          <select className="field" value={String(value)} onChange={(e) => onChange(e.target.value)}>{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>{hint}
        </label>
      );
    case "number":
      return (
        <label className="se-field"><span>{f.label} · {String(value)}</span>
          <input type="range" min={f.min} max={f.max} value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} />{hint}
        </label>
      );
    case "bool":
      return <label className="se-toggle"><input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} /><span>{f.label}</span></label>;
    case "package":
      return (
        <label className="se-field"><span>{f.label}</span>
          <select className="field" value={value === null ? "" : String(value)} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— Choisir —</option>
            {data.categories.map((c) => (
              <optgroup key={c.id} label={c.name}>{c.packages.map((p) => <option key={p.id} value={p.id}>{p.name} · {formatMoney(p.price, p.currency)}</option>)}</optgroup>
            ))}
          </select>{hint}
        </label>
      );
    case "goal":
      return (
        <label className="se-field"><span>{f.label}</span>
          <select className="field" value={value === null ? "" : String(value)} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Automatique (premier actif)</option>
            {data.goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>{hint}
        </label>
      );
    case "category":
      return (
        <label className="se-field"><span>{f.label}</span>
          <select className="field" value={value === null ? "" : String(value)} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— Choisir —</option>
            {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>{hint}
        </label>
      );
    case "packages":
    case "categories": {
      const chosen = Array.isArray(value) ? (value as number[]) : [];
      const options = f.kind === "packages" ? packages.map((p) => ({ id: p.id, label: p.name, sub: `${p.category} · ${formatMoney(p.price, p.currency)}` })) : data.categories.map((c) => ({ id: c.id, label: c.name, sub: `${c.packages.length} package(s)` }));
      const toggle = (id: number) => onChange(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id].slice(0, f.max));
      return (
        <div className="se-field">
          <span>{f.label}{chosen.length ? ` · ${chosen.length} choisi(s)` : ""}</span>
          {options.length === 0 && <small className="se-hint">Rien dans le catalogue Tebex pour l&apos;instant.</small>}
          <div className="se-picks">
            {options.map((o) => (
              <button key={o.id} type="button" className="se-pick" data-on={chosen.includes(o.id) || undefined} onClick={() => toggle(o.id)}>
                <b>{o.label}</b><small>{o.sub}</small>{chosen.includes(o.id) && <i>{chosen.indexOf(o.id) + 1}</i>}
              </button>
            ))}
          </div>
          {hint}
        </div>
      );
    }
    case "list": {
      const items = Array.isArray(value) ? (value as ListItem[]) : [];
      const set = (list: ListItem[]) => onChange(list);
      const move = (i: number, by: number) => {
        const list = [...items];
        const [x] = list.splice(i, 1);
        list.splice(Math.max(0, Math.min(list.length, i + by)), 0, x);
        set(list);
      };
      return (
        <div className="se-field">
          <span>{f.label}</span>
          <div className="se-list">
            {items.map((it, i) => (
              <div key={i} className="se-list-item">
                <div className="se-list-tools">
                  <small>#{i + 1}</small>
                  <button type="button" className="ibtn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Monter"><ArrowUp size={13} /></button>
                  <button type="button" className="ibtn" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Descendre"><ArrowDown size={13} /></button>
                  <button type="button" className="ibtn" onClick={() => set(items.filter((_, j) => j !== i))} aria-label="Supprimer"><Trash2 size={13} /></button>
                </div>
                {f.fields.map((sf) => sf.kind === "textarea"
                  ? <textarea key={sf.key} className="field" rows={2} placeholder={sf.label} maxLength={sf.max} value={it[sf.key] ?? ""} onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, [sf.key]: e.target.value } : x)))} />
                  : <input key={sf.key} className="field" placeholder={sf.label} maxLength={sf.kind === "url" ? 500 : sf.max} value={it[sf.key] ?? ""} onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, [sf.key]: e.target.value } : x)))} />)}
              </div>
            ))}
          </div>
          {items.length < f.max && (
            <button type="button" className="btn" onClick={() => set([...items, Object.fromEntries(f.fields.map((sf) => [sf.key, ""]))])}><Plus size={14} />Ajouter</button>
          )}
          {hint}
        </div>
      );
    }
  }
}
