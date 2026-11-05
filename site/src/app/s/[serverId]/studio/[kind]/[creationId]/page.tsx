import { notFound } from "next/navigation";
import { can, requirePermissionPage } from "@/lib/auth";
import { getLiveState } from "@/lib/agent";
import { libraryLink } from "@/lib/library";
import { getCreation, studioAIConfigured } from "@/lib/studio";
import { isCreationKind } from "@/lib/studio-shared";
import Shell from "@/app/shell";
import StudioEditor from "../../studio-editor";

export const dynamic = "force-dynamic";

export default async function CreationPage({ params }: { params: Promise<{ serverId: string; kind: string; creationId: string }> }) {
  const { serverId, kind, creationId } = await params;
  if (!isCreationKind(kind)) notFound();
  const { user, server } = await requirePermissionPage(serverId, "studio");
  const [creation, live, library] = await Promise.all([getCreation(server.id, Number(creationId)), getLiveState(server.id), libraryLink(server.id, Number(creationId))]);
  if (!creation || creation.kind !== kind) notFound();
  const players = live.players.filter((p) => p.pos).map((p) => ({ id: p.id, name: p.name, pos: p.pos as [number, number, number] }));

  return (
    <Shell user={user} server={server} active={`studio_${kind}`}>
      <StudioEditor
        key={creation.id}
        initial={creation}
        canDeploy={can(user, "studio_deploy")}
        canPublish={can(user, "library_publish")}
        library={library}
        online={live.online}
        aiReady={studioAIConfigured()}
        players={players}
      />
    </Shell>
  );
}
