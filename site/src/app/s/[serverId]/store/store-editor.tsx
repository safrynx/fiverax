"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown, ArrowUp, Copy, ExternalLink, Eye, EyeOff, History, Laptop, LayoutGrid, Palette, Plus, Rocket, Settings2, Smartphone, Sparkles, Trash2, Wand2
} from "lucide-react";
import {
  BLOCK_TYPES, BLOCKS, blockFields, blockId, cleanStoreDesign, cleanUrl, connectLink, isValidStoreSlug, MAX_BLOCKS, newBlock, PRESETS, starterDesign, STORE_FONTS,
  type BlockType, type FieldValue, type StoreBlock, type StoreData, type StoreDesign, type StoreTheme
} from "@/lib/store-design";
import type { StoreVersion } from "@/lib/store";
import { formatDateTime } from "@/lib/format";
import CopyButton from "@/app/copy-button";
import { describeApiError, useServerPaths, useUI } from "@/app/ui";
import StoreView from "@/app/store/store-view";
import { FieldInput } from "./store-fields";
import "./editor.css";

type Props = {
  initial: StoreDesign; data: StoreData; slug: string; publishedAt: string | null; dirty: boolean;
  storeUrl: string; versions: StoreVersion[]; aiReady: boolean; serverName: string;
};
type Tab = "blocks" | "style" | "ai" | "settings" | "versions";

const TABS: { key: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { key: "blocks", label: "Blocs", icon: LayoutGrid },
  { key: "style", label: "Style", icon: Palette },
  { key: "ai", label: "IA", icon: Sparkles },
  { key: "settings", label: "Réglages", icon: Settings2 },
  { key: "versions", label: "Historique", icon: History }
];

const AI_EXAMPLES = [
  "Une boutique néon cyberpunk, très immersive, avec le VIP mis en avant et un compte à rebours de promo",
  "Style luxe noir et or, sobre, avec une FAQ complète sur la livraison et les remboursements",
  "Réécris tous les textes pour un serveur RP police / gangs, ton percutant",
  "Ajoute une section arguments et le meilleur soutien du mois, puis réorganise la page pour vendre plus",
  "Passe en thème clair minimaliste, très lisible sur mobile"
];
const SOURCE_LABEL: Record<string, string> = { publish: "Publication", ai: "IA", restore: "Restauration", manual: "Manuel" };
const COLORS: [keyof StoreTheme, string][] = [["bg", "Fond"], ["surface", "Cartes"], ["text", "Texte"], ["muted", "Texte secondaire"], ["accent", "Accent"], ["accent2", "Accent 2"]];

