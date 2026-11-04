import { requireOwnerPage } from "@/lib/auth";
import { getShopSettings } from "@/lib/tebex";
import Shell, { PageHead } from "@/app/shell";
import ShopSettingsForm from "./settings-form";

export const dynamic = "force-dynamic";

export default async function ShopSettingsPage({ params }: { params: Promise<{ serverId: string }> }) {
  const { user, server } = await requireOwnerPage((await params).serverId);
  const settings = await getShopSettings(server.id);
  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");

  return (
    <Shell user={user} server={server} active="shop_settings">
      <PageHead kicker={server.name} title="Réglages boutique">
        Liaison avec le webstore Tebex du serveur. Les clés sont chiffrées en base et ne sont jamais renvoyées au navigateur.
      </PageHead>
      <ShopSettingsForm
        hasSecret={settings.hasSecret}
        secretUnreadable={settings.secretUnreadable}
        publicToken={settings.publicToken}
        hasWebhookSecret={settings.hasWebhookSecret}
        webhookUrl={settings.webhookKey ? `${appUrl}/api/tebex/webhook/${settings.webhookKey}` : null}
        alerts={settings.alerts}
        account={settings.account}
        checkedAt={settings.checkedAt}
      />
    </Shell>
  );
}
