import Link from "next/link";
import { requireOwnerPage } from "@/lib/auth";
import { getGuildBotProfile } from "@/lib/bot-profile";
import { botInviteUrl } from "@/lib/discord";
import { formatDateTime } from "@/lib/format";
import Shell, { PageHead } from "@/app/shell";
import BotProfileForm from "./bot-profile-form";

export const dynamic = "force-dynamic";

/** The shared bot, dressed in the server's colors on its own Discord (name, avatar, banner, bio). Owners only. */
export default async function BotPage({ params }: { params: Promise<{ serverId: string }> }) {
  const { user, server } = await requireOwnerPage((await params).serverId);
  const profile = await getGuildBotProfile(server.id, server.guildId);
  const invite = botInviteUrl(server.guildId);

  return (
    <Shell user={user} server={server} active="bot">
      <PageHead kicker={server.name} title="Bot Discord" help="/guides/demarrer#bot">
        Donne au bot le nom, l&apos;avatar, la bannière et la bio de ton serveur : tes membres voient « ton » bot, avec toutes les fonctions Fiverax.
      </PageHead>

      {!server.guildId ? (
        <div className="banner">Relie d&apos;abord ton serveur Discord dans <Link href={`/s/${server.id}/settings`} className="linkish">Configuration</Link>.</div>
      ) : !profile.base ? (
        <div className="banner" data-tone="danger">Le bot est momentanément injoignable sur Discord : réessaie dans quelques minutes.</div>
      ) : !profile.present ? (
        <div className="banner">Le bot n&apos;est pas encore sur ton Discord. {invite && <a href={invite} target="_blank" rel="noreferrer" className="linkish">Inviter le bot</a>}</div>
      ) : (
        <>
          {profile.updatedAt && <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Dernière modification depuis Fiverax : {formatDateTime(profile.updatedAt)}.</p>}
          <BotProfileForm
            current={{ nick: profile.nick, bio: profile.bio, avatarUrl: profile.avatarUrl, bannerUrl: profile.bannerUrl }}
            base={{ username: profile.base.username, avatarUrl: profile.base.avatarUrl, bannerUrl: profile.base.bannerUrl, description: profile.base.description }}
          />
        </>
      )}
    </Shell>
  );
}
