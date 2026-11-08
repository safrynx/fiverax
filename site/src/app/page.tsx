import type { Metadata } from "next";
import Link from "next/link";
import { Activity, ArrowRight, BadgeCheck, Blocks, Gift, ScanSearch, Building2, Code2, CreditCard, Gamepad2, KeyRound, Mic, Radio, ScrollText, ShieldAlert, ShoppingBag, Smartphone, Sparkles, TrendingUp, Users, WandSparkles } from "lucide-react";
import { PERMISSIONS } from "@/lib/permissions";
import { getIdentity } from "@/lib/auth";
import { Mark, Wordmark } from "./brand";
import ScanForm from "./scan/scan-form";
import { LEGAL_LINKS } from "@/lib/legal";
import { jsonLd, OG_BASE, ORGANIZATION_ID, SITE_DESCRIPTION, SITE_URL, WEBSITE_ID } from "@/lib/site";
import "./growth.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { ...OG_BASE, url: "/", title: "Fiverax · Panel staff FiveM, boutique Tebex et anticheat", description: "Le panel de ton serveur FiveM, piloté depuis Discord : staff, boutique Tebex, anticheat et scan de sécurité." }
};

/** Who Fiverax is and what it is, for search engines and AI answers. No price or rating: none is shown on the page. */
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": ORGANIZATION_ID, name: "Fiverax", url: `${SITE_URL}/`, logo: `${SITE_URL}/logo.png`, description: SITE_DESCRIPTION },
    { "@type": "WebSite", "@id": WEBSITE_ID, url: `${SITE_URL}/`, name: "Fiverax", inLanguage: "fr", publisher: { "@id": ORGANIZATION_ID } },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#app`,
      name: "Fiverax",
      url: `${SITE_URL}/`,
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Gestion de serveur FiveM",
      operatingSystem: "Web",
      inLanguage: "fr",
      description: SITE_DESCRIPTION,
      featureList: ["Gestion du staff et des grades Discord", "Avertissements et logs", "Temps en vocal et en jeu", "Bilan IA hebdomadaire", "Boutique Tebex avec Store Creator IA", "Anticheat", "Scan de sécurité"],
      publisher: { "@id": ORGANIZATION_ID }
    }
  ]
};

const features = [
  { icon: Users, title: "Gestion du staff", text: "Up, down, derank, recrutement : chaque changement de grade est appliqué directement sur les rôles Discord." },
  { icon: Activity, title: "Activité réelle", text: "Temps en vocal Discord et temps de jeu FiveM, par membre, sur la semaine. Tu vois qui est là, et qui ne l'est plus." },
  { icon: ShieldAlert, title: "Avertissements", text: "Trois niveaux d'avert, des commentaires et des pastilles pour suivre chaque membre dans la durée." },
  { icon: Sparkles, title: "Bilan IA du dimanche", text: "Chaque semaine, une synthèse des commentaires et de l'activité, avec une appréciation par membre." },
  { icon: KeyRound, title: "Permissions fines", text: `${PERMISSIONS.length} permissions à donner à une personne ou à un rôle Discord. Chacun ne voit que ce qu'il doit voir.` },
  { icon: ScrollText, title: "Logs complets", text: "Qui a fait quoi, sur qui, et quand. Chaque action du panel est tracée et consultable." }
];

const modules = [
  { icon: Users, title: "Staff", text: "Grades, avertissements, activité, bilan hebdo.", live: true },
  { icon: ShoppingBag, title: "Boutique Tebex", text: "Store Creator, ventes, paiements, promos et clients.", live: true },
  { icon: ShieldAlert, title: "Anti-cheat", text: "Détections, bans, scanner, badge « Protégé » et anti-raid Discord.", live: true },
  { icon: Code2, title: "Studio IA", text: "UI, scripts et mappings générés par l'IA.", live: true },
  { icon: Building2, title: "Entreprises", text: "Suivi des entreprises et de leurs employés." }
];

