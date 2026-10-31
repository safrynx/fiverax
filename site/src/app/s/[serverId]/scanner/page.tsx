import { can, requirePermissionPage } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai";
import { getLiveState } from "@/lib/agent";
import { getAuditSettings, getScan, latestReport, listScans, runningScan } from "@/lib/server-audit";
import Shell, { PageHead } from "@/app/shell";
import AuditView from "./audit-view";

export const dynamic = "force-dynamic";

export default async function AuditPage({ params, searchParams }: { params: Promise<{ serverId: string }>; searchParams: Promise<{ scan?: string }> }) {
  const { user, server } = await requirePermissionPage((await params).serverId, "view_security");
  const wanted = Number((await searchParams).scan);
  const [running, latest, history, settings, live] = await Promise.all([
    runningScan(server.id),
    wanted ? getScan(server.id, wanted) : latestReport(server.id),
    listScans(server.id),
    getAuditSettings(server.id),
    getLiveState(server.id)
  ]);

  return (
    <Shell user={user} server={server} active="audit">
      <PageHead kicker="Sécurité" title="Scanner">
        Backdoors, événements exploitables, injections SQL, secrets exposés, configuration, performance et maintenance de toutes les ressources, avec un score sur 100 et le correctif de chaque problème.
      </PageHead>
      <AuditView
        initial={{ running, latest, history }}
        settings={settings}
        online={live.online}
        canRun={can(user, "security_config")}
        aiReady={aiConfigured()}
      />
    </Shell>
  );
}
