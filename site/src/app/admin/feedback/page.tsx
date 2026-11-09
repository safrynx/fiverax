import type { Metadata } from "next";
import Link from "next/link";
import { Check, Eye } from "lucide-react";
import { requirePlatformAdminPage } from "@/lib/auth";
import { listFeedback } from "@/lib/beta";
import { formatDateTime } from "@/lib/format";
import { FEEDBACK_KINDS } from "@/lib/platform-shared";
import { PageHead } from "../../shell";
import { AdminAction } from "../admin-actions";
import AdminFrame from "../admin-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Retours · Administration", robots: { index: false, follow: false } };

const TONE = { bug: "danger", idea: "info", question: "warn" } as const;

/** Bug reports, ideas and questions sent from the panel (button « Signaler un bug » of every page). */
export default async function AdminFeedback({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const identity = await requirePlatformAdminPage();
  const all = (await searchParams).all === "1";
  const items = await listFeedback(all ? "all" : "open");

  return (
    <AdminFrame identity={identity} active="feedback">
      <PageHead kicker="Administration" title="Retours de la bêta">
        Les bugs, idées et questions envoyés depuis le panel, avec la page d&apos;où ils viennent.{" "}
        <Link href={all ? "/admin/feedback" : "/admin/feedback?all=1"} className="linkish">{all ? "Seulement à traiter" : "Voir aussi les traités"}</Link>
      </PageHead>
      {items.length === 0 && <p className="muted" style={{ padding: "20px 0" }}>Rien à traiter. 🎉</p>}
      {items.map((f) => (
        <article key={f.id} className="adm-card rise rise-1">
          <header>
            <span>
              <span className="tag" data-tone={TONE[f.kind]}>{FEEDBACK_KINDS[f.kind]}</span>{" "}
              <Link href={`/admin/users/${f.discordId}`} className="linkish">{f.username ?? f.discordId}</Link>
              {f.serverId && <> <span className="muted">· serveur</span> <Link href={`/admin/servers/${f.serverId}`} className="linkish">{f.serverId}</Link></>}
              {f.page && <span className="muted"> · {f.page}</span>}
            </span>
            <span className="adm-actions">
              {f.status === "new" && <span className="tag" data-tone="warn">Nouveau</span>}
              {f.status === "done" && <span className="tag" data-tone="up">Traité</span>}
              <time className="muted num-cell">{formatDateTime(f.createdAt)}</time>
            </span>
          </header>
          <p style={{ whiteSpace: "pre-wrap" }}>{f.message}</p>
          {f.adminNote && <p className="muted" style={{ fontSize: 13 }}>Note : {f.adminNote}</p>}
          {f.status !== "done" && (
            <div className="adm-actions" style={{ marginTop: 8 }}>
              {f.status === "new" && <AdminAction action="feedback_status" payload={{ id: f.id, status: "seen", note: null }} className="btn sm"><Eye size={14} />Vu</AdminAction>}
              <AdminAction action="feedback_status" payload={{ id: f.id, status: "done" }} success="Marqué comme traité." className="btn sm primary"
                confirm={{ title: "Marquer comme traité", input: { label: "Note (facultatif : correctif, version…)", field: "note", placeholder: "Corrigé dans la mise à jour du 10/11", optional: true }, confirmLabel: "Traité" }}>
                <Check size={14} />Traité
              </AdminAction>
            </div>
          )}
        </article>
      ))}
    </AdminFrame>
  );
}
