"use client";
import { useState } from "react";
import { Share2 } from "lucide-react";
import { describeApiError, useServerPaths, useUI } from "@/app/ui";

type Props = {
  creationId: number;
  /** First publication: the creation's name; new version: the item's current texts are kept by the server if left as is. */
  initial: { title: string; description: string; tags: string };
  /** Already published: this releases version `nextVersion`. */
  nextVersion: number | null;
  onClose: () => void;
  onDone: (result: { id: number; version: number; title: string; description: string; tags: string[] }) => void;
};

type Finding = { file?: string; title?: string; line?: number };

/** Publish a Studio creation to the network library (or release a new version of it). */
export default function PublishDialog({ creationId, initial, nextVersion, onClose, onDone }: Props) {
  const paths = useServerPaths();
  const { toast } = useUI();
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [tags, setTags] = useState(initial.tags);
  const [changelog, setChangelog] = useState("");
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<Finding[] | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const tagList = tags.split(/[,\s#]+/).filter(Boolean);
    try {
      const res = await fetch(paths.api("library?kind=publish"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creationId, title, description, tags: tagList, changelog: changelog || null })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "unsafe_code" && Array.isArray(data.details)) setBlocked(data.details as Finding[]);
        toast(describeApiError(data, res.status), "error");
        return;
      }
      onDone({ id: Number(data.id), version: Number(data.version), title: title.trim(), description: description.trim(), tags: tagList });
    } catch {
      toast("Impossible de joindre le panel.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="veil" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" style={{ width: "min(560px, 100%)" }} onSubmit={submit}>
        <h3>{nextVersion ? `Publier la version ${nextVersion}` : "Publier dans la bibliothèque"}</h3>
        <p>
          {nextVersion
            ? "Les serveurs qui l'ont installée verront la mise à jour dans leur Studio."
            : "Tous les serveurs Fiverax pourront l'installer dans leur Studio. Le nom de ton serveur est affiché comme auteur."}
          {" "}Le scanner vérifie le code : une backdoor ou une faille critique bloque la publication.
        </p>
        <div className="form-col" style={{ maxWidth: "none" }}>
          <label><span>Titre</span><input className="field" required minLength={3} maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label>
            <span>Description (ce que ça fait, comment l&apos;utiliser, commandes)</span>
            <textarea className="field" required minLength={10} maxLength={2000} rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label><span>Mots-clés (séparés par des virgules)</span><input className="field" maxLength={200} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="hud, police, garage" /></label>
          {nextVersion && <label><span>Nouveautés de cette version</span><input className="field" maxLength={500} value={changelog} onChange={(e) => setChangelog(e.target.value)} placeholder="Ajout du mode nuit, correction du menu…" /></label>}
        </div>
        {blocked && (
          <div className="error" style={{ marginTop: 14 }}>
            {blocked.map((f, i) => <div key={i}><code>{f.file}{f.line ? `:${f.line}` : ""}</code> {f.title}</div>)}
          </div>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary" disabled={busy || title.trim().length < 3 || description.trim().length < 10}><Share2 size={14} />{nextVersion ? "Publier la mise à jour" : "Publier"}</button>
        </div>
      </form>
    </div>
  );
}
