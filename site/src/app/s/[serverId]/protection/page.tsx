import { can, requirePermissionPage } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai";
import { getLiveState } from "@/lib/agent";
import { badgeSvg } from "@/lib/badge-svg";
import { db } from "@/lib/db";
import { currentPlan, ensureBadge, protectionStatus } from "@/lib/protection";
import { embedCodes, hardeningCfg, recommendKit } from "@/lib/protection-shared";
import Shell, { PageHead } from "@/app/shell";
import ProtectionView from "./protection-view";
import "@/app/growth.css";

export const dynamic = "force-dynamic";

export default async function ProtectionPage({ params }: { params: Promise<{ serverId: string }> }) {
  const { user, server } = await requirePermissionPage((await params).serverId, "view_security");
  const [status, badge, live, installedRows] = await Promise.all([
    protectionStatus(server.id),
    ensureBadge(server),
    getLiveState(server.id),
    db.all<{ id: number; resource: string }>("SELECT id, resource FROM studio_creations WHERE server_id = ? AND resource IN ('fvx_event_guard', 'fvx_webhooks', 'fvx_join_guard')", [server.id])
  ]);
  const plan = await currentPlan(server.id, status);
  const appUrl = process.env.APP_URL || "";
  const configRules = status.findings.filter((f) => f.category === "config").map((f) => f.rule);

  return (
    <Shell user={user} server={server} active="protection">
      <PageHead kicker="Sécurité" title="Protection & badge" help="/guides/scanner">
        Le niveau de protection de ton serveur, vérifié par Fiverax, ce qu&apos;il manque pour monter, ton plan d&apos;action et les ressources prêtes à installer.
        Affiche ensuite le badge « Protégé par Fiverax » sur ton site, ton Discord et ta fiche annuaire.
      </PageHead>
      <ProtectionView
        status={{ level: status.level, checks: status.checks, next: status.next, score: status.score, lastScanAt: status.lastScanAt }}
        plan={plan}
        badge={badge}
        badgePreview={badgeSvg({ level: status.level, score: status.score, checkedAt: status.lastScanAt })}
        embeds={embedCodes(appUrl, badge.publicId)}
        cfg={hardeningCfg(status.findings.length ? configRules : null)}
        kit={recommendKit(status.findings)}
        installed={Object.fromEntries(installedRows.map((r) => [r.resource, Number(r.id)]))}
        online={live.online}
        aiReady={aiConfigured()}
        can={{ config: can(user, "security_config"), studio: can(user, "studio"), deploy: can(user, "studio_deploy") }}
      />
    </Shell>
  );
}
