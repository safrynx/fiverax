import Link from "next/link";
import { requirePermissionPage } from "@/lib/auth";
import { countNewResponses, ensureSite, giveawaysForStaff, listResponses } from "@/lib/portal-site";
import type { PortalContext } from "@/lib/portal-site-shared";
import Shell, { PageHead } from "@/app/shell";
import PortalEditor from "./portal-editor";
import { GiveawaysView, ResponsesView } from "./portal-staff";
import "@/app/joueur/portal.css";

export const dynamic = "force-dynamic";

type Tab = "editor" | "responses" | "giveaways";

export default async function PortalAdminPage({ params, searchParams }: { params: Promise<{ serverId: string }>; searchParams: Promise<{ tab?: string; all?: string }> }) {
  const { user, server } = await requirePermissionPage((await params).serverId, "portal_edit");
  const sp = await searchParams;
  const tab: Tab = sp.tab === "responses" || sp.tab === "giveaways" ? sp.tab : "editor";
  const [site, waiting] = await Promise.all([ensureSite(server), countNewResponses(server.id)]);
  const base = `/s/${server.id}/portal`;
  const demo: PortalContext = {
    serverName: server.name, slug: site.slug, live: { online: true, players: 42, maxClients: 64 }, connect: "cfx.re/join/abc123",
    viewer: { username: user.username, avatarUrl: user.avatarUrl ?? null },
    stats: { linked: true, playSeconds: 36 * 3600 + 1200, sessions: 58, firstSeenAt: new Date(Date.now() - 90 * 86_400_000).toISOString(), inGame: false, banned: false },
    forms: {}, giveaways: {}
  };

  return (
    <Shell user={user} server={server} active="portal">
      <PageHead kicker="Réseau Fiverax" title="Portail joueurs" help="/guides/portail-annuaire">
        La page de ton serveur pour tes joueurs : annonces, événements, boutons, règlement, formulaires (candidatures, whitelist…) et giveaways avec récompense en jeu.
        Les joueurs s&apos;y connectent avec Discord et retrouvent leurs stats.
      </PageHead>
      <div className="pill-tabs" style={{ marginBottom: 20 }}>
        <Link href={base} data-on={tab === "editor"}>Éditeur</Link>
        <Link href={`${base}?tab=responses`} data-on={tab === "responses"}>Réponses{waiting ? ` · ${waiting}` : ""}</Link>
        <Link href={`${base}?tab=giveaways`} data-on={tab === "giveaways"}>Giveaways</Link>
      </div>
      {tab === "editor" && <PortalEditor initial={site} demo={demo} appUrl={(process.env.APP_URL || "").replace(/\/+$/, "")} />}
      {tab === "responses" && <ResponsesView responses={await listResponses(server.id, sp.all === "1" ? "all" : "open")} all={sp.all === "1"} />}
      {tab === "giveaways" && <GiveawaysView giveaways={await giveawaysForStaff(server)} published={Boolean(site.published)} />}
    </Shell>
  );
}
