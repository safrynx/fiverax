import { can, requirePermissionPage } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai";
import { getLiveState } from "@/lib/agent";
import { listChanges } from "@/lib/resource-files";
import Shell, { PageHead } from "@/app/shell";
import Assistant from "./assistant";
import { allowedKinds } from "@/lib/troubleshoot-perms";

export const dynamic = "force-dynamic";

export default async function AssistantPage({ params }: { params: Promise<{ serverId: string }> }) {
  const { user, server } = await requirePermissionPage((await params).serverId, "console");
  const files = can(user, "server_files");
  const [live, changes] = await Promise.all([getLiveState(server.id, { watch: true }), files ? listChanges(server.id) : Promise.resolve([])]);

  return (
    <Shell user={user} server={server} active="assistant">
      <PageHead kicker={server.name} title="Assistant IA">
        Parle-lui comme à un co-admin : « rembourse 5000 $ à Tata », « mets Bob mécano », « réanime Lucas », « pourquoi mon garage ne marche plus ? ».
        L&apos;IA voit les joueurs connectés, la console et les ressources{files ? ", ouvre les fichiers en cause et corrige le code (chaque modification s'affiche avant d'être écrite et s'annule en un clic)" : ""}.
        Rien n&apos;est exécuté sans ta confirmation.
      </PageHead>
      <Assistant
        initial={live}
        initialChanges={changes}
        canFiles={files}
        allowed={allowedKinds(user)}
        aiReady={aiConfigured()}
        settingsHref={user.owner ? `/s/${server.id}/settings` : null}
      />
    </Shell>
  );
}
