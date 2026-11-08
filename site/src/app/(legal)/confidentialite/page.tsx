import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL } from "@/lib/legal";
import { OG_BASE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Politique de confidentialité",
  description: "Les données que Fiverax collecte via Discord, FiveM et Tebex, pourquoi, combien de temps elles sont gardées et comment les supprimer.",
  alternates: { canonical: "/confidentialite" },
  openGraph: { ...OG_BASE, url: "/confidentialite", title: "Politique de confidentialité · Fiverax" }
};

const data = [
  {
    who: "Toi, quand tu te connectes",
    what: "Ton identifiant, ton pseudo et ton avatar Discord, et la liste des serveurs Discord que tu gères (connexion Discord).",
    why: "Te connecter et te montrer les serveurs auxquels tu as accès."
  },
  {
    who: "Les membres du staff d'un serveur",
    what: "Rôles et grades Discord, temps passé en vocal, temps de jeu FiveM, avertissements, commentaires, historique des grades, actions faites dans le panel.",
    why: "La gestion du staff : c'est le service que le propriétaire du serveur a demandé."
  },
  {
    who: "Les joueurs d'un serveur qui utilise la ressource Fiverax",
    what: "Pseudo en jeu, identifiants FiveM (license, Discord…, jamais l'adresse IP), sessions de jeu, signalements, sanctions et bans, détections de l'anticheat et captures d'écran liées à une détection.",
    why: "Le suivi du temps de jeu, l'anticheat et la modération du serveur."
  },
  {
    who: "Les joueurs qui utilisent l'annuaire ou un espace joueurs",
    what: "Identifiant et pseudo Discord, avis, votes, réponses aux formulaires et participations aux giveaways.",
    why: "Publier ton avis ou ton vote, traiter ta candidature, tirer les gagnants."
  },
  {
    who: "Les visiteurs du scan gratuit",
    what: "L'adresse du serveur scanné et le résultat, à partir des informations que le serveur publie lui-même.",
    why: "Afficher le résultat du scan."
  },
  {
    who: "Les acheteurs d'une boutique Tebex",
    what: "Les achats que Tebex transmet au serveur (pseudo, packages, montant). Le paiement se fait chez Tebex : Fiverax ne voit jamais tes moyens de paiement.",
    why: "Les statistiques de la boutique du serveur."
  }
];

const retention = [
  ["Captures d'écran de l'anticheat", "30 jours"],
  ["Captures des signalements de joueurs", "30 jours"],
  ["Résultats du scan gratuit", "30 jours"],
  ["Actions du bot Discord", "30 jours"],
  ["Détections de l'anticheat et incidents de sécurité", "180 jours"],
  ["Événements Tebex", "1 an"],
  ["Retransmission d'écran en direct", "1 heure"],
  ["Données de gestion d'un serveur (staff, joueurs, logs…)", "Tant que le serveur utilise Fiverax ; supprimées avec le serveur"]
];

export default function PrivacyPage() {
  return (
    <>
      <h1>Politique de confidentialité</h1>
      <p className="legal-updated">Dernière mise à jour : {LEGAL.updatedAt}</p>

      <p>
        Fiverax est un panel de gestion pour les serveurs FiveM. Cette page explique quelles données le service traite, pourquoi,
        combien de temps, avec qui elles sont partagées et comment exercer tes droits (RGPD).
      </p>

      <h2>Qui est responsable</h2>
      <p>
        Le responsable du traitement est l&apos;éditeur de Fiverax (voir les <Link href="/mentions-legales">mentions légales</Link>), joignable à{" "}
        <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.
      </p>
      <p>
        Pour les données des membres du staff et des joueurs d&apos;un serveur, le propriétaire de ce serveur décide de ce qu&apos;il suit
        avec Fiverax : il est responsable de ce traitement, et Fiverax agit pour son compte (sous-traitant). Si tu es joueur ou membre
        d&apos;un staff, tu peux t&apos;adresser à ton serveur ou directement à nous.
      </p>

      <h2>Les données traitées et pourquoi</h2>
      <div className="legal-table">
        <table>
          <thead><tr><th>Qui</th><th>Données</th><th>Pourquoi</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.who}><td>{d.who}</td><td>{d.what}</td><td>{d.why}</td></tr>)}</tbody>
        </table>
      </div>
      <p>
        Base légale : l&apos;exécution du service demandé (connexion, gestion du serveur, boutique) et l&apos;intérêt légitime des serveurs à
        protéger leur communauté (anticheat, modération, signalements).
      </p>
      <p>
        Le scan complet analyse les fichiers des ressources d&apos;un serveur pour y chercher des failles : le code est lu pendant
        l&apos;analyse et n&apos;est jamais conservé.
      </p>

      <h2>Combien de temps</h2>
      <div className="legal-table">
        <table>
          <thead><tr><th>Données</th><th>Durée</th></tr></thead>
          <tbody>{retention.map(([what, how]) => <tr key={what}><td>{what}</td><td>{how}</td></tr>)}</tbody>
        </table>
      </div>

      <h2>Avec qui elles sont partagées</h2>
      <ul>
        <li><b>{LEGAL.hostName}</b> héberge le site.</li>
        <li><b>Turso</b> héberge la base de données.</li>
        <li><b>Discord</b> pour la connexion, la lecture des rôles et le bot.</li>
        <li><b>Tebex</b> pour les boutiques et les paiements.</li>
        <li>
          <b>Un fournisseur d&apos;intelligence artificielle</b> (Groq ou Google Gemini, selon la configuration) reçoit les textes nécessaires
          au bilan hebdomadaire, au Store Creator, au Studio IA et au plan d&apos;action de sécurité. Ces données ne servent qu&apos;à générer
          la réponse.
        </li>
      </ul>
      <p>Aucune donnée n&apos;est vendue ni utilisée pour de la publicité. Le site n&apos;utilise aucun outil de mesure d&apos;audience externe ni traceur publicitaire : l&apos;annuaire compte seulement les vues et les clics de chaque fiche, de façon anonyme et sans cookie, pour les statistiques du serveur.</p>
      <p>Certains de ces prestataires peuvent traiter des données hors de l&apos;Union européenne, avec les garanties prévues par le RGPD.</p>

      <h2>Cookies</h2>
      <p>Fiverax n&apos;utilise que des cookies nécessaires au fonctionnement du site, qui ne demandent pas de consentement :</p>
      <ul>
        <li>la session de connexion (8 heures) ;</li>
        <li>la page où revenir après la connexion Discord (15 minutes) ;</li>
        <li>le code de parrainage d&apos;un serveur, quand tu arrives par un lien de parrainage (30 jours).</li>
      </ul>

      <h2>Tes droits</h2>
      <p>
        Tu peux demander l&apos;accès à tes données, leur rectification, leur suppression, leur portabilité, ou t&apos;opposer à leur
        traitement en écrivant à <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>. Le propriétaire d&apos;un serveur peut
        aussi le supprimer avec toutes ses données depuis la page Configuration du panel.
      </p>
      <p>
        Si tu estimes que tes droits ne sont pas respectés, tu peux saisir la CNIL (<a href="https://www.cnil.fr" rel="noopener">cnil.fr</a>).
      </p>

      <p>Voir aussi les <Link href="/mentions-legales">mentions légales</Link> et les <Link href="/cgu">conditions d&apos;utilisation</Link>.</p>
    </>
  );
}
