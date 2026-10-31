import { z } from "zod";
import { auditStmt } from "./audit";
import { db, stmt, type Stmt } from "./db";
import { ingestFivemEvent } from "./fivem";
import type { Permission } from "./permissions";
import { sendAnticheatAlert } from "./alerts";
import { activeBansForAgent, banExpiry, banPlayer, countStrikes, getSecuritySettings, hasActiveBan, recordDetection, SYSTEM_ACTOR } from "./security";
import { getServer } from "./servers";
import { AC_ACTIONS, detectionLabel, type AnticheatSettings } from "./security-config";
import { isFilePath, LIMITS, RESOURCE_RE } from "./studio-shared";

/**
 * Two-way FiveM agent (resource `fiverax_agent`).
 *
 * The agent calls POST /api/fivem/agent every few seconds with its server's token. Each call carries what happened
 * since the previous one (players joining / leaving, console lines, results of the actions it ran) and, now and then,
 * a snapshot of the server (players, resources). The answer holds the actions queued from the panel and the delay
 * before the next call. Polling works on any host (Vercel included): the agent opens the connection, never the site.
 *
 * Players are identified by their Rockstar license (stable across names and Discord accounts). IP identifiers are
 * never stored; hardware tokens are, as bans match on them.
 *
 * Security: the agent sends the security rev it knows (`secRev`); when it is stale the answer carries the anticheat
 * settings and the active bans. Detections come as events; a "ban" detection bans the player here.
 */

/** Lua's json.encode turns an empty table into `{}`: accept it as an empty list. */
const list = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z.preprocess(
    (v) => (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0 ? [] : v ?? []),
    z.array(item).max(max)
  );

const session = z.string().min(1).max(128);
const timestamp = z.number().positive().transform(Math.floor);

export const agentRequestSchema = z.object({
  version: z.string().max(20).optional(),
  /** First call after the resource started: sessions still open from a previous run are closed. */
  boot: z.boolean().optional(),
  /** Security rev the agent has loaded (0: none yet). */
  secRev: z.number().int().nonnegative().optional(),
  events: list(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("join"), session, name: z.string().max(100), identifiers: list(z.string().max(120), 30),
        tokens: list(z.string().max(200), 30).optional(), timestamp
      }),
      z.object({ type: z.literal("leave"), session, reason: z.string().max(200).optional(), timestamp }),
      z.object({
        type: z.literal("detection"), session: session.optional(), name: z.string().max(100), kind: z.string().regex(/^[a-z_]{2,40}$/),
        action: z.enum(AC_ACTIONS), details: z.record(z.string(), z.unknown()).optional(),
        /** Where it happened, for the map. */
        pos: z.array(z.number()).length(3).optional(),
        timestamp
      }),
      /** A connection the agent refused (ban, server locked, missing account, name). */
      z.object({ type: z.literal("refused"), name: z.string().max(100), reason: z.string().max(300), identifiers: list(z.string().max(120), 30), timestamp })
    ]),
    300
  ),
  state: z
    .object({
      hostname: z.string().max(300),
      maxClients: z.number().int().nonnegative(),
      uptime: z.number().nonnegative().transform(Math.floor),
      build: z.string().max(40).optional(),
      players: list(
        z.object({
          id: z.number().int(),
          name: z.string().max(100),
          session: session.optional(),
          ping: z.number().transform(Math.floor),
          /** Position [x, y, z] and heading, for the map. */
          pos: z.array(z.number()).length(3).optional(),
          heading: z.number().optional(),
          vehicle: z.string().max(60).optional(),
          health: z.number().optional(),
          armour: z.number().optional(),
          /** Voice: talking now, radio frequency and call channel (pma-voice). */
          talking: z.boolean().optional(),
          radio: z.number().optional(),
          call: z.number().optional(),
          zone: z.string().max(80).optional()
        }),
        2048
      ),
      resources: list(z.object({ name: z.string().max(100), state: z.string().max(20) }), 3000)
    })
    .optional(),
  console: list(z.object({ channel: z.string().max(60).optional(), message: z.string().max(4000) }), 500),
  results: list(z.object({ id: z.number().int().positive(), ok: z.boolean(), message: z.string().max(2000).optional() }), 100)
});

