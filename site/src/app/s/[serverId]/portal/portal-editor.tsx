"use client";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, ExternalLink, Eye, EyeOff, Plus, Save, Send, Trash2, Undo2 } from "lucide-react";
import {
  BLOCK_TYPES, BLOCKS, blockFields, cleanDesign, newBlock, MAX_BLOCKS,
  type Field, type FieldValue, type ListItem, type PortalBlock, type PortalContext, type PortalDesign
} from "@/lib/portal-site-shared";
import type { PortalSite } from "@/lib/portal-site";
import CopyText from "@/app/copy-text";
import PortalView from "@/app/joueur/portal-view";
import { describeApiError, useServerPaths, useUI } from "@/app/ui";

type Props = { initial: PortalSite; demo: PortalContext; appUrl: string };

const toLocal = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Block editor of the server's player portal, with the live preview next to it. */
export default function PortalEditor({ initial, demo, appUrl }: Props) {
  const paths = useServerPaths();
  const { toast, ask } = useUI();
  const [site, setSite] = useState(initial);
  const [design, setDesign] = useState<PortalDesign>(initial.draft);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const saved = JSON.stringify(cleanDesign(design)) === JSON.stringify(site.draft);
  const link = `${appUrl}/joueur/${site.slug}`;
  const ctx = useMemo(() => ({ ...demo, slug: site.slug }), [demo, site.slug]);

  async function call(action: string, body: unknown = {}) {
    const res = await fetch(paths.api(`portal?action=${action}`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : { error: "network" };
    if (!res?.ok) {
      toast(res ? describeApiError(data, res.status) : "Impossible de joindre le panel.", "error");
      return null;
    }
    return data as PortalSite;
  }

  async function save(): Promise<boolean> {
    setBusy("save");
    try {
      const next = await call("save", { design });
      if (!next) return false;
      setSite(next);
      setDesign(next.draft);
      return true;
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    if (!saved && !(await save())) return;
    setBusy("publish");
    try {
      const next = await call("publish");
      if (next) {
        setSite(next);
        toast("Portail publié : tes joueurs voient la nouvelle version.", "ok");
      }
    } finally {
      setBusy(null);
    }
  }

  async function unpublish() {
    setBusy("unpublish");
    try {
      const next = await call("unpublish");
      if (next) {
        setSite(next);
        toast("Portail retiré : la page n'est plus visible.", "ok");
      }
    } finally {
      setBusy(null);
    }
  }

  async function changeSlug() {
    const answer = await ask({ title: "Adresse du portail", message: "Lettres minuscules, chiffres et tirets.", input: { label: "Adresse", initial: site.slug, required: true }, confirmLabel: "Changer" });
    if (!answer?.value || answer.value === site.slug) return;
    const next = await call("slug", { slug: answer.value });
    if (next) {
      setSite(next);
      toast("Adresse changée.", "ok");
    }
  }

  const setBlock = (id: string, change: (b: PortalBlock) => PortalBlock) => setDesign((d) => ({ ...d, blocks: d.blocks.map((b) => (b.id === id ? change(b) : b)) }));
  const move = (i: number, by: number) => setDesign((d) => {
    const blocks = [...d.blocks];
    const [b] = blocks.splice(i, 1);
    blocks.splice(Math.max(0, Math.min(blocks.length, i + by)), 0, b);
    return { ...d, blocks };
  });
  const add = (type: PortalBlock["type"]) => {
    const block = newBlock(type);
    setDesign((d) => ({ ...d, blocks: [...d.blocks, block] }));
    setOpen(block.id);
    setAdding(false);
  };

  return (
    <>
      <div className="pe-bar rise rise-1" style={{ marginBottom: 16 }}>
        <button className="btn" disabled={saved || busy !== null} onClick={save}><Save size={14} />{saved ? "Enregistré" : busy === "save" ? "Enregistrement…" : "Enregistrer le brouillon"}</button>
        <button className="btn primary" disabled={busy !== null || (saved && !site.dirty && Boolean(site.published))} onClick={publish}><Send size={14} />{site.published ? "Publier les changements" : "Publier le portail"}</button>
        {site.published && <button className="btn" disabled={busy !== null} onClick={unpublish}><EyeOff size={14} />Dépublier</button>}
        {!saved && <button className="btn" onClick={() => setDesign(site.draft)}><Undo2 size={14} />Annuler les changements</button>}
        <span className="tag" data-tone={site.published ? "up" : undefined}>{site.published ? (site.dirty || !saved ? "Publié · brouillon modifié" : "Publié") : "Brouillon"}</span>
      </div>
      <div className="pe-bar" style={{ marginBottom: 20 }}>
        <code className="gx-link" style={{ fontSize: 13 }}>{link}</code>
        <CopyText text={link} label="Copier le lien" />
        <a href={`/joueur/${site.slug}${site.published && saved && !site.dirty ? "" : "?preview=1"}`} target="_blank" rel="noopener" className="btn sm"><ExternalLink size={13} />Ouvrir</a>
        <button className="btn sm" onClick={changeSlug}>Changer l&apos;adresse</button>
      </div>

      <div className="pe">
        <div className="pe-side">
          <section className="pe-block">
            <div className="pe-block-head"><button type="button" onClick={() => setOpen(open === "_page" ? null : "_page")}>{open === "_page" ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<b>Page</b><small>titre, logo, bannière, couleur</small></button></div>
            {open === "_page" && (
              <div className="pe-block-body">
                <label className="pe-field"><span>Titre</span><input className="field" maxLength={80} value={design.title} onChange={(e) => setDesign({ ...design, title: e.target.value })} /></label>
                <label className="pe-field"><span>Accroche</span><input className="field" maxLength={200} value={design.tagline} onChange={(e) => setDesign({ ...design, tagline: e.target.value })} /></label>
                <label className="pe-field"><span>Logo (lien https)</span><input className="field" value={design.logo} onChange={(e) => setDesign({ ...design, logo: e.target.value })} /></label>
                <label className="pe-field"><span>Bannière (lien https)</span><input className="field" value={design.banner} onChange={(e) => setDesign({ ...design, banner: e.target.value })} /></label>
                <label className="pe-field"><span>Couleur principale</span><input type="color" value={design.accent} onChange={(e) => setDesign({ ...design, accent: e.target.value })} style={{ width: 64, height: 34, padding: 0, border: 0, background: "none" }} /></label>
              </div>
            )}
          </section>

          {design.blocks.map((b, i) => (
            <section key={b.id} className="pe-block" data-hidden={b.hidden}>
              <div className="pe-block-head">
                <button type="button" onClick={() => setOpen(open === b.id ? null : b.id)}>
                  {open === b.id ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  <b>{BLOCKS[b.type].label}</b>
                  <small>{String(b.p.title ?? b.p.prize ?? "")}</small>
                </button>
                <button className="ibtn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Monter"><ArrowUp size={14} /></button>
                <button className="ibtn" onClick={() => move(i, 1)} disabled={i === design.blocks.length - 1} aria-label="Descendre"><ArrowDown size={14} /></button>
                <button className="ibtn" onClick={() => setBlock(b.id, (x) => ({ ...x, hidden: !x.hidden }))} aria-label={b.hidden ? "Afficher" : "Masquer"} title={b.hidden ? "Afficher" : "Masquer"}>{b.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                <button className="ibtn" onClick={() => setDesign((d) => ({ ...d, blocks: [...d.blocks.slice(0, i + 1), { ...newBlock(b.type), p: structuredClone(b.p) }, ...d.blocks.slice(i + 1)] }))} aria-label="Dupliquer" title="Dupliquer"><Copy size={14} /></button>
                <button className="ibtn" onClick={async () => {
                  if (b.type === "form" || b.type === "giveaway") {
                    const ok = await ask({ title: "Supprimer ce bloc ?", message: "Les réponses et inscriptions déjà reçues restent dans les onglets Réponses et Giveaways.", confirmLabel: "Supprimer", danger: true });
                    if (!ok) return;
                  }
                  setDesign((d) => ({ ...d, blocks: d.blocks.filter((x) => x.id !== b.id) }));
                }} aria-label="Supprimer" title="Supprimer"><Trash2 size={14} /></button>
              </div>
              {open === b.id && (
                <div className="pe-block-body">
                  <small className="muted">{BLOCKS[b.type].lead}</small>
                  {blockFields(b.type).map((f) => (
                    <FieldInput key={f.key} field={f} value={b.p[f.key]} onChange={(v) => setBlock(b.id, (x) => ({ ...x, p: { ...x.p, [f.key]: v } }))} />
                  ))}
                </div>
              )}
            </section>
          ))}

          {design.blocks.length < MAX_BLOCKS && (adding ? (
            <div className="pe-add">
              {BLOCK_TYPES.map((t) => <button key={t} type="button" onClick={() => add(t)}><b>{BLOCKS[t].label}</b><small>{BLOCKS[t].lead}</small></button>)}
            </div>
          ) : <button className="btn" onClick={() => setAdding(true)}><Plus size={14} />Ajouter un bloc</button>)}
        </div>

        <div className="pe-preview" aria-label="Aperçu">
          <small className="eyebrow">Aperçu (les boutons ne font rien ici)</small>
          <PortalView design={cleanDesign(design)} ctx={ctx} mode="preview" />
        </div>
      </div>
    </>
  );
}

function FieldInput({ field: f, value, onChange }: { field: Field; value: FieldValue | undefined; onChange: (v: FieldValue) => void }) {
  const hint = f.hint ? <small>{f.hint}</small> : null;
  switch (f.kind) {
    case "text":
      return <label className="pe-field"><span>{f.label}</span><input className="field" maxLength={f.max} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />{hint}</label>;
    case "textarea":
      return <label className="pe-field"><span>{f.label}</span><textarea className="field" rows={f.max > 1000 ? 6 : 3} maxLength={f.max} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />{hint}</label>;
    case "url":
      return <label className="pe-field"><span>{f.label}</span><input className="field" inputMode="url" placeholder="https://…" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />{hint}</label>;
    case "datetime":
      return <label className="pe-field"><span>{f.label}</span><input className="field" type="datetime-local" value={toLocal(String(value ?? ""))} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : "")} />{hint}</label>;
    case "select":
      return <label className="pe-field"><span>{f.label}</span><select className="field" value={String(value)} onChange={(e) => onChange(e.target.value)}>{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>{hint}</label>;
    case "number":
      return <label className="pe-field"><span>{f.label}</span><input className="field" type="number" min={f.min} max={f.max} value={Number(value ?? f.def)} onChange={(e) => onChange(Number(e.target.value))} />{hint}</label>;
    case "bool":
      return <label className="check"><input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />{f.label}</label>;
    case "list": {
      const items = Array.isArray(value) ? (value as ListItem[]) : [];
      const set = (next: ListItem[]) => onChange(next);
      const patch = (i: number, key: string, v: string) => set(items.map((x, j) => (j === i ? { ...x, [key]: v } : x)));
      return (
        <div className="pe-field">
          <span>{f.label}</span>
          <div className="pe-list">
            {items.map((it, i) => (
              <div key={i} className="pe-list-item">
                <div className="pe-list-tools">
                  <small>#{i + 1}</small>
                  <button type="button" className="ibtn" disabled={i === 0} onClick={() => set([...items.slice(0, i - 1), it, items[i - 1], ...items.slice(i + 1)])} aria-label="Monter"><ArrowUp size={13} /></button>
                  <button type="button" className="ibtn" disabled={i === items.length - 1} onClick={() => set([...items.slice(0, i), items[i + 1], it, ...items.slice(i + 2)])} aria-label="Descendre"><ArrowDown size={13} /></button>
                  <button type="button" className="ibtn" onClick={() => set(items.filter((_, j) => j !== i))} aria-label="Supprimer"><Trash2 size={13} /></button>
                </div>
                {f.fields.map((sf) =>
                  sf.kind === "textarea" ? <textarea key={sf.key} className="field" rows={2} placeholder={sf.label} maxLength={sf.max} value={it[sf.key] ?? ""} onChange={(e) => patch(i, sf.key, e.target.value)} />
                  : sf.kind === "select" ? <select key={sf.key} className="field" value={it[sf.key] ?? ""} onChange={(e) => patch(i, sf.key, e.target.value)}>{sf.options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  : sf.kind === "bool" ? <label key={sf.key} className="check"><input type="checkbox" checked={it[sf.key] === "1"} onChange={(e) => patch(i, sf.key, e.target.checked ? "1" : "")} />{sf.label}</label>
                  : sf.key === "options" && it.type !== "select" ? null
                  : <input key={sf.key} className="field" placeholder={sf.label} maxLength={sf.kind === "url" ? 500 : sf.max} value={it[sf.key] ?? ""} onChange={(e) => patch(i, sf.key, e.target.value)} />
                )}
              </div>
            ))}
          </div>
          {items.length < f.max && (
            <button type="button" className="btn sm" onClick={() => set([...items, Object.fromEntries(f.fields.map((sf) => [sf.key, sf.kind === "select" ? sf.options?.[0]?.[0] ?? "" : ""]))])}><Plus size={13} />Ajouter</button>
          )}
          {hint}
        </div>
      );
    }
  }
}
