import { createHash } from "node:crypto";
import { z } from "zod";
import { enqueueCommand, getCommandStatus, getLiveState } from "./agent";
import { db, stmt } from "./db";
import {
  applyPatches, FILE_LIMITS, isEditablePath, RESOURCE_NAME_RE,
  type ChangeFile, type ChangeStatus, type ResourceChange
} from "./resource-files-shared";

/**
 * Files of the server's resources, for the troubleshooting AI (Serveur FiveM > Assistant IA).
 *
 * - Read: the panel queues a "files" command (op list / read); the agent (files.js) answers on
 *   /api/fivem/agent/files. Contents are cached here (assistant_files): the AI's context, and the "before" of a change.
 * - Change: the AI proposes edits (find / replace, or a whole file) on files it read. They are stored as a change
 *   "to validate" with the content before and after. The admin applies it: the agent checks that each file is still
 *   the one the AI read (SHA-256), writes, keeps a .fiverax.bak copy and restarts the resource if asked.
 * - Undo: the "before" contents are written back the same way (only if nobody changed the files in between).
 *
 * Permission `server_files`; every read and write is in the logs.
 */

export class FilesError extends Error {}
export type Actor = { discordId: string; username?: string | null };

const iso = (d = new Date()) => d.toISOString();
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
/** A command the agent took but never answered (old agent without files.js, crash…). */
const ANSWER_MS = 2 * 60_000;

// ---- reads ----

export type ListedFile = { path: string; size: number };
export type ReadStatus = {
  commandId: number;
  resource: string;
  op: "list" | "read";
  status: "pending" | "done" | "failed";
  message: string | null;
  list: ListedFile[] | null;
  files: { path: string; missing?: boolean; error?: string; size?: number }[];
};

async function ensureResource(serverId: string, resource: string): Promise<void> {
  if (!RESOURCE_NAME_RE.test(resource) || resource === "fiverax_agent") throw new FilesError("invalid_resource");
  const live = await getLiveState(serverId);
  if (!live.online) throw new FilesError("agent_offline");
  if (!live.resources.some((r) => r.name === resource)) throw new FilesError("unknown_resource");
}

/** Queue a read: the list of the resource's files (no paths) or some files. Returns the command id to follow. */
export async function requestRead(serverId: string, actor: Actor, resource: string, paths?: string[]): Promise<number> {
  await ensureResource(serverId, resource);
  const clean = [...new Set((paths ?? []).filter(isEditablePath))].slice(0, FILE_LIMITS.readPaths);
  const payload = clean.length ? { op: "read", resource, paths: clean } : { op: "list", resource };
  const id = await enqueueCommand(serverId, actor, "files", payload);
  await db.run("INSERT INTO assistant_reads (command_id, server_id, resource, op, created_at) VALUES (?, ?, ?, ?, ?)", [id, serverId, resource, payload.op, iso()]);
  return id;
}

type ReadRow = { command_id: number; resource: string; op: "list" | "read"; status: ReadStatus["status"]; message: string | null; list_json: string | null; result_json: string | null; created_at: string };

export async function readStatus(serverId: string, commandId: number, now = new Date()): Promise<ReadStatus | null> {
  const row = await db.get<ReadRow>(
    "SELECT command_id, resource, op, status, message, list_json, result_json, created_at FROM assistant_reads WHERE server_id = ? AND command_id = ?",
    [serverId, commandId]
  );
  if (!row) return null;
  let { status, message } = row;
  if (status === "pending") {
    const command = await getCommandStatus(serverId, commandId, now);
    const late = now.getTime() - new Date(row.created_at).getTime() > ANSWER_MS;
    if (command && (command.status === "failed" || command.status === "expired" || command.status === "lost" || (command.status === "done" && late))) {
      status = "failed";
      message = command.status === "failed" ? command.result ?? "Refusé par le serveur" : command.status === "done" ? "L'agent n'a pas répondu : mets à jour fiverax_agent (version 3.5)" : "Le serveur FiveM n'a pas pris la demande";
      await db.run("UPDATE assistant_reads SET status = 'failed', message = ?, done_at = ? WHERE command_id = ? AND status = 'pending'", [message, iso(now), commandId]);
    }
  }
  return {
    commandId: Number(row.command_id), resource: row.resource, op: row.op, status, message,
    list: row.list_json ? (JSON.parse(row.list_json) as ListedFile[]) : null,
    files: row.result_json ? (JSON.parse(row.result_json) as ReadStatus["files"]) : []
  };
}