export type AgentRequest = z.infer<typeof agentRequestSchema>;
export type AgentCommand = { id: number; kind: CommandKind; payload: Record<string, unknown> };
export type AgentSecurity = { rev: number; anticheat: AnticheatSettings; bans: Awaited<ReturnType<typeof activeBansForAgent>> };
/** `watch`: someone looks at the live pages, send a snapshot on every call (map, voice). */
export type AgentResponse = { ok: true; commands: AgentCommand[]; interval: number; watch: boolean; security?: AgentSecurity };

/** The agent is "online" while it called less than this long ago (its slowest pace is IDLE_INTERVAL). */
export const ONLINE_MS = 30_000;
/** Poll pace in seconds: fast while someone watches the live pages, slow otherwise. */
const FAST_INTERVAL = 2;
const IDLE_INTERVAL = 8;
const WATCH_MS = 60_000;
/** A queued action the agent did not pick up in time is dropped (the server was off): it must not run hours later. */
const PENDING_TTL_MS = 2 * 60_000;
/** A picked-up action with no result after this is shown as lost. */
const SENT_TTL_MS = 60_000;
const CONSOLE_KEEP = 1000;

const iso = (d: Date) => d.toISOString();
const sessionKey = (serverId: string, session: string) => `${serverId}:${session}`;
const secondsBetween = (from: string, to: Date) => Math.max(0, Math.floor((to.getTime() - new Date(from).getTime()) / 1000));

/** The license identifies a player; the Discord id links them to the staff. IP addresses are dropped. */
export function parseIdentifiers(raw: string[]): { license: string | null; discordId: string | null; kept: string[] } {
  const kept = raw.filter((id) => /^[a-z0-9]+:/i.test(id) && !id.startsWith("ip:"));
  const license = kept.find((id) => id.startsWith("license:")) ?? kept.find((id) => id.startsWith("license2:")) ?? kept[0] ?? null;
  const discord = kept.find((id) => id.startsWith("discord:"))?.slice(8) ?? null;
  return { license, discordId: discord && /^\d{17,20}$/.test(discord) ? discord : null, kept };
}

/** Close a server's sessions left open by a previous run of the agent (server restart, crash). */
async function closeOpenSessions(serverId: string, now: Date): Promise<void> {
  const [players, staff] = await db.batch(
    [
      stmt("SELECT id, started_at FROM player_sessions WHERE server_id = ? AND ended_at IS NULL", [serverId]),
      stmt("SELECT id, started_at FROM activity_sessions WHERE server_id = ? AND source = 'fivem' AND origin = 'fivem_agent' AND ended_at IS NULL", [serverId])
    ],
    "read"
  );
  const close = (table: string) => (row: Record<string, unknown>) =>
    stmt(`UPDATE ${table} SET ended_at = ?, seconds = ? WHERE id = ?`, [iso(now), secondsBetween(String(row.started_at), now), Number(row.id)]);
  await db.batch([...players.rows.map(close("player_sessions")), ...staff.rows.map(close("activity_sessions"))]);
}

