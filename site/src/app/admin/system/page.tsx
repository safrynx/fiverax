import type { Metadata } from "next";
import { CheckCircle2, CircleAlert, Info } from "lucide-react";
import { systemChecks } from "@/lib/admin";
import { requirePlatformAdminPage } from "@/lib/auth";
import { getPlatformOwnerIds } from "@/lib/config";
import { formatDateTime } from "@/lib/format";
import { PageHead } from "../../shell";
import AdminFrame from "../admin-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Système · Administration", robots: { index: false, follow: false } };

/** Configuration and database health (what /api/health checks), in detail. Never shows a secret's value. */
export default async function AdminSystem() {
  const identity = await requirePlatformAdminPage();
  const report = await systemChecks();
  const admins = getPlatformOwnerIds();

  return (
    <AdminFrame identity={identity} active="system">
      <PageHead kicker="Administration" title="Système">
        Configuration du site et état de la base. Les valeurs des secrets ne sont jamais affichées, seulement leur présence.
      </PageHead>

      {report.missingEnv.length > 0 && (
        <div className="banner" data-tone="danger"><b>Variables manquantes</b> : {report.missingEnv.join(", ")}. Ajoute-les dans l&apos;environnement de l&apos;hébergeur puis redéploie.</div>
      )}

      <div className="cols two">
        <section className="sect rise rise-1" style={{ marginTop: 0 }}>
          <header><h2 className="h2">Vérifications</h2><span className={`tag`} data-tone={report.ok && report.warnings.length === 0 ? "up" : report.ok ? "warn" : "danger"}>{report.ok ? (report.warnings.length ? "À améliorer" : "Tout est bon") : "Hors service"}</span></header>
          {report.checks.map((c) => (
            <div key={c.key} className="adm-check" data-ok={c.ok} data-level={c.level}>
              {c.ok ? <CheckCircle2 size={18} /> : c.level === "info" ? <Info size={18} /> : <CircleAlert size={18} />}
              <div><b>{c.label}</b>{!c.ok && c.hint && <p>{c.hint}</p>}</div>
            </div>
          ))}
        </section>

        <section className="sect rise rise-2" style={{ marginTop: 0 }}>
          <header><h2 className="h2">Plateforme</h2></header>
          <div className="adm-list">
            <div><span>Administrateurs (PANEL_OWNER_IDS)</span><b>{admins.length}</b></div>
            <div><span>Environnement</span><b>{process.env.VERCEL ? "Vercel" : process.env.NODE_ENV ?? "?"}</b></div>
            <div><span>Base de données</span><b>{process.env.TURSO_DATABASE_URL ? "Turso" : "SQLite local"}</b></div>
            <div><span>Dernière migration</span><b className="num-cell">{report.migrations[0]?.name ?? "—"}</b></div>
          </div>
          <h3 className="eyebrow" style={{ margin: "24px 0 8px" }}>Migrations récentes</h3>
          <div className="adm-list">
            {report.migrations.slice(0, 8).map((m) => <div key={m.name}><span className="mono" style={{ fontSize: 12 }}>{m.name}</span><time className="muted num-cell">{formatDateTime(m.appliedAt)}</time></div>)}
          </div>
        </section>
      </div>
    </AdminFrame>
  );
}
