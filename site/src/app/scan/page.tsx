import type { Metadata } from "next";
import Link from "next/link";
import { Bug, Cpu, EyeOff, FileWarning, Lock, Network, ScanSearch, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { scanStats } from "@/lib/external-scan";
import { CtaLink } from "../annuaire/track";
import ScanForm from "./scan-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Scan de sécurité gratuit pour serveur FiveM · Fiverax" },
  description: "Ton serveur FiveM est-il protégé ? Colle ton lien cfx.re/join : score de sécurité, IP des joueurs exposées, ScriptHook, artifacts en retard, anticheat, OneSync. Gratuit et sans compte.",
  alternates: { canonical: "/scan" },
  openGraph: { title: "Scan de sécurité gratuit · serveurs FiveM", description: "Le score de sécurité de ton serveur FiveM en 10 secondes, sans rien installer.", type: "website" }
};

const quick = [
  { icon: EyeOff, title: "IP des joueurs exposées", text: "Si /players.json publie l'adresse de tes joueurs, n'importe qui peut les attaquer (DDoS)." },
  { icon: Bug, title: "ScriptHook et fichiers modifiés", text: "sv_scriptHookAllowed et sv_pureLevel : ce qui laisse entrer les menus de triche." },
  { icon: Cpu, title: "Artifacts en retard", text: "Ta version de FXServer comparée aux builds recommandés et aux failles connues de Cfx.re." },
  { icon: ShieldCheck, title: "Anticheat et OneSync", text: "Un anticheat visible ? OneSync actif ? Sans lui, le serveur ne voit pas ce que font les cheaters." },
  { icon: FileWarning, title: "Librairies abandonnées", text: "mysql-async, ghmattimysql, EssentialMode : lentes, plus maintenues, parfois avec des failles." },
  { icon: Network, title: "Configuration", text: "Build du jeu fixé, nombre de ressources, informations publiques du serveur." }
];

const deep = [
  "Backdoors (code téléchargé puis exécuté, code caché, panels de triche connus)",
  "Événements serveur exploitables (argent ou objets pris dans les paramètres du client)",
  "Injections SQL, webhooks Discord et clés API lisibles par les joueurs",
  "Permissions ACE ouvertes à tout le monde, RCON, ordre des ensure",
  "Performance : boucles Wait(0), requêtes SQL dans des boucles, fichiers streamés trop lourds"
];

export default async function ScanPage() {
  const stats = await scanStats().catch(() => ({ scans: 0, average: null }));
  return (
    <>
      <section className="gx-hero">
        <div className="lp-chip rise"><b>Gratuit</b>Sans compte, sans rien installer</div>
        <h1 className="rise rise-1">Ton serveur FiveM est-il <span className="gold">vraiment protégé ?</span></h1>
        <p className="rise rise-2">Colle le lien de ton serveur : Fiverax lit ce que tout le monde peut voir de lui et te donne un score de sécurité en quelques secondes, avec ce qu&apos;il faut corriger en priorité.</p>
        <div className="rise rise-3" style={{ marginTop: 26, maxWidth: 680 }}><ScanForm /></div>
        {stats.scans > 0 && (
          <div className="dir-facts rise rise-4">
            <span><b>{stats.scans}</b>serveurs scannés ces 30 jours</span>
            {stats.average !== null && <span><b>{stats.average}/100</b>score moyen</span>}
          </div>
        )}
      </section>

      <section className="dir-section">
        <header><h2><ScanSearch size={18} style={{ verticalAlign: -3, marginRight: 8 }} />Ce que vérifie le scan rapide</h2></header>
        <div className="gx-cards">
          {quick.map((q) => (
            <article key={q.title} className="gx-card">
              <span className="ic"><q.icon size={18} /></span>
              <h3>{q.title}</h3>
              <p>{q.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="dir-cta" style={{ alignItems: "start" }}>
        <div>
          <div className="eyebrow">Scan complet</div>
          <h2>Le scan rapide voit la porte. Le scan complet fouille la maison.</h2>
          <p>Avec l&apos;agent Fiverax installé sur ton serveur, chaque fichier de chaque ressource est analysé (le code n&apos;est jamais conservé) :</p>
          <ul className="gx-list">
            {deep.map((d) => <li key={d}><Lock size={13} />{d}</li>)}
          </ul>
          <p style={{ marginTop: 14 }}>Ensuite, le plan d&apos;action IA te dit quoi corriger, et le kit de protection te donne les ressources prêtes à installer. Ton serveur gagne le badge <b>Protégé par Fiverax</b>.</p>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <CtaLink href="/login" className="btn primary shine"><Sparkles size={16} />Scan complet gratuit</CtaLink>
          <Link href="/annuaire" className="btn"><Wrench size={16} />Voir les serveurs protégés</Link>
        </div>
      </section>
    </>
  );
}