async function playerJoined(serverId: string, e: Extract<AgentRequest["events"][number], { type: "join" }>): Promise<void> {
  const { license, discordId, kept } = parseIdentifiers(e.identifiers);
  if (!license) return;
  const at = iso(new Date(e.timestamp * 1000));
  const row = await db.get<{ id: number }>(
    `INSERT INTO players (server_id, license, name, discord_id, identifiers_json, tokens_json, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (server_id, license) DO UPDATE SET name = excluded.name, discord_id = COALESCE(excluded.discord_id, players.discord_id),
       identifiers_json = excluded.identifiers_json,
       tokens_json = CASE WHEN excluded.tokens_json = '[]' THEN players.tokens_json ELSE excluded.tokens_json END,
       last_seen_at = excluded.last_seen_at
     RETURNING id`,
    [serverId, license, e.name || "?", discordId, JSON.stringify(kept), JSON.stringify(e.tokens ?? []), at, at]
  );
  if (!row) return;
  await db.run("INSERT OR IGNORE INTO player_sessions (server_id, player_id, external_id, started_at) VALUES (?, ?, ?, ?)", [
    serverId, row.id, sessionKey(serverId, e.session), at
  ]);
  // Staff members also get their playtime counted on the staff pages (ignored for other players).
  if (discordId) await ingestFivemEvent(serverId, { event: "session_start", discordId, playerName: e.name, sessionId: e.session, timestamp: e.timestamp });
}

async function playerLeft(serverId: string, e: Extract<AgentRequest["events"][number], { type: "leave" }>): Promise<void> {
  const open = await db.get<{ id: number; player_id: number; started_at: string; discord_id: string | null }>(
    `SELECT s.id, s.player_id, s.started_at, p.discord_id FROM player_sessions s JOIN players p ON p.id = s.player_id
     WHERE s.external_id = ? AND s.ended_at IS NULL`,
    [sessionKey(serverId, e.session)]
  );
  if (!open) return;
  const end = new Date(e.timestamp * 1000);
  await db.batch([
    stmt("UPDATE player_sessions SET ended_at = ?, seconds = ?, leave_reason = ? WHERE id = ?", [iso(end), secondsBetween(open.started_at, end), e.reason ?? null, open.id]),
    stmt("UPDATE players SET last_seen_at = ? WHERE id = ?", [iso(end), open.player_id])
  ]);
  if (open.discord_id) await ingestFivemEvent(serverId, { event: "session_end", discordId: open.discord_id, sessionId: e.session, timestamp: e.timestamp });
}

/** The player of an agent session (null when the join was never reported). */
export async function playerOfSession(serverId: string, session: string | undefined): Promise<number | null> {
  if (!session) return null;
  const row = await db.get<{ player_id: number }>("SELECT player_id FROM player_sessions WHERE external_id = ?", [sessionKey(serverId, session)]);
  return row?.player_id ?? null;
}

const playerUrl = (serverId: string, playerId: number | null) =>
  playerId ? `${(process.env.APP_URL || "").replace(/\/+$/, "")}/s/${serverId}/players/${playerId}` : null;

/**
 * A detection from the agent: recorded (a "ban" one bans the player), escalated when the player's detections add
 * up (settings "strikes"), and posted to the alert webhook.
 */
async function detected(serverId: string, e: Extract<AgentRequest["events"][number], { type: "detection" }>, settings: AnticheatSettings): Promise<void> {
  const playerId = await playerOfSession(serverId, e.session);
  const at = new Date(e.timestamp * 1000);
  const details = { ...(e.details ?? {}), ...(e.pos ? { pos: e.pos.map((v) => Math.round(v)) } : {}) };
  await recordDetection(serverId, { playerId, playerName: e.name || "?", kind: e.kind, details, action: e.action }, at, {
    source: "anticheat", reason: `Anticheat : ${detectionLabel(e.kind)}`, expiresAt: banExpiry(settings.banHours, at)
  });
  let action: "log" | "kick" | "ban" = e.action === "off" ? "log" : e.action;
  let note: string | null = null;

  const { strikes } = settings;
  if (strikes.enabled && playerId && e.action !== "ban") {
    const count = await countStrikes(serverId, playerId, strikes.windowHours, at);
    const escalate = strikes.banAt > 0 && count >= strikes.banAt ? "ban" : strikes.kickAt > 0 && count === strikes.kickAt ? "kick" : null;
    if (escalate === "ban" && !(await hasActiveBan(serverId, playerId, at))) {
      await banPlayer(serverId, SYSTEM_ACTOR, { playerId, reason: `Anticheat : ${count} détections en ${strikes.windowHours} h`, source: "anticheat", expiresAt: banExpiry(settings.banHours, at) }, at);
    }
    if (escalate) {
      action = escalate;
      note = `Cumul : ${count} détections en ${strikes.windowHours} h → ${escalate === "ban" ? "ban" : "kick"}`;
      const live = await getLiveState(serverId);
      const target = live.players.find((p) => p.playerId === playerId);
      if (target) {
        const reason = escalate === "ban" ? settings.banMessage : `Anticheat : ${count} détections en ${strikes.windowHours} h.`;
        await enqueueCommand(serverId, SYSTEM_ACTOR, "kick", { target: target.id, reason }, { playerName: target.name, targetDiscordId: target.discordId });
      }
    }
  }
  const server = await getServer(serverId);
  await sendAnticheatAlert(settings, server?.name ?? serverId, { kind: e.kind, action, playerName: e.name || "?", details, url: playerUrl(serverId, playerId), note });
}

