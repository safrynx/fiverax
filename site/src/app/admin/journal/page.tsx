import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformAdminPage } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { listAdminAudit } from "@/lib/platform";
import { ADMIN_ACTIONS } from "@/lib/platform-shared";
import { PageHead } from "../../shell";
import AdminFrame, { Pager } from "../admin-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Journal · Administration", robots: { index: false, follow: false } };

const PAGE_SIZE = 50;

/** Pure: the details worth reading of an entry (reason, status, name…). */
function summary(details: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ["name", "reason", "status", "discordId", "sessions"]) {
    const v = details[key];
    if (typeof v === "string" || typeof v === "number") parts.push(String(v));
  }
  return parts.join(" · ");
}

function target(kind: string | null, id: string | null) {
  if (!kind || !id) return null;
  if (kind === "server") return <Link href={`/admin/servers/${id}`} className="linkish">{id}</Link>;
  if (kind === "user") return <Link href={`/admin/users/${id}`} className="linkish">{id}</Link>;
  return <span className="muted">{kind} #{id}</span>;
}

export default async function AdminJournal({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const identity = await requirePlatformAdminPage();
  const page = Math.max(1, Number.parseInt((await searchParams).page ?? "1", 10) || 1);
  const { rows, total } = await listAdminAudit({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AdminFrame identity={identity} active="journal">
      <PageHead kicker="Administration" title="Journal">Chaque action des administrateurs de la plateforme : qui, quoi, sur quoi, quand ({total}).</PageHead>
      <div>
        {rows.length === 0 && <p className="muted" style={{ padding: "30px 0" }}>Aucune action pour le moment.</p>}
        {rows.map((r, i) => (
          <div key={r.id} className="log wide row-in" style={{ ["--i" as string]: Math.min(i, 14) }}>
            <time>{formatDateTime(r.createdAt)}</time>
            <div><span className="tag" data-tone={/ban|suspend|delete|remove/.test(r.action) ? "danger" : "info"}>{ADMIN_ACTIONS[r.action] ?? r.action}</span></div>
            <div>
              <span style={{ fontWeight: 600 }}>{r.actorName ?? r.actorId}</span>
              {target(r.targetKind, r.targetId) && <span className="muted"> → </span>}{target(r.targetKind, r.targetId)}
              {summary(r.details) && <div className="muted" style={{ fontSize: 13, marginTop: 3, wordBreak: "break-word" }}>{summary(r.details)}</div>}
            </div>
          </div>
        ))}
      </div>
      <Pager page={page} pages={pages} link={(p) => `/admin/journal?page=${p}`} />
    </AdminFrame>
  );
}
