"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ExternalLink, Megaphone, Save, Star, Trash2 } from "lucide-react";
import type { DirectoryStats, FeaturedSlot, Listing, ModerationItem } from "@/lib/directory";
import { DIRECTORY_TAGS, LANGUAGES, MIN_AGES, publishProblems, type ListingInput, type PublicReview } from "@/lib/directory-shared";
import { FRAMEWORKS } from "@/lib/studio-shared";
import { describeApiError, useServerPaths, useUI } from "@/app/ui";

type Props = {
  initial: Listing;
  problems: string[];
  stats: DirectoryStats;
  reviews: (PublicReview & { reports: number })[];
  slots: FeaturedSlot[];
  moderation: ModerationItem[];
  platformOwner: boolean;
};

const PROBLEM: Record<string, string> = {
  tagline: "une accroche d'au moins 10 caractères",
  description: "une présentation d'au moins 80 caractères",
  connect: "l'adresse FiveM (cfx.re/join/…) ou l'invitation Discord"
};
const STAT_LABEL = { view: "Vues de la fiche", join: "Clics « Rejoindre »", discord: "Clics Discord", store: "Clics boutique", website: "Clics site" } as const;

function toInput(l: Listing): ListingInput {
  const { serverId: _s, published: _p, publishedAt: _a, updatedAt: _u, ...rest } = l;
  return rest;
}