async function refused(serverId: string, e: Extract<AgentRequest["events"][number], { type: "refused" }>): Promise<void> {
  const { license } = parseIdentifiers(e.identifiers);
  const player = license ? await db.get<{ id: number }>("SELECT id FROM players WHERE server_id = ? AND license = ?", [serverId, license]) : undefined;
  await recordDetection(serverId, {
    playerId: player?.id ?? null, playerName: e.name || "?", kind: "connection_refused", details: { reason: e.reason, license: license ?? undefined }, action: "log"
  }, new Date(e.timestamp * 1000));
}

/** Handle one call of a server's agent and hand it the queued actions. */
export async function handleAgentCall(serverId: string, req: AgentRequest, now = new Date()): Promise<AgentResponse> {
  if (req.boot) await closeOpenSessions(serverId, now);
  const anticheat = req.events.some((e) => e.type === "detection") ? (await getSecuritySettings(serverId)).anticheat : null;
  for (const e of req.events) {
    if (e.type === "join") await playerJoined(serverId, e);
    else if (e.type === "leave") await playerLeft(serverId, e);
    else if (e.type === "refused") await refused(serverId, e);
    else await detected(serverId, e, anticheat as AnticheatSettings);
  }

  const writes: Stmt[] = [
    req.state
      ? stmt(
          `INSERT INTO fivem_state (server_id, seen_at, state_json, state_at, agent_version) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (server_id) DO UPDATE SET seen_at = excluded.seen_at, state_json = excluded.state_json, state_at = excluded.state_at,
             agent_version = COALESCE(excluded.agent_version, fivem_state.agent_version)`,
          [serverId, iso(now), JSON.stringify(req.state), iso(now), req.version ?? null]
        )
      : stmt(
          `INSERT INTO fivem_state (server_id, seen_at, agent_version) VALUES (?, ?, ?)
           ON CONFLICT (server_id) DO UPDATE SET seen_at = excluded.seen_at, agent_version = COALESCE(excluded.agent_version, fivem_state.agent_version)`,
          [serverId, iso(now), req.version ?? null]
        ),
    ...req.console.map((line) => stmt("INSERT INTO fivem_console (server_id, at, channel, message) VALUES (?, ?, ?, ?)", [serverId, iso(now), line.channel ?? null, line.message])),
    ...req.results.map((r) =>
      stmt("UPDATE fivem_commands SET status = ?, result = ?, done_at = ? WHERE id = ? AND server_id = ? AND status = 'sent'", [
        r.ok ? "done" : "failed", r.message ?? null, iso(now), r.id, serverId
      ])
    ),
    stmt("UPDATE fivem_commands SET status = 'expired' WHERE server_id = ? AND status = 'pending' AND created_at < ?", [serverId, iso(new Date(now.getTime() - PENDING_TTL_MS))])
  ];
  if (req.console.length) {
    writes.push(
      stmt(
        `DELETE FROM fivem_console WHERE server_id = ? AND id <= (SELECT id FROM fivem_console WHERE server_id = ? ORDER BY id DESC LIMIT 1 OFFSET ${CONSOLE_KEEP})`,
        [serverId, serverId]
      )
    );
  }
  writes.push(
    stmt("UPDATE fivem_commands SET status = 'sent', sent_at = ? WHERE server_id = ? AND status = 'pending' RETURNING id, kind, payload", [iso(now), serverId]),
    stmt("SELECT watched_at FROM fivem_state WHERE server_id = ?", [serverId]),
    stmt("SELECT rev FROM security_settings WHERE server_id = ?", [serverId])
  );
  const results = await db.batch(writes);
  const claimed = results[results.length - 3].rows;
  const watchedAt = results[results.length - 2].rows[0]?.watched_at as string | null | undefined;
  const rev = Number(results[results.length - 1].rows[0]?.rev ?? 1);

  const commands = claimed
    .map((row) => ({ id: Number(row.id), kind: row.kind as CommandKind, payload: JSON.parse(String(row.payload)) as Record<string, unknown> }))
    .sort((a, b) => a.id - b.id);
  const watched = Boolean(watchedAt && now.getTime() - new Date(watchedAt).getTime() < WATCH_MS);
  const response: AgentResponse = { ok: true, commands, interval: watched || commands.length ? FAST_INTERVAL : IDLE_INTERVAL, watch: watched };
  if (req.secRev !== rev) {
    const [settings, bans] = await Promise.all([getSecuritySettings(serverId), activeBansForAgent(serverId, now)]);
    response.security = { rev: settings.rev, anticheat: settings.anticheat, bans };
  }
  return response;
}

