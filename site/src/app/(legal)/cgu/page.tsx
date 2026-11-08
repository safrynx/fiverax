import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL } from "@/lib/legal";
import { OG_BASE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Conditions générales d'utilisation",
  description: "Les règles d'utilisation de Fiverax : compte Discord, serveurs, annuaire, boutiques Tebex, scan de sécurité et responsabilités.",
  alternates: { canonical: "/cgu" },
  openGraph: { ...OG_BASE, url: "/cgu", title: "Conditions générales d'utilisation · Fiverax" }
};

export default function TermsPage() {
  return (
    <>
      <h1>Conditions générales d&apos;utilisation</h1>
      <p className="legal-updated">Dernière mise à jour : {LEGAL.updatedAt}</p>

      <h2>1. Le service</h2>
      <p>
        Fiverax est un panel de gestion pour les serveurs FiveM : gestion du staff depuis Discord, suivi de l&apos;activité, boutique
        reliée à Tebex, anticheat, scan de sécurité, annuaire des serveurs et espaces joueurs. En utilisant le site, tu acceptes ces
        conditions.
      </p>

      <h2>2. Compte et accès</h2>
      <p>
        La connexion se fait avec ton compte Discord. Seule une personne qui a la permission « Gérer le serveur » sur un serveur Discord
        peut l&apos;ajouter à Fiverax ; elle en devient le propriétaire et choisit qui a accès au panel. Les accès suivent les rôles Discord :
        un rôle retiré sur Discord retire l&apos;accès correspondant. Tu es responsable de ce qui est fait depuis ton compte.
      </p>

      <h2>3. Ce que tu t&apos;engages à respecter</h2>
      <ul>
        <li>N&apos;utiliser Fiverax que pour des serveurs que tu gères ou pour lesquels tu as l&apos;accord du propriétaire.</li>
        <li>Ne pas scanner un serveur dans le but de l&apos;attaquer, ni utiliser les résultats contre un serveur tiers.</li>
        <li>Respecter les conditions de Discord, de Cfx.re (FiveM) et de Tebex.</li>
        <li>Ne pas publier de contenu illégal, haineux, trompeur ou qui porte atteinte aux droits d&apos;autrui (fiches, avis, boutiques, espaces joueurs).</li>
        <li>Ne pas tenter de contourner la sécurité du service ni d&apos;accéder aux données d&apos;un autre serveur.</li>
      </ul>

      <h2>4. Contenus publiés par les serveurs et les joueurs</h2>
      <p>
        Chaque serveur est responsable de sa fiche dans l&apos;annuaire, de sa boutique et de son espace joueurs. Chaque joueur est
        responsable de ses avis. Fiverax peut retirer un contenu signalé ou contraire à ces conditions, et suspendre un serveur qui ne
        les respecte pas.
      </p>

      <h2>5. Boutiques et paiements</h2>
      <p>
        Les achats se font chez Tebex, qui encaisse le paiement et le reverse au serveur. Fiverax n&apos;est pas vendeur, ne voit pas les
        moyens de paiement et n&apos;intervient pas dans la vente : les questions sur un achat, un remboursement ou un avantage en jeu
        se règlent avec le serveur et Tebex.
      </p>

      <h2>6. Sécurité, anticheat et intelligence artificielle</h2>
      <p>
        Le scan, l&apos;anticheat, le plan d&apos;action et les contenus générés par l&apos;IA (bilan hebdomadaire, Store Creator, Studio IA) sont
        une aide. Ils ne garantissent pas qu&apos;un serveur est à l&apos;abri de toute faille ou de toute triche. Vérifie ce que tu installes
        et ce que tu publies.
      </p>

      <h2>7. Disponibilité et responsabilité</h2>
      <p>
        Fiverax fait de son mieux pour que le service soit disponible et fiable, sans pouvoir le garantir. Le service peut évoluer, être
        interrompu pour maintenance, ou dépendre de Discord, Cfx.re et Tebex. Fiverax ne peut pas être tenu responsable d&apos;un dommage
        indirect, d&apos;une perte de données ou de revenus liée à l&apos;utilisation du service, dans les limites prévues par la loi.
      </p>

      <h2>8. Fin d&apos;utilisation</h2>
      <p>
        Le propriétaire d&apos;un serveur peut le supprimer à tout moment depuis la page Configuration, avec toutes ses données. Fiverax
        peut suspendre l&apos;accès d&apos;un compte ou d&apos;un serveur en cas de non-respect de ces conditions.
      </p>

      <h2>9. Données personnelles</h2>
      <p>Voir la <Link href="/confidentialite">politique de confidentialité</Link>.</p>

      <h2>10. Modifications et droit applicable</h2>
      <p>
        Ces conditions peuvent être modifiées ; la date de mise à jour figure en haut de la page. Elles sont soumises au droit français.
        Pour toute question : <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.
      </p>
    </>
  );
}
