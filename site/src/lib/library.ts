import { analyzeFile, ANALYZABLE, type Finding, type Role } from "./audit-rules";
import { auditStmt } from "./audit";
import { db, stmt } from "./db";
import { getCreation, normalise, saveCreation, StudioError, type Creation, type CreationData } from "./studio";
import { checkFiles, isCreationKind, RESOURCE_RE, type CreationKind, type Framework, type StudioFile } from "./studio-shared";

/**
 * Library of the Fiverax network: UI, scripts and mappings made in the Studio, published by a server for every
 * other server. Installing an item copies it into the server's own Studio (a normal creation, then deployed as
 * usual); when the publisher releases a new version, the installed copies are offered the update.
 *
 * Shared code is checked when it is published: the scanner's rules run on every file, a backdoor or a critical
 * flaw blocks the publication, the other findings are shown on the item. Three servers reporting an item hide it
 * until a platform owner reviews it.
 */

type Actor = { discordId: string; username?: string | null };
const iso = (d = new Date()) => d.toISOString();

export class LibraryError extends Error {
  constructor(code: string, readonly details: unknown = null) {
    super(code);
  }
}

export const LIBRARY_SORTS = ["popular", "recent", "liked"] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];
export type ItemStatus = "published" | "hidden" | "removed";
/** Reports from distinct servers that hide an item until a platform owner looks at it. */
export const REPORTS_TO_HIDE = 3;

export type LibraryFinding = Pick<Finding, "rule" | "severity" | "title" | "detail" | "line"> & { file: string };

export type LibraryItemSummary = {
  id: number;
  kind: CreationKind;
  title: string;
  description: string;
  tags: string[];
  framework: Framework;
  resource: string;
  version: number;
  serverId: string;
  serverName: string;
  serverIcon: string | null;
  authorName: string | null;
  installs: number;
  likes: number;
  risk: "ok" | "warn";
  status: ItemStatus;
  updatedAt: string;
  fileCount: number;
};

export type LibraryItem = LibraryItemSummary & {
  changelog: string | null;
  files: StudioFile[];
  data: CreationData;
  findings: LibraryFinding[];
  reports: number;
  createdAt: string;
  /** Viewer's server: liked / reported it, its installed copy (creation id and version), its own item. */
  viewer: { liked: boolean; reported: boolean; installed: { creationId: number; version: number } | null; mine: boolean };
};

type ItemRow = {
  id: number; server_id: string; creation_id: number | null; kind: string; title: string; description: string; tags_json: string; framework: string;
  resource: string; version: number; changelog: string | null; files_json: string; data_json: string; findings_json: string; risk: string;
  author_name: string | null; installs: number; likes: number; reports: number; status: string; created_at: string; updated_at: string;
  server_name: string; icon_url: string | null;
};

