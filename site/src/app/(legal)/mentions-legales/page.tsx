import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL } from "@/lib/legal";
import { OG_BASE } from "@/lib/site";
import { Field } from "../field";

export const metadata: Metadata = {
  title: "Mentions légales",
  description: "Éditeur, hébergeur et contact du site Fiverax, le panel de gestion des serveurs FiveM.",
  alternates: { canonical: "/mentions-legales" },
  openGraph: { ...OG_BASE, url: "/mentions-legales", title: "Mentions légales · Fiverax" }
};

export default function LegalNoticePage() {
  return (
    <>
      <h1>Mentions légales</h1>
      <p className="legal-updated">Dernière mise à jour : {LEGAL.updatedAt}</p>

      <h2>Éditeur du site</h2>
      <p>
        Le site fiverax.com et le service Fiverax sont édités par un particulier, à titre non professionnel. Conformément à
        l&apos;article 6-III-2 de la loi n° 2004-575 du 21 juin 2004 pour la confiance dans l&apos;économie numérique, son identité
        n&apos;est pas publiée et a été communiquée à l&apos;hébergeur ci-dessous.
      </p>
      <p>Contact de l&apos;éditeur et du directeur de la publication : <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a></p>

      <h2>Hébergeur</h2>
      <p>
        {LEGAL.hostName} (<a href={LEGAL.hostWebsite} rel="noopener">{LEGAL.hostWebsite.replace(/^https?:\/\//, "")}</a>)<br />
        Adresse : <Field value={LEGAL.hostAddress} /><br />
        Téléphone : <Field value={LEGAL.hostPhone} />
      </p>

      <h2>Propriété intellectuelle</h2>
      <p>
        Le nom Fiverax, son logo, les textes, le design et le code du site sont la propriété de l&apos;éditeur. Toute reproduction
        sans autorisation est interdite. Les contenus publiés par les serveurs (fiches de l&apos;annuaire, boutiques, espaces joueurs)
        restent la propriété de leurs auteurs, qui en sont responsables.
      </p>
      <p>
        FiveM et Cfx.re sont des marques de leurs propriétaires respectifs, tout comme Grand Theft Auto V, Discord et Tebex.
        Fiverax est un service indépendant, qui n&apos;est ni affilié ni approuvé par ces sociétés.
      </p>

      <h2>Données personnelles</h2>
      <p>
        Ce que Fiverax collecte, pourquoi, combien de temps et comment exercer tes droits : voir la{" "}
        <Link href="/confidentialite">politique de confidentialité</Link>. L&apos;utilisation du service est encadrée par les{" "}
        <Link href="/cgu">conditions générales d&apos;utilisation</Link>.
      </p>

      <h2>Contact</h2>
      <p>Pour toute question ou pour signaler un contenu : <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.</p>
    </>
  );
}
