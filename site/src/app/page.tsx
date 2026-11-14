import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity, ArrowRight, BadgeCheck, Ban, Blocks, Bot, Camera, Code2, CreditCard, Gift, Globe, KeyRound, LayoutDashboard, Map as MapIcon,
  Network, PanelsTopLeft, Radar, Radio, ScanSearch, ScrollText, ShieldAlert, ShieldCheck, ShoppingBag, Siren, Smartphone, Sparkles,
  Terminal, TrendingUp, Users, WandSparkles
} from "lucide-react";
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
  openGraph: {
    ...OG_BASE,
    url: "/",
    title: "Fiverax · Le dashboard tout-en-un de ton serveur FiveM",
    description: "Joueurs en direct, reports avec replay, console, anticheat, anti-raid, staff, boutique Tebex et copilote IA : tout ton serveur FiveM dans un seul panel."
  }
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
      featureList: [
        "Joueurs en direct, carte et vocal",
        "Reports en jeu avec replay",
        "Ressources et console à distance",
        "Anticheat, scanner de backdoors et bans partagés",
        "Anti-raid Discord",
        "Copilote IA et assistant IA du serveur",
        "Gestion du staff et des grades Discord",
        "Boutique Tebex avec Store Creator IA",
        "Studio IA : UI, scripts et mappings",
        "Annuaire des serveurs et portail joueurs",
        "Scan de sécurité gratuit"
      ],
      publisher: { "@id": ORGANIZATION_ID }
    }
  ]
};

/** The dashboard's sections, in the order of its sidebar. */
const pillars = [
  { icon: Radio, title: "Serveur en direct", text: "Ce qui se passe en jeu, maintenant, et les outils pour agir.", items: ["En direct", "Carte & vocal", "Joueurs", "Reports & replays", "Ressources & console"] },
  { icon: Radar, title: "Sécurité", text: "Le code, le jeu et le Discord surveillés au même endroit.", items: ["Centre de sécurité", "Anticheat", "Scanner", "Bans", "Anti-raid Discord", "Badge"] },
  { icon: Sparkles, title: "IA intégrée", text: "Des assistants qui agissent, toujours après ta confirmation.", items: ["Copilote IA", "Assistant serveur", "Bilan hebdo", "Captures analysées"] },
  { icon: Users, title: "Staff", text: "Ton équipe gérée depuis le panel, Discord suit tout seul.", items: ["Équipe", "Grades Discord", "Avertissements", "Activité", "Bilan hebdo"] },
  { icon: ShoppingBag, title: "Boutique Tebex", text: "Ta boutique créée par l'IA, et ses ventes suivies au jour le jour.", items: ["Store Creator", "Ventes", "Paiements", "Catalogue", "Promotions", "Clients"] },
  { icon: Code2, title: "Studio IA", text: "Interfaces, scripts et mappings générés pour ton serveur.", items: ["UI Creator", "Script Creator", "Mapping Creator", "Bibliothèque"] },
  { icon: Globe, title: "Réseau Fiverax", text: "Fais venir des joueurs et partage tes bans avec les autres serveurs.", items: ["Fiche annuaire", "Portail joueurs", "Bans partagés", "Parrainage"] },
  { icon: LayoutDashboard, title: "Pilotage", text: "Un accueil, des logs, et des accès réglés au plus juste.", items: ["Accueil", "Logs", "Accès & rôles", "Bot Discord", "Multi-serveurs"] }
];

const live = [
  { icon: Radio, title: "En direct", text: "Les joueurs connectés, rafraîchis toutes les quelques secondes. Message privé, annonce, kick, ban ou capture d'écran en un clic." },
  { icon: MapIcon, title: "Carte & vocal", text: "La position de chaque joueur sur la carte, qui parle, les fréquences radio et les appels, mis à jour toutes les 2 secondes." },
  { icon: Siren, title: "Reports & boîte noire", text: "Chaque /report fait en jeu arrive avec le replay des minutes d'avant : positions, tirs, morts, et qui parlait." },
  { icon: Activity, title: "Fiche joueur", text: "Tous les joueurs passés sur ton serveur, leurs identifiants, leur historique de connexions et de sanctions." },
  { icon: Terminal, title: "Ressources & console", text: "Démarre, arrête ou redémarre une ressource, et tape tes commandes comme dans la console du serveur." },
  { icon: ScrollText, title: "Logs complets", text: "Qui a fait quoi, sur qui, et quand : chaque action du panel est tracée et consultable." }
];