function parse<T>(raw: string | null | undefined, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const SELECT = `SELECT l.*, s.name AS server_name, s.icon_url FROM library_items l JOIN servers s ON s.id = l.server_id`;

function toSummary(r: ItemRow): LibraryItemSummary {
  return {
    id: Number(r.id),
    kind: (isCreationKind(r.kind) ? r.kind : "script") as CreationKind,
    title: r.title,
    description: r.description,
    tags: parse<string[]>(r.tags_json, []),
    framework: r.framework as Framework,
    resource: r.resource,
    version: Number(r.version),
    serverId: r.server_id,
    serverName: r.server_name,
    serverIcon: r.icon_url,
    authorName: r.author_name,
    installs: Number(r.installs),
    likes: Number(r.likes),
    risk: r.risk === "warn" ? "warn" : "ok",
    status: r.status as ItemStatus,
    updatedAt: r.updated_at,
    fileCount: parse<StudioFile[]>(r.files_json, []).length
  };
}

// ---- checks ----

/** Pure: role of a file in its resource, from the manifest (else from its name). */
export function fileRole(path: string, manifest: string): Role {
  if (/\.(html?|css)$/i.test(path) || /^(html|ui|web|nui)\//i.test(path)) return "ui";
  const quoted = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const side of ["server", "client", "shared"] as const) {
    if (new RegExp(`${side}_scripts?\\s*[({]?[^})]*?['"]${quoted}['"]`, "i").test(manifest)) return side;
  }
  if (/server/i.test(path)) return "server";
  if (/client/i.test(path)) return "client";
  if (/config|shared/i.test(path)) return "shared";
  return "other";
}

/**
 * Pure: what the scanner and the Studio checks find in files about to be shared. `blocking`: a backdoor, an
 * obfuscated payload or a critical flaw (never published).
 */
export function reviewFiles(files: StudioFile[]): { findings: LibraryFinding[]; blocking: LibraryFinding[]; studioErrors: number } {
  const manifest = files.find((f) => f.path === "fxmanifest.lua")?.content ?? "";
  const findings: LibraryFinding[] = [];
  for (const f of files) {
    if (!ANALYZABLE.test(f.path)) continue;
    for (const x of analyzeFile(f.path, f.content, fileRole(f.path, manifest)).findings) {
      findings.push({ rule: x.rule, severity: x.severity, title: x.title, detail: x.detail, line: x.line, file: f.path });
    }
  }
  const studioErrors = checkFiles(files).filter((c) => c.level === "error").length;
  return { findings: findings.slice(0, 60), blocking: findings.filter((x) => x.severity === "critical"), studioErrors };
}

// ---- publishing ----

const cleanTags = (tags: string[]) =>
  [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/[^a-z0-9à-ÿ+#-]+/g, "-").replace(/^-+|-+$/g, "")).filter((t) => t.length >= 2 && t.length <= 20))].slice(0, 6);

/** What the item keeps of the creation's data: what an installed copy needs to stay editable the same way. */
function shareableData(c: Creation): CreationData {
  if (c.kind === "map") return { map: c.data.map };
  if (c.data.mode === "visual") return c.kind === "ui" ? { mode: "visual", ui: c.data.ui } : { mode: "visual", blocks: c.data.blocks };
  return c.kind === "ui" ? { mode: "code", tests: c.data.tests ?? [] } : { mode: "code" };
}

/**
 * Publish a creation, or release a new version of what it already published. Throws LibraryError
 * (unknown_creation, nothing_to_publish, has_errors, unsafe_code with the findings, item_hidden).
 */
export async function publishCreation(
  serverId: string,
  actor: Actor,
  creationId: number,
  input: { title: string; description: string; tags: string[]; changelog?: string | null },
  now = new Date()
): Promise<{ id: number; version: number; created: boolean }> {
  const creation = await getCreation(serverId, creationId);
  if (!creation) throw new LibraryError("unknown_creation");
  if (creation.files.length === 0) throw new LibraryError("nothing_to_publish");
  const review = reviewFiles(creation.files);
  if (review.blocking.length) throw new LibraryError("unsafe_code", review.blocking.slice(0, 5));
  if (review.studioErrors > 0) throw new LibraryError("has_errors");
  const risk = review.findings.some((f) => f.severity === "high") ? "warn" : "ok";
  const values = {
    title: input.title.trim().slice(0, 60),
    description: input.description.trim().slice(0, 2000),
    tags: JSON.stringify(cleanTags(input.tags)),
    files: JSON.stringify(creation.files),
    data: JSON.stringify(shareableData(creation)),
    findings: JSON.stringify(review.findings)
  };
  const existing = await db.get<{ id: number; version: number; status: string }>(
    "SELECT id, version, status FROM library_items WHERE server_id = ? AND creation_id = ?",
    [serverId, creationId]
  );
  if (existing && existing.status === "hidden") throw new LibraryError("item_hidden");

  if (existing) {
    const version = Number(existing.version) + 1;
    await db.batch([
      stmt(
        `UPDATE library_items SET title = ?, description = ?, tags_json = ?, framework = ?, version = ?, changelog = ?, files_json = ?, data_json = ?,
           findings_json = ?, risk = ?, author_discord_id = ?, author_name = ?, status = 'published', updated_at = ? WHERE id = ?`,
        [values.title, values.description, values.tags, creation.framework, version, input.changelog?.trim().slice(0, 500) || null, values.files, values.data,
          values.findings, risk, actor.discordId, actor.username ?? null, iso(now), existing.id]
      ),
      auditStmt(serverId, actor, "library_publish", null, { title: values.title, version })
    ]);
    return { id: Number(existing.id), version, created: false };
  }
  const [insert] = await db.batch([
    stmt(
      `INSERT INTO library_items (server_id, creation_id, kind, title, description, tags_json, framework, resource, version, changelog, files_json, data_json,
         findings_json, risk, author_discord_id, author_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [serverId, creationId, creation.kind, values.title, values.description, values.tags, creation.framework, creation.resource,
        input.changelog?.trim().slice(0, 500) || null, values.files, values.data, values.findings, risk, actor.discordId, actor.username ?? null, iso(now), iso(now)]
    ),
    auditStmt(serverId, actor, "library_publish", null, { title: values.title, version: 1 })
  ]);
  return { id: Number(insert.rows[0].id), version: 1, created: true };
}

/** The publisher withdraws its item (installed copies stay where they are). */
export async function unpublishItem(serverId: string, actor: Actor, itemId: number): Promise<boolean> {
  const item = await db.get<{ title: string }>("SELECT title FROM library_items WHERE id = ? AND server_id = ? AND status <> 'removed'", [itemId, serverId]);
  if (!item) return false;
  await db.batch([
    stmt("UPDATE library_items SET status = 'removed', updated_at = ? WHERE id = ?", [iso(), itemId]),
    auditStmt(serverId, actor, "library_unpublish", null, { title: item.title })
  ]);
  return true;
}

/** Platform owners: put a hidden item back (reports cleared), or remove it. */
export async function moderateItem(itemId: number, status: "published" | "removed"): Promise<boolean> {
  const res = await db.batch([
    stmt("UPDATE library_items SET status = ?, reports = CASE WHEN ? = 'published' THEN 0 ELSE reports END, updated_at = ? WHERE id = ?", [status, status, iso(), itemId]),
    ...(status === "published" ? [stmt("DELETE FROM library_reactions WHERE item_id = ? AND kind = 'report'", [itemId])] : [])
  ]);
  return res[0].changes > 0;
}

// ---- browsing ----

export async function listLibrary(
  opts: { kind?: CreationKind; q?: string; framework?: string; sort?: LibrarySort; serverId?: string; limit?: number } = {}
): Promise<LibraryItemSummary[]> {
  const where = ["l.status = 'published'"];
  const args: (string | number)[] = [];
  if (opts.kind) { where.push("l.kind = ?"); args.push(opts.kind); }
  if (opts.framework) { where.push("l.framework = ?"); args.push(opts.framework); }
  if (opts.serverId) { where.push("l.server_id = ?"); args.push(opts.serverId); }
  const q = opts.q?.trim();
  if (q) {
    where.push("(l.title LIKE ? OR l.description LIKE ? OR l.tags_json LIKE ? OR s.name LIKE ?)");
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const order = opts.sort === "recent" ? "l.updated_at DESC" : opts.sort === "liked" ? "l.likes DESC, l.installs DESC" : "l.installs DESC, l.likes DESC, l.updated_at DESC";
  const rows = await db.all<ItemRow>(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ?`, [...args, opts.limit ?? 60]);
  return rows.map(toSummary);
}

/** An item as seen from a server. Removed / hidden items: only their publisher and platform owners see them. */
export async function getLibraryItem(itemId: number, viewerServerId: string, opts: { moderator?: boolean } = {}): Promise<LibraryItem | null> {
  const [items, reactions, installed] = await db.batch(
    [
      stmt(`${SELECT} WHERE l.id = ?`, [itemId]),
      stmt("SELECT kind FROM library_reactions WHERE item_id = ? AND server_id = ?", [itemId, viewerServerId]),
      stmt("SELECT id, library_version FROM studio_creations WHERE server_id = ? AND library_item_id = ? ORDER BY id DESC LIMIT 1", [viewerServerId, itemId])
    ],
    "read"
  );
  const row = items.rows[0] as unknown as ItemRow | undefined;
  if (!row) return null;
  const mine = row.server_id === viewerServerId;
  if (row.status !== "published" && !mine && !opts.moderator) return null;
  const kinds = new Set(reactions.rows.map((r) => String(r.kind)));
  const copy = installed.rows[0];
  return {
    ...toSummary(row),
    changelog: row.changelog,
    files: parse<StudioFile[]>(row.files_json, []),
    data: parse<CreationData>(row.data_json, {}),
    findings: parse<LibraryFinding[]>(row.findings_json, []),
    reports: Number(row.reports),
    createdAt: row.created_at,
    viewer: {
      liked: kinds.has("like"),
      reported: kinds.has("report"),
      installed: copy ? { creationId: Number(copy.id), version: Number(copy.library_version ?? 0) } : null,
      mine
    }
  };
}

// ---- installing ----

async function freeResource(serverId: string, wanted: string): Promise<string> {
  const base = RESOURCE_RE.test(wanted) ? wanted : "fvx_library";
  for (let i = 1; i < 50; i++) {
    const candidate = i === 1 ? base : `${base.slice(0, 44)}_${i}`;
    if (!(await db.get("SELECT 1 FROM studio_creations WHERE server_id = ? AND resource = ?", [serverId, candidate]))) return candidate;
  }
  throw new LibraryError("resource_taken");
}

/** Copy an item into the server's Studio. Returns the new creation's id and kind. */
export async function installItem(serverId: string, actor: Actor, itemId: number, now = new Date()): Promise<{ creationId: number; kind: CreationKind }> {
  const item = await getLibraryItem(itemId, serverId);
  if (!item || item.status !== "published") throw new LibraryError("unknown_item");
  const resource = await freeResource(serverId, item.resource);
  let start: { files: StudioFile[]; data: CreationData };
  try {
    start = normalise(item.kind, item.title, item.framework, item.files, item.data);
  } catch (error) {
    throw new LibraryError(error instanceof StudioError ? error.message : "invalid_files");
  }
  const at = iso(now);
  const [insert, , reaction] = await db.batch([
    stmt(
      `INSERT INTO studio_creations (server_id, kind, name, resource, framework, files_json, data_json, author_discord_id, created_at, updated_at, library_item_id, library_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [serverId, item.kind, item.title, resource, item.framework, JSON.stringify(start.files), JSON.stringify(start.data), actor.discordId, at, at, item.id, item.version]
    ),
    auditStmt(serverId, actor, "library_install", null, { title: item.title, from: item.serverName, version: item.version, resource }),
    // One install per server counts (installing again after deleting the copy does not inflate the counter).
    stmt("INSERT OR IGNORE INTO library_reactions (item_id, server_id, kind, actor_discord_id, created_at) VALUES (?, ?, 'install', ?, ?)", [item.id, serverId, actor.discordId, at])
  ]);
  const creationId = Number(insert.rows[0].id);
  await db.batch([
    stmt(
      `INSERT INTO studio_versions (creation_id, server_id, source, prompt, summary, files_json, data_json, author_discord_id, author_name, created_at)
       VALUES (?, ?, 'library', NULL, ?, ?, ?, ?, ?, ?)`,
      [creationId, serverId, `Installée depuis la bibliothèque (${item.serverName}, v${item.version})`, JSON.stringify(start.files), JSON.stringify(start.data), actor.discordId, actor.username ?? null, at]
    ),
    ...(reaction.changes > 0 ? [stmt("UPDATE library_items SET installs = installs + 1 WHERE id = ?", [item.id])] : [])
  ]);
  return { creationId, kind: item.kind };
}

export type LibraryLink =
  | { role: "installed"; itemId: number; title: string; serverName: string; installedVersion: number; latestVersion: number; available: boolean }
  | { role: "published"; itemId: number; version: number; installs: number; likes: number; status: ItemStatus; title: string; description: string; tags: string[] }
  | null;

/** How a creation relates to the library: an installed copy (update available?) or the source of a published item. */
export async function libraryLink(serverId: string, creationId: number): Promise<LibraryLink> {
  const [copy, published] = await db.batch(
    [
      stmt(
        `SELECT c.library_item_id, c.library_version, l.title, l.version, l.status, s.name AS server_name
         FROM studio_creations c JOIN library_items l ON l.id = c.library_item_id JOIN servers s ON s.id = l.server_id
         WHERE c.server_id = ? AND c.id = ?`,
        [serverId, creationId]
      ),
      stmt("SELECT id, version, installs, likes, status, title, description, tags_json FROM library_items WHERE server_id = ? AND creation_id = ? AND status <> 'removed'", [serverId, creationId])
    ],
    "read"
  );
  const p = published.rows[0];
  if (p) {
    return {
      role: "published", itemId: Number(p.id), version: Number(p.version), installs: Number(p.installs), likes: Number(p.likes), status: p.status as ItemStatus,
      title: String(p.title), description: String(p.description), tags: parse<string[]>(p.tags_json as string, [])
    };
  }
  const c = copy.rows[0];
  if (c) {
    const installedVersion = Number(c.library_version ?? 0);
    const latestVersion = Number(c.version);
    return {
      role: "installed", itemId: Number(c.library_item_id), title: String(c.title), serverName: String(c.server_name),
      installedVersion, latestVersion, available: c.status === "published" && latestVersion > installedVersion
    };
  }
  return null;
}

/** Bring an installed copy to the item's latest version (the current state stays in the creation's history). */
export async function updateInstalled(serverId: string, actor: Actor, creationId: number): Promise<Creation> {
  const link = await libraryLink(serverId, creationId);
  if (!link || link.role !== "installed") throw new LibraryError("not_installed");
  if (!link.available) throw new LibraryError("up_to_date");
  const item = await getLibraryItem(link.itemId, serverId);
  if (!item) throw new LibraryError("unknown_item");
  const creation = await saveCreation(serverId, actor, creationId, { files: item.files, data: item.data, framework: item.framework }, {
    source: "library",
    summary: `Mise à jour v${item.version} depuis la bibliothèque${item.changelog ? ` : ${item.changelog}` : ""}`
  });
  await db.batch([
    stmt("UPDATE studio_creations SET library_version = ? WHERE server_id = ? AND id = ?", [item.version, serverId, creationId]),
    auditStmt(serverId, actor, "library_update", null, { title: item.title, version: item.version })
  ]);
  return creation;
}

// ---- likes & reports ----

export async function toggleLike(serverId: string, actor: Actor, itemId: number): Promise<{ liked: boolean; likes: number }> {
  const item = await db.get<{ server_id: string }>("SELECT server_id FROM library_items WHERE id = ? AND status = 'published'", [itemId]);
  if (!item) throw new LibraryError("unknown_item");
  const existing = await db.get("SELECT 1 FROM library_reactions WHERE item_id = ? AND server_id = ? AND kind = 'like'", [itemId, serverId]);
  await db.batch(
    existing
      ? [
          stmt("DELETE FROM library_reactions WHERE item_id = ? AND server_id = ? AND kind = 'like'", [itemId, serverId]),
          stmt("UPDATE library_items SET likes = MAX(0, likes - 1) WHERE id = ?", [itemId])
        ]
      : [
          stmt("INSERT INTO library_reactions (item_id, server_id, kind, actor_discord_id, created_at) VALUES (?, ?, 'like', ?, ?)", [itemId, serverId, actor.discordId, iso()]),
          stmt("UPDATE library_items SET likes = likes + 1 WHERE id = ?", [itemId])
        ]
  );
  const row = await db.get<{ likes: number }>("SELECT likes FROM library_items WHERE id = ?", [itemId]);
  return { liked: !existing, likes: Number(row?.likes ?? 0) };
}

/** One report per server; REPORTS_TO_HIDE of them hide the item. A server cannot report its own item. */
export async function reportItem(serverId: string, actor: Actor, itemId: number, reason: string): Promise<{ hidden: boolean }> {
  const item = await db.get<{ server_id: string; title: string }>("SELECT server_id, title FROM library_items WHERE id = ? AND status = 'published'", [itemId]);
  if (!item) throw new LibraryError("unknown_item");
  if (item.server_id === serverId) throw new LibraryError("own_item");
  if (await db.get("SELECT 1 FROM library_reactions WHERE item_id = ? AND server_id = ? AND kind = 'report'", [itemId, serverId])) throw new LibraryError("already_reported");
  const [, , , hidden] = await db.batch([
    stmt("INSERT INTO library_reactions (item_id, server_id, kind, reason, actor_discord_id, created_at) VALUES (?, ?, 'report', ?, ?, ?)", [
      itemId, serverId, reason.trim().slice(0, 300), actor.discordId, iso()
    ]),
    auditStmt(serverId, actor, "library_report", null, { title: item.title, reason: reason.slice(0, 120) }),
    stmt("UPDATE library_items SET reports = reports + 1 WHERE id = ?", [itemId]),
    stmt("UPDATE library_items SET status = 'hidden' WHERE id = ? AND status = 'published' AND reports >= ?", [itemId, REPORTS_TO_HIDE])
  ]);
  return { hidden: hidden.changes > 0 };
}

/** Reasons given by the servers that reported an item (platform owners' review). */
export async function itemReports(itemId: number): Promise<{ serverName: string; reason: string | null; at: string }[]> {
  const rows = await db.all<{ name: string; reason: string | null; created_at: string }>(
    "SELECT s.name, r.reason, r.created_at FROM library_reactions r JOIN servers s ON s.id = r.server_id WHERE r.item_id = ? AND r.kind = 'report' ORDER BY r.created_at DESC",
    [itemId]
  );
  return rows.map((r) => ({ serverName: r.name, reason: r.reason, at: r.created_at }));
}

/** Items waiting for a platform owner (hidden by reports). */
export async function hiddenItems(): Promise<LibraryItemSummary[]> {
  return (await db.all<ItemRow>(`${SELECT} WHERE l.status = 'hidden' ORDER BY l.updated_at DESC LIMIT 50`)).map(toSummary);
}
