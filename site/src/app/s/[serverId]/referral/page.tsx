import { requireOwnerPage } from "@/lib/auth";
import { db } from "@/lib/db";
import { featuredSlots } from "@/lib/directory";
import { referralOverview } from "@/lib/referrals";
import { MILESTONES, QUALIFY_PLAYERS, QUALIFY_WITHIN_DAYS, REFERRAL_DAYS, shareMessage, WELCOME_DAYS } from "@/lib/referrals-shared";
import Shell, { PageHead } from "@/app/shell";
import ReferralView from "./referral-view";
import "@/app/growth.css";

export const dynamic = "force-dynamic";

export default async function ReferralPage({ params }: { params: Promise<{ serverId: string }> }) {
  const { user, server } = await requireOwnerPage((await params).serverId);
  const [overview, listing, slots] = await Promise.all([
    referralOverview(server.id),
    db.get<{ published: number }>("SELECT published FROM directory_listings WHERE server_id = ?", [server.id]),
    featuredSlots(server.id)
  ]);

  return (
    <Shell user={user} server={server} active="referral">
      <PageHead kicker="Réseau Fiverax" title="Parrainage">
        Invite d&apos;autres serveurs sur Fiverax avec ton lien. Chaque serveur parrainé qui tourne vraiment (agent FiveM relié et {QUALIFY_PLAYERS} joueurs différents,
        dans les {QUALIFY_WITHIN_DAYS} jours) te rapporte <b>{REFERRAL_DAYS} jours « À la une »</b> dans l&apos;annuaire, et lui en offre {WELCOME_DAYS}.
      </PageHead>
      <ReferralView
        overview={overview}
        share={shareMessage(overview.link, server.name)}
        listingPublished={Boolean(listing?.published)}
        featuredUntil={slots.length ? slots[slots.length - 1].endsAt : null}
        milestones={MILESTONES.map((m) => ({ at: m.at, days: m.days, label: m.label }))}
      />
    </Shell>
  );
}
