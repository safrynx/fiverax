import Link from "next/link";
import { isOwner, requirePermissionPage } from "@/lib/auth";
import { designFor, ensureStoreSite, listStoreVersions, loadStoreData, storeAIConfigured } from "@/lib/store";
import { getShopSettings } from "@/lib/tebex";
import Shell, { PageHead } from "@/app/shell";
import StoreEditor from "./store-editor";

export const dynamic = "force-dynamic";

export default async function StoreCreatorPage({ params }: { params: Promise<{ serverId: string }> }) {
  const { user, server } = await requirePermissionPage((await params).serverId, "store_edit");
  const [settings, data] = await Promise.all([getShopSettings(server.id), loadStoreData(server.id)]);
  const site = await ensureStoreSite(server, data);
  const versions = await listStoreVersions(server.id);
  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  const owner = isOwner(user);

  return (
    <Shell user={user} server={server} active="store_creator">
      <PageHead kicker={server.name} title="Store Creator" help="/guides/boutique-tebex">
        Ta boutique en ligne, branchée sur Tebex : construis-la avec des blocs ou décris-la à l&apos;IA. Catalogue, prix, objectifs et joueurs en ligne sont toujours à jour.
      </PageHead>
      {!settings.publicToken && (
        <div className="banner">
          <b>Catalogue Tebex non relié.</b> Sans le token public, la boutique n&apos;a rien à vendre et le paiement est impossible.{" "}
          {owner ? <Link href={`/s/${server.id}/shop/settings`} className="linkish">Le renseigner dans Réglages boutique</Link> : "Demande à un propriétaire de le renseigner (Réglages boutique)."}
        </div>
      )}
      {settings.publicToken && data.error && <div className="error" style={{ marginBottom: 14 }}>Le catalogue Tebex ne répond pas pour l&apos;instant ({data.error}) : l&apos;aperçu est vide, ton design est conservé.</div>}
      <StoreEditor
        initial={designFor(site.draft, data)}
        data={data}
        slug={site.slug}
        publishedAt={site.publishedAt}
        dirty={site.dirty}
        storeUrl={`${appUrl}/store/${site.slug}`}
        versions={versions}
        aiReady={storeAIConfigured()}
        serverName={server.name}
      />
    </Shell>
  );
}
