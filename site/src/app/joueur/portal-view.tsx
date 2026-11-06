"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, ChevronDown, Clock, ExternalLink, Gamepad2, Gift, LogIn, MapPin, Megaphone, PartyPopper, ShieldBan, Trophy, Users } from "lucide-react";
import { joinUrl } from "@/lib/directory-shared";
import {
  formQuestions, hexRgb, RESPONSE_STATUS_LABEL,
  type FormView, type GiveawayView, type ListItem, type PortalBlock, type PortalContext, type PortalDesign
} from "@/lib/portal-site-shared";
import { describeApiError } from "../ui";

type Mode = "live" | "preview";
type Props = { design: PortalDesign; ctx: PortalContext; mode?: Mode };

const fmtDate = (iso: string) => new Date(iso).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const hours = (s: number) => `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
const list = (v: unknown) => (Array.isArray(v) ? (v as ListItem[]) : []);
const TONE_LABEL: Record<string, string> = { info: "Info", important: "Important", event: "Événement", update: "Mise à jour" };

/** A server's player portal: the published page for players, or the editor's live preview (actions disabled). */
export default function PortalView({ design, ctx, mode = "live" }: Props) {
  const login = `/api/auth/discord?next=${encodeURIComponent(`/joueur/${ctx.slug}`)}`;
  const style = { "--accent": design.accent, "--accent-rgb": hexRgb(design.accent) } as React.CSSProperties;
  return (
    <div className="ps" style={style}>
      <header className="ps-head" style={design.banner ? { backgroundImage: `linear-gradient(180deg, rgba(10,8,5,0.2), rgba(10,8,5,0.95)), url("${design.banner.replace(/"/g, "")}")` } : undefined}>
        {design.logo ? <img className="ps-logo" src={design.logo} alt="" referrerPolicy="no-referrer" /> : <span className="ps-logo">{design.title.charAt(0).toUpperCase()}</span>}
        <div>
          <span className="lp-chip"><b>Espace joueurs</b>{ctx.serverName}</span>
          <h1>{design.title}</h1>
          {design.tagline && <p>{design.tagline}</p>}
        </div>
        <div className="ps-me">
          {ctx.viewer
            ? <span className="ps-viewer">{ctx.viewer.avatarUrl ? <img src={ctx.viewer.avatarUrl} alt="" referrerPolicy="no-referrer" /> : null}{ctx.viewer.username}</span>
            : <a className="btn sm" href={mode === "live" ? login : undefined}><LogIn size={14} />Connexion Discord</a>}
        </div>
      </header>
      <div className="ps-blocks">
        {design.blocks.map((b) => <Block key={b.id} block={b} ctx={ctx} mode={mode} login={login} />)}
        {design.blocks.length === 0 && <p className="muted">Cette page est vide pour l&apos;instant.</p>}
      </div>
    </div>
  );
}