// ---- actions queued from the panel ----

const target = z.number().int().nonnegative();
const text = (max: number) => z.string().trim().min(1).max(max);

/** Each action, the permission it needs and what it carries. */
export const COMMANDS = {
  kick: { permission: "player_kick", schema: z.object({ target, reason: text(200) }) },
  dm: { permission: "player_message", schema: z.object({ target, message: text(300) }) },
  announce: { permission: "announce", schema: z.object({ message: text(300) }) },
  resource: {
    permission: "resources",
    schema: z.object({ action: z.enum(["start", "stop", "restart"]), name: z.string().regex(/^[\w.\-[\]]{1,100}$/) })
  },
  refresh: { permission: "resources", schema: z.object({}) },
  screenshot: { permission: "screenshot", schema: z.object({ target }) },
  /** Stream the player's screen while the panel watches it. */
  screen: { permission: "screenshot", schema: z.object({ target }) },
  freeze: { permission: "player_kick", schema: z.object({ target, on: z.boolean() }) },
  console: { permission: "console", schema: z.object({ command: text(500) }) },
  /** Start the server audit (audit.js of the agent): it sends its inventory to /api/fivem/agent/audit. */
  audit: { permission: "security_config", schema: z.object({ scanId: z.number().int().positive() }) },
  /** Write a Studio creation into its own resource folder, then (re)start it. Only queued by the studio API. */
  deploy: {
    permission: "studio_deploy",
    schema: z.object({
      resource: z.string().regex(RESOURCE_RE),
      files: z.array(z.object({ path: z.string().refine(isFilePath), content: z.string().max(LIMITS.fileBytes) })).min(1).max(LIMITS.files)
    })
  }
} satisfies Record<string, { permission: Permission; schema: z.ZodTypeAny }>;

export type CommandKind = keyof typeof COMMANDS;
export const isCommandKind = (kind: string): kind is CommandKind => Object.hasOwn(COMMANDS, kind);

const AUDIT_ACTION: Record<CommandKind, string> = {
  kick: "player_kick",
  dm: "player_message",
  announce: "announce",
  resource: "resource",
  refresh: "resource",
  screenshot: "player_screenshot",
  screen: "player_screen",
  freeze: "player_freeze",
  console: "console_command",
  deploy: "studio_deploy",
  audit: "audit_run"
};

type Actor = { discordId: string; username?: string | null };

