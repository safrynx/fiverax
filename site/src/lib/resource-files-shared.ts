/** Shared by the panel pages and the server: limits, paths the AI may touch, line diff. No server imports here. */

export const FILE_LIMITS = { fileBytes: 512 * 1024, files: 10, readPaths: 20, opened: 15 } as const;

export const RESOURCE_NAME_RE = /^[\w.\-[\]]{1,100}$/;
const TEXT_EXT = /\.(lua|js|mjs|cjs|ts|json|html|htm|css|cfg|sql|xml|yml|yaml|md|txt|meta|vue|jsx|tsx)$/i;

/** A relative text file inside a resource (same rules as files.js on the FiveM side). */
export function isEditablePath(p: string): boolean {
  return (
    typeof p === "string" && p.length > 0 && p.length <= 300 && !p.includes("..") && !p.includes("\\") && !p.startsWith("/") &&
    !/[\0:*?"<>|]/.test(p) && TEXT_EXT.test(p)
  );
}

export type ChangeStatus = "proposed" | "pending" | "applied" | "failed" | "reverting" | "reverted";
export type ChangeFile = { path: string; before: string | null; after: string | null };
export type ResourceChange = {
  id: number;
  resource: string;
  summary: string;
  files: ChangeFile[];
  status: ChangeStatus;
  message: string | null;
  restart: boolean;
  author: string | null;
  createdAt: string;
  appliedAt: string | null;
};

export const CHANGE_STATUS: Record<ChangeStatus, [string, string]> = {
  proposed: ["À valider", "info"],
  pending: ["Écriture…", "warn"],
  applied: ["Appliquée", "up"],
  failed: ["Échec", "danger"],
  reverting: ["Annulation…", "warn"],
  reverted: ["Annulée", "neutral"]
};

export type DiffLine = { type: "same" | "add" | "del"; text: string; a?: number; b?: number };

/**
 * Pure: line diff of two texts (LCS on what differs between the common head and tail). Very large changes fall back
 * to "everything removed, everything added" to stay fast in the browser.
 */
export function lineDiff(before: string | null, after: string | null): DiffLine[] {
  const a = before === null ? [] : before.replace(/\r\n/g, "\n").split("\n");
  const b = after === null ? [] : after.replace(/\r\n/g, "\n").split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const out: DiffLine[] = a.slice(0, head).map((text, i) => ({ type: "same", text, a: i + 1, b: i + 1 }));

  if (midA.length * midB.length > 4_000_000) {
    midA.forEach((text, i) => out.push({ type: "del", text, a: head + i + 1 }));
    midB.forEach((text, i) => out.push({ type: "add", text, b: head + i + 1 }));
  } else {
    const n = midA.length, m = midB.length;
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        out.push({ type: "same", text: midA[i], a: head + i + 1, b: head + j + 1 });
        i++; j++;
      } else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) {
        out.push({ type: "add", text: midB[j], b: head + j + 1 });
        j++;
      } else {
        out.push({ type: "del", text: midA[i], a: head + i + 1 });
        i++;
      }
    }
  }
  const offA = a.length - tail, offB = b.length - tail;
  for (let k = 0; k < tail; k++) out.push({ type: "same", text: a[offA + k], a: offA + k + 1, b: offB + k + 1 });
  return out;
}

/** Pure: only the changed lines with `context` lines around; null entries mark skipped parts. */
export function diffHunks(lines: DiffLine[], context = 3): (DiffLine | null)[] {
  const keep = new Uint8Array(lines.length);
  lines.forEach((l, i) => {
    if (l.type !== "same") for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = 1;
  });
  const out: (DiffLine | null)[] = [];
  lines.forEach((l, i) => {
    if (keep[i]) out.push(l);
    else if (out.length && out[out.length - 1] !== null) out.push(null);
  });
  if (out.length && out[out.length - 1] === null) out.pop();
  return out;
}

/** Pure: apply find / replace patches; each `find` must appear exactly once. Returns the new text or the failing patch. */
export function applyPatches(text: string, patches: { find: string; replace: string }[]): { ok: true; text: string } | { ok: false; find: string; reason: "missing" | "ambiguous" } {
  let out = text;
  for (const p of patches) {
    let find = p.find;
    let at = out.indexOf(find);
    if (at === -1 && out.includes("\r\n")) {
      // The AI writes \n; the file may use \r\n.
      find = p.find.replace(/\r?\n/g, "\r\n");
      at = out.indexOf(find);
    }
    if (at === -1) return { ok: false, find: p.find, reason: "missing" };
    if (out.indexOf(find, at + 1) !== -1) return { ok: false, find: p.find, reason: "ambiguous" };
    const replace = find === p.find ? p.replace : p.replace.replace(/\r?\n/g, "\r\n");
    out = out.slice(0, at) + replace + out.slice(at + find.length);
  }
  return { ok: true, text: out };
}
