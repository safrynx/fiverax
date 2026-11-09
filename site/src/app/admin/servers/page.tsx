import type { Metadata } from "next";
import Link from "next/link";
import { adminListServers, type ServerFilter } from "@/lib/admin";
import { requirePlatformAdminPage } from "@/lib/auth";
import { GuildIcon } from "../../new-server-form";
import { PageHead } from "../../shell";
import AdminFrame, { formatAgo, formatDay, Pager } from "../admin-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Serveurs · Administration", robots: { index: false, follow: false } };

const PAGE_SIZE = 40;
const FILTERS: { key: ServerFilter; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "online", label: "Agent en ligne" },
  { key: "no_agent", label: "Jamais relié à FiveM" },
  { key: "suspended", label: "Suspendus" }
];

export default async function AdminServers({ searchParams }: { searchParams: Promise<{ q?: string; f?: string; page?: string }> }) {
  const identity = await requirePlatformAdminPage();
  const { q = "", f = "all", page: pageParam } = await searchParams;
  const filter = (FILTERS.some((x) => x.key === f) ? f : "all") as ServerFilter;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const { rows, total } = await adminListServers({ q, filter, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p: number) => `/admin/servers?${new URLSearchParams({ ...(q ? { q } : {}), ...(filter !== "all" ? { f: filter } : {}), page: String(p) })}`;

  return (
    <AdminFrame identity={identity} active="servers">
      <PageHead kicker="Administration" title="Serveurs">Tous les serveurs enregistrés sur Fiverax ({total}). Ouvre une fiche pour suspendre, gérer les propriétaires ou supprimer.</PageHead>

      <form className="filters rise rise-1" action="/admin/servers">
        <input name="q" defaultValue={q} placeholder="Nom, identifiant, ID Discord du serveur ou du créateur" className="field" style={{ minWidth: 320 }} />
        <select name="f" defaultValue={filter} className="field">
          {FILTERS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
        <button className="btn primary">Filtrer</button>
        {(q || filter !== "all") && <Link href="/admin/servers" className="linkish">Réinitialiser</Link>}
      </form>

      <div className="tbl-wrap rise rise-2">
        <table className="tbl adm-tbl">
          <thead>
            <tr><th>Serveur</th><th>Créé par</th><th>Créé le</th><th>Staff</th><th>Joueurs</th><th>Agent</th><th>Bot</th><th title="Appels IA aujourd'hui">IA</th><th>Statut</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={9} className="muted" style={{ padding: "26px 14px" }}>Aucun serveur.</td></tr>}
            {rows.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link href={`/admin/servers/${s.id}`} className="adm-who adm-row-link">
                    <GuildIcon url={s.iconUrl} name={s.name} size={30} />
                    <div><b>{s.name}</b><small>{s.id}</small></div>
                  </Link>
                </td>
                <td>{s.createdBy ? <Link href={`/admin/users/${s.createdBy}`} className="linkish">{s.creatorName ?? s.createdBy}</Link> : "—"}</td>
                <td className="num-cell">{formatDay(s.createdAt)}</td>
                <td className="num-cell">{s.staff}</td>
                <td className="num-cell">{s.players}</td>
                <td>
                  {!s.hasFivemToken ? <span className="muted">non relié</span>
                    : s.agentOnline ? <span className="tag" data-tone="up">en ligne</span>
                    : <span className="muted">{formatAgo(s.agentSeenAt)}</span>}
                </td>
                <td>{!s.guildId ? <span className="muted">—</span> : s.botAlive ? <span className="tag" data-tone="up">présent</span> : <span className="tag">absent</span>}</td>
                <td className="num-cell">{s.aiToday || ""}</td>
                <td>{s.suspendedAt ? <span className="tag" data-tone="danger" title={s.suspendedReason ?? ""}>Suspendu</span> : <span className="tag" data-tone="info">Actif</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={pages} link={link} />
    </AdminFrame>
  );
}