export default function StoreEditor(props: Props) {
  const router = useRouter();
  const { ask, toast } = useUI();
  const paths = useServerPaths();
  const [design, setDesign] = useState<StoreDesign>(props.initial);
  const [tab, setTab] = useState<Tab>("blocks");
  const [selected, setSelected] = useState<string | null>(props.initial.blocks[0]?.id ?? null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [save, setSave] = useState<"saved" | "pending" | "saving" | "error">("saved");
  const [dirty, setDirty] = useState(props.dirty);
  const [publishedAt, setPublishedAt] = useState(props.publishedAt);
  const [slug, setSlug] = useState(props.slug);
  const [slugInput, setSlugInput] = useState(props.slug);
  const [busy, setBusy] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [aiLog, setAiLog] = useState<{ prompt: string; summary: string }[]>([]);
  const savedJson = useRef(JSON.stringify(props.initial));

  const preview = useMemo(() => cleanStoreDesign(design), [design]);
  const storeUrl = props.storeUrl.replace(/\/store\/[^/]+$/, `/store/${slug}`);

  const api = useCallback(async (kind: string, body: unknown): Promise<Record<string, unknown> | null> => {
    try {
      const res = await fetch(paths.api(`store?kind=${kind}`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(storeError(data.error) ?? describeApiError(data, res.status), "error");
        return null;
      }
      return data;
    } catch {
      toast("Impossible de joindre le panel.", "error");
      return null;
    }
  }, [paths, toast]);

  /** A design that came from the server (AI, restore): shown as is, not saved again. */
  const adopt = useCallback((next: StoreDesign) => {
    savedJson.current = JSON.stringify(next);
    setDesign(next);
    setSave("saved");
  }, []);

  // Auto-save the draft 1 s after the last change.
  useEffect(() => {
    const json = JSON.stringify(design);
    if (json === savedJson.current) return;
    setSave("pending");
    const timer = window.setTimeout(async () => {
      setSave("saving");
      const r = await api("save", { design });
      if (r) {
        savedJson.current = json;
        setDirty(Boolean(r.dirty));
        setSave("saved");
      } else setSave("error");
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [design, api]);

  // Leaving with unsaved changes.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (save !== "saved") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save]);

  // ---- edits ----
  const patch = (p: Partial<StoreDesign>) => setDesign((d) => ({ ...d, ...p }));
  const setTheme = (p: Partial<StoreTheme>) => setDesign((d) => ({ ...d, theme: { ...d.theme, ...p } }));
  const setBrand = (p: Partial<StoreDesign["brand"]>) => setDesign((d) => ({ ...d, brand: { ...d.brand, ...p } }));
  const setBlocks = (fn: (blocks: StoreBlock[]) => StoreBlock[]) => setDesign((d) => ({ ...d, blocks: fn(d.blocks) }));
  const setProp = (id: string, key: string, value: FieldValue) => setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, p: { ...b.p, [key]: value } } : b)));

  function addBlock(type: BlockType) {
    if (design.blocks.length >= MAX_BLOCKS) return toast(`${MAX_BLOCKS} blocs au maximum.`, "error");
    const first = props.data.categories.flatMap((c) => c.packages)[0];
    const block = newBlock(type, type === "featured" && first ? { packageId: first.id } : {});
    const at = selected ? design.blocks.findIndex((b) => b.id === selected) + 1 : design.blocks.length;
    setBlocks((bs) => [...bs.slice(0, at), block, ...bs.slice(at)]);
    setSelected(block.id);
    window.setTimeout(() => document.getElementById(block.id)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  }
  const move = (i: number, by: number) => setBlocks((bs) => {
    const list = [...bs];
    const [b] = list.splice(i, 1);
    list.splice(Math.max(0, Math.min(list.length, i + by)), 0, b);
    return list;
  });
  const duplicate = (b: StoreBlock) => {
    if (design.blocks.length >= MAX_BLOCKS) return;
    const copy = { ...structuredClone(b), id: blockId() };
    setBlocks((bs) => {
      const i = bs.findIndex((x) => x.id === b.id);
      return [...bs.slice(0, i + 1), copy, ...bs.slice(i + 1)];
    });
    setSelected(copy.id);
  };
  async function remove(b: StoreBlock) {
    if (await ask({ title: `Supprimer « ${BLOCKS[b.type].label} » ?`, message: "Tu peux revenir en arrière avec l'Historique si la boutique a été publiée entre-temps.", confirmLabel: "Supprimer", danger: true })) {
      setBlocks((bs) => bs.filter((x) => x.id !== b.id));
      if (selected === b.id) setSelected(null);
    }
  }

  const selectFromPreview = (id: string) => {
    setSelected(id);
    setTab("blocks");
    window.setTimeout(() => document.getElementById(`se-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 40);
  };

  async function applyPreset(key: string, full: boolean) {
    const preset = PRESETS.find((p) => p.key === key);
    if (!preset) return;
    if (full) {
      if (!(await ask({ title: `Repartir du modèle « ${preset.label} » ?`, message: "Tous les blocs sont remplacés par une page complète prête à l'emploi (l'Historique garde les versions publiées).", confirmLabel: "Remplacer la page", danger: true }))) return;
      const first = props.data.categories.flatMap((c) => c.packages)[0];
      const next = starterDesign(key, { name: design.brand.name || props.serverName, firstPackageId: first?.id ?? null, hasGoals: props.data.goals.length > 0, discord: design.brand.discord });
      setDesign({ ...next, brand: design.brand, legal: design.legal, seo: design.seo, checkout: design.checkout, branding: design.branding });
      setSelected(next.blocks[0]?.id ?? null);
    } else {
      patch({ preset: key, theme: { ...preset.theme, backgroundImage: design.theme.backgroundImage } });
    }
  }

  // ---- server actions ----
  async function flush(): Promise<boolean> {
    const json = JSON.stringify(design);
    if (json === savedJson.current) return true;
    const r = await api("save", { design });
    if (!r) return false;
    savedJson.current = json;
    setSave("saved");
    return true;
  }

  async function publish() {
    if (!props.data.categories.length && !(await ask({ title: "Publier sans catalogue ?", message: "Aucun package Tebex n'est lu pour l'instant : les visiteurs ne pourront rien acheter.", confirmLabel: "Publier quand même" }))) return;
    setBusy("publish");
    if (await flush()) {
      const r = await api("publish", {});
      if (r) {
        setPublishedAt(String(r.publishedAt));
        setDirty(false);
        toast(publishedAt ? "Modifications publiées" : "Ta boutique est en ligne !", "ok");
        router.refresh();
      }
    }
    setBusy(null);
  }

  async function unpublish() {
    if (!(await ask({ title: "Mettre la boutique hors ligne ?", message: "L'adresse publique affichera « introuvable » jusqu'à la prochaine publication. Ton brouillon est gardé.", confirmLabel: "Mettre hors ligne", danger: true }))) return;
    setBusy("unpublish");
    if (await api("unpublish", {})) {
      setPublishedAt(null);
      setDirty(true);
      toast("Boutique hors ligne", "ok");
    }
    setBusy(null);
  }

  async function saveSlug() {
    const next = slugInput.trim().toLowerCase();
    if (!isValidStoreSlug(next)) return toast("Adresse invalide : 3 à 40 caractères, minuscules, chiffres et tirets.", "error");
    if (publishedAt && !(await ask({ title: "Changer l'adresse ?", message: "L'ancienne adresse cessera de fonctionner : pense à mettre à jour tes liens (Discord, site, en jeu).", confirmLabel: "Changer" }))) return;
    setBusy("slug");
    const r = await api("slug", { slug: next });
    if (r) {
      setSlug(String(r.slug));
      toast("Adresse enregistrée", "ok");
    }
    setBusy(null);
  }

  async function runAI(text: string) {
    const instruction = text.trim();
    if (instruction.length < 3) return;
    setBusy("ai");
    if (await flush()) {
      const r = await api("ai", { prompt: instruction });
      if (r?.draft) {
        adopt(r.draft as StoreDesign);
        setDirty(true);
        setAiLog((l) => [{ prompt: instruction, summary: String(r.summary ?? "") }, ...l].slice(0, 10));
        setPrompt("");
        setSelected(null);
        toast("L'IA a mis à jour ta boutique", "ok");
        router.refresh();
      }
    }
    setBusy(null);
  }

  async function restore(v: StoreVersion) {
    if (!(await ask({ title: "Restaurer cette version ?", message: "Elle remplace ton brouillon actuel. La page publique ne change qu'à la prochaine publication.", confirmLabel: "Restaurer" }))) return;
    setBusy("restore");
    const r = await api("restore", { versionId: v.id });
    if (r?.draft) {
      adopt(r.draft as StoreDesign);
      setDirty(true);
      toast("Version restaurée dans le brouillon", "ok");
      router.refresh();
    }
    setBusy(null);
  }

  const status = !publishedAt
    ? { tone: "warn", label: "Pas encore en ligne" }
    : dirty
      ? { tone: "info", label: "En ligne · modifications non publiées" }
      : { tone: "up", label: "En ligne · à jour" };
  const saveLabel = { saved: "Enregistré", pending: "Modifié…", saving: "Enregistrement…", error: "Échec de l'enregistrement" }[save];
  const selectedBlock = design.blocks.find((b) => b.id === selected) ?? null;

  return (
    <div className="se">
      <div className="se-bar rise">
        <div className="se-bar-left">
          <span className="tag" data-tone={status.tone}>{status.label}</span>
          <span className="se-save" data-state={save}>{saveLabel}</span>
        </div>
        <div className="se-bar-right">
          <div className="se-device" role="group" aria-label="Aperçu">
            <button type="button" data-on={device === "desktop" || undefined} onClick={() => setDevice("desktop")} aria-label="Ordinateur"><Laptop size={15} /></button>
            <button type="button" data-on={device === "mobile" || undefined} onClick={() => setDevice("mobile")} aria-label="Mobile"><Smartphone size={15} /></button>
          </div>
          <a className="btn" href={`/store/${slug}?draft=1`} target="_blank" rel="noreferrer"><Eye size={15} />Plein écran</a>
          {publishedAt && <a className="btn" href={storeUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Voir en ligne</a>}
          <button type="button" className="btn primary shine" onClick={publish} disabled={busy !== null || (!dirty && Boolean(publishedAt))}>
            <Rocket size={15} />{busy === "publish" ? "Publication…" : publishedAt ? "Publier les modifications" : "Publier la boutique"}
          </button>
        </div>
      </div>

      <div className="se-main">
        <aside className="se-side rise rise-1">
          <div className="se-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}><t.icon size={15} />{t.label}</button>
            ))}
          </div>

          <div className="se-panel">
            {tab === "blocks" && (
              <>
                <div className="se-blocks">
                  {design.blocks.map((b, i) => (
                    <div key={b.id} id={`se-${b.id}`} className="se-block" data-on={selected === b.id || undefined} data-hidden={b.hidden || undefined}>
                      <div className="se-block-head" onClick={() => setSelected(selected === b.id ? null : b.id)}>
                        <span className="se-block-n">{i + 1}</span>
                        <div><b>{BLOCKS[b.type].label}</b><small>{blockSummary(b, props.data)}</small></div>
                        <div className="se-block-tools" onClick={(e) => e.stopPropagation()}>
                          <button type="button" className="ibtn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Monter"><ArrowUp size={13} /></button>
                          <button type="button" className="ibtn" onClick={() => move(i, 1)} disabled={i === design.blocks.length - 1} aria-label="Descendre"><ArrowDown size={13} /></button>
                          <button type="button" className="ibtn" onClick={() => setBlocks((bs) => bs.map((x) => (x.id === b.id ? { ...x, hidden: !x.hidden } : x)))} aria-label={b.hidden ? "Afficher" : "Masquer"}>{b.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                          <button type="button" className="ibtn" onClick={() => duplicate(b)} aria-label="Dupliquer"><Copy size={13} /></button>
                          <button type="button" className="ibtn" onClick={() => remove(b)} aria-label="Supprimer"><Trash2 size={13} /></button>
                        </div>
                      </div>
                      {selected === b.id && selectedBlock && (
                        <div className="se-block-body">
                          <p className="se-hint">{BLOCKS[b.type].lead}</p>
                          {blockFields(b.type).map((f) => <FieldInput key={f.key} field={f} value={b.p[f.key] ?? null} data={props.data} onChange={(v) => setProp(b.id, f.key, v)} />)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="se-add">
                  <div className="se-add-title"><Plus size={14} />Ajouter un bloc{selectedBlock ? " après la sélection" : ""}</div>
                  <div className="se-add-grid">
                    {BLOCK_TYPES.map((type) => (
                      <button key={type} type="button" onClick={() => addBlock(type)} title={BLOCKS[type].lead}><b>{BLOCKS[type].label}</b><small>{BLOCKS[type].lead}</small></button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {tab === "style" && (
              <>
                <div className="se-group-title">Thèmes</div>
                <div className="se-presets">
                  {PRESETS.map((p) => (
                    <div key={p.key} className="se-preset" data-on={design.preset === p.key || undefined}>
                      <button type="button" className="se-preset-swatch" onClick={() => applyPreset(p.key, false)} style={{ background: `linear-gradient(135deg, ${p.theme.bg} 45%, ${p.theme.surface})` }} aria-label={`Thème ${p.label}`}>
                        <i style={{ background: `linear-gradient(120deg, ${p.theme.accent}, ${p.theme.accent2})` }} />
                        <span style={{ color: p.theme.text, fontFamily: `"${p.theme.headingFont}", sans-serif` }}>Aa</span>
                      </button>
                      <b>{p.label}</b><small>{p.lead}</small>
                      <button type="button" className="linkish" onClick={() => applyPreset(p.key, true)}>Page complète</button>
                    </div>
                  ))}
                </div>
                <div className="se-group-title">Couleurs</div>
                <div className="se-colors">
                  {COLORS.map(([key, label]) => (
                    <label key={key} className="se-color"><input type="color" value={String(design.theme[key])} onChange={(e) => setTheme({ [key]: e.target.value } as Partial<StoreTheme>)} /><span>{label}</span></label>
                  ))}
                </div>
                <div className="se-group-title">Typographie et formes</div>
                <div className="se-grid2">
                  <label className="se-field"><span>Police des titres</span><select className="field" value={design.theme.headingFont} onChange={(e) => setTheme({ headingFont: e.target.value as StoreTheme["font"] })}>{STORE_FONTS.map((f) => <option key={f}>{f}</option>)}</select></label>
                  <label className="se-field"><span>Police du texte</span><select className="field" value={design.theme.font} onChange={(e) => setTheme({ font: e.target.value as StoreTheme["font"] })}>{STORE_FONTS.map((f) => <option key={f}>{f}</option>)}</select></label>
                  <label className="se-field"><span>Boutons</span><select className="field" value={design.theme.buttons} onChange={(e) => setTheme({ buttons: e.target.value as StoreTheme["buttons"] })}><option value="gradient">Dégradé</option><option value="solid">Plein</option><option value="outline">Contour</option></select></label>
                  <label className="se-field"><span>Cartes</span><select className="field" value={design.theme.cards} onChange={(e) => setTheme({ cards: e.target.value as StoreTheme["cards"] })}><option value="glass">Verre</option><option value="bordered">Bordure</option><option value="elevated">Ombre</option><option value="flat">Plat</option></select></label>
                  <label className="se-field"><span>Fond</span><select className="field" value={design.theme.background} onChange={(e) => setTheme({ background: e.target.value as StoreTheme["background"] })}><option value="glow">Halo</option><option value="gradient">Dégradé</option><option value="grid">Grille</option><option value="plain">Uni</option><option value="image">Image</option></select></label>
                  <label className="se-field"><span>Arrondis · {design.theme.radius} px</span><input type="range" min={0} max={28} value={design.theme.radius} onChange={(e) => setTheme({ radius: Number(e.target.value) })} /></label>
                </div>
                {design.theme.background === "image" && <UrlField label="Image de fond" value={design.theme.backgroundImage} onChange={(v) => setTheme({ backgroundImage: v })} />}
                <label className="se-toggle"><input type="checkbox" checked={design.theme.caps} onChange={(e) => setTheme({ caps: e.target.checked })} /><span>Titres en majuscules</span></label>
              </>
            )}

            {tab === "ai" && (
              <div className="se-ai">
                <div className="se-ai-hero">
                  <Wand2 size={20} />
                  <div><b>Décris la boutique de tes rêves</b><small>L&apos;IA connaît ton catalogue Tebex : elle choisit le style, écrit les textes et organise les blocs. Tu peux tout retoucher ensuite.</small></div>
                </div>
                {!props.aiReady && <div className="banner"><b>IA non configurée.</b> Ajoute <code>AI_API_KEY</code> aux variables d&apos;environnement du site.</div>}
                <textarea className="field" rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={1500} placeholder="Ex. : une boutique sombre et premium pour un serveur RP sérieux, le pack VIP en vedette, une promo -20 % jusqu'à dimanche avec le code NOEL…" disabled={busy === "ai"} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void runAI(prompt); }} />
                <button type="button" className="btn primary shine" disabled={!props.aiReady || busy !== null || prompt.trim().length < 3} onClick={() => runAI(prompt)}>
                  <Sparkles size={15} />{busy === "ai" ? "L'IA construit ta boutique…" : design.blocks.length ? "Appliquer" : "Créer ma boutique"}
                </button>
                {busy === "ai" && <div className="se-ai-wait"><span /><span /><span />Analyse du catalogue, choix du style, rédaction… (20 à 60 s)</div>}
                <div className="se-group-title">Idées</div>
                <div className="se-ai-examples">{AI_EXAMPLES.map((ex) => <button key={ex} type="button" onClick={() => setPrompt(ex)} disabled={busy === "ai"}>{ex}</button>)}</div>
                {aiLog.length > 0 && (
                  <>
                    <div className="se-group-title">Cette session</div>
                    {aiLog.map((l, i) => <div key={i} className="bubble"><div className="bubble-meta"><span>« {l.prompt.slice(0, 80)}{l.prompt.length > 80 ? "…" : ""} »</span></div>{l.summary}</div>)}
                  </>
                )}
              </div>
            )}

            {tab === "settings" && (
              <>
                <div className="se-group-title">Adresse de la boutique</div>
                <div className="se-slug">
                  <span>{storeUrl.replace(/\/store\/[^/]+$/, "/store/")}</span>
                  <input className="field" value={slugInput} onChange={(e) => setSlugInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} maxLength={40} />
                  <button type="button" className="btn" onClick={saveSlug} disabled={busy !== null || slugInput === slug}>OK</button>
                </div>
                <div className="se-row"><CopyButton text={storeUrl} label="Copier le lien" /></div>

                <div className="se-group-title">Identité</div>
                <label className="se-field"><span>Nom</span><input className="field" value={design.brand.name} maxLength={60} onChange={(e) => setBrand({ name: e.target.value })} /></label>
                <label className="se-field"><span>Slogan (bas de page)</span><input className="field" value={design.brand.tagline} maxLength={120} onChange={(e) => setBrand({ tagline: e.target.value })} /></label>
                <UrlField label="Logo" value={design.brand.logo} onChange={(v) => setBrand({ logo: v })} />
                <UrlField label="Invitation Discord" value={design.brand.discord} onChange={(v) => setBrand({ discord: v })} placeholder="https://discord.gg/…" />
                <UrlField label="Site web" value={design.brand.website} onChange={(v) => setBrand({ website: v })} />
                <label className="se-field">
                  <span>Adresse de connexion FiveM</span>
                  <input className="field" value={design.brand.connect} maxLength={120} onChange={(e) => setBrand({ connect: e.target.value })} placeholder="cfx.re/join/abc123" />
                  {design.brand.connect && !connectLink(design.brand.connect) && <small className="se-bad">Format non reconnu (ex. cfx.re/join/abc123 ou play.monserveur.fr:30120)</small>}
                  <small className="se-hint">Affiche les boutons « Jouer maintenant » et « Rejoindre le serveur ».</small>
                </label>
                <label className="se-field"><span>Bandeau d&apos;annonce (en haut)</span><input className="field" value={design.brand.announcement} maxLength={140} onChange={(e) => setBrand({ announcement: e.target.value })} placeholder="🎉 -20 % tout le week-end avec le code WEEKEND" /></label>

                <div className="se-group-title">Paiement</div>
                <label className="se-field"><span>Fenêtre de paiement Tebex</span><select className="field" value={design.checkout.theme} onChange={(e) => patch({ checkout: { ...design.checkout, theme: e.target.value as StoreDesign["checkout"]["theme"] } })}><option value="auto">Comme la boutique</option><option value="dark">Sombre</option><option value="light">Claire</option></select></label>
                <label className="se-toggle"><input type="checkbox" checked={design.checkout.coupon} onChange={(e) => patch({ checkout: { ...design.checkout, coupon: e.target.checked } })} /><span>Champ « code promo »</span></label>
                <label className="se-toggle"><input type="checkbox" checked={design.checkout.giftCard} onChange={(e) => patch({ checkout: { ...design.checkout, giftCard: e.target.checked } })} /><span>Champ « carte cadeau »</span></label>
                <label className="se-toggle"><input type="checkbox" checked={design.checkout.creatorCode} onChange={(e) => patch({ checkout: { ...design.checkout, creatorCode: e.target.checked } })} /><span>Champ « code créateur »</span></label>

                <div className="se-group-title">Référencement et partage</div>
                <label className="se-field"><span>Titre de la page</span><input className="field" value={design.seo.title} maxLength={70} placeholder={`Boutique ${design.brand.name}`} onChange={(e) => patch({ seo: { ...design.seo, title: e.target.value } })} /></label>
                <label className="se-field"><span>Description (Google, Discord…)</span><textarea className="field" rows={2} value={design.seo.description} maxLength={180} onChange={(e) => patch({ seo: { ...design.seo, description: e.target.value } })} /></label>
                <UrlField label="Image de partage" value={design.seo.image} onChange={(v) => patch({ seo: { ...design.seo, image: v } })} />

                <div className="se-group-title">Mentions</div>
                <UrlField label="Conditions générales de vente" value={design.legal.terms} onChange={(v) => patch({ legal: { ...design.legal, terms: v } })} />
                <UrlField label="Politique de confidentialité" value={design.legal.privacy} onChange={(v) => patch({ legal: { ...design.legal, privacy: v } })} />
                <label className="se-field"><span>Note en bas de page</span><textarea className="field" rows={2} value={design.legal.notice} maxLength={400} onChange={(e) => patch({ legal: { ...design.legal, notice: e.target.value } })} placeholder="Les achats sont des dons pour le serveur, sans avantage payant interdit par les règles Cfx.re." /></label>
                <label className="se-toggle"><input type="checkbox" checked={design.branding} onChange={(e) => patch({ branding: e.target.checked })} /><span>Badge « Boutique propulsée par Fiverax »</span></label>

                {publishedAt && (
                  <>
                    <div className="se-group-title">Zone sensible</div>
                    <button type="button" className="btn" onClick={unpublish} disabled={busy !== null}>Mettre la boutique hors ligne</button>
                  </>
                )}
              </>
            )}

            {tab === "versions" && (
              <>
                <p className="se-hint">Chaque publication, chaque passage de l&apos;IA et chaque restauration est gardé (40 dernières versions). Restaurer remplace le brouillon, pas la page en ligne.</p>
                {props.versions.length === 0 && <p className="muted">Aucune version pour l&apos;instant : publie ta boutique pour créer la première.</p>}
                <div className="se-versions">
                  {props.versions.map((v) => (
                    <div key={v.id} className="se-version">
                      <div>
                        <span className="tag" data-tone={v.source === "publish" ? "up" : v.source === "ai" ? "info" : undefined}>{SOURCE_LABEL[v.source] ?? v.source}</span>
                        <small>{formatDateTime(v.createdAt)}{v.author ? ` · ${v.author}` : ""}</small>
                        {(v.summary || v.prompt) && <p>{v.summary ?? v.prompt}</p>}
                      </div>
                      <button type="button" className="btn" onClick={() => restore(v)} disabled={busy !== null}>Restaurer</button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </aside>

        <PreviewFrame device={device}>
          <StoreView design={preview} data={props.data} slug={slug} mode="preview" selected={selected} onSelect={selectFromPreview} />
        </PreviewFrame>
      </div>
    </div>
  );
}

/** Desktop: the store at 1280 px, scaled to fit. Mobile: a 390 px phone. Overlays (cart, details) stay inside. */
function PreviewFrame({ device, children }: { device: "desktop" | "mobile"; children: React.ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 900, h: 700 });
  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const width = device === "desktop" ? 1280 : 390;
  const scale = device === "desktop" ? Math.min(1, box.w / width) : Math.min(1, (box.h - 24) / 820, box.w / (width + 24));
  const height = device === "desktop" ? box.h / scale : 820;
  return (
    <div ref={outer} className="se-preview rise rise-2" data-device={device}>
      <div className="se-canvas" style={{ width, height, transform: `scale(${scale})` }}>
        <div className="se-scroll">{children}</div>
      </div>
    </div>
  );
}

function UrlField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="se-field">
      <span>{label}</span>
      <input className="field" type="url" inputMode="url" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? "https://…"} />
      {value && !cleanUrl(value) && <small className="se-bad">Lien https complet requis (ignoré sinon)</small>}
    </label>
  );
}

/** One-line description of a block in the list. */
function blockSummary(b: StoreBlock, data: StoreData): string {
  const p = b.p;
  if (b.hidden) return "Masqué";
  const pkgName = (id: unknown) => data.categories.flatMap((c) => c.packages).find((x) => x.id === id)?.name;
  switch (b.type) {
    case "featured": return pkgName(p.packageId) ?? "Aucun package choisi";
    case "categories": return Array.isArray(p.categoryIds) && p.categoryIds.length ? `${p.categoryIds.length} catégorie(s)` : "Toutes les catégories";
    case "packages": return Array.isArray(p.packageIds) ? `${p.packageIds.length} package(s)` : "";
    case "promo": return typeof p.code === "string" && p.code ? `Code ${p.code}` : String(p.title ?? "");
    case "spacer": return "";
    default: return typeof p.title === "string" ? p.title : "";
  }
}

function storeError(code: unknown): string | null {
  switch (code) {
    case "slug_taken": return "Cette adresse est déjà prise par une autre boutique.";
    case "invalid_slug": return "Adresse invalide : 3 à 40 caractères, minuscules, chiffres et tirets (certains mots sont réservés).";
    case "unknown_version": return "Version introuvable.";
    case "unknown_store": return "Boutique introuvable : recharge la page.";
    default: return null;
  }
}
