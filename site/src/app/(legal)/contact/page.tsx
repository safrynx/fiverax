import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL } from "@/lib/legal";
import { OG_BASE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contacter l'équipe Fiverax : question sur le panel, ton serveur FiveM, tes données ou un contenu à signaler.",
  alternates: { canonical: "/contact" },
  openGraph: { ...OG_BASE, url: "/contact", title: "Contact · Fiverax" }
};

export default function ContactPage() {
  return (
    <>
      <h1>Contact</h1>
      <p>
        Une question sur Fiverax, un problème avec ton serveur, une demande sur tes données ou un contenu à signaler ? Écris-nous à{" "}
        <a href={`mailto:${LEGAL.contactEmail}`}><b>{LEGAL.contactEmail}</b></a>.
      </p>
      <h2>Pour aller plus vite</h2>
      <ul>
        <li>Indique le nom de ton serveur et, si tu l&apos;as, le lien de sa fiche dans l&apos;<Link href="/annuaire">annuaire</Link>.</li>
        <li>Pour un problème dans le panel, décris ce que tu as fait et ce que tu as vu (une capture d&apos;écran aide beaucoup).</li>
        <li>Pour une demande sur tes données (accès, suppression), écris depuis l&apos;adresse liée à ton compte Discord si possible, ou donne ton pseudo Discord.</li>
      </ul>
      <p>
        Tu es joueur et ta question concerne un serveur en particulier (sanction, achat, candidature) ? Le staff de ce serveur est le
        mieux placé pour te répondre : passe par son Discord ou son espace joueurs.
      </p>
    </>
  );
}