/** The latest file list of a resource (from a "list" read), if any. */
async function latestList(serverId: string, resource: string): Promise<ListedFile[] | null> {
  const row = await db.get<{ list_json: string | null }>(
    "SELECT list_json FROM assistant_reads WHERE server_id = ? AND resource = ? AND op = 'list' AND status = 'done' ORDER BY command_id DESC LIMIT 1",
    [serverId, resource]
  );
  return row?.list_json ? (JSON.parse(row.list_json) as ListedFile[]) : null;
}

export type CachedFile = { resource: string; path: string; content: string; hash: string; readAt: string };

export async function cachedFiles(serverId: string, refs: { resource: string; path: string }[]): Promise<CachedFile[]> {
  const out: CachedFile[] = [];
  for (const ref of refs.slice(0, FILE_LIMITS.opened)) {
    const row = await db.get<{ content: string; hash: string; read_at: string }>(
      "SELECT content, hash, read_at FROM assistant_files WHERE server_id = ? AND resource = ? AND path = ?",
      [serverId, ref.resource, ref.path]
    );
    if (row) out.push({ resource: ref.resource, path: ref.path, content: row.content, hash: row.hash, readAt: row.read_at });
  }
  return out;
}

/** Listings of these resources, for the AI. */
export async function listings(serverId: string, resources: string[]): Promise<{ resource: string; files: ListedFile[] }[]> {
  const out: { resource: string; files: ListedFile[] }[] = [];
  for (const resource of [...new Set(resources)].slice(0, 6)) {
    const files = await latestList(serverId, resource);
    if (files) out.push({ resource, files });
  }
  return out;
}

// ---- answers of the agent ----

const agentFile = z.object({
  path: z.string().max(300),
  content: z.string().max(FILE_LIMITS.fileBytes * 2).optional(),
  hash: z.string().max(64).optional(),
  missing: z.boolean().optional(),
  error: z.string().max(300).optional()
});
export const agentFilesSchema = z.object({
  commandId: z.number().int().positive(),
  op: z.enum(["list", "read", "write"]),
  resource: z.string().max(100),
  ok: z.boolean(),
  message: z.string().max(2000).optional(),
  list: z.array(z.object({ path: z.string().max(300), size: z.number().nonnegative() })).max(2000).optional(),
  files: z.array(agentFile).max(FILE_LIMITS.readPaths + 1).optional(),
  written: z.array(z.object({ path: z.string().max(300), hash: z.string().max(64) })).max(FILE_LIMITS.files).optional(),
  conflict: z.string().max(300).optional()
});

export async function receiveFromAgent(serverId: string, body: z.infer<typeof agentFilesSchema>, now = new Date()): Promise<void> {
  if (body.op === "write") return receiveWrite(serverId, body, now);
  const row = await db.get<{ resource: string }>("SELECT resource FROM assistant_reads WHERE server_id = ? AND command_id = ? AND status = 'pending'", [serverId, body.commandId]);
  if (!row) return;
  const files = (body.files ?? []).filter((f) => isEditablePath(f.path));
  const writes = [
    stmt("UPDATE assistant_reads SET status = ?, message = ?, list_json = ?, result_json = ?, done_at = ? WHERE server_id = ? AND command_id = ?", [
      body.ok ? "done" : "failed",
      body.message ?? null,
      body.list ? JSON.stringify(body.list.filter((f) => isEditablePath(f.path))) : null,
      JSON.stringify(files.map((f) => ({ path: f.path, missing: f.missing || undefined, error: f.error, size: f.content?.length }))),
      iso(now), serverId, body.commandId
    ]),
    ...files.map((f) =>
      f.content !== undefined && f.content.length <= FILE_LIMITS.fileBytes
        ? stmt(
            `INSERT INTO assistant_files (server_id, resource, path, content, hash, read_at) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (server_id, resource, path) DO UPDATE SET content = excluded.content, hash = excluded.hash, read_at = excluded.read_at`,
            [serverId, row.resource, f.path, f.content, sha(f.content), iso(now)]
          )
        : stmt("DELETE FROM assistant_files WHERE server_id = ? AND resource = ? AND path = ?", [serverId, row.resource, f.path])
    )
  ];
  await db.batch(writes);
}

