"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Flag, Star, Trash2 } from "lucide-react";
import type { Eligibility } from "@/lib/directory";
import { MIN_REVIEW_SECONDS, type PublicReview, type RatingSummary } from "@/lib/directory-shared";
import { describeApiError, useUI } from "@/app/ui";
import { Stars } from "../parts";

type Props = {
  slug: string; serverName: string; reviews: PublicReview[]; rating: RatingSummary; eligibility: Eligibility; loggedIn: boolean; published: boolean;
};

const when = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

export default function Reviews({ slug, serverName, reviews, rating, eligibility, loggedIn, published }: Props) {
  const router = useRouter();
  const { ask, toast } = useUI();
  const mine = reviews.find((r) => r.mine) ?? null;
  const [editing, setEditing] = useState(false);
  const [stars, setStars] = useState(mine?.rating ?? 0);
  const [body, setBody] = useState(mine?.body ?? "");
  const [busy, setBusy] = useState(false);

  async function post(action: string, payload: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true);
    try {
      const res = await fetch(`/api/directory?action=${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(describeApiError(data, res.status), "error");
        return null;
      }
      return data;
    } catch {
      toast("Impossible de joindre Fiverax.", "error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stars) return toast("Choisis une note de 1 à 5 étoiles.", "error");
    if (await post("review", { slug, rating: stars, body })) {
      toast(mine ? "Avis modifié." : "Merci pour ton avis !", "ok");
      setEditing(false);
      router.refresh();
    }
  }

  async function remove() {
    if (!(await ask({ title: "Supprimer ton avis ?", message: "Tu pourras en écrire un nouveau.", confirmLabel: "Supprimer", danger: true }))) return;
    if (await post("delete", { slug })) router.refresh();
  }

  async function report(id: number) {
    const answer = await ask({
      title: "Signaler cet avis ?",
      message: "Faux avis, insultes, contenu hors sujet… Après 3 signalements, il est masqué jusqu'à vérification par Fiverax.",
      confirmLabel: "Signaler",
      danger: true,
      input: { label: "Raison", required: true, multiline: true, placeholder: "Ce qui ne va pas" }
    });
    if (!answer || answer.value.trim().length < 5) return;
    const data = await post("report", { reviewId: id, reason: answer.value });
    if (data) {
      toast(data.hidden ? "Merci : l'avis est masqué en attendant la vérification." : "Merci, le signalement est enregistré.", "ok");
      if (data.hidden) router.refresh();
    }
  }

  const max = Math.max(1, ...rating.distribution);
  const showForm = published && eligibility.ok && (!mine || editing);
  const loginHref = `/api/auth/discord?next=${encodeURIComponent(`/annuaire/${slug}#avis`)}`;

  return (
    <section id="avis" className="dir-section" style={{ scrollMarginTop: 90 }}>
      <header><h2>Avis des joueurs</h2>{rating.count > 0 && <span className="muted" style={{ fontSize: 13 }}>{rating.count} avis vérifié{rating.count > 1 ? "s" : ""}</span>}</header>

      {rating.count > 0 && (
        <div className="dir-panel dir-rating">
          <div style={{ textAlign: "center" }}>
            <div className="dir-rating-big">{rating.average}</div>
            <Stars value={rating.average ?? 0} size={14} />
          </div>
          <div className="dir-bars">
            {[5, 4, 3, 2, 1].map((n) => (
              <div key={n}><span>{n}</span><i><span style={{ width: `${(rating.distribution[n - 1] / max) * 100}%` }} /></i><span>{rating.distribution[n - 1]}</span></div>
            ))}
          </div>
        </div>
      )}

      <div className="dir-panel" style={{ marginTop: 16 }}>
        {!published ? (
          <p className="muted" style={{ margin: 0 }}>Les avis s&apos;ouvrent quand la fiche est publiée.</p>
        ) : !loggedIn ? (
          <p style={{ margin: 0 }}>Tu as joué sur {serverName} ? <a href={loginHref} className="linkish">Connecte-toi avec Discord</a> pour laisser ton avis.</p>
        ) : !eligibility.ok ? (
          <p className="muted" style={{ margin: 0 }}>
            {eligibility.reason === "staff"
              ? "Tu fais partie de l'équipe de ce serveur : tu ne peux pas le noter."
              : `Seuls les joueurs qui ont joué au moins ${Math.round(MIN_REVIEW_SECONDS / 3600)} h sur ce serveur peuvent laisser un avis (ton compte Discord doit être lié à FiveM). Temps enregistré pour toi : ${Math.floor(eligibility.playtime / 60)} min.`}
          </p>
        ) : showForm ? (
          <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
            <b style={{ fontSize: 14 }}>{mine ? "Modifier ton avis" : "Ton avis sur " + serverName}</b>
            <span className="dir-star-input" role="radiogroup" aria-label="Note">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" data-on={stars >= n} onClick={() => setStars(n)} aria-label={`${n} étoile${n > 1 ? "s" : ""}`}><Star size={24} fill={stars >= n ? "currentColor" : "none"} /></button>
              ))}
            </span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} className="field" rows={4} minLength={20} maxLength={2000} placeholder="L'ambiance, le staff, l'économie, les scripts… ce qui t'a plu ou pas (20 caractères minimum)." />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button className="btn primary" disabled={busy || body.trim().length < 20}>{mine ? "Enregistrer" : "Publier mon avis"}</button>
              {mine && <button type="button" className="btn" onClick={() => setEditing(false)}>Annuler</button>}
              <span className="muted" style={{ fontSize: 12 }}>Publié avec ton pseudo et ton avatar Discord, avec ton temps de jeu.</span>
            </div>
          </form>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span>{mine?.status === "hidden" ? "Ton avis est masqué en attendant une vérification." : "Merci, ton avis est publié."}</span>
            <button className="btn sm" onClick={() => { setStars(mine!.rating); setBody(mine!.body); setEditing(true); }}>Modifier</button>
            <button className="btn sm" onClick={remove} disabled={busy}><Trash2 size={13} />Supprimer</button>
          </div>
        )}
      </div>

      {reviews.length === 0 && <p className="dir-empty">Pas encore d&apos;avis. Les joueurs de {serverName} peuvent être les premiers.</p>}
      <div style={{ marginTop: 8 }}>
        {reviews.map((r) => (
          <article key={r.id} className="dir-review">
            <header>
              {r.avatarUrl ? <img src={r.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="dir-avatar" />}
              <b>{r.author}</b>
              <Stars value={r.rating} size={12} />
              <span className="dir-verified" title="Temps de jeu enregistré par le serveur"><BadgeCheck size={12} />A joué {r.playtimeHours} h</span>
              <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>{when(r.createdAt)}{r.updatedAt.slice(0, 10) !== r.createdAt.slice(0, 10) ? " · modifié" : ""}</span>
              {!r.mine && loggedIn && <button className="ibtn" title="Signaler" onClick={() => report(r.id)} disabled={busy}><Flag size={12} /></button>}
            </header>
            <p>{r.body}</p>
            {r.mine && r.status === "hidden" && <p className="muted" style={{ fontSize: 12 }}>Masqué après des signalements : visible par toi seul.</p>}
            {r.reply && <div className="dir-reply"><b>Réponse de {serverName}</b>{r.reply}</div>}
          </article>
        ))}
      </div>
    </section>
  );
}