const storePoints = [
  { icon: ShoppingBag, title: "Ton vrai catalogue Tebex", text: "Packages, prix, promos et objectifs lus en direct : rien à recopier, rien à mettre à jour." },
  { icon: CreditCard, title: "Paiement Tebex sécurisé", text: "Connexion Cfx.re, codes promo, cartes cadeaux, puis la fenêtre de paiement officielle Tebex. L'argent va directement sur ton compte Tebex." },
  { icon: Radio, title: "Vivante", text: "Joueurs en ligne, derniers soutiens, meilleur donateur du mois et compte à rebours des promos." },
  { icon: Smartphone, title: "Parfaite sur mobile", text: "Chaque thème est pensé pour le téléphone, là où beaucoup de joueurs cliquent sur le lien partagé sur Discord." }
];

const storeDemo = [
  { n: "VIP Or", p: "14,99 €", tag: "Populaire" },
  { n: "Pack véhicules", p: "24,99 €", tag: "" },
  { n: "Maison de luxe", p: "39,99 €", tag: "-20 %" }
];

const faq = [
  { q: "Qui peut ajouter un serveur ?", a: "Toute personne qui a la permission « Gérer le serveur » (ou qui est administrateur) sur le serveur Discord. Tu deviens propriétaire de ton espace Fiverax et tu ajoutes ensuite ton équipe." },
  { q: "Faut-il installer quelque chose sur mon serveur FiveM ?", a: "Seulement pour le temps de jeu, l'anticheat et le scan complet : une ressource légère, à déposer dans tes resources avec le token propre à ton serveur. Le staff passe uniquement par Discord, la boutique par Tebex." },
  { q: "Je gère plusieurs serveurs, c'est possible ?", a: "Oui. Un seul compte, un seul bot, et tu passes d'un serveur à l'autre depuis le panel. Les données, les rôles et les accès de chaque serveur restent séparés." },
  { q: "Que se passe-t-il si quelqu'un perd son rôle sur Discord ?", a: "Ses accès sont recalculés à chaque requête à partir de ses rôles Discord : un rôle retiré sur Discord, et l'accès au panel disparaît." },
  { q: "Comment marche la boutique en ligne ?", a: "Tu relies ton webstore Tebex, puis tu crées ta page avec le Store Creator : avec des blocs, ou en la décrivant à l'IA. Les joueurs paient chez Tebex, l'argent arrive directement sur ton compte Tebex et les achats sont livrés en jeu par la ressource Tebex officielle." },
  { q: "Puis-je supprimer mes données ?", a: "Oui. Le propriétaire d'un serveur peut le supprimer depuis la page Configuration, avec toutes ses données." }
];

const demo = [
  { n: "Nova", g: "Modérateur", t: "12h40", w: 0, v: true },
  { n: "Kaiz", g: "Admin", t: "9h05", w: 0, v: true },
  { n: "Lyra", g: "Helper", t: "6h12", w: 1, v: false },
  { n: "Mehdi", g: "Modérateur", t: "3h48", w: 2, v: false }
];

