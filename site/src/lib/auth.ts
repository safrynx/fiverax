import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { db, stmt } from "./db";
import { decodeSession, isSessionActive, sessionCookieName } from "./session";
import { hasPanelAccessIn, isPlatformOwner, isServerOwnerIn, loadConfig, permissionsIn, resolveGradeIn } from "./config";
import { betaAllows } from "./beta";
import { getPlatformSettings } from "./platform";
import { getServer, listServers, type Server } from "./servers";
import type { Permission } from "./permissions";
import type { Identity, SessionUser } from "./types";

/**
 * Two levels:
 * - the identity, read from the session cookie (who is logged in);
 * - the user as seen by one server (roles, grade, permissions there), rebuilt on every request from the database,
 *   so a role removed on Discord revokes access without waiting for the cookie to expire.
 *
 * Roles of a server come from its synced staff row (kept fresh by the bot), else from the login-time
 * lookup cached in member_roles (people who access the panel through a role without being staff).
 */

export async function getIdentity(): Promise<Identity | null> {
  const store = await cookies();
  const payload = decodeSession(store.get(sessionCookieName)?.value);
  // The signature proves who the cookie claims to be; the session row says it is still open (logout, ban, admin).
  if (!payload || !(await isSessionActive(payload))) return null;
  return { discordId: payload.discordId, username: payload.username, avatarUrl: payload.avatarUrl };
}