/**
 * Queue an action for the server's agent (validated payload) and log it. `context` adds what the log needs to be
 * readable (player name, Discord id of the target).
 */
export async function enqueueCommand(
  serverId: string,
  actor: Actor,
  kind: CommandKind,
  payload: Record<string, unknown>,
  context: { playerName?: string | null; targetDiscordId?: string | null } = {}
): Promise<number> {
  const details =
    kind === "refresh" ? { action: "refresh" }
    : kind === "audit" ? {}
    : kind === "deploy" ? { resource: payload.resource, files: Array.isArray(payload.files) ? payload.files.length : 0 }
    : { ...payload, player: context.playerName ?? undefined };
  const [insert] = await db.batch([
    stmt("INSERT INTO fivem_commands (server_id, kind, payload, actor_discord_id, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id", [
      serverId, kind, JSON.stringify(payload), actor.discordId, iso(new Date())
    ]),
    auditStmt(serverId, actor, AUDIT_ACTION[kind], context.targetDiscordId ?? null, details)
  ]);
  return Number(insert.rows[0].id);
}

export type CommandStatus = { id: number; status: "pending" | "sent" | "done" | "failed" | "expired" | "lost"; result: string | null };

export async function getCommandStatus(serverId: string, id: number, now = new Date()): Promise<CommandStatus | null> {
  const row = await db.get<{ id: number; status: CommandStatus["status"]; result: string | null; sent_at: string | null }>(
    "SELECT id, status, result, sent_at FROM fivem_commands WHERE server_id = ? AND id = ?",
    [serverId, id]
  );
  if (!row) return null;
  const lost = row.status === "sent" && row.sent_at && now.getTime() - new Date(row.sent_at).getTime() > SENT_TTL_MS;
  return { id: row.id, status: lost ? "lost" : row.status, result: row.result };
}

// ---- what the panel shows ----

export type LivePlayer = {
  id: number;
  name: string;
  ping: number;
  /** Row in `players` (the player's page), when the agent reported the join. */
  playerId: number | null;
  discordId: string | null;
  connectedAt: string | null;
  staff: { username: string; grade: string } | null;
  pos: [number, number, number] | null;
  heading: number;
  vehicle: string | null;
  health: number | null;
  armour: number | null;
  talking: boolean;
  radio: number | null;
  call: number | null;
  zone: string | null;
};

export type LiveState = {
  /** The agent never called: nothing to show yet. */
  linked: boolean;
  online: boolean;
  seenAt: string | null;
  stateAt: string | null;
  agentVersion: string | null;
  hostname: string | null;
  maxClients: number;
  uptime: number;
  build: string | null;
  players: LivePlayer[];
  resources: { name: string; state: string }[];
};

type StoredState = NonNullable<AgentRequest["state"]>;

/**
 * The server as last reported by its agent, players matched with their page and with the staff.
 * `watch` speeds up the agent for a minute (someone is looking at the live pages).
 */