export default async function LandingPage() {
  const identity = await getIdentity();
  const cta = identity
    ? { href: "/servers", label: "Ouvrir le dashboard" }
    : { href: "/login", label: "Commencer avec Discord" };

  return (
    <div className="lp">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(structuredData)} />
      <header className="lp-nav">
        <div className="lp-wrap">
          <Link href="/" aria-label="Fiverax"><Wordmark size={30} /></Link>
          <nav>
            <Link href="/scan">Scan gratuit</Link>
            <Link href="/annuaire">Annuaire des serveurs</Link>
            <a href="#boutique">Store Creator</a>
            <a href="#fonctionnalites">Fonctionnalités</a>
            <a href="#modules">Modules</a>
            <a href="#demarrer">Démarrer</a>
            <a href="#faq">FAQ</a>
          </nav>
          <Link href={identity ? "/servers" : "/login"} className="btn sm">{identity ? "Dashboard" : "Connexion"}</Link>
        </div>
      </header>

      <main className="lp-wrap">
        <section className="lp-hero">
          <div>
            <Link href="/scan" className="lp-chip rise"><b>Nouveau</b>Scan de sécurité gratuit de ton serveur FiveM, sans compte</Link>
            <h1 className="rise rise-1">Ton panel staff FiveM, <br /><span className="gold">piloté d&apos;un seul endroit.</span></h1>
            <p className="lead rise rise-2">
              Fiverax est le panel de gestion des serveurs FiveM : il relie ton Discord et ton serveur pour gérer ton staff (grades, avertissements, activité en vocal et en jeu, bilan de la semaine), ta boutique Tebex et ton anticheat. Sans tableur, sans commandes à retenir.
            </p>
            <div className="lp-cta rise rise-3">
              <Link href={cta.href} className="btn primary shine">{cta.label}<ArrowRight size={16} /></Link>
              <a href="#apercu" className="btn">Voir le panel</a>
            </div>
          </div>
          <div className="lp-orb rise rise-2">
            <Mark size={240} />
            <div className="lp-note n1"><span className="ic"><TrendingUp size={15} /></span><div>Nova passe Modérateur<small>rôle Discord mis à jour</small></div></div>
            <div className="lp-note n2"><span className="ic"><Gamepad2 size={15} /></span><div>+2h14 en jeu<small>session FiveM terminée</small></div></div>
            <div className="lp-note n3"><span className="ic"><Mic size={15} /></span><div>4 staff en vocal<small>maintenant</small></div></div>
          </div>
        </section>

        <div className="lp-facts rise rise-4">
          <div><b>1 bot</b><span>pour tous tes serveurs Discord</span></div>
          <div><b>{PERMISSIONS.length}</b><span>permissions par personne ou par rôle</span></div>
          <div><b>Vocal + jeu</b><span>l&apos;activité réelle de chaque membre</span></div>
          <div><b>Dimanche</b><span>un bilan IA de la semaine</span></div>
        </div>

        <section id="securite" className="lp-sect">
          <header>
            <div className="eyebrow">Sécurité</div>
            <h2>Anticheat et scan de sécurité FiveM : ton serveur est-il <span className="gold">vraiment protégé ?</span></h2>
            <p>Colle le lien de ton serveur : score de sécurité en 10 secondes, sans compte. Ensuite, Fiverax analyse le code de chaque ressource, te dit quoi corriger et te donne les ressources pour le faire.</p>
          </header>
          <div style={{ maxWidth: 680 }}><ScanForm /></div>
          <div className="lp-grid" style={{ marginTop: 28 }}>
            <article className="lp-feat">
              <span className="ic"><ScanSearch size={19} /></span>
              <h3>Scanner de backdoors</h3>
              <p>Code caché, événements qui donnent de l&apos;argent, injections SQL, webhooks exposés, permissions ouvertes : un score sur 100 et le correctif de chaque problème.</p>
            </article>
            <article className="lp-feat">
              <span className="ic"><Sparkles size={19} /></span>
              <h3>Plan d&apos;action IA et kit</h3>
              <p>L&apos;IA classe ce qu&apos;il faut faire, du plus urgent au plus simple, et le kit de protection s&apos;installe sur ton serveur en un clic.</p>
            </article>
            <article className="lp-feat">
              <span className="ic"><BadgeCheck size={19} /></span>
              <h3>Badge « Protégé par Fiverax »</h3>
              <p>Protégé, Renforcé, Forteresse : un niveau vérifié, jamais déclaratif, à afficher sur ton site et ton Discord. Les serveurs protégés remontent dans l&apos;annuaire.</p>
            </article>
            <article className="lp-feat">
              <span className="ic"><Gift size={19} /></span>
              <h3>Parrainage</h3>
              <p>Chaque serveur que tu fais venir te rapporte 7 jours « À la une » dans l&apos;annuaire, et il en reçoit 3.</p>
            </article>
          </div>
        </section>

        <section id="boutique" className="lp-sect lp-store">
          <header>
            <div className="eyebrow">Store Creator</div>
            <h2>Ta boutique Tebex FiveM, créée par l&apos;IA. <span className="gold">En une phrase.</span></h2>
            <p>Décris ta boutique à l&apos;IA, ou construis-la bloc par bloc comme un pro du design. Elle est branchée sur Tebex : catalogue, paiement et livraison en jeu fonctionnent dès la publication.</p>
          </header>

          <div className="lp-store-grid">
            <div className="lp-store-modes">
              <article className="lp-store-mode">
                <span className="ic"><WandSparkles size={19} /></span>
                <div>
                  <h3>Mode IA</h3>
                  <p>« Une boutique néon cyberpunk, le VIP en vedette, une promo -20 % jusqu&apos;à dimanche. » L&apos;IA connaît ton catalogue : elle choisit le style, écrit les textes et place les blocs.</p>
                </div>
              </article>
              <article className="lp-store-mode">
                <span className="ic"><Blocks size={19} /></span>
                <div>
                  <h3>Mode blocs</h3>
                  <p>15 blocs prêts à l&apos;emploi (en-tête, package à la une, promo, objectif, FAQ, Discord…), 6 thèmes, aperçu en direct sur ordinateur et mobile, historique des versions.</p>
                </div>
              </article>
              <ul className="lp-store-points">
                {storePoints.map((pt) => (
                  <li key={pt.title}><pt.icon size={16} /><div><b>{pt.title}</b><span>{pt.text}</span></div></li>
                ))}
              </ul>
            </div>

            <div className="lp-store-demo" aria-hidden="true">
              <div className="bar"><i /><i /><i /><span>fiverax · /store/ton-serveur · exemple</span></div>
              <div className="lp-sd">
                <div className="lp-sd-nav"><b><span>N</span>Neon City RP</b><em>🛒 2</em></div>
                <div className="lp-sd-hero">
                  <small>Boutique officielle</small>
                  <strong>Soutiens le serveur</strong>
                  <p>Tes avantages arrivent en jeu en quelques minutes.</p>
                  <div><u>Voir les offres</u><span className="lp-sd-live"><i />128 joueurs en ligne</span></div>
                </div>
                <div className="lp-sd-promo"><b>-20 % ce week-end</b><span>02 : 14 : 37</span><code>WEEKEND</code></div>
                <div className="lp-sd-cards">
                  {storeDemo.map((c) => (
                    <div key={c.n}>
                      <i>{c.tag && <em>{c.tag}</em>}</i>
                      <b>{c.n}</b>
                      <span>{c.p}<u>Ajouter</u></span>
                    </div>
                  ))}
                </div>
                <div className="lp-sd-goal"><span>Objectif du mois · nouvelle map</span><i><b /></i></div>
              </div>
              <div className="lp-store-note"><span className="ic"><Sparkles size={15} /></span><div>Boutique générée par l&apos;IA<small>en moins d&apos;une minute</small></div></div>
            </div>
          </div>

          <div className="lp-cta">
            <Link href={cta.href} className="btn primary shine">Créer ma boutique<ArrowRight size={16} /></Link>
            <a href="#demarrer" className="btn">Comment ça marche</a>
          </div>
        </section>

        <section id="apercu" className="lp-sect">
          <header>
            <div className="eyebrow">Aperçu</div>
            <h2>Toute ton équipe, en un coup d&apos;œil.</h2>
            <p>L&apos;accueil de chaque serveur résume les 7 derniers jours : qui est actif, qui est en vocal, qui a des avertissements.</p>
          </header>
          <div className="lp-window">
            <div className="bar"><i /><i /><i /><span>fiverax · Mon serveur RP · exemple</span></div>
            <div className="body">
              <aside>
                <Wordmark size={22} />
                <div data-on>Accueil</div><div>Staff</div><div>Bilan hebdo</div><div>Logs</div><div>Accès &amp; rôles</div>
              </aside>
              <main>
                <div className="strip">
                  <div><div className="eyebrow">Staff actif</div><div className="num">24</div><small>4 en vocal</small></div>
                  <div><div className="eyebrow">Vocal · 7 j</div><div className="num">186h</div><small>cumulé</small></div>
                  <div><div className="eyebrow">Jeu · 7 j</div><div className="num">312h</div><small>cumulé</small></div>
                </div>
                {demo.map((m) => (
                  <div key={m.n} className="lp-row">
                    <span className="av">{m.n.slice(0, 2).toUpperCase()}</span>
                    <div><b>{m.n}</b><small>{m.t} en jeu cette semaine</small></div>
                    <span className="plate"><span>{m.g}</span></span>
                    <span className="pips" data-level={m.w}><i /><i /><i /></span>
                    <span className={`dot ${m.v ? "on" : ""}`} />
                  </div>
                ))}
              </main>
            </div>
          </div>
        </section>

        <section id="fonctionnalites" className="lp-sect">
          <header>
            <div className="eyebrow">Fonctionnalités</div>
            <h2>Gestion du staff FiveM : tout ce qu&apos;il faut pour tenir une équipe.</h2>
            <p>Discord reste la source de vérité : Fiverax lit les rôles, les applique, et garde l&apos;historique.</p>
          </header>
          <div className="lp-grid">
            {features.map((f) => (
              <article key={f.title} className="lp-feat">
                <span className="ic"><f.icon size={19} /></span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="modules" className="lp-sect">
          <header>
            <div className="eyebrow">Modules</div>
            <h2>Staff, boutique Tebex, anticheat, Studio IA : un seul panel.</h2>
            <p>Fiverax grandit avec ton serveur : de nouveaux modules s&apos;ajoutent au même panel, avec les mêmes accès.</p>
          </header>
          <div className="lp-mods">
            {modules.map((m) => (
              <article key={m.title} className="lp-mod" data-live={m.live || undefined}>
                <div><m.icon size={22} /><span className="tag" data-tone={m.live ? "up" : undefined}>{m.live ? "Disponible" : "Bientôt"}</span></div>
                <h3>{m.title}</h3>
                <p>{m.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="demarrer" className="lp-sect">
          <header>
            <div className="eyebrow">Démarrer</div>
            <h2>En place en cinq minutes.</h2>
          </header>
          <div className="lp-steps">
            <div className="lp-step"><h3>Connecte-toi avec Discord</h3><p>Pas de compte à créer. Fiverax voit les serveurs Discord que tu gères.</p></div>
            <div className="lp-step"><h3>Ajoute ton serveur</h3><p>Invite le bot, choisis tes rôles staff et tes grades. La page Configuration te guide pas à pas.</p></div>
            <div className="lp-step"><h3>Relie FiveM et Tebex</h3><p>Optionnel : la ressource FiveM pour le temps de jeu et l&apos;anticheat, ta clé Tebex pour la boutique. Ensuite, le Store Creator fait le reste.</p></div>
          </div>
        </section>

        <section id="faq" className="lp-sect">
          <header>
            <div className="eyebrow">FAQ</div>
            <h2>Questions fréquentes</h2>
          </header>
          <div className="lp-faq">
            {faq.map((f) => (
              <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>
            ))}
          </div>
        </section>

        <section className="lp-final">
          <Mark size={320} />
          <h2>Prêt à reprendre la main sur ton staff ?</h2>
          <p>Connecte ton Discord, ajoute ton serveur, et retrouve toute ton équipe dans un seul panel.</p>
          <div className="lp-cta">
            <Link href={cta.href} className="btn primary shine">{cta.label}<ArrowRight size={16} /></Link>
          </div>
        </section>

        <footer className="lp-foot">
          <Wordmark size={24} />
          <nav>
            <a href="#fonctionnalites">Fonctionnalités</a>
            <a href="#faq">FAQ</a>
            <Link href="/scan">Scan de sécurité gratuit</Link>
            <Link href="/annuaire">Annuaire des serveurs</Link>
            <Link href="/login">Connexion</Link>
            {LEGAL_LINKS.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
          </nav>
          <span>© {new Date().getFullYear()} Fiverax</span>
        </footer>
      </main>
    </div>
  );
}
