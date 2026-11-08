import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { getIdentity } from "@/lib/auth";
import { DiscordIcon, Mark, Wordmark } from "../brand";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connexion", robots: { index: false, follow: false } };

const messages: Record<string, string> = {
  missing_config: "Configuration Discord incomplète côté serveur.",
  invalid_state: "Session de connexion expirée ou invalide. Réessaie.",
  oauth_exchange: "Discord a refusé l'échange du code. Vérifie le client secret et l'URL de redirection.",
  oauth_identity: "Impossible de lire ton profil Discord.",
  forbidden: "Ton compte n'a accès à aucun serveur. Demande au propriétaire d'un serveur de t'ajouter.",
  access_denied: "Connexion annulée."
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; missing?: string }> }) {
  const identity = await getIdentity();
  const { error, missing } = await searchParams;
  if (identity && !error) redirect("/servers");

  return (
    <main className="login">
      <section className="login-art">
        <Link href="/" style={{ position: "relative" }}><Wordmark size={30} /></Link>
        <Mark size={420} />
        <blockquote className="rise">
          Grades, avertissements, activité : ton staff FiveM tient dans un seul panel.
          <span>Fiverax · Dashboard FiveM multi-serveurs</span>
        </blockquote>
      </section>

      <section className="login-side">
        <header>
          <Link href="/" className="linkish" style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}><ArrowLeft size={14} />Accueil</Link>
          <span className="login-mobile-brand"><Wordmark size={24} /></span>
        </header>

        <div className="login-card">
          <div className="eyebrow rise">Espace membre</div>
          <h1 className="rise rise-1">Connexion</h1>
          <p className="muted rise rise-2" style={{ margin: "10px 0 0" }}>
            Connecte-toi avec ton compte Discord pour retrouver tes serveurs, ou ajouter le tien.
          </p>

          {error && (
            <div className="error rise" style={{ marginTop: 22 }}>
              {messages[error] ?? "Erreur de connexion."}
              {error === "missing_config" && missing ? ` (${missing})` : null}
            </div>
          )}

          <a href="/api/auth/discord" className="btn discord shine rise rise-3" style={{ marginTop: 28 }}>
            <DiscordIcon size={20} />Continuer avec Discord
          </a>

          <ul className="login-perms rise rise-4">
            <li><Check size={15} />Fiverax lit ton profil et la liste de tes serveurs Discord.</li>
            <li><Check size={15} />Il ne publie rien et n&apos;écrit aucun message en ton nom.</li>
            <li><Check size={15} />Tes accès suivent tes rôles Discord, serveur par serveur.</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
