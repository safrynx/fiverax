import Link from "next/link";
import { can, requirePermissionPage } from "@/lib/auth";
import { db } from "@/lib/db";
import { isBanActive, listBans } from "@/lib/security";
import { formatDateTime } from "@/lib/format";
import Shell, { PageHead } from "@/app/shell";
import { getMembership } from "@/lib/network";
import { categoryLabel } from "@/lib/network-shared";
import ShareButton from "./share-button";
import UnbanButton from "./unban-button";

export const dynamic = "force-dynamic";

const SOURCES: Record<string, [string, string]> = { manual: ["Staff", "info"], anticheat: ["Anticheat", "danger"], ai: ["IA", "warn"] };

export default async function BansPage({ params, searchParams }: { params: Promise<{ serverId: string }>; searchParams: Promise<{ q?: string; all?: string }> }) {
  const { user, server } = await requirePermissionPage((await params).serverId, "view_security");
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const all = sp.all === "1";
  const base = `/s/${server.id}/bans`;
  const bans = await listBans(server.id, { q, active: !all, limit: 300 });
  // Names of the staff who banned / unbanned.
  const authorIds = [...new Set(bans.flatMap((b) => [b.authorId, b.revokedBy]).filter((id): id is string => Boolean(id && /^\d+$/.test(id))))];
  const names = new Map<string, string>();
  if (authorIds.length) {
    const rows = await db.all<{ discord_id: string; username: string }>(
      `SELECT discord_id, username FROM staff_members WHERE server_id = ? AND discord_id IN (${authorIds.map(() => "?").join(",")})`,
      [server.id, ...authorIds]
    );
    for (const r of rows) names.set(r.discord_id, r.username);
  }
  const who = (id: string | null) => (!id ? "—" : id === "fiverax" ? "Fiverax" : names.get(id) ?? id);
  const canBan = can(user, "ban");
  const member = Boolean(await getMembership(server.id));

  return (
    <Shell user={user} server={server} active="bans">
      <PageHead kicker={server.name} title="Bans">
        Appliqués par l&apos;agent à la connexion, sur la license Rockstar, les comptes liés et les identifiants matériels du joueur. Pour bannir quelqu&apos;un, ouvre sa fiche dans Joueurs.
        {member ? " Les bans « Partagé » comptent pour les autres serveurs du réseau Fiverax." : ""}
      </PageHead>

      <form className="filters rise rise-1" action={base}>
        <input name="q" defaultValue={q} placeholder="Nom, identifiant, raison…" className="field" style={{ minWidth: 300 }} />
        {all && <input type="hidden" name="all" value="1" />}
        <button className="btn primary">Rechercher</button>
        <span className="pill-tabs">
          <Link href={`${base}${q ? `?q=${encodeURIComponent(q)}` : ""}`} data-on={!all}>Actifs</Link>
          <Link href={`${base}?all=1${q ? `&q=${encodeURIComponent(q)}` : ""}`} data-on={all}>Historique complet</Link>
        </span>
      </form>

      {bans.length === 0 && <p className="muted" style={{ padding: "30px 0" }}>{q ? "Aucun ban trouvé." : "Aucun ban actif."}</p>}
      {bans.length > 0 && (
        <div className="tbl-wrap rise rise-2">
          <table className="tbl" style={{ minWidth: 1080 }}>
            <thead>
              <tr><th>Joueur</th><th>Raison</th><th>Catégorie</th><th title="Visible par les autres serveurs du réseau Fiverax">Réseau</th><th>Par</th><th>Le</th><th>Fin</th><th>Statut</th>{canBan && <th />}</tr>
            </thead>
            <tbody>
              {bans.map((b, i) => {
                const active = isBanActive(b);
                const [sourceLabel, sourceTone] = SOURCES[b.source] ?? [b.source, "neutral"];
                return (
                  <tr key={b.id} className="row-in" style={{ ["--i" as string]: Math.min(i, 14) }}>
                    <td style={{ fontWeight: 600 }}>{b.playerId ? <Link href={`/s/${server.id}/players/${b.playerId}`}>{b.name}</Link> : b.name}</td>
                    <td style={{ maxWidth: 320 }}>{b.reason}</td>
                    <td><span className="tag">{categoryLabel(b.category)}</span></td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <span className="muted" style={{ fontSize: 12, marginRight: 6 }}>{!member ? "—" : b.shared ? "Partagé" : "Privé"}</span>
                      {canBan && member && active && <ShareButton banId={b.id} shared={b.shared} name={b.name} />}
                    </td>
                    <td><span className="tag" data-tone={sourceTone}>{sourceLabel}</span> <span className="muted" style={{ fontSize: 12 }}>{b.source === "manual" ? b.authorName ?? who(b.authorId) : ""}</span></td>
                    <td className="num-cell muted" style={{ whiteSpace: "nowrap" }}>{formatDateTime(b.createdAt)}</td>
                    <td className="num-cell" style={{ whiteSpace: "nowrap" }}>{b.expiresAt ? formatDateTime(b.expiresAt) : "Définitif"}</td>
                    <td>
                      {active
                        ? <span className="tag" data-tone="danger">Actif</span>
                        : b.revokedAt
                          ? <span className="tag" title={`Débanni par ${who(b.revokedBy)}`}>Levé</span>
                          : <span className="tag">Expiré</span>}
                    </td>
                    {canBan && <td style={{ textAlign: "right" }}>{active && <UnbanButton banId={b.id} name={b.name} />}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