async function receiveWrite(serverId: string, body: z.infer<typeof agentFilesSchema>, now: Date): Promise<void> {
  const row = await db.get<ChangeRow>(`SELECT ${CHANGE_COLUMNS} FROM assistant_changes WHERE server_id = ? AND (command_id = ? OR revert_command_id = ?)`, [
    serverId, body.commandId, body.commandId
  ]);
  if (!row || (row.status !== "pending" && row.status !== "reverting")) return;
  const reverting = row.status === "reverting";
  const files = JSON.parse(row.files_json) as ChangeFile[];
  const next: ChangeStatus = body.ok ? (reverting ? "reverted" : "applied") : reverting ? "applied" : "failed";
  const message = body.ok ? body.message ?? null : `${reverting ? "Annulation impossible" : "Échec"} : ${body.message ?? "erreur inconnue"}`;
  const writes = [
    stmt("UPDATE assistant_changes SET status = ?, message = ?, applied_at = COALESCE(?, applied_at) WHERE id = ?", [
      next, message, body.ok && !reverting ? iso(now) : null, row.id
    ])
  ];
  // The cache follows what is now on disk.
  if (body.ok) {
    for (const f of files) {
      const content = reverting ? f.before : f.after;
      writes.push(
        content === null
          ? stmt("DELETE FROM assistant_files WHERE server_id = ? AND resource = ? AND path = ?", [serverId, row.resource, f.path])
          : stmt(
              `INSERT INTO assistant_files (server_id, resource, path, content, hash, read_at) VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT (server_id, resource, path) DO UPDATE SET content = excluded.content, hash = excluded.hash, read_at = excluded.read_at`,
              [serverId, row.resource, f.path, content, sha(content), iso(now)]
            )
      );
    }
  }
  await db.batch(writes);
}

// ---- changes ----

export const editSchema = z.object({
  resource: z.string().regex(RESOURCE_NAME_RE),
  path: z.string().refine(isEditablePath),
  content: z.string().max(FILE_LIMITS.fileBytes).nullable().optional(),
  patches: z.array(z.object({ find: z.string().min(1).max(20_000), replace: z.string().max(40_000) })).max(30).optional()
});
export type Edit = z.infer<typeof editSchema>;

const CHANGE_COLUMNS = "id, resource, summary, files_json, status, message, restart, command_id, revert_command_id, actor_name, created_at, applied_at";
type ChangeRow = {
  id: number; resource: string; summary: string; files_json: string; status: ChangeStatus; message: string | null; restart: number;
  command_id: number | null; revert_command_id: number | null; actor_name: string | null; created_at: string; applied_at: string | null;
};

const toChange = (r: ChangeRow): ResourceChange => ({
  id: Number(r.id), resource: r.resource, summary: r.summary, files: JSON.parse(r.files_json) as ChangeFile[], status: r.status, message: r.message,
  restart: Boolean(r.restart), author: r.actor_name, createdAt: r.created_at, appliedAt: r.applied_at
});

/**
 * Turn the AI's edits into a change to validate (nothing is written yet). Existing files must have been read first
 * (their content is the "before"); a file absent from the resource's listing is a new file.
 * Returns the change and the edits that could not be used, with why (told back to the AI).
 */
export async function proposeChange(
  serverId: string, actor: Actor, summary: string, edits: Edit[]
): Promise<{ change: ResourceChange | null; rejected: string[] }> {
  const rejected: string[] = [];
  const byResource = new Map<string, ChangeFile[]>();
  for (const edit of edits.slice(0, FILE_LIMITS.files)) {
    if (edit.resource === "fiverax_agent") {
      rejected.push(`${edit.resource}/${edit.path} : l'agent ne se modifie pas`);
      continue;
    }
    const [cached] = await cachedFiles(serverId, [edit]);
    let before: string | null = cached?.content ?? null;
    if (!cached) {
      const list = await latestList(serverId, edit.resource);
      if (!list || list.some((f) => f.path === edit.path)) {
        rejected.push(`${edit.resource}/${edit.path} : fichier pas encore lu (lis-le avant de le modifier)`);
        continue;
      }
      before = null; // new file
    }
    let after: string | null;
    if (edit.patches?.length) {
      if (before === null) {
        rejected.push(`${edit.resource}/${edit.path} : nouveau fichier, donne son contenu complet`);
        continue;
      }
      const applied = applyPatches(before, edit.patches);
      if (!applied.ok) {
        rejected.push(`${edit.resource}/${edit.path} : le texte à remplacer ${applied.reason === "missing" ? "est introuvable" : "apparaît plusieurs fois"} (« ${applied.find.slice(0, 80)} »)`);
        continue;
      }
      after = applied.text;
    } else if (edit.content !== undefined) {
      after = edit.content;
    } else {
      rejected.push(`${edit.resource}/${edit.path} : ni contenu ni remplacement`);
      continue;
    }
    if (after === before) continue;
    if (after === null && before === null) continue;
    const files = byResource.get(edit.resource) ?? [];
    const same = files.findIndex((f) => f.path === edit.path);
    if (same >= 0) files[same] = { ...files[same], after };
    else files.push({ path: edit.path, before, after });
    byResource.set(edit.resource, files);
  }
  // One change per answer: the AI works on one resource at a time.
  const [first] = byResource.entries();
  if (!first) return { change: null, rejected };
  for (const [resource] of [...byResource.entries()].slice(1)) rejected.push(`${resource} : une seule ressource par modification, redemande pour celle-ci`);
  const [resource, files] = first;
  const row = await db.get<ChangeRow>(
    `INSERT INTO assistant_changes (server_id, resource, summary, files_json, status, actor_discord_id, actor_name, created_at)
     VALUES (?, ?, ?, ?, 'proposed', ?, ?, ?) RETURNING ${CHANGE_COLUMNS}`,
    [serverId, resource, summary.slice(0, 500) || "Modification proposée par l'IA", JSON.stringify(files), actor.discordId, actor.username ?? null, iso()]
  );
  return { change: row ? toChange(row) : null, rejected };
}

