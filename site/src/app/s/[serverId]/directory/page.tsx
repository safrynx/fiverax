import { requirePermissionPage } from "@/lib/auth";
import { featuredSlots, getListing, publishProblems, reviewsForStaff, reviewsToModerate, statsFor } from "@/lib/directory";
import Shell, { PageHead } from "@/app/shell";
import { getVoteSettings, votesForStaff } from "@/lib/votes";
import DirectoryEditor from "./directory-editor";
import VotesEditor from "./votes-editor";

export const dynamic = "force-dynamic";

export default async function DirectoryAdminPage({ params }: { params: Promise<{ serverId: string }> }) {
  const { user, server } = await requirePermissionPage((await params).serverId, "directory_edit");
  const [listing, stats, reviews, slots, moderation, voteSettings, votes] = await Promise.all([
    getListing(server.id), statsFor(server.id), reviewsForStaff(server.id), featuredSlots(server.id),
    user.platformOwner ? reviewsToModerate() : Promise.resolve([]), getVoteSettings(server.id), votesForStaff(server.id)
  ]);

  return (
    <Shell user={user} server={server} active="directory">
      <PageHead kicker="Réseau Fiverax" title="Fiche annuaire">
        Ta page dans l&apos;annuaire public des serveurs Fiverax : les joueurs y voient qui est connecté en direct, lisent les avis de ceux qui ont joué chez toi
        et rejoignent en un clic. Gratuit, publié quand tu veux.
      </PageHead>
      <DirectoryEditor
        initial={listing}
        problems={publishProblems(listing)}
        stats={stats}
        reviews={reviews}
        slots={slots}
        moderation={moderation}
        platformOwner={user.platformOwner}
      />
      <VotesEditor initial={voteSettings} stats={votes} slug={listing.slug} published={listing.published} />
    </Shell>
  );
}