export async function getLiveState(serverId: string, opts: { watch?: boolean } = {}, now = new Date()): Promise<LiveState> {
  const row = await db.get<{ seen_at: string; state_json: string | null; state_at: string | null; agent_version: string | null; watched_at: string | null }>(
    "SELECT seen_at, state_json, state_at, agent_version, watched_at FROM fivem_state WHERE server_id = ?",
    [serverId]
  );
  // Throttled: one write every 20 s at most, however many people have the page open.
  if (opts.watch && row && (!row.watched_at || now.getTime() - new Date(row.watched_at).getTime() > 20_000)) {
    await db.run("UPDATE fivem_state SET watched_at = ? WHERE server_id = ?", [iso(now), serverId]);
  }
  const online = Boolean(row && now.getTime() - new Date(row.seen_at).getTime() < ONLINE_MS);
  let state: StoredState | null = null;
  try {
    state = row?.state_json ? (JSON.parse(row.state_json) as StoredState) : null;
  } catch { /* corrupt snapshot: treat as none */ }

  const sessions = (state?.players ?? []).map((p) => p.session).filter((s): s is string => Boolean(s));
  const known = new Map<string, { player_id: number; started_at: string; discord_id: string | null; username: string | null; grade: string | null }>();
  if (online && sessions.length) {
    const rows = await db.all<{ external_id: string; player_id: number; started_at: string; discord_id: string | null; username: string | null; grade: string | null }>(
      `SELECT s.external_id, s.player_id, s.started_at, p.discord_id, st.username, st.grade
       FROM player_sessions s JOIN players p ON p.id = s.player_id
       LEFT JOIN staff_members st ON st.server_id = p.server_id AND st.discord_id = p.discord_id AND st.left_guild_at IS NULL
       WHERE s.server_id = ? AND s.ended_at IS NULL`,
      [serverId]
    );
    for (const r of rows) known.set(r.external_id, r);
  }

  const players: LivePlayer[] = online
    ? (state?.players ?? []).map((p) => {
        const k = p.session ? known.get(sessionKey(serverId, p.session)) : undefined;
        return {
          id: p.id,
          name: p.name,
          ping: p.ping,
          playerId: k?.player_id ?? null,
          discordId: k?.discord_id ?? null,
          connectedAt: k?.started_at ?? null,
          staff: k?.username ? { username: k.username, grade: k.grade ?? "" } : null,
          pos: p.pos ? [p.pos[0], p.pos[1], p.pos[2]] : null,
          heading: p.heading ?? 0,
          vehicle: p.vehicle || null,
          health: p.health ?? null,
          armour: p.armour ?? null,
          talking: Boolean(p.talking),
          radio: p.radio || null,
          call: p.call || null,
          zone: p.zone || null
        };
      })
    : [];

  return {
    linked: Boolean(row),
    online,
    seenAt: row?.seen_at ?? null,
    stateAt: row?.state_at ?? null,
    agentVersion: row?.agent_version ?? null,
    hostname: state?.hostname ?? null,
    maxClients: state?.maxClients ?? 0,
    uptime: state?.uptime ?? 0,
    build: state?.build ?? null,
    players: players.sort((a, b) => a.id - b.id),
    resources: [...(state?.resources ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  };
}

export type ConsoleLine = { id: number; at: string; channel: string | null; message: string };

/** Console lines after `afterId` (the newest `limit` ones when starting). */
export async function getConsole(serverId: string, afterId = 0, limit = 300): Promise<ConsoleLine[]> {
  const rows = await db.all<ConsoleLine>(
    "SELECT id, at, channel, message FROM fivem_console WHERE server_id = ? AND id > ? ORDER BY id DESC LIMIT ?",
    [serverId, afterId, limit]
  );
  return rows.reverse();
}

/** Close player sessions (all servers) still open long after their agent went silent. Called by the maintenance. */
export async function closeStalePlayerSessions(maxSeconds: number, now = new Date()): Promise<number> {
  const cutoff = iso(new Date(now.getTime() - maxSeconds * 1000));
  const rows = await db.all<{ id: number; started_at: string; seen_at: string | null }>(
    `SELECT s.id, s.started_at, f.seen_at FROM player_sessions s LEFT JOIN fivem_state f ON f.server_id = s.server_id
     WHERE s.ended_at IS NULL AND (s.started_at <= ? OR f.seen_at IS NULL OR f.seen_at <= ?)`,
    [cutoff, iso(new Date(now.getTime() - 10 * 60_000))]
  );
  await db.batch(rows.map((r) => {
    // Ends at the agent's last call (the player cannot have played after it), capped at maxSeconds.
    const lastSign = r.seen_at && r.seen_at > r.started_at ? new Date(r.seen_at) : now;
    const seconds = Math.min(maxSeconds, secondsBetween(r.started_at, lastSign));
    return stmt("UPDATE player_sessions SET ended_at = ?, seconds = ? WHERE id = ?", [iso(new Date(new Date(r.started_at).getTime() + seconds * 1000)), seconds, r.id]);
  }));
  return rows.length;
}
