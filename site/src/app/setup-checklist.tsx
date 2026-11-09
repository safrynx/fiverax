import Link from "next/link";
import { getLiveState } from "@/lib/agent";
import { getBotStatus } from "@/lib/bot-status";
import { ladderIn, loadConfig } from "@/lib/config";
import { botInviteUrl } from "@/lib/discord";
import type { Server } from "@/lib/servers";

type Step = { done: boolean; title: string; hint: string; action?: { label: string; href: string; external?: boolean }; guide?: string };

/** Steps to get a new server working, computed from its real state. */
export async function setupSteps(server: Server): Promise<Step[]> {
  const base = `/s/${server.id}`;
  const [bot, cfg, live] = await Promise.all([getBotStatus(server.id), loadConfig(server.id), getLiveState(server.id)]);
  const invite = botInviteUrl(server.guildId);
  return [
    { done: Boolean(server.guildId), title: "Relier le serveur Discord", hint: "L'ID du serveur Discord suivi par le bot.", action: { label: "Configuration", href: `${base}/settings` } },
    {
      done: bot.alive,
      title: "Inviter le bot",
      hint: "Il synchronise les membres, les rôles et le vocal, et place son rôle tout en haut. Il apparaît connecté une minute après l'invitation.",
      action: invite ? { label: "Inviter le bot", href: invite, external: true } : undefined,
      guide: "/guides/demarrer"
    },
    { done: ladderIn(cfg).length > 0, title: "Choisir les rôles de grade", hint: "Les rôles Discord qui forment la hiérarchie du staff.", action: { label: "Accès & rôles", href: `${base}/admin` }, guide: "/guides/demarrer" },
    {
      done: cfg.access.length > 0 || cfg.owners.length > 1,
      title: "Donner l'accès à ton équipe",
      hint: "Des personnes ou des rôles Discord, avec leurs permissions.",
      action: { label: "Accès & rôles", href: `${base}/admin` },
      guide: "/guides/staff"
    },
    {
      done: server.hasFivemToken && live.linked,
      title: "Relier le serveur FiveM",
      hint: "Télécharge l'agent fiverax_agent (page Configuration), génère son token et colle les lignes dans le server.cfg. L'étape se valide au premier contact de l'agent.",
      action: { label: "Configuration", href: `${base}/settings` },
      guide: "/guides/agent-fivem"
    }
  ];
}

/** "Mise en route" card. Hidden once every step is done, unless `always`. */
export default async function SetupChecklist({ server, always = false }: { server: Server; always?: boolean }) {
  const steps = await setupSteps(server);
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length && !always) return null;

  return (
    <section className="rise" style={{ border: "1px solid var(--line-2)", borderRadius: 14, padding: "18px 20px", marginBottom: 36 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 className="h2">Mise en route</h2>
        <span className="muted" style={{ fontSize: 13 }}>{done === steps.length ? "Tout est prêt ✓" : `${done} / ${steps.length} étapes`}</span>
      </header>
      <ol style={{ listStyle: "none", margin: "14px 0 0", padding: 0, display: "grid", gap: 10 }}>
        {steps.map((step, i) => (
          <li key={step.title} style={{ display: "flex", gap: 14, alignItems: "center", opacity: step.done ? 0.55 : 1 }}>
            <span className="tag" data-tone={step.done ? "up" : "neutral"} style={{ minWidth: 28, textAlign: "center" }}>{step.done ? "✓" : i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, textDecoration: step.done ? "line-through" : "none" }}>{step.title}</div>
              <div className="muted" style={{ fontSize: 12 }}>{step.hint}{!step.done && step.guide && <> <Link href={step.guide} className="linkish">Tutoriel</Link></>}</div>
            </div>
            {!step.done && step.action && (step.action.external
              ? <a href={step.action.href} target="_blank" rel="noreferrer" className="btn sm">{step.action.label}</a>
              : <Link href={step.action.href} className="btn sm">{step.action.label}</Link>)}
          </li>
        ))}
      </ol>
    </section>
  );
}