function parseRoles(raw: string | null | undefined): string[] {
  try {
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

type StaffRow = { server_id: string; grade: string; grade_level: number; roles_json: string; left_guild_at: string | null; last_synced_at: string | null };

/** The user's Discord roles on every server we know something about. */
async function rolesByServer(discordId: string): Promise<{ roles: Map<string, string[]>; staff: Map<string, StaffRow> }> {
  const [staffRows, cached] = await db.batch(
    [
      stmt("SELECT server_id, grade, grade_level, roles_json, left_guild_at, last_synced_at FROM staff_members WHERE discord_id = ?", [discordId]),
      stmt("SELECT server_id, roles_json FROM member_roles WHERE discord_id = ?", [discordId])
    ],
    "read"
  );
  const roles = new Map<string, string[]>();
  for (const row of cached.rows) roles.set(String(row.server_id), parseRoles(row.roles_json as string));
  const staff = new Map<string, StaffRow>();
  for (const row of staffRows.rows as unknown as StaffRow[]) {
    staff.set(row.server_id, row);
    if (row.left_guild_at) roles.set(row.server_id, []);
    else if (row.last_synced_at) roles.set(row.server_id, parseRoles(row.roles_json));
  }
  return { roles, staff };
}

/** Build the per-server user, or null when they have no access to that server. */
async function userFor(identity: Identity, serverId: string, roles: string[], staff: StaffRow | undefined): Promise<SessionUser | null> {
  const cfg = await loadConfig(serverId);
  if (!hasPanelAccessIn(cfg, identity.discordId, roles)) return null;
  const grade = resolveGradeIn(cfg, roles);
  return {
    ...identity,
    serverId,
    owner: isServerOwnerIn(cfg, identity.discordId),
    platformOwner: isPlatformOwner(identity.discordId),
    roles,
    permissions: permissionsIn(cfg, identity.discordId, roles),
    grade: staff?.grade ?? grade?.grade ?? "Membre",
    gradeLevel: staff?.grade_level ?? grade?.gradeLevel ?? 0
  };
}

/** The logged-in user on one server, or null (not logged in, or no access to that server). */
export async function getSessionUser(serverId: string): Promise<SessionUser | null> {
  const identity = await getIdentity();
  if (!identity) return null;
  const { roles, staff } = await rolesByServer(identity.discordId);
  return userFor(identity, serverId, roles.get(serverId) ?? [], staff.get(serverId));
}

/** Servers this identity may open (platform owners: all of them). */
export async function listAccessibleServers(identity: Identity): Promise<Server[]> {
  const servers = await listServers();
  if (isPlatformOwner(identity.discordId)) return servers;
  const { roles, staff } = await rolesByServer(identity.discordId);
  const out: Server[] = [];
  for (const server of servers) {
    if (await userFor(identity, server.id, roles.get(server.id) ?? [], staff.get(server.id))) out.push(server);
  }
  return out;
}

export function isOwner(user: SessionUser): boolean {
  return user.owner;
}

/** Management level in the server's grade ladder (0 = no managed grade). */
export async function getActorLevel(user: SessionUser): Promise<number> {
  return resolveGradeIn(await loadConfig(user.serverId), user.roles)?.gradeLevel ?? 0;
}

export function can(user: SessionUser, permission: Permission): boolean {
  return user.permissions.includes(permission);
}

type ApiGuard = { user: SessionUser; server: Server } | { error: NextResponse };

/** The panel is in maintenance for this account (platform admins always get in): its message, else null. */
async function maintenanceFor(identity: Identity): Promise<{ message: string } | null> {
  if (isPlatformOwner(identity.discordId)) return null;
  const { maintenance } = await getPlatformSettings();
  return maintenance.active ? { message: maintenance.message } : null;
}

/** API guard: a user with access to the server, or a ready-made 401/403/404/503 response. */
export async function requireStaffApi(serverId: string): Promise<ApiGuard> {
  const identity = await getIdentity();
  if (!identity) return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  const maintenance = await maintenanceFor(identity);
  if (maintenance) return { error: NextResponse.json({ error: "maintenance", message: maintenance.message || null }, { status: 503 }) };
  const server = await getServer(serverId);
  if (!server) return { error: NextResponse.json({ error: "unknown_server" }, { status: 404 }) };
  if (server.suspended && !isPlatformOwner(identity.discordId)) return { error: NextResponse.json({ error: "server_suspended" }, { status: 403 }) };
  if (!(await betaAllows(identity.discordId, server.id))) return { error: NextResponse.json({ error: "beta_closed" }, { status: 403 }) };
  const user = await getSessionUser(serverId);
  if (!user) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { user, server };
}

/** API guard: access to the server and `permission` on it. */
export async function requirePermissionApi(serverId: string, permission: Permission): Promise<ApiGuard> {
  const guard = await requireStaffApi(serverId);
  if ("error" in guard) return guard;
  if (!can(guard.user, permission)) {
    return { error: NextResponse.json({ error: "forbidden_permission", permission }, { status: 403 }) };
  }
  return guard;
}

/** API guard for the server's access page: its owners only. */
export async function requireOwnerApi(serverId: string): Promise<ApiGuard> {
  const guard = await requireStaffApi(serverId);
  if ("error" in guard) return guard;
  if (!isOwner(guard.user)) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return guard;
}

/** API guard for platform-level actions (creating servers): platform owners only. */
export async function requirePlatformOwnerApi(): Promise<{ identity: Identity } | { error: NextResponse }> {
  const identity = await getIdentity();
  if (!identity) return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  if (!isPlatformOwner(identity.discordId)) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  return { identity };
}

/** API guard for the panel itself outside a server (creating a server): logged in, panel not in maintenance. */
export async function requireIdentityApi(): Promise<{ identity: Identity } | { error: NextResponse }> {
  const identity = await getIdentity();
  if (!identity) return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  const maintenance = await maintenanceFor(identity);
  if (maintenance) return { error: NextResponse.json({ error: "maintenance", message: maintenance.message || null }, { status: 503 }) };
  return { identity };
}

/** Page guard: logged in (any server, or none yet), panel not in maintenance. */
export async function requireIdentityPage(): Promise<Identity> {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  if (await maintenanceFor(identity)) redirect("/maintenance");
  return identity;
}

/** Page guard of the platform administration (/admin): platform owners only; anyone else gets a plain 404. */
export async function requirePlatformAdminPage(): Promise<Identity> {
  const identity = await getIdentity();
  if (!identity) redirect("/login");
  if (!isPlatformOwner(identity.discordId)) notFound();
  return identity;
}

/** Page guard: unknown server -> 404, suspended or no access -> back to the server list. */
export async function requireStaffPage(serverId: string): Promise<{ user: SessionUser; server: Server }> {
  const identity = await requireIdentityPage();
  const server = await getServer(serverId);
  if (!server) notFound();
  if (server.suspended && !isPlatformOwner(identity.discordId)) redirect("/servers?error=suspended");
  if (!(await betaAllows(identity.discordId, server.id))) redirect("/servers?error=beta");
  const user = await getSessionUser(serverId);
  if (!user) redirect("/servers?error=forbidden");
  return { user, server };
}

/** Page guard: users without `permission` go back to the server's dashboard. */
export async function requirePermissionPage(serverId: string, permission: Permission): Promise<{ user: SessionUser; server: Server }> {
  const page = await requireStaffPage(serverId);
  if (!can(page.user, permission)) redirect(`/s/${serverId}`);
  return page;
}

export async function requireOwnerPage(serverId: string): Promise<{ user: SessionUser; server: Server }> {
  const page = await requireStaffPage(serverId);
  if (!isOwner(page.user)) redirect(`/s/${serverId}`);
  return page;
}
