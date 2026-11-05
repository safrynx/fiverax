import Link from "next/link";
import { Boxes, Download, FileCode2, Heart, Palette, ShieldAlert } from "lucide-react";
import { requirePermissionPage } from "@/lib/auth";
import { hiddenItems, LIBRARY_SORTS, listLibrary, type LibraryItemSummary, type LibrarySort } from "@/lib/library";
import { FRAMEWORKS, isCreationKind, KIND_META, type CreationKind } from "@/lib/studio-shared";
import { formatDateTime } from "@/lib/format";
import Shell, { PageHead } from "@/app/shell";
import { GuildIcon } from "@/app/new-server-form";

export const dynamic = "force-dynamic";

const KIND_ICON = { ui: Palette, script: FileCode2, map: Boxes } as const;
const SORT_LABEL: Record<LibrarySort, string> = { popular: "Les plus installées", recent: "Les plus récentes", liked: "Les plus aimées" };

type Search = { kind?: string; q?: string; sort?: string; fw?: string };

export default async function LibraryPage({ params, searchParams }: { params: Promise<{ serverId: string }>; searchParams: Promise<Search> }) {
  const { user, server } = await requirePermissionPage((await params).serverId, "studio");
  const sp = await searchParams;
  const kind = sp.kind && isCreationKind(sp.kind) ? sp.kind : undefined;
  const sort: LibrarySort = (LIBRARY_SORTS as readonly string[]).includes(sp.sort ?? "") ? (sp.sort as LibrarySort) : "popular";
  const q = sp.q?.trim() ?? "";
  const fw = FRAMEWORKS.some((f) => f.key === sp.fw) ? sp.fw : undefined;
  const [items, mine, moderation] = await Promise.all([
    listLibrary({ kind, q, sort, framework: fw }),
    listLibrary({ serverId: server.id, sort: "recent", limit: 30 }),
    user.platformOwner ? hiddenItems() : Promise.resolve([])
  ]);
  const base = `/s/${server.id}/library`;
  const href = (change: Partial<Search>) => {
    const next = { kind, q: q || undefined, sort: sort === "popular" ? undefined : sort, fw, ...change };
    const qs = new URLSearchParams(Object.entries(next).filter((e): e is [string, string] => Boolean(e[1]))).toString();
    return qs ? `${base}?${qs}` : base;
  };

  return (
    <Shell user={user} server={server} active="library">
      <PageHead kicker="Réseau Fiverax" title="Bibliothèque">
        Les UI, scripts et mappings que les serveurs Fiverax partagent. Installe-les dans ton Studio en un clic, adapte-les avec l&apos;IA, déploie-les.
        Chaque publication passe par le scanner de sécurité : le code dangereux est refusé.
      </PageHead>

      {moderation.length > 0 && (
        <section className="banner">
          <b>Modération :</b> {moderation.length} création(s) masquée(s) après des signalements —{" "}
          {moderation.map((m, i) => <span key={m.id}>{i > 0 && ", "}<Link href={`${base}/${m.id}`} className="linkish">{m.title}</Link></span>)}
        </section>
      )}

      <form className="filters rise rise-1" action={base}>
        {kind && <input type="hidden" name="kind" value={kind} />}
        {sort !== "popular" && <input type="hidden" name="sort" value={sort} />}
        <input name="q" defaultValue={q} placeholder="HUD, garage, job, police…" className="field" style={{ minWidth: 260 }} />
        <select name="fw" defaultValue={fw ?? ""} className="field">
          <option value="">Tous les frameworks</option>
          {FRAMEWORKS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
        <button className="btn primary">Rechercher</button>
        <span className="pill-tabs">
          <Link href={href({ kind: undefined })} data-on={!kind}>Tout</Link>
          {(["ui", "script", "map"] as CreationKind[]).map((k) => <Link key={k} href={href({ kind: k })} data-on={kind === k}>{KIND_META[k].title.replace(" Creator", "")}</Link>)}
        </span>
        <span className="pill-tabs">
          {LIBRARY_SORTS.map((s) => <Link key={s} href={href({ sort: s === "popular" ? undefined : s })} data-on={sort === s}>{SORT_LABEL[s]}</Link>)}
        </span>
      </form>

      {items.length === 0 && (
        <p className="muted" style={{ padding: "30px 0" }}>
          {q || kind || fw ? "Rien ne correspond à ta recherche." : "La bibliothèque est encore vide : publie la première création depuis ton Studio (bouton « Publier » d'une création)."}
        </p>
      )}
      <div className="studio-grid rise rise-2">{items.map((item) => <ItemCard key={item.id} item={item} href={`${base}/${item.id}`} />)}</div>

      {mine.length > 0 && (
        <section className="sect rise rise-3">
          <header><h2 className="h2">Publiées par ton serveur <span className="muted" style={{ fontFamily: "var(--font-body)", fontSize: 13 }}>· {mine.length}</span></h2></header>
          <div className="studio-grid" style={{ marginTop: 12 }}>{mine.map((item) => <ItemCard key={item.id} item={item} href={`${base}/${item.id}`} />)}</div>
        </section>
      )}
    </Shell>
  );
}

function ItemCard({ item, href }: { item: LibraryItemSummary; href: string }) {
  const Icon = KIND_ICON[item.kind];
  return (
    <Link href={href} className="studio-card">
      <div className="studio-card-top"><Icon size={16} /><b>{item.title}</b></div>
      <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.description}</p>
      <div className="studio-card-meta">
        <span className="tag">{KIND_META[item.kind].title.replace(" Creator", "")}</span>
        {item.kind !== "map" && <span className="tag">{FRAMEWORKS.find((f) => f.key === item.framework)?.label ?? item.framework}</span>}
        {item.risk === "warn" && <span className="tag" data-tone="warn" title="Le scanner a des remarques : lis-les avant de déployer" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><ShieldAlert size={10} />À vérifier</span>}
        {item.tags.slice(0, 3).map((t) => <span key={t} className="tag" data-tone="info">#{t}</span>)}
      </div>
      <div className="studio-card-meta" style={{ fontSize: 12, color: "var(--muted)", gap: 10 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}><GuildIcon url={item.serverIcon} name={item.serverName} size={18} />{item.serverName}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }} title="Installations"><Download size={11} />{item.installs}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }} title="J'aime"><Heart size={11} />{item.likes}</span>
        <span>v{item.version} · {formatDateTime(item.updatedAt)}</span>
      </div>
    </Link>
  );
}
