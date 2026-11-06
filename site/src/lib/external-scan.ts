import { createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { db } from "./db";
import {
  analyzeExternal, isPublicIp, parseTarget, targetLabel,
  type ExternalData, type ExternalReport, type ScanTarget
} from "./external-scan-shared";
import { checkArtifacts } from "./server-audit";

/**
 * Free public scan (/scan): fetch the public endpoints of a FiveM server and score what they show.
 *
 * Safety (the panel fetches an address typed by anyone):
 * - a cfx.re code goes through the official server list (fixed host); an address is resolved once, every address it
 *   resolves to must be public (lib/external-scan-shared isPublicIp), and the request goes to that IP, so a DNS answer
 *   cannot change between the check and the request; ports under 1024 are refused;
 * - GET only, on three fixed paths, no redirect followed, 4 s timeout, 1.5 MB at most per answer;
 * - 8 scans per hour per network address (kept as a keyed hash), and the same server is not fetched again for 10 min.
 * Nothing about the players is stored: they are counted, then dropped. Results are kept 30 days.
 */

export class ScanError extends Error {}

const CACHE_MS = 10 * 60_000;
const PER_HOUR = 8;
const GLOBAL_PER_HOUR = 400;
const KEEP_DAYS = 30;
const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 4000;
const iso = (d = new Date()) => d.toISOString();

export type PublicScan = {
  token: string;
  target: string;
  name: string | null;
  score: number;
  counts: { critical: number; high: number; medium: number; info: number };
  report: ExternalReport;
  createdAt: string;
  discordId: string | null;
};

/** Keyed hash of the visitor's address: rate limits without keeping the address. */
export function scanIpHash(ip: string | null | undefined): string | null {
  const clean = ip?.split(",")[0]?.trim();
  if (!clean) return null;
  return createHmac("sha256", process.env.SESSION_SECRET || "fiverax").update(`scan:${clean}`).digest("base64url").slice(0, 32);
}

/** GET a JSON document with every limit above. Null when unreachable or not JSON. */
async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown | null> {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "application/json", "User-Agent": "FiveraxScanner/1.0", ...headers } });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 3000) : []);
const vars = (v: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries(record(v)).slice(0, 300).map(([k, x]) => [k.slice(0, 80), String(x ?? "").slice(0, 300)]));
const players = (v: unknown): ExternalData["players"] =>
  Array.isArray(v)
    ? v.slice(0, 2048).map((p) => {
        const r = record(p);
        return { endpoint: typeof r.endpoint === "string" ? r.endpoint : undefined, identifiers: strings(r.identifiers) };
      })
    : null;

/** Base URL of a server address, after checking where it really points. */
async function safeBase(host: string, port: number): Promise<string> {
  let address = host;
  if (!isPublicIp(host)) {
    if (/^[0-9.]+$/.test(host) || host.includes(":")) throw new ScanError("private_address");
    if (/(^|\.)(localhost|local|internal|lan|home|corp)$/i.test(host)) throw new ScanError("private_address");
    let all: { address: string }[];
    try {
      all = await lookup(host, { all: true, verbatim: true });
    } catch {
      throw new ScanError("unknown_host");
    }
    if (!all.length || all.some((a) => !isPublicIp(a.address))) throw new ScanError("private_address");
    address = (all.find((a) => !a.address.includes(":")) ?? all[0]).address;
  }
  return `http://${address.includes(":") ? `[${address}]` : address}:${port}`;
}

/** The public data of a FiveM server from its base URL (already checked): info.json, players.json, dynamic.json. */
async function fromBase(base: string): Promise<ExternalData> {
  const [info, list, dyn] = await Promise.all([getJson(`${base}/info.json`), getJson(`${base}/players.json`), getJson(`${base}/dynamic.json`)]);
  if (!info && !dyn) throw new ScanError("unreachable");
  const i = record(info);
  const d = record(dyn);
  const v = vars(i.vars);
  return {
    hostname: typeof d.hostname === "string" ? d.hostname : null,
    projectName: v.sv_projectName ?? null,
    server: typeof i.server === "string" ? i.server : null,
    vars: v,
    // Some servers hide info.json (sv_requestParanoia): their convars are unknown, not "off".
    varsHidden: !info,
    resources: info && Array.isArray(i.resources) ? strings(i.resources) : null,
    players: players(list),
    clients: Number(d.clients) || null,
    maxClients: Number(d.sv_maxclients) || Number(v.sv_maxClients) || null
  };
}

async function fromAddress(host: string, port: number): Promise<ExternalData> {
  return fromBase(await safeBase(host, port));
}

/** Pure: a server URL given by Cfx.re ("http://1.2.3.4:30120/", "https://x-y.users.cfx.re/") → host and port to check, or a proxy base. */
export function parseCitizenUrl(raw: string | null): { proxy: string } | { host: string; port: number } | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol === "https:" && /^[a-z0-9-]+\.users\.cfx\.re$/i.test(url.hostname)) return { proxy: `https://${url.hostname.toLowerCase()}` };
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (port < 1024) return null;
  return { host: url.hostname.replace(/^\[|\]$/g, "").toLowerCase(), port };
}

/**
 * Where a cfx.re/join code points, the way the FiveM client finds it: the "x-citizenfx-url" header of
 * https://cfx.re/join/<code> (the redirect is not followed).
 */
async function resolveCfx(code: string): Promise<string | null> {
  try {
    const res = await fetch(`https://cfx.re/join/${encodeURIComponent(code)}`, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "User-Agent": "FiveraxScanner/1.0" } });
    await res.body?.cancel().catch(() => {});
    const target = parseCitizenUrl(res.headers.get("x-citizenfx-url"));
    if (!target) return null;
    return "proxy" in target ? target.proxy : await safeBase(target.host, target.port);
  } catch (error) {
    if (error instanceof ScanError) throw error;
    return null;
  }
}

