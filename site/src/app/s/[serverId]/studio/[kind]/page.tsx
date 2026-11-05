import Link from "next/link";
import { notFound } from "next/navigation";
import { FileCode2 } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth";
import { getLiveState } from "@/lib/agent";
import { listCreations, studioAIConfigured } from "@/lib/studio";
import { FRAMEWORKS, isCreationKind, KIND_META } from "@/lib/studio-shared";
import { formatDateTime } from "@/lib/format";
import Shell, { PageHead } from "@/app/shell";
import DeployTag from "../deploy-tag";
import NewCreation from "./new-creation";

export const dynamic = "force-dynamic";

export default async function StudioPage({ params }: { params: Promise<{ serverId: string; kind: string }> }) {
  const { serverId, kind } = await params;
  if (!isCreationKind(kind)) notFound();
  const { user, server } = await requirePermissionPage(serverId, "studio");
  const [creations, live] = await Promise.all([listCreations(server.id, kind), getLiveState(server.id)]);
  const meta = KIND_META[kind];
  const base = `/s/${server.id}/studio/${kind}`;
  const players = live.players.filter((p) => p.pos).map((p) => ({ id: p.id, name: p.name, pos: p.pos as [number, number, number] }));

  return (
    <Shell user={user} server={server} active={`studio_${kind}`}>
      <PageHead kicker="Studio IA" title={meta.title}>{meta.lead}</PageHead>
      {!studioAIConfigured() && kind !== "map" && (
        <div className="banner"><b>IA non configurée.</b> Ajoute <code>AI_API_KEY</code> (et <code>AI_BASE_URL</code>) dans l&apos;environnement du site : sans elle tu peux seulement écrire le code à la main.</div>
      )}

      <NewCreation kind={kind} players={players} />
      <p className="muted rise rise-1" style={{ fontSize: 13, margin: "14px 0 0" }}>
        Pas envie de partir de zéro ? <Link href={`/s/${server.id}/library?kind=${kind}`} className="linkish">Parcours la bibliothèque du réseau</Link> : les {meta.one}s partagées par les autres serveurs Fiverax s&apos;installent en un clic.
      </p>

      <section className="sect rise rise-2">
        <header><h2 className="h2">Créations du serveur <span className="muted" style={{ fontFamily: "var(--font-body)", fontSize: 13 }}>· {creations.length}</span></h2></header>
        {creations.length === 0 && <p className="muted" style={{ padding: "18px 0" }}>Rien pour l&apos;instant : décris ta première {meta.one} ci-dessus.</p>}
        <div className="studio-grid">
          {creations.map((c) => (
            <Link key={c.id} href={`${base}/${c.id}`} className="studio-card">
              <div className="studio-card-top">
                <FileCode2 size={16} />
                <b>{c.name}</b>
              </div>
              <code>{c.resource}</code>
              <div className="studio-card-meta">
                <DeployTag deploy={c.deploy} />
                {c.kind !== "map" && <span className="tag">{FRAMEWORKS.find((f) => f.key === c.framework)?.label ?? c.framework}</span>}
                <span className="muted" style={{ fontSize: 12 }}>{c.fileCount} fichier(s) · {formatDateTime(c.updatedAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </Shell>
  );
}
