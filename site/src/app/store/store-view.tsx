"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { connectLink, packageIndex, type StoreBlock, type StoreData, type StoreDesign, type StorePackage } from "@/lib/store-design";
import { formatMoney } from "@/lib/tebex-shared";
import "./store.css";

type Props = {
  design: StoreDesign;
  data: StoreData;
  slug: string;
  /** "preview": inside the editor (no payment, blocks selectable). */
  mode: "live" | "preview";
  selected?: string | null;
  onSelect?: (blockId: string) => void;
};

type CartLine = { packageId: number; quantity: number };
type Codes = { coupon: string; giftCard: string; creatorCode: string };
type Finish = {
  ident: string; username: string | null; total: number; currency: string; checkoutUrl: string | null;
  lines: { name: string; quantity: number; price: number }[]; codes: { kind: string; code: string; ok: boolean; message: string | null }[]; needsLogin: boolean;
};
type Flow =
  | { step: "idle" }
  | { step: "busy"; label: string }
  | { step: "login"; ident: string; auth: { name: string; url: string }[] }
  | { step: "ready"; finish: Finish }
  | { step: "error"; message: string };

declare global {
  interface Window {
    Tebex?: { checkout: { init: (o: Record<string, unknown>) => void; launch: () => void; on: (event: string, cb: () => void) => void } };
  }
}

// ---- pure helpers ----

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function fontsHref(design: StoreDesign): string {
  const fams = [...new Set([design.theme.font, design.theme.headingFont])];
  return `https://fonts.googleapis.com/css2?${fams.map((f) => `family=${f.replace(/ /g, "+")}:wght@400;500;600;700;800`).join("&")}&display=swap`;
}