/** The official server list (fallback when the server does not answer directly). */
async function fromServerList(code: string): Promise<ExternalData | null> {
  const data = record(record(await getJson(`https://servers-frontend.fivem.net/api/servers/single/${encodeURIComponent(code)}`)).Data);
  if (!Object.keys(data).length) return null;
  const v = vars(data.vars);
  return {
    hostname: typeof data.hostname === "string" ? data.hostname : null,
    projectName: v.sv_projectName ?? null,
    server: typeof data.server === "string" ? data.server : null,
    vars: v,
    resources: Array.isArray(data.resources) ? strings(data.resources) : null,
    // The list hides the players' endpoints: nothing to say about them from here.
    players: null,
    clients: Number(data.clients) || null,
    maxClients: Number(data.sv_maxclients) || null
  };
}

/** A cfx.re/join code: resolved like the FiveM client does, then read on the server itself; the official list as a fallback. */
async function fromCfx(code: string): Promise<ExternalData> {
  const base = await resolveCfx(code);
  if (base) {
    try {
      return await fromBase(base);
    } catch (error) {
      const listed = await fromServerList(code);
      if (listed) return listed;
      throw error;
    }
  }
  const listed = await fromServerList(code);
  if (!listed) throw new ScanError("unknown_server");
  return listed;
}

type Row = {
  token: string; target: string; name: string | null; score: number; critical: number; high: number; medium: number; info: number;
  report_json: string; created_at: string; discord_id: string | null;
};
const toScan = (r: Row): PublicScan => ({
  token: r.token, target: r.target, name: r.name, score: Number(r.score),
  counts: { critical: Number(r.critical), high: Number(r.high), medium: Number(r.medium), info: Number(r.info) },
  report: JSON.parse(r.report_json) as ExternalReport, createdAt: r.created_at, discordId: r.discord_id
});

export async function getPublicScan(token: string): Promise<PublicScan | null> {
  if (!/^[A-Za-z0-9_-]{16,32}$/.test(token)) return null;
  const row = await db.get<Row>("SELECT token, target, name, score, critical, high, medium, info, report_json, created_at, discord_id FROM public_scans WHERE token = ?", [token]);
  return row ? toScan(row) : null;
}

/**
 * Scan a server (or answer the scan of the same server made less than 10 min ago).
 * `fetcher` replaces the network in tests.
 */
export async function runPublicScan(
  input: string,
  who: { ipHash: string | null; discordId: string | null },
  opts: { now?: Date; fetcher?: (t: ScanTarget) => Promise<ExternalData> } = {}
): Promise<PublicScan> {
  const now = opts.now ?? new Date();
  const target = parseTarget(input);
  if (!target) throw new ScanError("invalid_target");

  const cached = await db.get<Row>(
    "SELECT token, target, name, score, critical, high, medium, info, report_json, created_at, discord_id FROM public_scans WHERE target = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1",
    [targetLabel(target), iso(new Date(now.getTime() - CACHE_MS))]
  );
  if (cached) return toScan(cached);

  const hourAgo = iso(new Date(now.getTime() - 3600_000));
  const [mine, all] = await Promise.all([
    who.ipHash ? db.get<{ n: number }>("SELECT COUNT(*) AS n FROM public_scans WHERE ip_hash = ? AND created_at > ?", [who.ipHash, hourAgo]) : Promise.resolve({ n: 0 }),
    db.get<{ n: number }>("SELECT COUNT(*) AS n FROM public_scans WHERE created_at > ?", [hourAgo])
  ]);
  if (Number(mine?.n ?? 0) >= PER_HOUR || Number(all?.n ?? 0) >= GLOBAL_PER_HOUR) throw new ScanError("rate_limited");

  const fetcher = opts.fetcher ?? ((t: ScanTarget) => (t.kind === "cfx" ? fromCfx(t.code) : fromAddress(t.host, t.port)));
  const data = await fetcher(target);
  const build = Number(/v1\.0\.0\.(\d+)/.exec(data.server ?? data.vars?.version ?? "")?.[1]) || null;
  const artifacts = opts.fetcher ? null : build ? await checkArtifacts(data.server ?? data.vars.version) : null;
  const report = analyzeExternal(data, artifacts);
  const counts = { critical: 0, high: 0, medium: 0, info: 0 };
  for (const f of report.findings) counts[f.severity]++;
  const token = randomBytes(15).toString("base64url");
  await db.batch([
    {
      sql: `INSERT INTO public_scans (token, target, name, score, critical, high, medium, info, report_json, ip_hash, discord_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [token, targetLabel(target), report.facts.name, report.score, counts.critical, counts.high, counts.medium, counts.info, JSON.stringify(report), who.ipHash, who.discordId, iso(now)]
    },
    { sql: "DELETE FROM public_scans WHERE created_at < ?", args: [iso(new Date(now.getTime() - KEEP_DAYS * 86_400_000))] }
  ]);
  return { token, target: targetLabel(target), name: report.facts.name, score: report.score, counts, report, createdAt: iso(now), discordId: who.discordId };
}

/** Numbers for the landing page: scans of the last 30 days and their average score. */
export async function scanStats(): Promise<{ scans: number; average: number | null }> {
  const row = await db.get<{ n: number; avg: number | null }>("SELECT COUNT(*) AS n, AVG(score) AS avg FROM public_scans");
  return { scans: Number(row?.n ?? 0), average: row?.avg == null ? null : Math.round(Number(row.avg)) };
}
