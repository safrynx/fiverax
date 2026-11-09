import { requireOwnerPage } from "@/lib/auth";
import { getLiveState } from "@/lib/agent";
import { AGENT_VERSION } from "@/lib/agent-files.generated";
import { isPlatformOwner } from "@/lib/config";
import { botInviteUrl } from "@/lib/discord";
import { LEGACY_SERVER_ID, listManageableGuilds, serverReviewHour, serverTimeZone } from "@/lib/servers";
import Shell, { PageHead } from "@/app/shell";
import SetupChecklist from "@/app/setup-checklist";
import DeleteServer from "./delete-server";
import ServerSettings from "./server-settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ params }: { params: Promise<{ serverId: string }> }) {
  const { user, server } = await requireOwnerPage((await params).serverId);
  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  const platformOwner = isPlatformOwner(user.discordId);
  // Guilds this owner may point the server at: the ones they manage and no other server uses (plus the current one).
  const guildOptions = (await listManageableGuilds(user.discordId))
    .filter((g) => !g.serverId || g.serverId === server.id)
    .map((g) => ({ id: g.guildId, name: g.name }));
  const live = await getLiveState(server.id);

  return (
    <Shell user={user} server={server} active="settings">
      <PageHead kicker={server.name} title="Configuration" help="/guides/demarrer">Identité du serveur, serveur Discord suivi par le bot, fuseau horaire et agent FiveM.</PageHead>
      <SetupChecklist server={server} always />
      <ServerSettings
        name={server.name}
        guildId={server.guildId}
        timezone={server.timezone}
        reviewHour={server.reviewHour}
        defaultTimezone={serverTimeZone(null)}
        defaultReviewHour={serverReviewHour(null)}
        freeGuildInput={platformOwner}
        guildOptions={guildOptions}
        hasFivemToken={server.hasFivemToken}
        appUrl={appUrl}
        agent={{ linked: live.linked, online: live.online, version: live.agentVersion }}
        latestAgent={AGENT_VERSION}
        inviteUrl={botInviteUrl(server.guildId)}
      />
      {(server.id !== LEGACY_SERVER_ID || platformOwner) && <DeleteServer name={server.name} />}
    </Shell>
  );
}