const relative = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `il y a ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `il y a ${Math.round(s / 86400)} j`;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const nums = (v: unknown) => (Array.isArray(v) ? (v as number[]) : []);
const paragraphs = (t: string) => t.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

const ERRORS: Record<string, string> = {
  store_unavailable: "Cette boutique n'est pas disponible pour le moment.",
  basket_complete: "Ce panier a déjà été payé. Merci !",
  empty_basket: "Ton panier est vide.",
  package_refused: "Tebex a refusé un des packages (déjà possédé, limite d'achat atteinte ou réservé à certains joueurs).",
  rate_limited: "Trop de tentatives : réessaie dans quelques minutes.",
  tebex_unreachable: "Tebex ne répond pas : réessaie dans un instant.",
  tebex_not_found: "Panier expiré : recommence ton achat."
};

// ---- component ----

export default function StoreView({ design, data, slug, mode, selected, onSelect }: Props) {
  const t = design.theme;
  const preview = mode === "preview";
  const pkgs = useMemo(() => packageIndex(data), [data]);
  const cartKey = `fvx-cart:${slug}`;
  const flowKey = `fvx-checkout:${slug}`;
  const [cart, setCart] = useState<CartLine[]>([]);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<StorePackage | null>(null);
  const [codes, setCodes] = useState<Codes>({ coupon: "", giftCard: "", creatorCode: "" });
  const [flow, setFlow] = useState<Flow>({ step: "idle" });
  const [paid, setPaid] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const loaded = useRef(false);

  const vars = {
    "--sf-bg": t.bg, "--sf-surface": t.surface, "--sf-text": t.text, "--sf-muted": t.muted, "--sf-accent": t.accent, "--sf-accent2": t.accent2,
    "--sf-radius": `${t.radius}px`, "--sf-font": `"${t.font}", system-ui, sans-serif`, "--sf-head": `"${t.headingFont}", "${t.font}", system-ui, sans-serif`,
    "--sf-on-accent": luminance(t.accent) > 0.45 ? "#0b0b0b" : "#ffffff",
    "--sf-bg-image": t.background === "image" && t.backgroundImage ? `url("${t.backgroundImage}")` : "none"
  } as React.CSSProperties;
  const light = luminance(t.bg) > 0.5;

  const say = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((cur) => (cur === m ? null : cur)), 3200);
  }, []);

  // Cart survives a reload and the round trip to the Cfx.re sign-in.
  useEffect(() => {
    if (preview) return;
    try {
      const saved = JSON.parse(localStorage.getItem(cartKey) ?? "[]") as CartLine[];
      if (Array.isArray(saved)) setCart(saved.filter((l) => pkgs.has(l.packageId)));
    } catch { /* storage unavailable */ }
    loaded.current = true;
  }, [cartKey, pkgs, preview]);
  useEffect(() => {
    if (preview || !loaded.current) return;
    try {
      localStorage.setItem(cartKey, JSON.stringify(cart));
    } catch { /* storage unavailable */ }
  }, [cart, cartKey, preview]);

  const count = cart.reduce((n, l) => n + l.quantity, 0);
  const estimate = cart.reduce((sum, l) => sum + (pkgs.get(l.packageId)?.price ?? 0) * l.quantity, 0);

  function add(p: StorePackage, quiet = false) {
    setCart((c) => {
      const line = c.find((l) => l.packageId === p.id);
      if (line) return p.quantity ? c.map((l) => (l.packageId === p.id ? { ...l, quantity: Math.min(99, l.quantity + 1) } : l)) : c;
      return [...c, { packageId: p.id, quantity: 1 }];
    });
    if (!quiet) say(`${p.name} ajouté au panier`);
  }
  const setQty = (id: number, q: number) => setCart((c) => (q <= 0 ? c.filter((l) => l.packageId !== id) : c.map((l) => (l.packageId === id ? { ...l, quantity: Math.min(99, q) } : l))));

  async function post(body: Record<string, unknown>) {
    const res = await fetch(`/api/store/${slug}/checkout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(json.error ?? `http_${res.status}`));
    return json as Record<string, unknown>;
  }

  const finish = useCallback(async (ident: string, lines: CartLine[], c: Codes) => {
    setFlow({ step: "busy", label: "Préparation de ton panier…" });
    try {
      const r = (await post({ step: "finish", ident, items: lines, ...c })) as unknown as Finish;
      if (r.needsLogin) {
        setFlow({ step: "error", message: "Connexion Cfx.re non terminée : recommence et connecte-toi avec ton compte FiveM." });
        return;
      }
      setFlow({ step: "ready", finish: r });
    } catch (e) {
      setFlow({ step: "error", message: ERRORS[(e as Error).message] ?? "Impossible de préparer le paiement. Réessaie dans un instant." });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Back from the Cfx.re sign-in (?basket=…) or from the payment (?paid=1).
  useEffect(() => {
    if (preview) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("paid") === "1") {
      setPaid(true);
      setCart([]);
      try {
        localStorage.removeItem(cartKey);
        localStorage.removeItem(flowKey);
      } catch { /* ignore */ }
    }
    const ident = url.searchParams.get("basket");
    if (ident && /^[\w-]{6,80}$/.test(ident)) {
      let saved: { ident?: string; items?: CartLine[]; codes?: Codes } = {};
      try {
        saved = JSON.parse(localStorage.getItem(flowKey) ?? "{}");
      } catch { /* ignore */ }
      if (saved.ident === ident && saved.items?.length) {
        setOpen(true);
        void finish(ident, saved.items, saved.codes ?? { coupon: "", giftCard: "", creatorCode: "" });
      }
    }
    if (url.searchParams.has("basket") || url.searchParams.has("paid")) {
      url.searchParams.delete("basket");
      url.searchParams.delete("paid");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }, [cartKey, finish, flowKey, preview]);

  async function checkout() {
    if (preview) return say("Aperçu : le paiement est désactivé dans l'éditeur.");
    if (!cart.length) return;
    setFlow({ step: "busy", label: "Ouverture de la connexion sécurisée…" });
    try {
      const r = (await post({ step: "start" })) as { ident: string; auth: { name: string; url: string }[] };
      try {
        localStorage.setItem(flowKey, JSON.stringify({ ident: r.ident, items: cart, codes }));
      } catch { /* ignore */ }
      if (!r.auth.length) return finish(r.ident, cart, codes);
      if (r.auth.length === 1) {
        setFlow({ step: "busy", label: `Connexion avec ${r.auth[0].name}…` });
        window.location.href = r.auth[0].url;
        return;
      }
      setFlow({ step: "login", ident: r.ident, auth: r.auth });
    } catch (e) {
      setFlow({ step: "error", message: ERRORS[(e as Error).message] ?? "Impossible de démarrer le paiement. Réessaie dans un instant." });
    }
  }

  function pay(f: Finish) {
    const launch = () => {
      const tebex = window.Tebex;
      if (!tebex?.checkout) {
        if (f.checkoutUrl) window.location.href = f.checkoutUrl;
        return;
      }
      try {
        tebex.checkout.init({
          ident: f.ident,
          theme: design.checkout.theme === "auto" ? (light ? "light" : "dark") : design.checkout.theme,
          colors: [{ name: "primary", color: t.accent }, { name: "secondary", color: t.accent2 }]
        });
        tebex.checkout.on("payment:complete", () => {
          setPaid(true);
          setCart([]);
          setOpen(false);
          setFlow({ step: "idle" });
          try {
            localStorage.removeItem(cartKey);
            localStorage.removeItem(flowKey);
          } catch { /* ignore */ }
        });
        tebex.checkout.launch();
      } catch {
        if (f.checkoutUrl) window.location.href = f.checkoutUrl;
      }
    };
    if (window.Tebex) return launch();
    const script = document.createElement("script");
    script.src = "https://js.tebex.io/v/1.js";
    script.onload = launch;
    script.onerror = () => f.checkoutUrl && (window.location.href = f.checkoutUrl);
    document.head.appendChild(script);
  }

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const offersId = design.blocks.find((b) => b.type === "categories" || b.type === "packages")?.id;
  const join = design.brand.connect ? connectLink(design.brand.connect) : "";

  const ctx: BlockCtx = { design, data, pkgs, preview, add, view: setDetail, scrollTo, offersId, join };
  const blocks = design.blocks.filter((b) => preview || !b.hidden);

  return (
    <div className="sf" style={vars} data-bg={t.background} data-cards={t.cards} data-buttons={t.buttons} data-caps={t.caps || undefined} data-light={light || undefined} data-mode={mode}>
      <link rel="stylesheet" href={fontsHref(design)} precedence="default" />
      {design.brand.announcement && <div className="sf-announce">{design.brand.announcement}</div>}

      <header className="sf-nav">
        <div className="sf-wrap sf-nav-in">
          <a className="sf-logo" href="#top" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
            {design.brand.logo ? <img src={design.brand.logo} alt="" /> : <span className="sf-logo-mark">{design.brand.name.slice(0, 1)}</span>}
            <span>{design.brand.name}</span>
          </a>
          <nav>
            {offersId && <button type="button" onClick={() => scrollTo(offersId)}>Offres</button>}
            {design.brand.discord && <a href={design.brand.discord} target="_blank" rel="noreferrer">Discord</a>}
            {design.brand.website && <a href={design.brand.website} target="_blank" rel="noreferrer">Site</a>}
            <button type="button" className="sf-cart-btn" onClick={() => setOpen(true)} aria-label={`Panier, ${count} article(s)`}>
              <CartIcon />{count > 0 && <b>{count}</b>}
            </button>
          </nav>
        </div>
      </header>

      {paid && (
        <div className="sf-wrap"><div className="sf-paid"><b>Merci pour ton soutien !</b> Ton paiement est validé : tes avantages arrivent en jeu dès ta prochaine connexion au serveur.</div></div>
      )}

      <main id="top">
        {blocks.map((b) => (
          <section
            key={b.id}
            id={b.id}
            className="sf-block"
            data-type={b.type}
            data-hidden={b.hidden || undefined}
            data-selected={preview && selected === b.id ? true : undefined}
            onClickCapture={preview && onSelect ? () => onSelect(b.id) : undefined}
          >
            <Block block={b} ctx={ctx} />
          </section>
        ))}
        {blocks.length === 0 && <div className="sf-wrap sf-empty">Ajoute un premier bloc pour construire ta boutique.</div>}
      </main>

      <footer className="sf-foot">
        <div className="sf-wrap sf-foot-in">
          <div>
            <b>{design.brand.name}</b>
            {design.brand.tagline && <p>{design.brand.tagline}</p>}
            {design.legal.notice && <p className="sf-notice">{design.legal.notice}</p>}
          </div>
          <div className="sf-foot-links">
            {design.legal.terms && <a href={design.legal.terms} target="_blank" rel="noreferrer">Conditions de vente</a>}
            {design.legal.privacy && <a href={design.legal.privacy} target="_blank" rel="noreferrer">Confidentialité</a>}
            <span className="sf-secure"><LockIcon /> Paiement sécurisé par Tebex</span>
          </div>
        </div>
        <div className="sf-wrap sf-foot-legal">
          Ce serveur n&apos;est pas affilié à Rockstar Games ni à Take-Two Interactive.
          {design.branding && <a className="sf-powered" href="/" target="_blank" rel="noreferrer">Boutique propulsée par <b>Fiverax</b></a>}
        </div>
      </footer>

      {detail && (
        <div className="sf-veil" onMouseDown={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="sf-modal" role="dialog" aria-label={detail.name}>
            <button type="button" className="sf-x" onClick={() => setDetail(null)} aria-label="Fermer">×</button>
            <PackageArt pkg={detail} big />
            <div className="sf-modal-body">
              <h3>{detail.name}</h3>
              <Price pkg={detail} />
              {detail.type === "subscription" && <span className="sf-chip">Abonnement</span>}
              {detail.description ? paragraphs(detail.description).map((p, i) => <p key={i}>{p}</p>) : <p className="sf-muted">Aucune description.</p>}
              <div className="sf-row">
                <button type="button" className="sf-btn" onClick={() => { add(detail); setDetail(null); }}>Ajouter au panier</button>
                <button type="button" className="sf-btn ghost" onClick={() => { add(detail, true); setDetail(null); setOpen(true); }}>Acheter maintenant</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {open && (
        <div className="sf-veil" onMouseDown={(e) => e.target === e.currentTarget && flow.step !== "busy" && setOpen(false)}>
          <aside className="sf-drawer" role="dialog" aria-label="Panier">
            <div className="sf-drawer-head">
              <h3>Ton panier</h3>
              <button type="button" className="sf-x" onClick={() => setOpen(false)} aria-label="Fermer">×</button>
            </div>

            {flow.step === "ready" ? (
              <div className="sf-drawer-body">
                <div className="sf-who"><span className="sf-dot" />Connecté en tant que <b>{flow.finish.username ?? "joueur"}</b></div>
                {flow.finish.lines.map((l, i) => (
                  <div key={i} className="sf-line"><div><b>{l.name}</b><small>× {l.quantity}</small></div><span>{formatMoney(l.price * l.quantity, flow.finish.currency)}</span></div>
                ))}
                {flow.finish.codes.map((c) => (
                  <div key={c.kind} className="sf-code" data-ok={c.ok}>{c.ok ? "✓" : "✗"} {c.kind === "coupon" ? "Code promo" : c.kind === "giftcard" ? "Carte cadeau" : "Code créateur"} {c.code}{!c.ok && c.message ? ` : ${c.message}` : ""}</div>
                ))}
                <div className="sf-total"><span>Total</span><b>{formatMoney(flow.finish.total, flow.finish.currency)}</b></div>
                <button type="button" className="sf-btn wide" onClick={() => pay(flow.finish)}>Payer en toute sécurité</button>
                <button type="button" className="sf-link" onClick={() => setFlow({ step: "idle" })}>Modifier le panier</button>
                <p className="sf-fine">Le paiement s&apos;ouvre dans une fenêtre sécurisée Tebex. Tes avantages arrivent en jeu sur le compte <b>{flow.finish.username}</b>.</p>
              </div>
            ) : flow.step === "login" ? (
              <div className="sf-drawer-body">
                <p>Connecte-toi avec ton compte de jeu : c&apos;est lui qui reçoit tes avantages.</p>
                {flow.auth.map((a) => <a key={a.url} className="sf-btn wide" href={a.url}>Continuer avec {a.name}</a>)}
                <button type="button" className="sf-link" onClick={() => setFlow({ step: "idle" })}>Annuler</button>
              </div>
            ) : (
              <div className="sf-drawer-body">
                {cart.length === 0 && <p className="sf-muted">Ton panier est vide. Ajoute une offre pour commencer.</p>}
                {cart.map((l) => {
                  const p = pkgs.get(l.packageId);
                  if (!p) return null;
                  return (
                    <div key={l.packageId} className="sf-line">
                      <PackageArt pkg={p} small />
                      <div><b>{p.name}</b><small>{formatMoney(p.price, p.currency)}</small></div>
                      <div className="sf-qty">
                        {p.quantity && <button type="button" onClick={() => setQty(p.id, l.quantity - 1)} aria-label="Moins">−</button>}
                        {p.quantity && <span>{l.quantity}</span>}
                        {p.quantity && <button type="button" onClick={() => setQty(p.id, l.quantity + 1)} aria-label="Plus">+</button>}
                        <button type="button" className="sf-rm" onClick={() => setQty(p.id, 0)} aria-label="Retirer">×</button>
                      </div>
                    </div>
                  );
                })}
                {cart.length > 0 && (
                  <>
                    {(design.checkout.coupon || design.checkout.giftCard || design.checkout.creatorCode) && (
                      <details className="sf-codes">
                        <summary>Un code promo ou une carte cadeau ?</summary>
                        {design.checkout.coupon && <input value={codes.coupon} onChange={(e) => setCodes({ ...codes, coupon: e.target.value })} placeholder="Code promo" maxLength={60} />}
                        {design.checkout.giftCard && <input value={codes.giftCard} onChange={(e) => setCodes({ ...codes, giftCard: e.target.value })} placeholder="Carte cadeau" maxLength={60} />}
                        {design.checkout.creatorCode && <input value={codes.creatorCode} onChange={(e) => setCodes({ ...codes, creatorCode: e.target.value })} placeholder="Code créateur" maxLength={60} />}
                      </details>
                    )}
                    <div className="sf-total"><span>Total estimé</span><b>{formatMoney(estimate, data.currency)}</b></div>
                    <button type="button" className="sf-btn wide" onClick={checkout} disabled={flow.step === "busy"}>
                      {flow.step === "busy" ? flow.label : "Passer au paiement"}
                    </button>
                    {flow.step === "error" && <p className="sf-error">{flow.message}</p>}
                    <p className="sf-fine">Tu te connectes avec ton compte Cfx.re (FiveM), puis tu paies chez Tebex. Taxes et réductions calculées à l&apos;étape suivante.</p>
                  </>
                )}
              </div>
            )}
          </aside>
        </div>
      )}

      {toast && <div className="sf-toast" role="status">{toast}</div>}
    </div>
  );
}

// ---- blocks ----

type BlockCtx = {
  design: StoreDesign; data: StoreData; pkgs: Map<number, StorePackage>; preview: boolean;
  add: (p: StorePackage) => void; view: (p: StorePackage) => void; scrollTo: (id: string) => void; offersId?: string; join: string;
};

function Hint({ ctx, children }: { ctx: BlockCtx; children: React.ReactNode }) {
  return ctx.preview ? <div className="sf-wrap"><div className="sf-hint">{children}</div></div> : null;
}

function Block({ block: b, ctx }: { block: StoreBlock; ctx: BlockCtx }) {
  const p = b.p;
  switch (b.type) {
    case "hero": {
      const s = ctx.data.server;
      return (
        <div className="sf-hero" data-size={str(p.size)} data-align={str(p.align)} style={p.image ? ({ "--hero-img": `url("${str(p.image)}")` } as React.CSSProperties) : undefined} data-img={p.image ? true : undefined}>
          <div className="sf-wrap sf-hero-in">
            {str(p.kicker) && <span className="sf-kicker">{str(p.kicker)}</span>}
            <h1>{str(p.title)}</h1>
            {str(p.subtitle) && <p>{str(p.subtitle)}</p>}
            <div className="sf-row">
              {str(p.cta) && <button type="button" className="sf-btn lg" onClick={() => ctx.offersId && ctx.scrollTo(ctx.offersId)}>{str(p.cta)}</button>}
              {ctx.join && <a className="sf-btn ghost lg" href={ctx.join}>Jouer maintenant</a>}
            </div>
            {p.live === true && s?.online && <span className="sf-live"><span className="sf-dot" />{s.players} joueur{s.players > 1 ? "s" : ""} en ligne{s.max ? ` / ${s.max}` : ""}</span>}
          </div>
        </div>
      );
    }
    case "server": {
      const s = ctx.data.server;
      if (!s) return <Hint ctx={ctx}>Statut du serveur : relie l&apos;agent FiveM (Configuration) pour afficher les joueurs en ligne.</Hint>;
      const pct = s.max ? Math.min(100, Math.round((s.players / s.max) * 100)) : 0;
      return (
        <div className="sf-wrap">
          <div className="sf-card sf-server">
            <div className="sf-server-state" data-on={s.online || undefined}><span className="sf-dot" />{s.online ? "En ligne" : "Hors ligne"}</div>
            <div className="sf-server-main">
              <h2>{s.online ? str(p.title) : "Le serveur redémarre"}</h2>
              <p>{str(p.text)}</p>
            </div>
            <div className="sf-server-count">
              <b>{s.players}<small>/{s.max || "?"}</small></b>
              <span>joueurs</span>
              <div className="sf-meter"><i style={{ width: `${pct}%` }} /></div>
            </div>
            {ctx.join ? <a className="sf-btn" href={ctx.join}>{str(p.button)}</a> : ctx.preview ? <span className="sf-hint-inline">Ajoute l&apos;adresse de connexion (Réglages) pour le bouton</span> : null}
          </div>
        </div>
      );
    }
    case "featured": {
      const pkg = typeof p.packageId === "number" ? ctx.pkgs.get(p.packageId) : undefined;
      if (!pkg) return <Hint ctx={ctx}>Package à la une : choisis un package dans les réglages du bloc.</Hint>;
      const img = str(p.image) || pkg.image;
      return (
        <div className="sf-wrap">
          <div className="sf-featured sf-card" data-style={str(p.style)} style={img ? ({ "--feat-img": `url("${img}")` } as React.CSSProperties) : undefined}>
            {str(p.style) !== "banner" && <div className="sf-featured-art">{img ? <img src={img} alt="" /> : <PackageArt pkg={pkg} big />}</div>}
            <div className="sf-featured-body">
              {str(p.badge) && <span className="sf-badge">{str(p.badge)}</span>}
              <h2>{pkg.name}</h2>
              <Price pkg={pkg} big />
              {paragraphs(str(p.text) || pkg.description).slice(0, 3).map((t, i) => <p key={i}>{t}</p>)}
              <div className="sf-row">
                <button type="button" className="sf-btn lg" onClick={() => ctx.add(pkg)}>Ajouter au panier</button>
                <button type="button" className="sf-btn ghost lg" onClick={() => ctx.view(pkg)}>Détails</button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    case "categories":
      return <Categories p={p} ctx={ctx} />;
    case "packages": {
      const list = nums(p.packageIds).map((id) => ctx.pkgs.get(id)).filter((x): x is StorePackage => Boolean(x));
      if (!list.length) return <Hint ctx={ctx}>Sélection : choisis les packages à montrer dans les réglages du bloc.</Hint>;
      return (
        <div className="sf-wrap">
          {str(p.title) && <h2 className="sf-h2">{str(p.title)}</h2>}
          <PackageList list={list} layout={str(p.layout)} columns={Number(p.columns) || 3} ctx={ctx} descriptions />
        </div>
      );
    }
    case "promo":
      return <Promo p={p} ctx={ctx} />;
    case "goal": {
      const goal = (typeof p.goalId === "number" ? ctx.data.goals.find((g) => g.id === p.goalId) : undefined) ?? ctx.data.goals[0];
      if (!goal) return <Hint ctx={ctx}>Objectif : crée un objectif communautaire actif dans Tebex (et la clé secrète dans Réglages boutique).</Hint>;
      const pct = Math.min(100, Math.round((goal.current / Math.max(goal.target, 0.01)) * 100));
      return (
        <div className="sf-wrap">
          <div className="sf-card sf-goal">
            <div><span className="sf-kicker">{str(p.title)}</span><h2>{goal.name}</h2>{str(p.text) && <p>{str(p.text)}</p>}</div>
            <div className="sf-goal-bar"><i style={{ width: `${pct}%` }} /></div>
            <div className="sf-goal-meta"><b>{pct} %</b><span>{formatMoney(goal.current, ctx.data.currency)} sur {formatMoney(goal.target, ctx.data.currency)}</span></div>
          </div>
        </div>
      );
    }
    case "recent": {
      const list = ctx.data.recent.slice(0, Number(p.count) || 6);
      if (!list.length) return <Hint ctx={ctx}>Derniers achats : ils apparaîtront dès les premiers webhooks Tebex reçus.</Hint>;
      return (
        <div className="sf-wrap">
          {str(p.title) && <h2 className="sf-h2">{str(p.title)}</h2>}
          <div className="sf-recent">
            {list.map((r, i) => (
              <div key={i} className="sf-card sf-recent-item">
                <span className="sf-avatar">{p.anonymous || !r.name ? "★" : r.name.slice(0, 1).toUpperCase()}</span>
                <div><b>{p.anonymous || !r.name ? "Un joueur" : r.name}</b><small>{r.item}</small></div>
                <time>{relative(r.at)}</time>
              </div>
            ))}
          </div>
        </div>
      );
    }
    case "top": {
      const top = ctx.data.top;
      if (!top) return <Hint ctx={ctx}>Soutien du mois : apparaîtra avec les premiers achats reçus.</Hint>;
      return (
        <div className="sf-wrap">
          <div className="sf-card sf-top">
            <span className="sf-trophy">🏆</span>
            <div><span className="sf-kicker">{str(p.title)}</span><h2>{top.name}</h2><p>{str(p.text)}{p.amount === true ? ` · ${formatMoney(top.amount, ctx.data.currency)}` : ""}</p></div>
          </div>
        </div>
      );
    }
    case "features": {
      const items = Array.isArray(p.items) ? (p.items as Record<string, string>[]) : [];
      return (
        <div className="sf-wrap">
          {str(p.title) && <h2 className="sf-h2 center">{str(p.title)}</h2>}
          <div className="sf-features">
            {items.map((it, i) => (
              <div key={i} className="sf-card sf-feature">{it.icon && <span className="sf-feature-ic">{it.icon}</span>}<h3>{it.title}</h3><p>{it.text}</p></div>
            ))}
          </div>
        </div>
      );
    }
    case "text":
      return (
        <div className="sf-wrap sf-text" data-align={str(p.align)}>
          {str(p.title) && <h2 className="sf-h2">{str(p.title)}</h2>}
          {paragraphs(str(p.body)).map((t, i) => <p key={i}>{t}</p>)}
        </div>
      );
    case "faq": {
      const items = Array.isArray(p.items) ? (p.items as Record<string, string>[]) : [];
      return (
        <div className="sf-wrap sf-faq">
          {str(p.title) && <h2 className="sf-h2 center">{str(p.title)}</h2>}
          {items.map((it, i) => <details key={i} className="sf-card"><summary>{it.q}</summary><p>{it.a}</p></details>)}
        </div>
      );
    }
    case "discord": {
      if (!ctx.design.brand.discord) return <Hint ctx={ctx}>Discord : ajoute le lien d&apos;invitation dans Réglages &gt; Identité.</Hint>;
      return (
        <div className="sf-wrap">
          <div className="sf-discord">
            <DiscordIcon />
            <div><h2>{str(p.title)}</h2><p>{str(p.text)}</p></div>
            <a className="sf-btn lg" href={ctx.design.brand.discord} target="_blank" rel="noreferrer">{str(p.button)}</a>
          </div>
        </div>
      );
    }
    case "image": {
      if (!str(p.url)) return <Hint ctx={ctx}>Image : colle le lien https d&apos;une image.</Hint>;
      const img = <img src={str(p.url)} alt={str(p.caption)} loading="lazy" />;
      return (
        <div className="sf-wrap">
          <figure className="sf-image">{str(p.link) ? <a href={str(p.link)} target="_blank" rel="noreferrer">{img}</a> : img}{str(p.caption) && <figcaption>{str(p.caption)}</figcaption>}</figure>
        </div>
      );
    }
    case "spacer":
      return <div className="sf-spacer" data-size={str(p.size)} />;
  }
}

function Categories({ p, ctx }: { p: StoreBlock["p"]; ctx: BlockCtx }) {
  const chosen = nums(p.categoryIds);
  const cats = (chosen.length ? chosen.map((id) => ctx.data.categories.find((c) => c.id === id)) : ctx.data.categories).filter(
    (c): c is StoreData["categories"][number] => Boolean(c && c.packages.length)
  );
  const [tab, setTab] = useState<number | null>(null);
  if (!cats.length) {
    return ctx.preview ? <Hint ctx={ctx}>{ctx.data.error ? "Catalogue illisible : vérifie le token public dans Réglages boutique." : "Aucun package en vente dans ces catégories."}</Hint> : null;
  }
  const tabs = p.tabs === true && cats.length > 1;
  const current = tabs ? cats.find((c) => c.id === tab) ?? cats[0] : null;
  const layout = str(p.layout);
  const columns = Number(p.columns) || 3;
  return (
    <div className="sf-wrap">
      {str(p.title) && <h2 className="sf-h2">{str(p.title)}</h2>}
      {tabs && current ? (
        <>
          <div className="sf-tabs" role="tablist">
            {cats.map((c) => <button key={c.id} type="button" role="tab" aria-selected={c.id === current.id} onClick={() => setTab(c.id)}>{c.name}<small>{c.packages.length}</small></button>)}
          </div>
          {p.descriptions === true && current.description && <p className="sf-muted sf-cat-desc">{current.description}</p>}
          <PackageList list={current.packages} layout={layout} columns={columns} ctx={ctx} descriptions={p.descriptions === true} />
        </>
      ) : (
        cats.map((c) => (
          <div key={c.id} className="sf-cat">
            {cats.length > 1 && <h3 className="sf-h3">{c.name}</h3>}
            {p.descriptions === true && c.description && <p className="sf-muted sf-cat-desc">{c.description}</p>}
            <PackageList list={c.packages} layout={layout} columns={columns} ctx={ctx} descriptions={p.descriptions === true} />
          </div>
        ))
      )}
    </div>
  );
}

function PackageList({ list, layout, columns, ctx, descriptions }: { list: StorePackage[]; layout: string; columns: number; ctx: BlockCtx; descriptions: boolean }) {
  return (
    <div className="sf-packages" data-layout={layout} style={{ "--cols": columns } as React.CSSProperties}>
      {list.map((pkg) => (
        <article key={pkg.id} className="sf-card sf-pkg">
          <button type="button" className="sf-pkg-art" onClick={() => ctx.view(pkg)} aria-label={`Détails de ${pkg.name}`}>
            <PackageArt pkg={pkg} />
            {pkg.discount > 0 && <span className="sf-badge sf-pkg-badge">Promo</span>}
          </button>
          <div className="sf-pkg-body">
            <h3>{pkg.name}</h3>
            {descriptions && pkg.description && <p>{pkg.description}</p>}
            <div className="sf-pkg-foot">
              <Price pkg={pkg} />
              <button type="button" className="sf-btn sm" onClick={() => ctx.add(pkg)}>Ajouter</button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function Promo({ p, ctx }: { p: StoreBlock["p"]; ctx: BlockCtx }) {
  const end = str(p.endsAt) ? new Date(str(p.endsAt).length === 10 ? `${str(p.endsAt)}T23:59:59` : str(p.endsAt)).getTime() : 0;
  const [now, setNow] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setNow(Date.now());
    if (!end) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [end]);
  const left = end && now ? Math.max(0, end - now) : 0;
  if (end && now && left === 0 && !ctx.preview) return null; // promo over
  const units: [string, number][] = [
    ["j", Math.floor(left / 86400000)],
    ["h", Math.floor(left / 3600000) % 24],
    ["min", Math.floor(left / 60000) % 60],
    ["s", Math.floor(left / 1000) % 60]
  ];
  async function copy() {
    try {
      await navigator.clipboard.writeText(str(p.code));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* ignore */ }
  }
  return (
    <div className="sf-wrap">
      <div className="sf-promo">
        <div><h2>{str(p.title)}</h2>{str(p.text) && <p>{str(p.text)}</p>}</div>
        {end > 0 && now !== null && (
          <div className="sf-count" aria-label="Temps restant">
            {units.map(([label, value]) => <span key={label}><b>{String(value).padStart(2, "0")}</b><small>{label}</small></span>)}
          </div>
        )}
        {str(p.code) && <button type="button" className="sf-promo-code" onClick={copy}>{copied ? "Copié !" : str(p.code)}<small>{copied ? "" : "copier"}</small></button>}
      </div>
    </div>
  );
}

function Price({ pkg, big }: { pkg: StorePackage; big?: boolean }) {
  const was = pkg.discount > 0 ? pkg.price + pkg.discount : pkg.basePrice > pkg.price ? pkg.basePrice : 0;
  return (
    <span className="sf-price" data-big={big || undefined}>
      <b>{formatMoney(pkg.price, pkg.currency)}</b>
      {was > pkg.price && <s>{formatMoney(was, pkg.currency)}</s>}
      {pkg.type === "subscription" && <small>/ mois</small>}
    </span>
  );
}

function PackageArt({ pkg, big, small }: { pkg: StorePackage; big?: boolean; small?: boolean }) {
  const cls = `sf-art${big ? " big" : ""}${small ? " small" : ""}`;
  if (pkg.image) return <span className={cls}><img src={pkg.image} alt="" loading="lazy" /></span>;
  return <span className={`${cls} empty`}><b>{pkg.name.slice(0, 1).toUpperCase()}</b></span>;
}

const CartIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 7h15l-1.6 8.2a2 2 0 0 1-2 1.6H9.2a2 2 0 0 1-2-1.6L5 3H2" /><circle cx="9.5" cy="20.5" r="1.2" /><circle cx="17.5" cy="20.5" r="1.2" />
  </svg>
);
const LockIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
);
const DiscordIcon = () => (
  <svg className="sf-discord-ic" width="44" height="44" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18 18 0 0 0-5.6 0L8.6 3a19.6 19.6 0 0 0-4.9 1.5C.6 9.1-.3 13.7.1 18.2a19.8 19.8 0 0 0 6 3l1.3-2.1a12.8 12.8 0 0 1-2-1l.5-.4a14.1 14.1 0 0 0 12.2 0l.5.4a12.8 12.8 0 0 1-2 1l1.3 2.1a19.7 19.7 0 0 0 6-3c.5-5.2-.8-9.8-3.6-13.8ZM8 15.4c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.6 8 10.6s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z" />
  </svg>
);
