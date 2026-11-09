import type { Metadata } from "next";
import { requirePlatformAdminPage } from "@/lib/auth";
import { getPlatformSettings } from "@/lib/platform";
import { maxServersPerUser } from "@/lib/servers";
import { PageHead } from "../../shell";
import AdminFrame from "../admin-frame";
import SettingsForm from "./settings-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Réglages · Administration", robots: { index: false, follow: false } };

export default async function AdminSettings() {
  const identity = await requirePlatformAdminPage();
  const settings = await getPlatformSettings();
  return (
    <AdminFrame identity={identity} active="settings">
      <PageHead kicker="Administration" title="Réglages de la plateforme">
        Inscriptions, annonce, maintenance et quotas d&apos;IA. Chaque enregistrement est écrit dans le journal.
      </PageHead>
      <SettingsForm initial={settings} envMaxServers={maxServersPerUser()} />
    </AdminFrame>
  );
}