function Block({ block: b, ctx, mode, login }: { block: PortalBlock; ctx: PortalContext; mode: Mode; login: string }) {
  const p = b.p;
  const img = (src: unknown) => (src ? <img className="ps-img" src={String(src)} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null);
  switch (b.type) {
    case "hero":
      return (
        <section className="ps-hero" style={p.image ? { backgroundImage: `linear-gradient(90deg, rgba(10,8,5,0.92), rgba(10,8,5,0.35)), url("${String(p.image).replace(/"/g, "")}")` } : undefined}>
          <h2>{String(p.title)}</h2>
          {p.text && <p>{String(p.text)}</p>}
        </section>
      );
    case "announcement":
      return (
        <article className="ps-card ps-announce" data-tone={String(p.tone)}>
          <div className="ps-kicker"><Megaphone size={14} />{TONE_LABEL[String(p.tone)] ?? "Info"}{p.date ? ` · ${new Date(String(p.date)).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}` : ""}</div>
          <h3>{String(p.title)}</h3>
          <p className="ps-text">{String(p.body)}</p>
          {img(p.image)}
        </article>
      );
    case "event":
      return (
        <article className="ps-card ps-event">
          <div>
            <div className="ps-kicker"><CalendarClock size={14} />Événement</div>
            <h3>{String(p.title)}</h3>
            {p.text && <p className="ps-text">{String(p.text)}</p>}
            <div className="ps-meta">
              {p.at && <span><Clock size={13} />{fmtDate(String(p.at))}</span>}
              {p.place && <span><MapPin size={13} />{String(p.place)}</span>}
            </div>
          </div>
          {p.at ? <Countdown at={String(p.at)} /> : null}
          {img(p.image)}
        </article>
      );
    case "buttons": {
      const items = list(p.items).filter((i) => i.label && i.url);
      if (!items.length) return mode === "preview" ? <p className="muted">Bloc Boutons : ajoute un texte et un lien.</p> : null;
      return (
        <section className="ps-buttons">
          {p.title && <h3>{String(p.title)}</h3>}
          <div>
            {items.map((i, n) => (
              <a key={n} href={i.url} className={`btn${p.primaryFirst && n === 0 ? " primary" : ""}`} target={i.url.startsWith("https://") ? "_blank" : undefined} rel="noopener noreferrer nofollow">
                {i.label}{i.url.startsWith("https://") && <ExternalLink size={13} />}
              </a>
            ))}
          </div>
        </section>
      );
    }
    case "text":
      return (
        <article className="ps-card">
          {p.title && <h3>{String(p.title)}</h3>}
          <p className="ps-text">{String(p.body) || (mode === "preview" ? "Écris ton texte dans le bloc." : "")}</p>
          {img(p.image)}
        </article>
      );
    case "faq":
      return (
        <section className="ps-card">
          <h3>{String(p.title)}</h3>
          <div className="ps-faq">
            {list(p.items).filter((i) => i.q).map((i, n) => (
              <details key={n}><summary>{i.q}<ChevronDown size={15} /></summary><p className="ps-text">{i.a}</p></details>
            ))}
          </div>
        </section>
      );
    case "rules":
      return (
        <section className="ps-card">
          <h3>{String(p.title)}</h3>
          <ol className="ps-rules">
            {list(p.items).filter((i) => i.title).map((i, n) => <li key={n}><b>{i.title}</b>{i.text && <p className="ps-text">{i.text}</p>}</li>)}
          </ol>
        </section>
      );
    case "status": {
      const connect = String(p.connect || ctx.connect || "");
      const join = connect ? joinUrl(connect) : null;
      return (
        <section className="ps-card ps-status">
          <div>
            <h3>{String(p.title)}</h3>
            {ctx.live ? (
              <p className="ps-live"><i className={`dir-pulse ${ctx.live.online ? "" : "off"}`} />{ctx.live.online ? <><b>{ctx.live.players}</b>{ctx.live.maxClients ? ` / ${ctx.live.maxClients}` : ""} joueurs en ligne</> : "Serveur hors ligne"}</p>
            ) : <p className="muted">Statut indisponible.</p>}
          </div>
          {join && <a href={join} className="btn primary shine"><Gamepad2 size={15} />{String(p.button)}</a>}
        </section>
      );
    }
    case "stats":
      return (
        <section className="ps-card">
          <h3>{String(p.title)}</h3>
          {!ctx.viewer ? (
            <p className="muted">Connecte-toi avec Discord pour voir ton temps de jeu et tes sessions. <a className="linkish" href={mode === "live" ? login : undefined}>Connexion</a></p>
          ) : !ctx.stats?.linked ? (
            <p className="muted">Aucune session trouvée avec ce compte Discord. Relie Discord dans FiveM (Paramètres &gt; Comptes liés), puis joue une fois sur le serveur.</p>
          ) : (
            <div className="ps-stats">
              <div><b>{hours(ctx.stats.playSeconds)}</b><span>de jeu</span></div>
              <div><b>{ctx.stats.sessions}</b><span>sessions</span></div>
              {ctx.stats.firstSeenAt && <div><b>{new Date(ctx.stats.firstSeenAt).toLocaleDateString("fr-FR", { month: "short", year: "numeric" })}</b><span>depuis</span></div>}
              <div><b>{ctx.stats.inGame ? "En jeu" : "Hors jeu"}</b><span>maintenant</span></div>
              {ctx.stats.banned && <div data-bad><b><ShieldBan size={16} /> Banni</b><span><a className="linkish" href="/joueur">contester</a></span></div>}
            </div>
          )}
        </section>
      );
    case "form":
      return <FormBlock block={b} view={ctx.forms[b.id]} slug={ctx.slug} mode={mode} login={login} />;
    case "giveaway":
      return <GiveawayBlock block={b} view={ctx.giveaways[b.id]} slug={ctx.slug} mode={mode} login={login} />;
  }
}

