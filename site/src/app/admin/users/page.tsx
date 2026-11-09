import type { Metadata } from "next";
import Link from "next/link";
import { adminListUsers, type UserFilter } from "@/lib/admin";
import { requirePlatformAdminPage } from "@/lib/auth";
import Avatar from "../../avatar";
import { PageHead } from "../../shell";
import { BanByIdForm } from "../admin-actions";
import AdminFrame, { formatAgo, formatDay, Pager } from "../admin-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Comptes · Administration", robots: { index: false, follow: false } };

const PAGE_SIZE = 40;
const FILTERS: { key: UserFilter; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "active", label: "Actifs (24 h)" },
  { key: "partners", label: "Partenaires" },
  { key: "banned", label: "Bannis" }
];

export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ q?: string; f?: string; page?: string }> }) {
  const identity = await requirePlatformAdminPage();
  const { q = "", f = "all", page: pageParam } = await searchParams;
  const filter = (FILTERS.some((x) => x.key === f) ? f : "all") as UserFilter;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const { rows, total } = await adminListUsers({ q, filter, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p: number) => `/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), ...(filter !== "all" ? { f: filter } : {}), page: String(p) })}`;

  return (
    <AdminFrame identity={identity} active="users">
      <PageHead kicker="Administration" title="Comptes" actions={<BanByIdForm />}>
        Chaque compte Discord qui s&apos;est connecté à Fiverax ({total}). Un compte banni ne peut plus se connecter et ses sessions se ferment aussitôt.
      </PageHead>

      <form className="filters rise rise-1" action="/admin/users">
        <input name="q" defaultValue={q} placeholder="Pseudo ou ID Discord" className="field" style={{ minWidth: 280 }} />
        <select name="f" defaultValue={filter} className="field">
          {FILTERS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
        <button className="btn primary">Filtrer</button>
        {(q || filter !== "all") && <Link href="/admin/users" className="linkish">Réinitialiser</Link>}
      </form>

      <div className="tbl-wrap rise rise-2">
        <table className="tbl adm-tbl">
          <thead>
            <tr><th>Compte</th><th>Inscrit le</th><th>Activité</th><th title="Nombre de connexions">Connexions</th><th title="Serveurs dont il est propriétaire">Serveurs</th><th title="Sessions ouvertes">Sessions</th><th>Statut</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="muted" style={{ padding: "26px 14px" }}>Aucun compte.</td></tr>}
            {rows.map((u) => (
              <tr key={u.discordId}>
                <td>
                  <Link href={`/admin/users/${u.discordId}`} className="adm-who adm-row-link">
                    <Avatar url={u.avatarUrl} name={u.username} size={30} />
                    <div><b>{u.username}</b><small>{u.discordId}</small></div>
                  </Link>
                </td>
                <td className="num-cell">{formatDay(u.firstLoginAt)}</td>
                <td className="num-cell">{formatAgo(u.lastSeenAt ?? u.lastLoginAt)}</td>
                <td className="num-cell">{u.loginCount}</td>
                <td className="num-cell">{u.owned}</td>
                <td className="num-cell">{u.openSessions}</td>
                <td>
                  {u.platformAdmin ? <span className="tag" data-tone="info">Admin</span>
                    : u.bannedAt ? <span className="tag" data-tone="danger" title={u.banReason ?? ""}>Banni</span>
                    : u.partnerAt ? <span className="tag" data-tone="up">Partenaire</span>
                    : <span className="tag">Actif</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={pages} link={link} />
    </AdminFrame>
  );
}
