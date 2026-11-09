import Link from "next/link";
import { can, getActorLevel, isOwner, requireStaffPage } from "@/lib/auth";
import { getGradeLadder } from "@/lib/config";
import { fivemSource, getStaffOverview } from "@/lib/stats";
import { getCountersResetAt } from "@/lib/counters";
import { formatDateTime } from "@/lib/format";
import Shell, { PageHead } from "@/app/shell";
import BotBanner from "@/app/bot-banner";
import StaffTable, { type StaffRow } from "./staff-table";
import RecruitButton from "./recruit-button";
import ResetButton from "./reset-button";

export const dynamic = "force-dynamic";

const periods: Record<string, { label: string; days: number }> = {
  "7": { label: "7 jours", days: 7 }, "30": { label: "30 jours", days: 30 }, all: { label: "Tout", days: 0 }
};

export default async function StaffPage({ params, searchParams }: { params: Promise<{ serverId: string }>; searchParams: Promise<{ p?: string }> }) {
  const { user, server } = await requireStaffPage((await params).serverId);
  const { p = "30" } = await searchParams;
  const key = periods[p] ? p : "30";
  const period = periods[key];
  const staff = await getStaffOverview(server.id, period.days ? new Date(Date.now() - period.days * 86400_000) : undefined);

  const owner = isOwner(user);
  const [actorLevel, ladder, resetAt, source] = await Promise.all([getActorLevel(user), getGradeLadder(server.id), getCountersResetAt(server.id), fivemSource(server.id)]);

  const rows: StaffRow[] = staff.map((m) => {
    const canAct = m.discordId !== user.discordId && (owner || m.gradeLevel < actorLevel);
    return {
      id: m.id,
      discordId: m.discordId,
      username: m.username,
      avatarUrl: m.avatarUrl,
      grade: m.grade,
      gradeLevel: m.gradeLevel,
      voiceSeconds: m.voiceSeconds,
      fivemSeconds: m.fivemSeconds,
      inVoice: m.inVoice,
      inFivem: m.inFivem,
      warnLevel: m.warnLevel,
      badge: m.activeBadgeColor,
      lastNote: m.lastNote,
      canUp: canAct && can(user, "rank_up") && ladder.some((g) => g.level > m.gradeLevel && (owner || g.level < actorLevel)),
      canDown: canAct && can(user, "rank_down") && ladder.some((g) => g.level < m.gradeLevel),
      canDemote: canAct && can(user, "rank_demote"),
      canWarnAdd: canAct && can(user, "warn_add") && m.warnLevel < 3,
      canWarnRemove: canAct && can(user, "warn_remove") && m.warnLevel > 0,
      canComment: can(user, "comment")
    };
  });
  const recruitGrades = ladder.filter((g) => owner || g.level < actorLevel).map((g) => g.name);
  const gradeNames = [...new Set([...ladder].reverse().map((g) => g.name).concat(staff.map((m) => m.grade)))];

  return (
    <Shell user={user} server={server} active="staff">
      <BotBanner server={server} />
      <PageHead
        kicker="Équipe"
        title="Staff"
        help="/guides/staff"
        actions={
          <>
            {can(user, "recruit") && <RecruitButton grades={recruitGrades} />}
            {can(user, "reset_counters") && <ResetButton />}
            <div className="pill-tabs">
              {Object.entries(periods).map(([k, v]) => <Link key={k} href={`/s/${server.id}/staff?p=${k}`} data-on={k === key}>{v.label}</Link>)}
            </div>
          </>
        }
      >
        Temps de jeu issu de {source === "database" ? "la base du serveur FiveM" : "l'agent FiveM"} · période : {period.label}.{resetAt && <> Compteurs remis à zéro le {formatDateTime(resetAt.toISOString())}.</>}
      </PageHead>
      <div className="rise rise-1"><StaffTable rows={rows} grades={gradeNames} /></div>
    </Shell>
  );
}