const staffFeatures = [
  { icon: Users, title: "Grades sur Discord", text: "Up, down, derank, recrutement : chaque changement de grade est appliqué directement sur les rôles Discord." },
  { icon: Activity, title: "Activité réelle", text: "Temps en vocal Discord et temps de jeu FiveM, par membre, sur la semaine. Tu vois qui est là, et qui ne l'est plus." },
  { icon: ShieldAlert, title: "Avertissements", text: "Trois niveaux d'avert, des commentaires et des pastilles pour suivre chaque membre dans la durée." },
  { icon: TrendingUp, title: "Bilan IA du dimanche", text: "Chaque semaine, une synthèse des commentaires et de l'activité, avec une appréciation par membre." },
  { icon: KeyRound, title: "Permissions fines", text: `${PERMISSIONS.length} permissions à donner à une personne ou à un rôle Discord. Chacun ne voit que ce qu'il doit voir.` },
  { icon: Bot, title: "Un bot pour tout", text: "Un seul bot Discord pour tous tes serveurs : synchronisation du staff, anti-raid et alertes." }
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
  { q: "Faut-il installer quelque chose sur mon serveur FiveM ?", a: "Pour la partie jeu, oui : l'agent Fiverax, une ressource légère à déposer dans tes resources avec le token propre à ton serveur. Il active le direct, la carte et le vocal, les reports avec replay, la console, le temps de jeu, l'anticheat et le scan complet. Le staff et l'anti-raid passent uniquement par Discord, la boutique par Tebex." },
  { q: "Que peut faire l'IA, et agit-elle toute seule ?", a: "Le copilote répond à tes questions sur le panel et prépare les actions (avertir, monter un grade, bannir, verrouiller le Discord…). L'assistant serveur voit la console, les joueurs et les ressources, et peut corriger un script. Dans les deux cas, ils ne proposent que ce que tes permissions autorisent et rien n'est exécuté sans ta confirmation." },
  { q: "Je gère plusieurs serveurs, c'est possible ?", a: "Oui. Un seul compte, un seul bot, et tu passes d'un serveur à l'autre depuis le panel. Les données, les rôles et les accès de chaque serveur restent séparés." },
  { q: "Mon staff voit-il tout le panel ?", a: `Non. Chaque section dépend de ${PERMISSIONS.length} permissions que tu donnes à une personne ou à un rôle Discord. Les accès sont recalculés à chaque requête à partir des rôles Discord : un rôle retiré, et l'accès disparaît.` },
  { q: "Comment marche la boutique en ligne ?", a: "Tu relies ton webstore Tebex, puis tu crées ta page avec le Store Creator : avec des blocs, ou en la décrivant à l'IA. Les joueurs paient chez Tebex, l'argent arrive directement sur ton compte Tebex et les achats sont livrés en jeu par la ressource Tebex officielle." },
  { q: "Puis-je supprimer mes données ?", a: "Oui. Le propriétaire d'un serveur peut le supprimer depuis la page Configuration, avec toutes ses données." }
];

const demoNav = [
  { label: "Pilotage", items: ["Accueil", "Copilote IA"] },
  { label: "Serveur FiveM", items: ["En direct", "Carte & vocal", "Reports & replays"] },
  { label: "Sécurité", items: ["Anticheat", "Anti-raid Discord"] },
  { label: "Boutique", items: ["Ventes"] },
  { label: "Staff", items: ["Équipe"] }
];

