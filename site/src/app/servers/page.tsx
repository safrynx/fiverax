import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowUpRight, Server as ServerIcon } from "lucide-react";
import { listAccessibleServers, requireIdentityPage } from "@/lib/auth";
import { getBotStatus } from "@/lib/bot-status";
import { isPlatformOwner } from "@/lib/config";
import { db } from "@/lib/db";
import { referrerOfCode } from "@/lib/referrals";
import { REF_COOKIE, WELCOME_DAYS } from "@/lib/referrals-shared";
import { countServersCreatedBy, listManageableGuilds, maxServersPerUser } from "@/lib/servers";
import { Frame, PageHead } from "../shell";
import AddServer, { GuildIcon } from "../new-server-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mes serveurs" };

/** The servers the user can open, and their Discord servers they can add (self-service). */
export default async function ServersPage({ searchParams }: { searchParams: Promise<{ error?: string; deleted?: string }> }) {
  const identity = await requireIdentityPage();
  const { error, deleted } = await searchParams;
  const platformOwner = isPlatformOwner(identity.discordId);
  const [servers, guilds, created, invitedBy] = await Promise.all([
    listAccessibleServers(identity),
    listManageableGuilds(identity.discordId),
    countServersCreatedBy(identity.discordId),
    referrerOfCode((await cookies()).get(REF_COOKIE)?.value).catch(() => null)
  ]);

  const [counts, bots] = await Promise.all([
    db.all<{ server_id: string; n: number }>("SELECT server_id, COUNT(*) AS n FROM staff_members WHERE left_guild_at IS NULL GROUP BY server_id"),
    Promise.all(servers.map((s) => getBotStatus(s.id)))
  ]);
  const staffCount = new Map(counts.map((c) => [c.server_id, c.n]));

  return (
    <Frame identity={identity} sections={[{ label: "Espace", items: [{ href: "/servers", label: "Serveurs", icon: ServerIcon, active: true }] }]}>
      <PageHead kicker={`Bonjour ${identity.username}`} title="Tes serveurs">
        {servers.length ? "Choisis le serveur à gérer, ou ajoute le tien." : "Ajoute ton serveur pour commencer : tu en deviens le propriétaire."}
      </PageHead>
      {error === "forbidden" && <div className="banner">Tu n&apos;as pas accès à ce serveur.</div>}
      {deleted && <div className="banner">Le serveur a été supprimé, avec toutes ses données.</div>}
      {invitedBy && <div className="banner">Invité par <b>{invitedBy}</b> : ajoute ton serveur et relie FiveM : dès que tes premiers joueurs se connectent, tu gagnes {WELCOME_DAYS} jours « À la une » dans l&apos;annuaire (page Parrainage).</div>}

      {servers.length > 0 && (
        <div className="server-grid">
          {servers.map((s, i) => (
            <Link key={s.id} href={`/s/${s.id}`} className={`server-card rise rise-${Math.min(i + 1, 4)}`}>
              <div className="server-card-top">
                <GuildIcon url={s.iconUrl} name={s.name} size={48} />
                <ArrowUpRight size={18} className="server-card-go" />
              </div>
              <div className="h2" style={{ marginTop: 18, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
              <div className="server-card-meta">
                <span><b>{staffCount.get(s.id) ?? 0}</b> staff</span>
                <span><i className={`dot ${bots[i].alive ? "on" : ""}`} />{!s.guildId ? "Discord non lié" : bots[i].alive ? "Bot connecté" : "Bot absent"}</span>
                <span className="tag" data-tone={s.hasFivemToken ? "up" : undefined}>{s.hasFivemToken ? "FiveM lié" : "FiveM non lié"}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <section className="panel rise rise-2" style={{ maxWidth: 720 }}>
        <header className="panel-head">
          <div>
            <h2 className="h2">Ajouter un serveur</h2>
            <p className="muted">
              Choisis un de tes serveurs Discord. Tu en deviens propriétaire, puis la page Configuration te guide : inviter le bot, choisir les rôles, relier FiveM.
              {!platformOwner && <> {Math.max(0, maxServersPerUser() - created)} création(s) restante(s).</>}
            </p>
          </div>
        </header>
        <AddServer guilds={guilds} accessible={servers.map((s) => s.id)} manual={platformOwner} remaining={platformOwner ? 999 : maxServersPerUser() - created} />
      </section>
    </Frame>
  );
}