export default function DirectoryEditor({ initial, stats, reviews, slots: initialSlots, moderation: initialModeration, platformOwner }: Props) {
  const router = useRouter();
  const paths = useServerPaths();
  const { ask, toast } = useUI();
  const [listing, setListing] = useState(initial);
  const [form, setForm] = useState<ListingInput>(toInput(initial));
  const [busy, setBusy] = useState(false);
  const [slots, setSlots] = useState(initialSlots);
  const [moderation, setModeration] = useState(initialModeration);
  const dirty = JSON.stringify(form) !== JSON.stringify(toInput(listing));
  const problems = publishProblems(form);
  const set = <K extends keyof ListingInput>(key: K, value: ListingInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function post(action: string, body: unknown = {}, url = paths.api(`directory?action=${action}`)): Promise<Record<string, unknown> | null> {
    setBusy(true);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(describeApiError(data, res.status), "error");
        return null;
      }
      return data;
    } catch {
      toast("Impossible de joindre le panel.", "error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<boolean> {
    const data = (await post("save", { listing: form })) as Listing | null;
    if (!data) return false;
    setListing(data);
    setForm(toInput(data));
    toast("Fiche enregistrée.", "ok");
    return true;
  }

  async function publish(on: boolean) {
    if (on && dirty && !(await save())) return;
    if (!on && !(await ask({ title: "Retirer la fiche de l'annuaire ?", message: "Elle ne sera plus visible ; les avis sont gardés.", confirmLabel: "Retirer", danger: true }))) return;
    const data = (await post(on ? "publish" : "unpublish")) as Listing | null;
    if (data) {
      setListing(data);
      toast(on ? "Ta fiche est en ligne dans l'annuaire !" : "Fiche retirée de l'annuaire.", "ok");
    }
  }

  async function reply(r: PublicReview) {
    const answer = await ask({
      title: `Répondre à ${r.author}`,
      message: "Ta réponse est publique, sous l'avis. Laisse vide pour la retirer.",
      confirmLabel: "Publier",
      input: { label: "Réponse", multiline: true, placeholder: "Merci pour ton retour…", initial: r.reply ?? "" }
    });
    if (answer && (await post("reply", { reviewId: r.id, reply: answer.value }))) {
      toast("Réponse enregistrée.", "ok");
      router.refresh();
    }
  }

  async function feature() {
    const answer = await ask({ title: "Mettre ce serveur à la une", message: "Nombre de jours (1 à 90), à la suite des créneaux en cours.", confirmLabel: "Mettre à la une", input: { label: "Jours", required: true, placeholder: "7" } });
    if (!answer) return;
    const data = await post("feature", { days: Number(answer.value), note: null });
    if (data) setSlots(data.slots as FeaturedSlot[]);
  }

  async function unfeature(id: number) {
    if (await post("unfeature", { id })) setSlots((s) => s.filter((x) => x.id !== id));
  }

  async function moderate(id: number, status: "published" | "removed") {
    if (await post("moderate", { reviewId: id, status }, "/api/directory?action=moderate")) setModeration((m) => m.filter((x) => x.id !== id));
  }

  const publicUrl = `/annuaire/${listing.slug}${listing.published ? "" : "?preview=1"}`;
  const maxViews = Math.max(1, ...stats.days.map((d) => d.view));

  return (
    <>
      <section className="banner" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span className="tag" data-tone={listing.published ? "up" : "neutral"}>{listing.published ? "En ligne" : "Non publiée"}</span>
        <span style={{ flex: 1, minWidth: 220 }}>
          {listing.published ? <>Ta fiche est visible sur <code>/annuaire/{listing.slug}</code>.</> : problems.length ? <>Pour publier, il manque : {problems.map((p) => PROBLEM[p]).join(", ")}.</> : "Prête à être publiée."}
        </span>
        {listing.updatedAt && <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="btn sm"><ExternalLink size={13} />{listing.published ? "Voir la fiche" : "Aperçu"}</a>}
        {listing.published
          ? <button className="btn sm" disabled={busy} onClick={() => publish(false)}><EyeOff size={13} />Retirer</button>
          : <button className="btn sm primary" disabled={busy || problems.length > 0} onClick={() => publish(true)}><Eye size={13} />Publier dans l&apos;annuaire</button>}
      </section>

      <div className="cols even" style={{ marginTop: 24 }}>
        <section className="rise rise-1">
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingBottom: 12, borderBottom: "1px solid var(--line-2)" }}>
            <h2 className="h2">La fiche</h2>
            <button className="btn sm primary" disabled={busy || !dirty} onClick={save}><Save size={13} />Enregistrer</button>
          </header>
          <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
            <Field label="Nom affiché"><input className="field" value={form.name} maxLength={60} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="Adresse de la fiche" hint="Minuscules, chiffres et tirets.">
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span className="muted">/annuaire/</span><input className="field" value={form.slug} maxLength={40} onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} /></div>
            </Field>
            <Field label="Accroche" hint={`${form.tagline.length}/120 · une phrase qui donne envie`}><input className="field" value={form.tagline} maxLength={120} placeholder="RP sérieux à Los Santos, économie réaliste, staff présent 24/7" onChange={(e) => set("tagline", e.target.value)} /></Field>
            <Field label="Présentation" hint={`${form.description.length}/5000`}><textarea className="field" rows={8} value={form.description} maxLength={5000} placeholder="L'univers, les métiers, les règles, ce qui vous rend uniques…" onChange={(e) => set("description", e.target.value)} /></Field>
            <Field label="Connexion FiveM" hint="cfx.re/join/xxxxxx (conseillé) ou ip:port"><input className="field" value={form.connect} placeholder="cfx.re/join/abc123" onChange={(e) => set("connect", e.target.value.trim())} /></Field>
            <Field label="Invitation Discord"><input className="field" value={form.discord} placeholder="discord.gg/tonserveur" onChange={(e) => set("discord", e.target.value.trim())} /></Field>
            <Field label="Site web (facultatif)"><input className="field" value={form.website} placeholder="https://…" onChange={(e) => set("website", e.target.value.trim())} /></Field>
            <Field label="Logo" hint="Lien https vers une image carrée (par défaut : l'icône du Discord)"><input className="field" value={form.logoUrl} placeholder="https://…" onChange={(e) => set("logoUrl", e.target.value.trim())} /></Field>
            <Field label="Bannière" hint="Lien https, format large (1600×700 conseillé)"><input className="field" value={form.bannerUrl} placeholder="https://…" onChange={(e) => set("bannerUrl", e.target.value.trim())} /></Field>
            <Field label="Galerie" hint="Jusqu'à 6 captures, un lien https par ligne">
              <textarea className="field" rows={3} value={form.gallery.join("\n")} onChange={(e) => set("gallery", e.target.value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 6))} />
            </Field>
            <Field label="Étiquettes" hint="6 maximum">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {DIRECTORY_TAGS.map((t) => {
                  const on = form.tags.includes(t.key);
                  return (
                    <button key={t.key} type="button" className="tag" data-tone={on ? "up" : undefined} style={{ cursor: "pointer" }}
                      onClick={() => set("tags", on ? form.tags.filter((x) => x !== t.key) : form.tags.length < 6 ? [...form.tags, t.key] : form.tags)}>
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </Field>
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
              <Field label="Framework"><select className="field" value={form.framework} onChange={(e) => set("framework", e.target.value)}>{FRAMEWORKS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></Field>
              <Field label="Langue"><select className="field" value={form.language} onChange={(e) => set("language", e.target.value as ListingInput["language"])}>{LANGUAGES.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}</select></Field>
              <Field label="Âge minimum"><select className="field" value={form.minAge} onChange={(e) => set("minAge", Number(e.target.value) as ListingInput["minAge"])}>{MIN_AGES.map((a) => <option key={a} value={a}>{a ? `${a} ans` : "Aucun"}</option>)}</select></Field>
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
              <input type="checkbox" checked={form.showPlayers} onChange={(e) => set("showPlayers", e.target.checked)} />
              Afficher les joueurs connectés en direct (fortement conseillé : c&apos;est ce que les joueurs regardent en premier)
            </label>
          </div>
        </section>

        <div>
          <section className="rise rise-2">
            <header style={{ paddingBottom: 12, borderBottom: "1px solid var(--line-2)" }}><h2 className="h2">30 derniers jours</h2></header>
            <div className="strip" style={{ marginTop: 14 }}>
              {(Object.keys(STAT_LABEL) as (keyof typeof STAT_LABEL)[]).map((k) => <div key={k}><div className="eyebrow">{STAT_LABEL[k]}</div><div className="num">{stats.totals[k]}</div></div>)}
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 60, marginTop: 14 }} aria-label="Vues par jour">
              {stats.days.map((d) => <div key={d.day} title={`${d.day} : ${d.view} vue(s), ${d.join} clic(s) Rejoindre`} style={{ flex: 1, height: `${Math.max(3, (d.view / maxViews) * 100)}%`, background: d.view ? "var(--accent)" : "var(--line)", borderRadius: 2, opacity: d.view ? 0.85 : 1 }} />)}
            </div>
          </section>

          <section className="sect rise rise-3">
            <header><h2 className="h2" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Megaphone size={15} />Mise en avant</h2></header>
            {slots.length === 0 ? (
              <p className="muted">Pas de mise en avant en cours. Les serveurs « À la une » apparaissent en haut de l&apos;annuaire, avant tous les autres.</p>
            ) : slots.map((s) => (
              <div key={s.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
                <Star size={13} style={{ color: "var(--accent)" }} />
                <span style={{ flex: 1 }}>Du {new Date(s.startsAt).toLocaleDateString("fr-FR")} au {new Date(s.endsAt).toLocaleDateString("fr-FR")}</span>
                {platformOwner && <button className="ibtn bad" title="Retirer" disabled={busy} onClick={() => unfeature(s.id)}><Trash2 size={12} /></button>}
              </div>
            ))}
            {platformOwner
              ? <button className="btn sm" style={{ marginTop: 10 }} disabled={busy || !listing.published} onClick={feature}><Star size={13} />Mettre à la une (admin Fiverax)</button>
              : <p className="muted" style={{ fontSize: 13 }}>La mise en avant payante arrive bientôt.</p>}
          </section>
        </div>
      </div>

      <section className="sect rise rise-3">
        <header><h2 className="h2">Avis <span className="muted" style={{ fontFamily: "var(--font-body)", fontSize: 13 }}>· {reviews.length}</span></h2></header>
        {reviews.length === 0 && <p className="muted">Aucun avis pour l&apos;instant. Seuls les joueurs avec au moins 1 h de jeu sur ton serveur (compte Discord lié en jeu) peuvent en laisser.</p>}
        {reviews.map((r) => (
          <div key={r.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <b>{r.author}</b>
              <span style={{ color: "var(--accent)" }}>{"★".repeat(r.rating)}<span style={{ color: "var(--line-2)" }}>{"★".repeat(5 - r.rating)}</span></span>
              <span className="muted" style={{ fontSize: 12 }}>{r.playtimeHours} h de jeu · {new Date(r.createdAt).toLocaleDateString("fr-FR")}</span>
              {r.status === "hidden" && <span className="tag" data-tone="warn">Masqué (signalements)</span>}
              {r.reports > 0 && r.status !== "hidden" && <span className="tag" data-tone="warn">{r.reports} signalement(s)</span>}
              <button className="btn sm" style={{ marginLeft: "auto" }} disabled={busy} onClick={() => reply(r)}>{r.reply ? "Modifier la réponse" : "Répondre"}</button>
            </div>
            <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{r.body}</p>
            {r.reply && <p className="muted" style={{ margin: "6px 0 0 12px", paddingLeft: 10, borderLeft: "2px solid var(--accent)", whiteSpace: "pre-wrap" }}>{r.reply}</p>}
          </div>
        ))}
      </section>

      {platformOwner && (
        <section className="sect">
          <header><h2 className="h2">Modération Fiverax <span className="muted" style={{ fontFamily: "var(--font-body)", fontSize: 13 }}>· tous serveurs · {moderation.length}</span></h2></header>
          {moderation.length === 0 && <p className="muted">Aucun avis masqué à vérifier.</p>}
          {moderation.map((r) => (
            <div key={r.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <a href={`/annuaire/${r.slug}`} target="_blank" rel="noopener noreferrer" className="linkish">{r.serverName}</a>
                <b>{r.author}</b><span>{"★".repeat(r.rating)}</span>
                <span className="tag" data-tone="warn">{r.reports} signalement(s)</span>
                <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
                  <button className="btn sm" disabled={busy} onClick={() => moderate(r.id, "published")}>Remettre en ligne</button>
                  <button className="btn sm" disabled={busy} onClick={() => moderate(r.id, "removed")}><Trash2 size={13} />Supprimer</button>
                </span>
              </div>
              <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{r.body}</p>
              {r.reasons.length > 0 && <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>Raisons : {r.reasons.join(" · ")}</p>}
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}{hint && <span className="muted" style={{ fontWeight: 400, marginLeft: 8, fontSize: 12 }}>{hint}</span>}</span>
      {children}
    </label>
  );
}
