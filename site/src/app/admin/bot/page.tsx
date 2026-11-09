import type { Metadata } from "next";
import { requirePlatformAdminPage } from "@/lib/auth";
import { getBotIdentity } from "@/lib/bot-profile";
import { db } from "@/lib/db";
import { getPlatformSettings } from "@/lib/platform";
import { PageHead } from "../../shell";
import AdminFrame from "../admin-frame";
import BotAdminForm from "./bot-admin-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bot Discord · Administration", robots: { index: false, follow: false } };

/** The shared Discord bot, everywhere: identity and status. Each server can still dress it in its own colors on its Discord. */
export default async function AdminBot() {
  const identity = await requirePlatformAdminPage();
  const [bot, settings, watched] = await Promise.all([
    getBotIdentity(true),
    getPlatformSettings(),
    db.get<{ n: number }>("SELECT COUNT(*) AS n FROM servers WHERE guild_id IS NOT NULL AND suspended_at IS NULL")
  ]);

  return (
    <AdminFrame identity={identity} active="bot">
      <PageHead kicker="Administration" title="Bot Discord">
        Le profil du bot partagé sur tous les serveurs, et son statut. Chaque serveur peut en plus lui donner son nom, son avatar, sa bannière et sa bio sur son propre Discord (Administration &gt; Bot Discord de chaque serveur).
      </PageHead>
      {bot
        ? <BotAdminForm identity={bot} presence={settings.bot} watched={Number(watched?.n ?? 0)} />
        : <div className="banner" data-tone="danger">Impossible de lire le bot sur Discord : vérifie <code>DISCORD_BOT_TOKEN</code> dans l&apos;environnement du site (page Système).</div>}
    </AdminFrame>
  );
}