const demoFeed = [
  { tag: "Report", tone: "warn", who: "Lyra signale Kaiz", what: "replay des 3 dernières minutes prêt", t: "il y a 1 min" },
  { tag: "Anticheat", tone: "danger", who: "Tata expulsé", what: "téléportation détectée, capture analysée", t: "il y a 4 min" },
  { tag: "Boutique", tone: "up", who: "VIP Or acheté par Nova", what: "14,99 € · livré en jeu", t: "il y a 9 min" },
  { tag: "Staff", tone: "info", who: "Mehdi passe Modérateur", what: "rôle Discord mis à jour", t: "il y a 22 min" },
  { tag: "Anti-raid", tone: "danger", who: "8 salons supprimés", what: "action annulée, auteur sanctionné", t: "hier" }
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
            <a href="#plateforme">Fonctionnalités</a>
            <a href="#direct">En direct</a>
            <a href="#securite">Sécurité</a>
            <a href="#ia">IA</a>
            <a href="#boutique">Boutique</a>
            <Link href="/scan">Scan gratuit</Link>
            <Link href="/annuaire">Annuaire</Link>
            <a href="#faq">FAQ</a>
          </nav>
          <Link href={identity ? "/servers" : "/login"} className="btn sm">{identity ? "Dashboard" : "Connexion"}</Link>
        </div>
      </header>

      <main className="lp-wrap">
        <section className="lp-hero">
          <div>
            <Link href="/scan" className="lp-chip rise"><b>Nouveau</b>Scan de sécurité gratuit de ton serveur FiveM, sans compte</Link>
            <h1 className="rise rise-1">Tout ton serveur FiveM, <br /><span className="gold">piloté d&apos;un seul panel.</span></h1>
            <p className="lead rise rise-2">
              Fiverax relie ton serveur FiveM et ton Discord dans un seul dashboard : joueurs en direct sur la carte, reports avec replay,
              console, anticheat et anti-raid, staff, boutique Tebex et un copilote IA qui exécute tes demandes. Sans tableur, sans commandes à retenir.
            </p>
            <div className="lp-cta rise rise-3">
              <Link href={cta.href} className="btn primary shine">{cta.label}<ArrowRight size={16} /></Link>
              <a href="#apercu" className="btn">Voir le dashboard</a>
            </div>
          </div>
          <div className="lp-orb rise rise-2">
            <Mark size={240} />
            <div className="lp-note n1"><span className="ic"><Siren size={15} /></span><div>Report de Lyra<small>replay des 3 dernières minutes</small></div></div>
            <div className="lp-note n2"><span className="ic"><ShieldAlert size={15} /></span><div>Cheater reconnu<small>banni par le réseau Fiverax</small></div></div>
            <div className="lp-note n3"><span className="ic"><ShoppingBag size={15} /></span><div>VIP Or acheté<small>livré en jeu</small></div></div>
          </div>
        </section>

        <div className="lp-facts rise rise-4">
          <div><b>1 panel</b><span>direct, sécurité, staff, boutique et IA</span></div>
          <div><b>2 s</b><span>carte et vocal rafraîchis en continu</span></div>
          <div><b>Copilote IA</b><span>tes demandes en français, exécutées après confirmation</span></div>
          <div><b>{PERMISSIONS.length}</b><span>permissions par personne ou par rôle</span></div>
        </div>

        <section id="plateforme" className="lp-sect">
          <header>
            <div className="eyebrow">La plateforme</div>
            <h2>Un dashboard, <span className="gold">tout ton serveur.</span></h2>
            <p>Le jeu, le Discord, l&apos;équipe et la boutique, chacun dans sa section. Tu n&apos;actives que ce dont tu as besoin, et chaque membre ne voit que ce que tu lui ouvres.</p>
          </header>
          <div className="lp-pillars">
            {pillars.map((p) => (
              <article key={p.title} className="lp-pillar">
                <span className="ic"><p.icon size={19} /></span>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
                <ul>{p.items.map((i) => <li key={i}>{i}</li>)}</ul>
              </article>
            ))}
          </div>
        </section>

        <section id="apercu" className="lp-sect">
          <header>
            <div className="eyebrow">Aperçu</div>
            <h2>Tout ce qui compte, en un coup d&apos;œil.</h2>
            <p>L&apos;état du serveur, les reports, les détections, les ventes et les mouvements du staff arrivent au même endroit, en temps réel.</p>
          </header>
          <div className="lp-window">
            <div className="bar"><i /><i /><i /><span>fiverax · Mon serveur RP · exemple</span></div>
            <div className="body">
              <aside>
                <Wordmark size={22} />
                {demoNav.map((s) => (
                  <div key={s.label} className="grp">
                    <small>{s.label}</small>
                    {s.items.map((i) => <div key={i} data-on={i === "En direct" || undefined}>{i}</div>)}
                  </div>
                ))}
              </aside>
              <main>
                <div className="strip">
                  <div><div className="eyebrow">En ligne</div><div className="num">128</div><small>sur 256 places</small></div>
                  <div><div className="eyebrow">Staff en jeu</div><div className="num">6</div><small>4 en vocal</small></div>
                  <div><div className="eyebrow">Détections · 24 h</div><div className="num">3</div><small>2 bans</small></div>
                  <div><div className="eyebrow">Ventes · 7 j</div><div className="num">842 €</div><small>Tebex</small></div>
                </div>
                <div className="lp-feed">
                  {demoFeed.map((e) => (
                    <div key={e.who}>
                      <span className="tag" data-tone={e.tone}>{e.tag}</span>
                      <div><b>{e.who}</b><small>{e.what}</small></div>
                      <time>{e.t}</time>
                    </div>
                  ))}
                </div>
              </main>
            </div>
          </div>
        </section>

        <section id="direct" className="lp-sect">
          <header>
            <div className="eyebrow">Serveur en direct</div>
            <h2>Ton serveur FiveM en direct, <span className="gold">comme si tu étais en jeu.</span></h2>
            <p>L&apos;agent Fiverax, une ressource légère, envoie au panel ce qui se passe sur ton serveur. Ton staff modère depuis le navigateur, même sans lancer GTA.</p>
          </header>
          <div className="lp-grid">
            {live.map((f) => (
              <article key={f.title} className="lp-feat">
                <span className="ic"><f.icon size={19} /></span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="securite" className="lp-sect">
          <header>
            <div className="eyebrow">Sécurité</div>
            <h2>Anticheat, anti-raid et scan de sécurité : ton serveur est-il <span className="gold">vraiment protégé ?</span></h2>
            <p>Colle le lien de ton serveur : score de sécurité en 10 secondes, sans compte. Ensuite, Fiverax protège le code, le jeu et le Discord, et te dit quoi corriger.</p>
          </header>
          <div style={{ maxWidth: 680 }}><ScanForm /></div>
          <div className="lp-grid" style={{ marginTop: 28 }}>
            <article className="lp-feat">
              <span className="ic"><ShieldAlert size={19} /></span>
              <h3>Anticheat côté serveur</h3>
              <p>Détections côté serveur, protection des événements et captures d&apos;écran analysées par l&apos;IA. Ton staff n&apos;est jamais sanctionné.</p>
            </article>
            <article className="lp-feat">
              <span className="ic"><ScanSearch size={19} /></span>
              <h3>Scanner de backdoors</h3>
              <p>Code caché, événements qui donnent de l&apos;argent, injections SQL, webhooks exposés : un score sur 100, un plan d&apos;action IA et le correctif de chaque problème.</p>
            </article>
            <article className="lp-feat">
              <span className="ic"><ShieldCheck size={19} /></span>
              <h3>Anti-raid Discord</h3>
              <p>Le bot surveille le journal d&apos;audit : rôles et salons supprimés, bans en masse… L&apos;action est annulée et son auteur sanctionné.</p>
            </article>
            <article className="lp-feat">
              <span className="ic"><Network size={19} /></span>
              <h3>Bans partagés</h3>
              <p>Un cheater banni sur un serveur Fiverax est reconnu sur les autres, même sous un autre pseudo. Seule une empreinte (hash) est comparée.</p>
            </article>
            <article className="lp-feat">
              <span className="ic"><Ban size={19} /></span>
              <h3>Bans et centre de sécurité</h3>
              <p>Bans temporaires ou définitifs, et une vue unique sur le code, le jeu, le Discord et la réaction de ton staff.</p>
            </article>
            <article className="lp-feat">
              <span className="ic"><BadgeCheck size={19} /></span>
              <h3>Badge « Protégé par Fiverax »</h3>
              <p>Protégé, Renforcé, Forteresse : un niveau vérifié, jamais déclaratif, à afficher sur ton site et ton Discord. Les serveurs protégés remontent dans l&apos;annuaire.</p>
            </article>
          </div>
        </section>

        <section id="ia" className="lp-sect">
          <header>
            <div className="eyebrow">Intelligence artificielle</div>
            <h2>Une IA qui agit, <span className="gold">pas seulement qui répond.</span></h2>
            <p>Parle au panel comme à un bras droit. L&apos;IA ne propose que ce que tes permissions autorisent, et rien n&apos;est exécuté sans ta confirmation.</p>
          </header>
          <div className="lp-store-grid">
            <div className="lp-store-modes">
              <article className="lp-store-mode">
                <span className="ic"><Sparkles size={19} /></span>
                <div>
                  <h3>Copilote IA du panel</h3>
                  <p>« Avertis Bob pour absence en réunion », « qui n&apos;a pas fait de vocal depuis une semaine ? », « verrouille le Discord » : staff, joueurs, bans, Discord et navigation.</p>
                </div>
              </article>
              <article className="lp-store-mode">
                <span className="ic"><Terminal size={19} /></span>
                <div>
                  <h3>Assistant IA du serveur</h3>
                  <p>« Rembourse 5000 $ à Tata », « pourquoi mon garage ne marche plus ? » : il voit les joueurs, la console et les ressources, et peut corriger le script en cause. Chaque modification s&apos;annule en un clic.</p>
                </div>
              </article>
              <ul className="lp-store-points">
                <li><TrendingUp size={16} /><div><b>Bilan du dimanche</b><span>Une synthèse de la semaine de ton staff, membre par membre.</span></div></li>
                <li><Camera size={16} /><div><b>Captures analysées</b><span>L&apos;anticheat demande une capture d&apos;écran, l&apos;IA dit ce qu&apos;elle y voit.</span></div></li>
                <li><Code2 size={16} /><div><b>Studio IA</b><span>UI, scripts et mappings générés pour ton serveur, rangés dans ta bibliothèque.</span></div></li>
                <li><WandSparkles size={16} /><div><b>Store Creator</b><span>Ta boutique Tebex décrite en une phrase, construite par l&apos;IA.</span></div></li>
              </ul>
            </div>

            <div className="lp-chat" aria-hidden="true">
              <div className="bar"><Sparkles size={14} /><span>Copilote IA · exemple</span></div>
              <div className="msgs">
                <p className="me">Bannis Tata 3 jours pour freekill, et dis-moi qui n&apos;a pas fait de vocal cette semaine.</p>
                <div className="ai">
                  <p>Voici ce que je propose :</p>
                  <div className="act"><Ban size={14} /><div><b>Bannir Tata · 3 jours</b><small>Motif : freekill</small></div><u>Confirmer</u></div>
                  <p>Pas de vocal depuis 7 jours : <b>Lyra</b> (Helper) et <b>Mehdi</b> (Modérateur).</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="boutique" className="lp-sect lp-store">
          <header>
            <div className="eyebrow">Boutique Tebex</div>
            <h2>Ta boutique Tebex FiveM, créée par l&apos;IA. <span className="gold">En une phrase.</span></h2>
            <p>Décris ta boutique à l&apos;IA, ou construis-la bloc par bloc. Elle est branchée sur Tebex : catalogue, paiement et livraison en jeu fonctionnent dès la publication, et le panel suit tes ventes, paiements, promos et clients.</p>
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

        <section id="staff" className="lp-sect">
          <header>
            <div className="eyebrow">Staff</div>
            <h2>Ton équipe, gérée depuis le panel. <span className="gold">Discord suit.</span></h2>
            <p>Discord reste la source de vérité : Fiverax lit les rôles, les applique, et garde l&apos;historique de chaque membre.</p>
          </header>
          <div className="lp-grid">
            {staffFeatures.map((f) => (
              <article key={f.title} className="lp-feat">
                <span className="ic"><f.icon size={19} /></span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="reseau" className="lp-sect">
          <header>
            <div className="eyebrow">Réseau Fiverax</div>
            <h2>Fais venir des joueurs, <span className="gold">garde-les.</span></h2>
            <p>Ton serveur gagne une vitrine publique et une page pour sa communauté, reliées au panel.</p>
          </header>
          <div className="lp-mods">
            <article className="lp-mod" data-live>
              <div><Globe size={22} /><Link href="/annuaire" className="linkish">Voir l&apos;annuaire</Link></div>
              <h3>Fiche annuaire</h3>
              <p>Joueurs connectés, avis vérifiés, votes : les joueurs te trouvent, et les serveurs protégés remontent dans le classement.</p>
            </article>
            <article className="lp-mod" data-live>
              <div><PanelsTopLeft size={22} /></div>
              <h3>Portail joueurs</h3>
              <p>Annonces, événements, règlement, candidatures, whitelist et giveaways avec récompense en jeu. Tes joueurs s&apos;y connectent avec Discord.</p>
            </article>
            <article className="lp-mod" data-live>
              <div><Gift size={22} /></div>
              <h3>Parrainage</h3>
              <p>Chaque serveur que tu fais venir te rapporte 7 jours « À la une » dans l&apos;annuaire, et il en reçoit 3.</p>
            </article>
          </div>
        </section>

        <section id="demarrer" className="lp-sect">
          <header>
            <div className="eyebrow">Démarrer</div>
            <h2>En place en cinq minutes.</h2>
          </header>
          <div className="lp-steps">
            <div className="lp-step"><h3>Connecte-toi avec Discord</h3><p>Pas de compte à créer. Fiverax voit les serveurs Discord que tu gères.</p></div>
            <div className="lp-step"><h3>Ajoute ton serveur</h3><p>Invite le bot, choisis tes rôles staff et tes grades. Le staff, les logs et l&apos;anti-raid fonctionnent tout de suite.</p></div>
            <div className="lp-step"><h3>Branche FiveM et Tebex</h3><p>Installe l&apos;agent Fiverax pour le direct, la carte, les reports, la console et l&apos;anticheat. Ajoute ta clé Tebex pour la boutique.</p></div>
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
          <h2>Prêt à reprendre la main sur ton serveur ?</h2>
          <p>Connecte ton Discord, ajoute ton serveur, et pilote tes joueurs, ta sécurité, ton staff et ta boutique depuis un seul panel.</p>
          <div className="lp-cta">
            <Link href={cta.href} className="btn primary shine">{cta.label}<ArrowRight size={16} /></Link>
          </div>
        </section>

        <footer className="lp-foot">
          <Wordmark size={24} />
          <nav>
            <a href="#plateforme">Fonctionnalités</a>
            <a href="#faq">FAQ</a>
            <Link href="/scan">Scan de sécurité gratuit</Link>
            <Link href="/annuaire">Annuaire des serveurs</Link>
            <Link href="/guides">Tutoriels</Link>
            <Link href="/login">Connexion</Link>
            {LEGAL_LINKS.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
          </nav>
          <span>© {new Date().getFullYear()} Fiverax</span>
        </footer>
      </main>
    </div>
  );
}