function Countdown({ at }: { at: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return null;
  const left = new Date(at).getTime() - now;
  if (left <= 0) return <div className="ps-count"><PartyPopper size={18} /><b>C&apos;est maintenant !</b></div>;
  const d = Math.floor(left / 86_400_000), h = Math.floor((left / 3_600_000) % 24), m = Math.floor((left / 60_000) % 60), s = Math.floor((left / 1000) % 60);
  return (
    <div className="ps-count" aria-label="Compte à rebours">
      {[[d, "j"], [h, "h"], [m, "min"], [s, "s"]].map(([v, u]) => <div key={u as string}><b>{String(v).padStart(2, "0")}</b><span>{u}</span></div>)}
    </div>
  );
}

const DEMO_FORM: FormView = { responses: [], canSubmit: true, reason: null, playHours: 0 };
const DEMO_GIVEAWAY: GiveawayView = { entries: 0, entered: false, open: true, drawn: false, winners: [], won: false, reason: null, playHours: 0 };

function FormBlock({ block: b, view = DEMO_FORM, slug, mode, login }: { block: PortalBlock; view?: FormView; slug: string; mode: Mode; login: string }) {
  const router = useRouter();
  const questions = formQuestions(b);
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const set = (i: number, v: string) => setAnswers((a) => a.map((x, j) => (j === i ? v : x)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "preview") return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/portal?action=form", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, blockId: b.id, answers }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(formError(data.error) ?? describeApiError(data, res.status));
      setSent(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ps-card ps-form">
      <h3>{String(b.p.title)}</h3>
      {b.p.text && <p className="ps-text">{String(b.p.text)}</p>}
      {view.responses.length > 0 && (
        <div className="ps-responses">
          {view.responses.map((r) => (
            <div key={r.id} data-status={r.status}>
              <b>{RESPONSE_STATUS_LABEL[r.status]}</b><span className="muted"> · envoyée le {new Date(r.createdAt).toLocaleDateString("fr-FR")}</span>
              {r.reply && <p className="ps-text">Réponse du staff : {r.reply}</p>}
            </div>
          ))}
        </div>
      )}
      {sent ? <p className="ps-ok"><Check size={15} />{String(b.p.success)}</p>
        : view.reason === "login" ? <a href={mode === "live" ? login : undefined} className="btn primary"><LogIn size={14} />Se connecter avec Discord pour répondre</a>
        : view.reason === "closed" ? <p className="muted">Ce formulaire est fermé pour le moment.</p>
        : view.reason === "once" ? null
        : view.reason === "playtime" ? <p className="muted">Il faut au moins {Number(b.p.minHours)} h de jeu sur le serveur pour répondre (tu en as {view.playHours}).</p>
        : (
          <form onSubmit={submit} className="ps-fields">
            {questions.map((q, i) => (
              <label key={i}>
                <span>{q.label}{q.required && <i> *</i>}</span>
                {q.type === "textarea" ? <textarea className="field" rows={4} maxLength={3000} value={answers[i]} onChange={(e) => set(i, e.target.value)} required={q.required} />
                  : q.type === "select" ? (
                    <select className="field" value={answers[i]} onChange={(e) => set(i, e.target.value)} required={q.required}>
                      <option value="">— Choisir —</option>
                      {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : q.type === "yesno" ? (
                    <div className="ps-yesno">{["Oui", "Non"].map((o) => <button key={o} type="button" className="btn sm" data-on={answers[i] === o} onClick={() => set(i, answers[i] === o ? "" : o)}>{o}</button>)}</div>
                  ) : <input className="field" type={q.type === "number" ? "number" : "text"} maxLength={300} value={answers[i]} onChange={(e) => set(i, e.target.value)} required={q.required} />}
              </label>
            ))}
            {error && <p className="error">{error}</p>}
            <button className="btn primary" disabled={busy || mode === "preview"}>{busy ? "Envoi…" : String(b.p.button)}</button>
          </form>
        )}
    </section>
  );
}

function GiveawayBlock({ block: b, view = DEMO_GIVEAWAY, slug, mode, login }: { block: PortalBlock; view?: GiveawayView; slug: string; mode: Mode; login: string }) {
  const [state, setState] = useState(view);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setState(view), [view]);

  async function act(action: "enter" | "leave") {
    if (mode === "preview") return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal?action=${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, blockId: b.id }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(formError(data.error) ?? describeApiError(data, res.status));
      setState(action === "enter" ? (data as GiveawayView) : { ...state, entered: false, entries: Math.max(0, state.entries - 1) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ps-card ps-giveaway">
      <div>
        <div className="ps-kicker"><Gift size={14} />Giveaway</div>
        <h3>{String(b.p.title)}</h3>
        <p className="ps-prize"><Trophy size={16} />{String(b.p.prize)}{Number(b.p.winners) > 1 ? ` · ${Number(b.p.winners)} gagnants` : ""}</p>
        {b.p.text && <p className="ps-text">{String(b.p.text)}</p>}
        <div className="ps-meta">
          <span><Users size={13} />{state.entries} inscrit{state.entries > 1 ? "s" : ""}</span>
          {b.p.endsAt && <span><Clock size={13} />{state.drawn ? "Tiré" : `Fin ${fmtDate(String(b.p.endsAt))}`}</span>}
          {Number(b.p.minHours) > 0 && <span>{Number(b.p.minHours)} h de jeu minimum</span>}
        </div>
        {state.drawn ? (
          <div className="ps-winners">
            {state.won && <p className="ps-ok"><PartyPopper size={15} />Bravo, tu as gagné !{b.p.rewardType !== "none" ? " Ta récompense arrive en jeu à ta prochaine connexion." : " Le staff va te contacter."}</p>}
            <b>Gagnant{state.winners.length > 1 ? "s" : ""} :</b> {state.winners.length ? state.winners.join(", ") : "aucun inscrit"}
          </div>
        ) : state.reason === "login" ? <a href={mode === "live" ? login : undefined} className="btn primary"><LogIn size={14} />Se connecter pour participer</a>
          : state.reason === "closed" ? <p className="muted">Inscriptions terminées : tirage en cours.</p>
          : state.reason === "playtime" ? <p className="muted">Il faut {Number(b.p.minHours)} h de jeu sur le serveur pour participer (tu en as {state.playHours}).</p>
          : state.entered ? <div className="ps-entered"><span className="ps-ok"><Check size={15} />Tu participes</span><button className="btn sm" disabled={busy} onClick={() => act("leave")}>Me retirer</button></div>
          : <button className="btn primary shine" disabled={busy || mode === "preview"} onClick={() => act("enter")}><Gift size={15} />Participer</button>}
        {error && <p className="error">{error}</p>}
      </div>
      {b.p.image ? <img className="ps-img" src={String(b.p.image)} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
    </section>
  );
}

function formError(code: string | undefined): string | null {
  switch (code) {
    case "answer_required": return "Réponds aux questions obligatoires.";
    case "answer_too_long": return "Une réponse est trop longue.";
    case "answer_number": return "Une réponse doit être un nombre.";
    case "answer_choice": return "Choisis une des réponses proposées.";
    case "form_too_soon": return "Tu viens déjà d'envoyer une réponse : réessaie dans quelques minutes.";
    case "form_too_many": return "Tu as déjà 3 réponses en attente.";
    case "form_closed": return "Ce formulaire est fermé.";
    case "form_once": return "Tu as déjà répondu.";
    case "form_playtime": case "giveaway_playtime": return "Pas assez d'heures de jeu sur le serveur.";
    case "giveaway_closed": return "Les inscriptions sont terminées.";
    case "unknown_block": return "Ce bloc n'existe plus : recharge la page.";
    default: return null;
  }
}