export async function getChange(serverId: string, id: number, now = new Date()): Promise<ResourceChange | null> {
  const row = await db.get<ChangeRow>(`SELECT ${CHANGE_COLUMNS} FROM assistant_changes WHERE server_id = ? AND id = ?`, [serverId, id]);
  if (!row) return null;
  // A write the agent never answered.
  const waiting = row.status === "pending" ? row.command_id : row.status === "reverting" ? row.revert_command_id : null;
  if (waiting) {
    const command = await getCommandStatus(serverId, waiting, now);
    const createdAt = (await db.get<{ created_at: string }>("SELECT created_at FROM fivem_commands WHERE id = ?", [waiting]))?.created_at;
    const late = createdAt ? now.getTime() - new Date(createdAt).getTime() > ANSWER_MS : false;
    if (command && (command.status === "failed" || command.status === "expired" || command.status === "lost" || (command.status === "done" && late))) {
      const reason = command.status === "failed" ? command.result ?? "refusé" : command.status === "done" ? "l'agent n'a pas répondu (mets à jour fiverax_agent, version 3.5)" : "le serveur FiveM n'a pas pris la demande";
      const status: ChangeStatus = row.status === "reverting" ? "applied" : "failed";
      const message = `${row.status === "reverting" ? "Annulation impossible" : "Échec"} : ${reason}`;
      await db.run("UPDATE assistant_changes SET status = ?, message = ? WHERE id = ? AND status = ?", [status, message, row.id, row.status]);
      return { ...toChange(row), status, message };
    }
  }
  return toChange(row);
}

export async function listChanges(serverId: string, limit = 20): Promise<ResourceChange[]> {
  const rows = await db.all<ChangeRow>(`SELECT ${CHANGE_COLUMNS} FROM assistant_changes WHERE server_id = ? AND status != 'proposed' ORDER BY id DESC LIMIT ?`, [serverId, limit]);
  return rows.map(toChange);
}

const expectOf = (content: string | null) => (content === null ? "" : sha(content));

/** Write a proposed (or failed) change on the server. */
export async function applyChange(serverId: string, actor: Actor, id: number, restart: boolean): Promise<ResourceChange> {
  const change = await getChange(serverId, id);
  if (!change) throw new FilesError("unknown_change");
  if (change.status !== "proposed" && change.status !== "failed") throw new FilesError("change_not_pending");
  await ensureResource(serverId, change.resource);
  const commandId = await enqueueCommand(serverId, actor, "files", {
    op: "write", resource: change.resource, restart,
    files: change.files.map((f) => ({ path: f.path, content: f.after, expect: expectOf(f.before) }))
  });
  await db.run("UPDATE assistant_changes SET status = 'pending', message = NULL, restart = ?, command_id = ? WHERE id = ?", [restart ? 1 : 0, commandId, id]);
  return { ...change, status: "pending", message: null, restart };
}

/** Put the files back as they were before an applied change. */
export async function revertChange(serverId: string, actor: Actor, id: number): Promise<ResourceChange> {
  const change = await getChange(serverId, id);
  if (!change) throw new FilesError("unknown_change");
  if (change.status !== "applied") throw new FilesError("change_not_applied");
  await ensureResource(serverId, change.resource);
  const commandId = await enqueueCommand(serverId, actor, "files", {
    op: "write", resource: change.resource, restart: change.restart,
    files: change.files.map((f) => ({ path: f.path, content: f.before, expect: expectOf(f.after) }))
  });
  await db.run("UPDATE assistant_changes SET status = 'reverting', message = NULL, revert_command_id = ? WHERE id = ?", [commandId, id]);
  return { ...change, status: "reverting", message: null };
}

/** Forget a proposal the admin does not want. */
export async function discardChange(serverId: string, id: number): Promise<void> {
  await db.run("DELETE FROM assistant_changes WHERE server_id = ? AND id = ? AND status = 'proposed'", [serverId, id]);
}
