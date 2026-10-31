"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes, LayoutTemplate, Puzzle, Sparkles } from "lucide-react";
import { FRAMEWORKS, KIND_META, resourceSlug, type CreationKind, type Framework } from "@/lib/studio-shared";
import { UI_TEMPLATES } from "@/lib/studio-ui";
import { describeApiError, useServerPaths, useUI } from "@/app/ui";
import { PLACES_3D } from "../map-editor";

type Props = { kind: CreationKind; players: { id: number; name: string; pos: [number, number, number] }[] };

const MANUAL = {
  ui: { label: "Créer en mode simple", hint: "Assemble la fenêtre (titres, boutons, jauges…) sans coder.", icon: LayoutTemplate },
  script: { label: "Créer avec des blocs", hint: "Emboîte des blocs comme dans Scratch : le code est écrit tout seul.", icon: Puzzle },
  map: { label: "Placer les props moi-même", hint: "Glisse des props et des kits prêts à poser sur la vue de dessus.", icon: Boxes }
} as const;

/**
 * Two ways to start: describe it (the editor opens and asks the AI right away), or make it by hand
 * (blocks for a script, the simple builder for a UI, props for a mapping).
 */
export default function NewCreation({ kind, players }: Props) {
  const router = useRouter();
  const paths = useServerPaths();
  const { toast } = useUI();
  const meta = KIND_META[kind];
  const [prompt, setPrompt] = useState("");
  const [name, setName] = useState("");
  const [resource, setResource] = useState("");
  const [framework, setFramework] = useState<Framework>("standalone");
  const [where, setWhere] = useState(players.length ? `p${players[0].id}` : "place0");
  const [template, setTemplate] = useState(UI_TEMPLATES[0].key);
  const [busy, setBusy] = useState(false);
  const manual = MANUAL[kind];

  const autoName = prompt.trim().split(/[\s,.:;!?]+/).slice(0, 4).join(" ");
  const finalName = (name.trim() || autoName || meta.one).slice(0, 60);
  const finalResource = resource.trim() || resourceSlug(finalName);

  function center(): [number, number, number] {
    if (where.startsWith("p")) {
      const p = players.find((x) => `p${x.id}` === where);
      if (p) return [p.pos[0], p.pos[1], p.pos[2] - 1];
    }
    const place = PLACES_3D[Number(where.slice(5))] ?? PLACES_3D[0];
    return place.pos;
  }

  async function create(byHand: boolean) {
    if (finalName.length < 2) return;
    setBusy(true);
    try {
      const res = await fetch(paths.api("studio"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind, name: finalName, resource: finalResource, framework,
          ...(kind === "map" ? { center: center() } : {}),
          ...(byHand && kind !== "map" ? { visual: true, template } : {})
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(describeApiError(data, res.status), "error");
        return;
      }
      const ask = byHand ? "" : prompt.trim();
      router.push(paths.page(`/studio/${kind}/${data.id}${ask ? `?ask=${encodeURIComponent(ask)}` : ""}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void create(false); }} className="studio-new rise rise-1">
      <div className="eyebrow">Nouvelle {meta.one}</div>
      <div className="studio-new-row">
        <label>
          <small className="muted">Nom</small>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder={autoName || "Mon menu"} maxLength={60} />
        </label>
        <label>
          <small className="muted">Ressource (dossier FiveM)</small>
          <input className="field" value={resource} onChange={(e) => setResource(e.target.value.toLowerCase())} placeholder={finalResource} maxLength={48} pattern="[a-z0-9][a-z0-9_\-]{2,47}" />
        </label>
        {kind !== "map" ? (
          <label>
            <small className="muted">Framework</small>
            <select className="field" value={framework} onChange={(e) => setFramework(e.target.value as Framework)}>
              {FRAMEWORKS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </label>
        ) : (
          <label>
            <small className="muted">Emplacement</small>
            <select className="field" value={where} onChange={(e) => setWhere(e.target.value)}>
              {players.length > 0 && (
                <optgroup label="Position d'un joueur en jeu">
                  {players.map((p) => <option key={p.id} value={`p${p.id}`}>{p.name} (#{p.id})</option>)}
                </optgroup>
              )}
              <optgroup label="Lieux (altitude approximative)">
                {PLACES_3D.map((p, i) => <option key={p.name} value={`place${i}`}>{p.name}</option>)}
              </optgroup>
            </select>
          </label>
        )}
      </div>

      <div className="studio-choices">
        <div className="studio-choice">
          <label htmlFor="studio-prompt" className="studio-choice-head"><Sparkles size={15} /> Avec l&apos;IA</label>
          <textarea
            id="studio-prompt"
            className="field"
            rows={3}
            maxLength={2000}
            placeholder={`Décris ${kind === "map" ? "la scène" : kind === "ui" ? "l'interface" : "le script"} en français, le plus précisément possible…`}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="studio-examples">
            {meta.examples.map((ex) => (
              <button key={ex} type="button" className="perm" onClick={() => setPrompt(ex)}>{ex}</button>
            ))}
          </div>
          <button className="btn primary" disabled={busy || finalName.length < 2 || prompt.trim().length < 3}>
            <Sparkles size={15} />Créer avec l&apos;IA
          </button>
        </div>

        <div className="studio-choice">
          <div className="studio-choice-head"><manual.icon size={15} /> À la main</div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>{manual.hint}</p>
          {kind === "ui" && (
            <div className="studio-examples">
              {UI_TEMPLATES.map((t) => <button key={t.key} type="button" className="perm" data-on={template === t.key} onClick={() => setTemplate(t.key)}>{t.label}</button>)}
            </div>
          )}
          <button type="button" className="btn" disabled={busy || finalName.length < 2} onClick={() => create(true)}>
            <manual.icon size={15} />{manual.label}
          </button>
        </div>
      </div>
    </form>
  );
}
