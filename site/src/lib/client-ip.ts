import { createHmac } from "node:crypto";

/**
 * The visitor's IP address, read the same way everywhere (rate limits, votes, scans, checkout).
 *
 * x-real-ip first: Vercel (and the usual reverse proxies: nginx, Traefik, Caddy) set it to the address that opened
 * the connection, replacing whatever the client sent. The first x-forwarded-for entry comes next: on Vercel it is
 * overwritten too, but behind a proxy that *appends* to the header it is the part a client can forge, which is why
 * it is only a fallback. Without any trusted proxy in front of Next, neither header can be trusted.
 */
const IP_RE = /^[0-9a-f.:]{3,45}$/i;

export function clientIp(headers: Headers): string | null {
  const candidates = [headers.get("x-real-ip"), (headers.get("x-forwarded-for") ?? "").split(",")[0]];
  for (const raw of candidates) {
    const ip = raw?.trim();
    if (ip && IP_RE.test(ip)) return ip;
  }
  return null;
}

/** Keyed hash of an address (never stored in clear), separate per purpose so two tables cannot be joined. */
export function hashIp(ip: string | null | undefined, purpose: string): string | null {
  const clean = ip?.split(",")[0]?.trim();
  if (!clean) return null;
  return createHmac("sha256", process.env.SESSION_SECRET || "fiverax").update(`${purpose}:${clean}`).digest("base64url").slice(0, 32);
}
