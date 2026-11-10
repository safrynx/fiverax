import type { Metadata } from "next";
import { can, requireStaffPage } from "@/lib/auth";
import { aiConfigured } from "@/lib/ai";
import Shell, { PageHead } from "@/app/shell";
import Copilot from "./copilot";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Copilote IA" };

export default async function CopilotPage({ params }: { params: Promise<{ serverId: string }> }) {
  const { user, server } = await requireStaffPage((await params).serverId);

  // Starting points that match what this admin may see and do.
  const quick = [
    "Qui a été le moins actif dans le staff cette semaine ?",
    "Fais-moi un point sur le staff : avertissements, pastilles, membres inactifs.",
    ...(can(user, "view_live") ? ["Qui est connecté en jeu en ce moment ?"] : []),
    ...(can(user, "view_logs") ? ["Qu'est-ce qui s'est passé sur le panel aujourd'hui ?"] : []),
    ...(can(user, "ban") ? ["Montre-moi les bans actifs."] : [])
  ];

  return (
    <Shell user={user} server={server} active="copilot">
      <PageHead kicker={server.name} title="Copilote IA">
        Demande-lui ce que tu veux sur le panel, comme à un bras droit : « avertis Bob pour absence en réunion », « monte Lucas d&apos;un grade »,
        « qui n&apos;a pas fait de vocal depuis une semaine ? », « bannis Tata 3 jours pour freekill », « verrouille le Discord », « emmène-moi aux logs ».
        Il ne propose que ce que tes permissions autorisent, et rien n&apos;est exécuté sans ta confirmation.
      </PageHead>
      <Copilot aiReady={aiConfigured()} quick={quick} />
    </Shell>
  );
}
