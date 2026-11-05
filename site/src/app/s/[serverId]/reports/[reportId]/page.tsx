import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePermissionPage } from "@/lib/auth";
import { getReport } from "@/lib/blackbox";
import { KIND_LABEL } from "@/lib/blackbox-shared";
import Shell, { PageHead } from "@/app/shell";
import ReplayView from "./replay-view";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: Promise<{ serverId: string; reportId: string }> }) {
  const { serverId, reportId } = await params;
  const { user, server } = await requirePermissionPage(serverId, "reports");
  const id = Number(reportId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const report = await getReport(server.id, id);
  if (!report) notFound();

  return (
    <Shell user={user} server={server} active="reports">
      <Link href={`/s/${server.id}/reports`} className="linkish rise" style={{ display: "inline-block", marginBottom: 18 }}>← Retour aux reports</Link>
      <PageHead kicker={`${KIND_LABEL[report.kind]} #${report.id}`} title="Replay de l'incident">
        Rejoue les minutes avant (et juste après) : qui était là, qui a tiré le premier, qui parlait. Clique un événement de la chronologie pour y aller.
      </PageHead>
      <ReplayView report={report} mapImage={process.env.MAP_IMAGE_URL || null} can={{ ban: can(user, "ban") }} />
    </Shell>
  );
}
