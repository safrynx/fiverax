import type { Client } from "@libsql/client";

/**
 * Retro-compatible schema migrations for the GTASUN staff manager.
 * Each migration runs once, tracked in a `schema_migrations` table.
 * Never drop or rename existing columns. When a constraint must change, rebuild the table
 * (create _v2, copy every row, drop, rename) inside the same migration so it stays atomic.
 */
const migrations: { name: string; sql: string }[] = [
  {
    name: "001_base_tables",
    sql: `
      CREATE TABLE IF NOT EXISTS staff_members (
        id TEXT PRIMARY KEY,
        discord_id TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL,
        avatar_url TEXT,
        grade TEXT NOT NULL DEFAULT 'Helper',
        grade_level INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS activity_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('discord_voice', 'fivem')),
        started_at TEXT NOT NULL,
        ended_at TEXT,
        seconds INTEGER NOT NULL DEFAULT 0,
        external_session_id TEXT UNIQUE
      );
      CREATE INDEX IF NOT EXISTS idx_activity_member_source ON activity_sessions(discord_id, source);
      CREATE TABLE IF NOT EXISTS staff_badges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT NOT NULL,
        color TEXT NOT NULL CHECK(color IN ('red','yellow','green','blue')),
        reason TEXT NOT NULL,
        author_discord_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        resolved_at TEXT
      );
      CREATE TABLE IF NOT EXISTS staff_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT NOT NULL,
        body TEXT NOT NULL,
        author_discord_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS grade_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT NOT NULL,
        old_grade TEXT NOT NULL,
        new_grade TEXT NOT NULL,
        actor_discord_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_discord_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target_discord_id TEXT,
        details TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `
  },
  {
    name: "002_voice_sessions",
    sql: `
      CREATE TABLE IF NOT EXISTS voice_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        seconds INTEGER NOT NULL DEFAULT 0,
        reconciled INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_voice_member_open ON voice_sessions(discord_id, ended_at);
      CREATE INDEX IF NOT EXISTS idx_voice_started ON voice_sessions(started_at);
    `
  },
  {
    name: "003_staff_member_extensions",
    sql: `
      ALTER TABLE staff_members ADD COLUMN guild_joined_at TEXT;
      ALTER TABLE staff_members ADD COLUMN left_guild_at TEXT;
      ALTER TABLE staff_members ADD COLUMN roles_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE staff_members ADD COLUMN last_synced_at TEXT;
    `
  },
  {
    name: "004_sessions_origin",
    sql: `
      ALTER TABLE activity_sessions ADD COLUMN origin TEXT NOT NULL DEFAULT 'unknown';
    `
  },
  {
    name: "005_oauth_states",
    sql: `
      CREATE TABLE IF NOT EXISTS oauth_states (
        state TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `
  },
  {
    name: "006_lookup_indexes",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_badges_member ON staff_badges(discord_id, status);
      CREATE INDEX IF NOT EXISTS idx_notes_member ON staff_notes(discord_id);
      CREATE INDEX IF NOT EXISTS idx_grade_history_member ON grade_history(discord_id);
    `
  },
  {
    name: "007_panel_access",
    sql: `
      CREATE TABLE IF NOT EXISTS panel_access (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK(kind IN ('user','role')),
        discord_id TEXT NOT NULL,
        label TEXT,
        added_by TEXT NOT NULL DEFAULT 'system',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(kind, discord_id)
      );
      INSERT OR IGNORE INTO panel_access (kind, discord_id, label) VALUES
        ('role', '1557788967414407229', 'Rôle initial'),
        ('role', '1557788898497659012', 'Rôle initial'),
        ('user', '1243884102407422024', 'Accès initial'),
        ('user', '1130169424905785354', 'Accès initial');
    `
  },
  {
    name: "008_roles_warnings_playtime",
    sql: `
      CREATE TABLE IF NOT EXISTS discord_roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        color INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS grade_roles (
        role_id TEXT PRIMARY KEY
      );
      CREATE TABLE IF NOT EXISTS warn_roles (
        level INTEGER PRIMARY KEY CHECK(level BETWEEN 1 AND 3),
        role_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS warnings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT NOT NULL,
        level INTEGER NOT NULL,
        reason TEXT NOT NULL,
        author_discord_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        removed_at TEXT,
        removed_by TEXT,
        removed_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_warnings_member ON warnings(discord_id, removed_at);
      CREATE TABLE IF NOT EXISTS playtime_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT NOT NULL,
        seconds INTEGER NOT NULL,
        taken_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_member ON playtime_snapshots(discord_id, taken_at);
    `
  },
  {
    name: "009_bot_status_note_authors",
    sql: `
      CREATE TABLE IF NOT EXISTS bot_status (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      ALTER TABLE staff_notes ADD COLUMN author_name TEXT;
    `
  },
  {
    name: "010_permissions_log_names",
    sql: `
      ALTER TABLE panel_access ADD COLUMN permissions TEXT;
      UPDATE panel_access SET permissions = '["view_report","rank_up","rank_down","rank_demote","set_grade","warn_add","warn_remove","comment","badges","sync"]';
      ALTER TABLE audit_log ADD COLUMN actor_name TEXT;
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(id DESC);
    `
  },
  {
    name: "011_weekly_reviews",
    sql: `
      CREATE TABLE IF NOT EXISTS weekly_reviews (
        week_start TEXT NOT NULL,
        discord_id TEXT NOT NULL,
        rating TEXT NOT NULL CHECK(rating IN ('red','yellow','green','blue')),
        summary TEXT NOT NULL,
        comments_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (week_start, discord_id)
      );
    `
  },
  {
    name: "012_playtime_totals",
    sql: `
      CREATE TABLE IF NOT EXISTS playtime_totals (
        discord_id TEXT PRIMARY KEY,
        seconds INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
    `
  },
  {
    // Multi-server: every row belongs to a server (one Discord guild + one FiveM server).
    // Existing data goes to the "default" server. Tables whose uniqueness must include the server are rebuilt
    // (SQLite cannot change a constraint in place); the others just gain a column.
    name: "013_multi_server",
    sql: `
      CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        guild_id TEXT UNIQUE,
        timezone TEXT,
        review_hour INTEGER,
        fivem_token_hash TEXT UNIQUE,
        created_by TEXT NOT NULL DEFAULT 'system',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT OR IGNORE INTO servers (id, name) VALUES ('default', 'Serveur principal');
      CREATE TABLE IF NOT EXISTS server_owners (
        server_id TEXT NOT NULL,
        discord_id TEXT NOT NULL,
        added_by TEXT NOT NULL DEFAULT 'system',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (server_id, discord_id)
      );
      CREATE TABLE IF NOT EXISTS member_roles (
        server_id TEXT NOT NULL,
        discord_id TEXT NOT NULL,
        roles_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (server_id, discord_id)
      );

      ALTER TABLE activity_sessions ADD COLUMN server_id TEXT NOT NULL DEFAULT 'default';
      ALTER TABLE staff_badges ADD COLUMN server_id TEXT NOT NULL DEFAULT 'default';
      ALTER TABLE staff_notes ADD COLUMN server_id TEXT NOT NULL DEFAULT 'default';
      ALTER TABLE grade_history ADD COLUMN server_id TEXT NOT NULL DEFAULT 'default';
      ALTER TABLE audit_log ADD COLUMN server_id TEXT NOT NULL DEFAULT 'default';
      ALTER TABLE voice_sessions ADD COLUMN server_id TEXT NOT NULL DEFAULT 'default';
      ALTER TABLE warnings ADD COLUMN server_id TEXT NOT NULL DEFAULT 'default';
      ALTER TABLE playtime_snapshots ADD COLUMN server_id TEXT NOT NULL DEFAULT 'default';
      ALTER TABLE discord_roles ADD COLUMN server_id TEXT NOT NULL DEFAULT 'default';
      ALTER TABLE grade_roles ADD COLUMN server_id TEXT NOT NULL DEFAULT 'default';
      CREATE INDEX IF NOT EXISTS idx_activity_server ON activity_sessions(server_id, discord_id, source);
      CREATE INDEX IF NOT EXISTS idx_badges_server ON staff_badges(server_id, discord_id, status);
      CREATE INDEX IF NOT EXISTS idx_notes_server ON staff_notes(server_id, discord_id);
      CREATE INDEX IF NOT EXISTS idx_grade_history_server ON grade_history(server_id, discord_id);
      CREATE INDEX IF NOT EXISTS idx_audit_server ON audit_log(server_id, id DESC);
      CREATE INDEX IF NOT EXISTS idx_voice_server_open ON voice_sessions(server_id, discord_id, ended_at);
      CREATE INDEX IF NOT EXISTS idx_warnings_server ON warnings(server_id, discord_id, removed_at);
      CREATE INDEX IF NOT EXISTS idx_snapshots_server ON playtime_snapshots(server_id, discord_id, taken_at);
      CREATE INDEX IF NOT EXISTS idx_discord_roles_server ON discord_roles(server_id);
      CREATE INDEX IF NOT EXISTS idx_grade_roles_server ON grade_roles(server_id);

      CREATE TABLE staff_members_v2 (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL DEFAULT 'default',
        discord_id TEXT NOT NULL,
        username TEXT NOT NULL,
        avatar_url TEXT,
        grade TEXT NOT NULL DEFAULT 'Helper',
        grade_level INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        guild_joined_at TEXT,
        left_guild_at TEXT,
        roles_json TEXT NOT NULL DEFAULT '[]',
        last_synced_at TEXT,
        UNIQUE(server_id, discord_id)
      );
      INSERT INTO staff_members_v2 (id, discord_id, username, avatar_url, grade, grade_level, created_at, updated_at, guild_joined_at, left_guild_at, roles_json, last_synced_at)
        SELECT id, discord_id, username, avatar_url, grade, grade_level, created_at, updated_at, guild_joined_at, left_guild_at, roles_json, last_synced_at FROM staff_members;
      DROP TABLE staff_members;
      ALTER TABLE staff_members_v2 RENAME TO staff_members;

      CREATE TABLE panel_access_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT NOT NULL DEFAULT 'default',
        kind TEXT NOT NULL CHECK(kind IN ('user','role')),
        discord_id TEXT NOT NULL,
        label TEXT,
        added_by TEXT NOT NULL DEFAULT 'system',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        permissions TEXT,
        UNIQUE(server_id, kind, discord_id)
      );
      INSERT INTO panel_access_v2 (id, kind, discord_id, label, added_by, created_at, permissions)
        SELECT id, kind, discord_id, label, added_by, created_at, permissions FROM panel_access;
      DROP TABLE panel_access;
      ALTER TABLE panel_access_v2 RENAME TO panel_access;

      CREATE TABLE warn_roles_v2 (
        server_id TEXT NOT NULL DEFAULT 'default',
        level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 3),
        role_id TEXT NOT NULL,
        PRIMARY KEY (server_id, level)
      );
      INSERT INTO warn_roles_v2 (level, role_id) SELECT level, role_id FROM warn_roles;
      DROP TABLE warn_roles;
      ALTER TABLE warn_roles_v2 RENAME TO warn_roles;

      CREATE TABLE weekly_reviews_v2 (
        server_id TEXT NOT NULL DEFAULT 'default',
        week_start TEXT NOT NULL,
        discord_id TEXT NOT NULL,
        rating TEXT NOT NULL CHECK(rating IN ('red','yellow','green','blue')),
        summary TEXT NOT NULL,
        comments_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (server_id, week_start, discord_id)
      );
      INSERT INTO weekly_reviews_v2 (week_start, discord_id, rating, summary, comments_count, created_at)
        SELECT week_start, discord_id, rating, summary, comments_count, created_at FROM weekly_reviews;
      DROP TABLE weekly_reviews;
      ALTER TABLE weekly_reviews_v2 RENAME TO weekly_reviews;

      CREATE TABLE playtime_totals_v2 (
        server_id TEXT NOT NULL DEFAULT 'default',
        discord_id TEXT NOT NULL,
        seconds INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (server_id, discord_id)
      );
      INSERT INTO playtime_totals_v2 (discord_id, seconds, updated_at) SELECT discord_id, seconds, updated_at FROM playtime_totals;
      DROP TABLE playtime_totals;
      ALTER TABLE playtime_totals_v2 RENAME TO playtime_totals;

      UPDATE bot_status SET key = 'default:' || key WHERE key IN ('heartbeat', 'top_role_position', 'counters_reset_at', 'review_done');
      UPDATE activity_sessions SET external_session_id = 'default:' || external_session_id WHERE external_session_id IS NOT NULL;
    `
  },
  {
    // Self-service: the Discord guilds of each user, read at login (OAuth `guilds` scope). `can_manage` = owner,
    // Administrator or Manage Server: only those guilds can be registered as a server by that user.
    name: "014_self_service",
    sql: `
      CREATE TABLE IF NOT EXISTS user_guilds (
        discord_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        name TEXT NOT NULL,
        icon_url TEXT,
        can_manage INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (discord_id, guild_id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_guilds_guild ON user_guilds(guild_id);
      ALTER TABLE servers ADD COLUMN icon_url TEXT;
    `
  },
  {
    // Two-way FiveM agent: live state (one row per server), queue of actions sent from the panel, every player
    // ever seen (not only staff) with their sessions, and the tail of the server console.
    name: "015_fivem_live",
    sql: `
      CREATE TABLE IF NOT EXISTS fivem_state (
        server_id TEXT PRIMARY KEY,
        seen_at TEXT NOT NULL,
        state_json TEXT,
        state_at TEXT,
        agent_version TEXT,
        watched_at TEXT
      );
      CREATE TABLE IF NOT EXISTS fivem_commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        result TEXT,
        actor_discord_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        sent_at TEXT,
        done_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_fivem_commands_queue ON fivem_commands(server_id, status, id);
      CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT NOT NULL,
        license TEXT NOT NULL,
        name TEXT NOT NULL,
        discord_id TEXT,
        identifiers_json TEXT NOT NULL DEFAULT '[]',
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        UNIQUE (server_id, license)
      );
      CREATE INDEX IF NOT EXISTS idx_players_seen ON players(server_id, last_seen_at);
      CREATE INDEX IF NOT EXISTS idx_players_discord ON players(server_id, discord_id);
      CREATE TABLE IF NOT EXISTS player_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT NOT NULL,
        player_id INTEGER NOT NULL,
        external_id TEXT NOT NULL UNIQUE,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        seconds INTEGER NOT NULL DEFAULT 0,
        leave_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_player_sessions_player ON player_sessions(player_id, id);
      CREATE INDEX IF NOT EXISTS idx_player_sessions_open ON player_sessions(server_id, ended_at);
      CREATE TABLE IF NOT EXISTS fivem_console (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT NOT NULL,
        at TEXT NOT NULL,
        channel TEXT,
        message TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fivem_console ON fivem_console(server_id, id)
    `
  },
  {
    // Security: settings of the anticheat (sent to the FiveM agent) and of the Discord anti-raid (sent to the bot),
    // bans enforced by the agent at connection, anticheat detections, screenshots with their AI verdict, and the
    // incidents the bot handled on Discord. `rev` changes on every settings / ban change so the agent reloads.
    name: "016_security",
    sql: `
      CREATE TABLE IF NOT EXISTS security_settings (
        server_id TEXT PRIMARY KEY,
        anticheat_json TEXT,
        antiraid_json TEXT,
        rev INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS bans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT NOT NULL,
        player_id INTEGER,
        name TEXT NOT NULL,
        identifiers_json TEXT NOT NULL DEFAULT '[]',
        tokens_json TEXT NOT NULL DEFAULT '[]',
        reason TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        detection_id INTEGER,
        author_discord_id TEXT,
        author_name TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        revoked_at TEXT,
        revoked_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_bans_server ON bans(server_id, revoked_at, id);
      CREATE INDEX IF NOT EXISTS idx_bans_player ON bans(server_id, player_id);
      CREATE TABLE IF NOT EXISTS ac_detections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT NOT NULL,
        player_id INTEGER,
        player_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}',
        action TEXT NOT NULL,
        screenshot_id INTEGER,
        at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        reviewed_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_ac_detections ON ac_detections(server_id, id);
      CREATE INDEX IF NOT EXISTS idx_ac_detections_player ON ac_detections(server_id, player_id, id);
      CREATE TABLE IF NOT EXISTS ac_screenshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT NOT NULL,
        player_id INTEGER,
        player_name TEXT NOT NULL,
        reason TEXT NOT NULL,
        image BLOB NOT NULL,
        mime TEXT NOT NULL,
        ai_verdict TEXT NOT NULL DEFAULT 'pending',
        ai_score INTEGER,
        ai_summary TEXT,
        requested_by TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ac_screenshots ON ac_screenshots(server_id, id);
      CREATE TABLE IF NOT EXISTS security_incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        actor_id TEXT,
        actor_name TEXT,
        actor_bot INTEGER NOT NULL DEFAULT 0,
        summary TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}',
        actions_json TEXT NOT NULL DEFAULT '[]',
        removed_roles_json TEXT NOT NULL DEFAULT '[]',
        at TEXT NOT NULL,
        restored_at TEXT,
        restored_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_security_incidents ON security_incidents(server_id, id);
      ALTER TABLE players ADD COLUMN tokens_json TEXT NOT NULL DEFAULT '[]'
    `
  },
  {
    // Live screen of a player (latest frame only), actions queued for the Discord bot (lockdown, backups), and the
    // backups of each guild's roles and channels.
    name: "017_security_live",
    sql: `
      CREATE TABLE IF NOT EXISTS screen_frames (
        server_id TEXT NOT NULL,
        target INTEGER NOT NULL,
        player_name TEXT NOT NULL,
        image BLOB,
        mime TEXT,
        at TEXT,
        watched_at TEXT NOT NULL,
        PRIMARY KEY (server_id, target)
      );
      CREATE TABLE IF NOT EXISTS bot_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        result TEXT,
        actor_discord_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        sent_at TEXT,
        done_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_bot_actions_queue ON bot_actions(status, id);
      CREATE TABLE IF NOT EXISTS discord_backups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reason TEXT NOT NULL,
        roles_count INTEGER NOT NULL DEFAULT 0,
        channels_count INTEGER NOT NULL DEFAULT 0,
        members_count INTEGER NOT NULL DEFAULT 0,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_discord_backups ON discord_backups(server_id, id)
    `
  },
  {
    name: "018_studio",
    sql: `
      CREATE TABLE IF NOT EXISTS studio_creations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        resource TEXT NOT NULL,
        framework TEXT NOT NULL DEFAULT 'standalone',
        files_json TEXT NOT NULL DEFAULT '[]',
        data_json TEXT NOT NULL DEFAULT '{}',
        author_discord_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deploy_command_id INTEGER,
        deploy_hash TEXT,
        deployed_at TEXT,
        UNIQUE (server_id, resource)
      );
      CREATE INDEX IF NOT EXISTS idx_studio_creations ON studio_creations(server_id, kind, updated_at);
      CREATE TABLE IF NOT EXISTS studio_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        creation_id INTEGER NOT NULL,
        server_id TEXT NOT NULL,
        source TEXT NOT NULL,
        prompt TEXT,
        summary TEXT,
        files_json TEXT NOT NULL,
        data_json TEXT NOT NULL,
        author_discord_id TEXT NOT NULL,
        author_name TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_studio_versions ON studio_versions(creation_id, id)
    `
  },
  {
    name: "019_server_audit",
    sql: `
      CREATE TABLE IF NOT EXISTS audit_files (
        key TEXT PRIMARY KEY,
        engine INTEGER NOT NULL,
        size INTEGER NOT NULL DEFAULT 0,
        findings_json TEXT NOT NULL DEFAULT '[]',
        events_json TEXT NOT NULL DEFAULT '[]',
        analyzed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_scans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        trigger TEXT NOT NULL DEFAULT 'manual',
        actor_discord_id TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT,
        inventory_json TEXT,
        report_json TEXT,
        score INTEGER,
        critical INTEGER NOT NULL DEFAULT 0,
        high INTEGER NOT NULL DEFAULT 0,
        medium INTEGER NOT NULL DEFAULT 0,
        info INTEGER NOT NULL DEFAULT 0,
        progress TEXT,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_scans ON audit_scans(server_id, id);
      CREATE TABLE IF NOT EXISTS audit_settings (
        server_id TEXT PRIMARY KEY,
        continuous INTEGER NOT NULL DEFAULT 0,
        alert INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      )
    `
  }
];

/**
 * Attach the legacy single-server install to its guild: DISCORD_GUILD_ID (old setting) becomes the guild of
 * the "default" server, once, if no other server already claims it. Runs after every migration pass (cheap, idempotent).
 */
async function bootstrapLegacyServer(client: Client): Promise<void> {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) return;
  await client.execute({
    sql: `UPDATE servers SET guild_id = ? WHERE id = 'default' AND guild_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM servers WHERE guild_id = ?)`,
    args: [guildId, guildId]
  });
}

/** Split a migration into single statements (no migration contains a ";" inside a string literal). */
function statementsOf(sql: string): string[] {
  return sql.split(";").map((part) => part.trim()).filter(Boolean);
}

export async function runMigrations(client: Client): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const done = await client.execute("SELECT name FROM schema_migrations");
  const applied = new Set(done.rows.map((row) => String(row.name)));

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    try {
      // One atomic batch: the schema change and its bookkeeping row succeed or fail together.
      await client.batch(
        [
          ...statementsOf(migration.sql).map((sql) => ({ sql, args: [] as never[] })),
          { sql: "INSERT INTO schema_migrations (name) VALUES (?)", args: [migration.name] }
        ],
        "write"
      );
    } catch (error) {
      // Another server instance may have applied it at the same moment: that is fine.
      const check = await client.execute({ sql: "SELECT 1 FROM schema_migrations WHERE name = ?", args: [migration.name] });
      if (check.rows.length === 0) throw error;
    }
  }
  await bootstrapLegacyServer(client);
}
