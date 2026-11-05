import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { can, requirePermissionPage } from "@/lib/auth";
import { SEVERITY_LABEL } from "@/lib/audit-rules";
import { getLibraryItem, itemReports } from "@/lib/library";
import { FRAMEWORKS, KIND_META } from "@/lib/studio-shared";
import { formatDateTime } from "@/lib/format";
import Shell, { type NavKey } from "@/app/shell";
import { LIB_PAGES } from "../library-view";
import { GuildIcon } from "@/app/new-server-form";
import ItemActions from "../item-actions";
import ItemPreview from "../item-preview";

export const dynamic = "force-dynamic";

const STATUS: Record<string, [string, string]> = { hidden: ["Masquée après des signalements", "warn"], removed: ["Retirée de la bibliothèque", "danger"] };

export default async function LibraryItemPage({ params }: { params: Promise<{ serverId: string; itemId: string }> }) {
  const { serverId, itemId } = await params;
  const { user, server } = await requirePermissionPage(serverId, "studio");
  const id = Number(itemId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const item = await getLibraryItem(id, server.id, { moderator: user.platformOwner });
  if (!item) notFound();
  const reports = user.platformOwner && item.reports > 0 ? await itemReports(item.id) : [];
  const meta = KIND_META[item.kind];
  const serious = item.findings.filter((f) => f.severity === "high" || f.severity === "medium");

  return (
    <Shell user={user} server={server} active={`lib_${item.kind}` as NavKey}>
      <Link href={`/s/${server.id}/${LIB_PAGES[item.kind].slug}`} className="linkish rise" style={{ display: "inline-block", marginBottom: 22 }}>← Bibliothèque : {LIB_PAGES[item.kind].title}</Link>

      {STATUS[item.status] && <div className="banner"><b>{STATUS[item.status][0]}.</b> {item.viewer.mine ? "Seuls ton serveur et la modération Fiverax la voient." : "Visible par la modération uniquement."}</div>}

      <div className="studio-head rise">
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">{meta.title} · v{item.version}</div>
          <h1 className="h1">{item.title}</h1>
          <div className="studio-meta">
            <GuildIcon url={item.serverIcon} name={item.serverName} size={20} />
            <span>par <b>{item.serverName}</b>{item.authorName ? ` (${item.authorName})` : ""}</span>
            {item.kind !== "map" && <span className="tag">{FRAMEWORKS.find((f) => f.key === item.framework)?.label ?? item.framework}</span>}
            <code>{item.resource}</code>
            <span className="muted" style={{ fontSize: 12 }}>{item.installs} installation(s) · mise à jour le {formatDateTime(item.updatedAt)}</span>
          </div>
        </div>
        <ItemActions
          itemId={item.id}
          title={item.title}
          kind={item.kind}
          status={item.status}
          liked={item.viewer.liked}
          likes={item.likes}
          installed={item.viewer.installed}
          latestVersion={item.version}
          mine={item.viewer.mine}
          can={{ install: can(user, "studio"), publish: can(user, "library_publish"), moderate: user.platformOwner }}
        />
      </div>

      <div className="studio rise rise-1">
        <aside style={{ display: "grid", gap: 22, alignContent: "start" }}>
          <section>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Description</div>
            <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{item.description}</p>
            {item.tags.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>{item.tags.map((t) => <span key={t} className="tag" data-tone="info">#{t}</span>)}</div>}
          </section>
          {item.changelog && (
            <section>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Nouveautés de la v{item.version}</div>
              <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{item.changelog}</p>
            </section>
          )}
          <section>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Analyse de sécurité</div>
            {serious.length === 0 ? (
              <p style={{ margin: 0, display: "flex", gap: 8, alignItems: "flex-start" }}><CheckCircle2 size={15} style={{ color: "var(--ok)", flex: "none", marginTop: 3 }} /> Le scanner n&apos;a rien trouvé d&apos;inquiétant (backdoor, faille exploitable, secret exposé).</p>
            ) : (
              <div className="studio-checks">
                {serious.map((f, i) => (
                  <div key={i} className="studio-check" data-level={f.severity === "high" ? "error" : "warn"}>
                    {f.severity === "high" ? <AlertTriangle size={14} /> : <Info size={14} />}
                    <div><b>{SEVERITY_LABEL[f.severity]}</b> · <code>{f.file}{f.line ? `:${f.line}` : ""}</code> {f.title}<div className="muted" style={{ fontSize: 12 }}>{f.detail}</div></div>
                  </div>
                ))}
              </div>
            )}
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Code écrit par un autre serveur : relis-le avant de le déployer. Une fois installé, c&apos;est ta copie : l&apos;IA du Studio peut l&apos;adapter à ton serveur.
            </p>
          </section>
          {reports.length > 0 && (
            <section>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Signalements · {reports.length}</div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {reports.map((r, i) => <li key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}><b>{r.serverName}</b> · {r.reason}<div className="muted" style={{ fontSize: 12 }}>{formatDateTime(r.at)}</div></li>)}
              </ul>
            </section>
          )}
        </aside>
        <ItemPreview kind={item.kind} resource={item.resource} files={item.files} data={item.data} />
      </div>
    </Shell>
  );
}
