import { createHash } from "node:crypto";
import { stmt, type Stmt } from "./db";

/**
 * Keys of the Fiverax network: what a ban matches on, hashed. Other servers never see a raw identifier: they hash
 * the identifiers of the player in front of them and look the hashes up. IP addresses are never used.
 */

const BANNABLE = /^(license2?|discord|steam|fivem|xbl|live2?):[^\s]{2,}$/i;

/** Pure: the hash of one identifier ("license:abc…") or hardware token. */
export function networkKey(value: string): string {
  return createHash("sha256").update(`fiverax-network:${value.trim().toLowerCase()}`).digest("hex").slice(0, 40);
}

/** Pure: [hash, kind] of every identifier and token a ban matches on (deduplicated). */
export function networkKeys(identifiers: string[], tokens: string[]): [string, string][] {
  const out = new Map<string, string>();
  for (const id of identifiers) {
    if (BANNABLE.test(id)) out.set(networkKey(id), id.split(":")[0].toLowerCase());
  }
  for (const token of tokens) {
    if (typeof token === "string" && token.length >= 4) out.set(networkKey(`token:${token}`), "token");
  }
  return [...out.entries()].slice(0, 80);
}

/** Keys of the ban just inserted for this server (same batch, right after the INSERT INTO bans). */
export function latestBanKeysStmt(serverId: string, identifiers: string[], tokens: string[]): Stmt | null {
  const keys = networkKeys(identifiers, tokens);
  if (keys.length === 0) return null;
  return stmt(
    `INSERT OR IGNORE INTO network_ban_keys (ban_id, server_id, key, kind)
     SELECT (SELECT MAX(id) FROM bans WHERE server_id = ?), ?, json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)`,
    [serverId, serverId, JSON.stringify(keys)]
  );
}

/** Keys of a given ban (backfill of bans made before the network existed). */
export function banKeysStmt(serverId: string, banId: number, identifiers: string[], tokens: string[]): Stmt | null {
  const keys = networkKeys(identifiers, tokens);
  if (keys.length === 0) return null;
  return stmt(
    `INSERT OR IGNORE INTO network_ban_keys (ban_id, server_id, key, kind)
     SELECT ?, ?, json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)`,
    [banId, serverId, JSON.stringify(keys)]
  );
}
