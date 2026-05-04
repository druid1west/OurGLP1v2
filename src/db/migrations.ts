// src/db/migrations.ts
import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { logger } from '../utils/logger';

type TableInfoRow = {
  cid: number;
  name: string;
  type: string;
  notnull: 0 | 1;
  dflt_value: string | null;
  pk: 0 | 1;
};

async function ensureTable(conn: SQLiteDBConnection, createSql: string, tableName: string) {
  const res = await conn.query(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    [tableName]
  );
  if (!res.values || res.values.length === 0) {
    await conn.execute(createSql);
  }
}

async function ensureColumns(
  conn: SQLiteDBConnection,
  table: string,
  wanted: Array<{ name: string; sql: string }>
) {
  const res = await conn.query(`PRAGMA table_info(${table})`);
  const rows = (res.values ?? []) as TableInfoRow[];
  const existing = new Set(rows.map((r) => String(r.name)));
  for (const w of wanted) {
    if (!existing.has(w.name)) {
      logger.info(`[migrations] Adding column ${table}.${w.name}`);
      await conn.execute(`ALTER TABLE ${table} ADD COLUMN ${w.sql}`);
    }
  }
}

export async function runMigrations(conn: SQLiteDBConnection): Promise<void> {
  await conn.execute(`PRAGMA foreign_keys = ON`);
  logger.info('[runMigrations] Starting...');

  // ─────────────────────────────────────────
  // user_profile (guard + columns)
  // ─────────────────────────────────────────
  await ensureTable(
    conn,
    `
    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    `,
    'user_profile'
  );
  await ensureColumns(conn, 'user_profile', [
    { name: 'has_pro',  sql: 'has_pro INTEGER NOT NULL DEFAULT 0' },
    { name: 'synced_at', sql: 'synced_at INTEGER' },
  ]);

  // ─────────────────────────────────────────
  // users
  // ─────────────────────────────────────────
  await ensureTable(
    conn,
    `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT,
      email_lower TEXT,
      password_hash TEXT,
      first_name TEXT,
      last_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    `,
    'users'
  );
  await ensureColumns(conn, 'users', [
    { name: 'fasting_end',       sql: 'fasting_end TEXT' },
    { name: 'has_pro',           sql: 'has_pro INTEGER NOT NULL DEFAULT 0' },
    { name: 'subscription_tier', sql: "subscription_tier TEXT DEFAULT 'free'" },
    { name: 'pro_until',         sql: 'pro_until TEXT' },
    { name: 'timezone',          sql: "timezone TEXT NOT NULL DEFAULT 'UTC'" },
    { name: 'injection_time',    sql: 'injection_time TEXT' },
    { name: 'injection_day',     sql: 'injection_day TEXT' },
    { name: 'fasting_schedule',  sql: 'fasting_schedule TEXT' },
    { name: 'fasting_start',     sql: 'fasting_start TEXT' },
    { name: 'height',            sql: 'height REAL' },
    { name: 'weight',            sql: 'weight REAL' },
    { name: 'goal_weight',       sql: 'goal_weight REAL' },
    { name: 'bmi',               sql: 'bmi REAL' },
    { name: 'medication_name',   sql: 'medication_name TEXT' },
    { name: 'medication_dose',   sql: 'medication_dose TEXT' },
    { name: 'last_login_at',     sql: 'last_login_at TEXT' },
    { name: 'auth_provider',     sql: "auth_provider TEXT NOT NULL DEFAULT 'email'" },
    { name: 'provider_sub',      sql: 'provider_sub TEXT' },
    { name: 'apple_private_relay', sql: 'apple_private_relay INTEGER NOT NULL DEFAULT 0' },
  ]);
  await conn.execute(`CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users(email_lower)`);

  // ─────────────────────────────────────────
// glp1_experience_logs (subjective medication experience)
// ─────────────────────────────────────────
await ensureTable(
conn,
`
CREATE TABLE IF NOT EXISTS glp1_experience_logs (
id INTEGER PRIMARY KEY AUTOINCREMENT,
user_id TEXT NOT NULL,


recorded_at TEXT NOT NULL, -- UTC ISO timestamp
local_day TEXT NOT NULL, -- YYYY-MM-DD in user's TZ


hunger INTEGER NOT NULL CHECK (hunger BETWEEN 1 AND 10),
nausea INTEGER NOT NULL CHECK (nausea BETWEEN 0 AND 10),


note TEXT,
created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`,
'glp1_experience_logs'
);


await conn.execute(`
CREATE INDEX IF NOT EXISTS idx_glp1_experience_user_day
ON glp1_experience_logs(user_id, local_day)
`);

  // ─────────────────────────────────────────
  // fasting_days
  // ─────────────────────────────────────────
  await ensureTable(
    conn,
    `
    CREATE TABLE IF NOT EXISTS fasting_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day TEXT NOT NULL UNIQUE,
      first_meal_at TEXT,
      last_meal_at TEXT,
      tz TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    `,
    'fasting_days'
  );

  // ─────────────────────────────────────────
  // health_logs
  // ─────────────────────────────────────────
  await ensureTable(
    conn,
    `
    CREATE TABLE IF NOT EXISTS health_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_type TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    `,
    'health_logs'
  );
  await conn.execute(`CREATE INDEX IF NOT EXISTS idx_health_logs_type_time ON health_logs(entry_type, recorded_at)`);

  // ─────────────────────────────────────────
  // exercises
  // ─────────────────────────────────────────
  await ensureTable(
    conn,
    `
    CREATE TABLE IF NOT EXISTS exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exercise_date TEXT NOT NULL,
      day_of_week TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      exercise_type TEXT NOT NULL,
      calories_burned INTEGER,
      start_at TEXT,
      end_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    `,
    'exercises'
  );
  await ensureColumns(conn, 'exercises', [
    { name: 'start_at', sql: 'start_at TEXT' },
    { name: 'end_at',   sql: 'end_at TEXT' },
  ]);
  await conn.execute(`CREATE INDEX IF NOT EXISTS idx_exercises_date ON exercises(exercise_date)`);

  // ─────────────────────────────────────────
  // reminders
  // ─────────────────────────────────────────
  await ensureTable(
    conn,
    `
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      datetime TEXT,                -- ISO UTC instant or NULL
      method TEXT NOT NULL,         -- JSON array of strings, e.g. ["push","email"]
      advance_minutes INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      reminder_type TEXT,
      day_of_week TEXT,             -- 'Mon'..'Sun'
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    `,
    'reminders'
  );
  await ensureColumns(conn, 'reminders', [
    { name: 'acknowledged_at', sql: 'acknowledged_at TEXT' },
  ]);
  await conn.execute(`CREATE INDEX IF NOT EXISTS reminders_datetime_idx ON reminders(datetime)`);
  await conn.execute(`CREATE INDEX IF NOT EXISTS reminders_dow_idx ON reminders(day_of_week)`);
  await conn.execute(`CREATE INDEX IF NOT EXISTS reminders_acknowledged_idx ON reminders(acknowledged_at)`);

  // ─────────────────────────────────────────
  // settings
  // ─────────────────────────────────────────
  await ensureTable(
    conn,
    `
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY,   -- always 1
      push_token TEXT,
      updated_at TEXT
    );
    `,
    'settings'
  );
  await ensureColumns(conn, 'settings', [
    { name: 'notifications_permission', sql: "notifications_permission TEXT DEFAULT 'unknown'" }, // 'granted'|'denied'|'prompt'|'unknown'
    { name: 'notifications_enabled',    sql: 'notifications_enabled INTEGER NOT NULL DEFAULT 1' }, // 0|1
    { name: 'last_permission_check',    sql: 'last_permission_check TEXT' },
    { name: 'last_prompt_at',           sql: 'last_prompt_at TEXT' },
  ]);
  await conn.execute(
    `INSERT OR IGNORE INTO settings (id, push_token, updated_at) VALUES (1, NULL, NULL)`
  );

  // ─────────────────────────────────────────
  // daily_protein_intake
  // ─────────────────────────────────────────
  await ensureTable(
    conn,
    `
    CREATE TABLE IF NOT EXISTS daily_protein_intake (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL, -- ISO date (e.g. '2025-04-05')
      protein_grams REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, date)
    );
    `,
    'daily_protein_intake'
  );
  await conn.execute(`CREATE INDEX IF NOT EXISTS idx_daily_protein_user_date ON daily_protein_intake(user_id, date)`);

  // ─────────────────────────────────────────
  // user_profile (guard + columns) — duplicate guard retained if intentional
  // ─────────────────────────────────────────
  await ensureTable(
    conn,
    `
    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    `,
    'user_profile'
  );
  await ensureColumns(conn, 'user_profile', [
    { name: 'has_pro',  sql: 'has_pro INTEGER NOT NULL DEFAULT 0' },
    { name: 'synced_at', sql: 'synced_at INTEGER' },
  ]);

  // ─────────────────────────────────────────
  // Weekly Summary (prefs, archive, charts)
  // ─────────────────────────────────────────
  await ensureTable(
    conn,
    `
    CREATE TABLE IF NOT EXISTS weekly_summary_prefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT,
      include_protein        INTEGER NOT NULL DEFAULT 1,
      include_hydration      INTEGER NOT NULL DEFAULT 1,
      include_blood_pressure INTEGER NOT NULL DEFAULT 0,
      include_blood_sugar    INTEGER NOT NULL DEFAULT 0,
      include_bowel          INTEGER NOT NULL DEFAULT 0,
      include_exercise       INTEGER NOT NULL DEFAULT 1,
      include_mood           INTEGER NOT NULL DEFAULT 1,
      include_fasting        INTEGER NOT NULL DEFAULT 1,
      include_injection      INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    `,
    'weekly_summary_prefs'
  );
  await conn.execute(`CREATE INDEX IF NOT EXISTS idx_wsp_updated_at ON weekly_summary_prefs(updated_at)`);

  await ensureTable(
    conn,
    `
    CREATE TABLE IF NOT EXISTS weekly_summary_archive (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_utc TEXT NOT NULL,
      to_utc   TEXT NOT NULL,
      tz       TEXT NOT NULL,
      anchor_type         TEXT,   -- 'taken'|'scheduled'|'fallback'|'override'
      anchor_used         TEXT,   -- ISO datetime
      anchor_taken_at     TEXT,
      anchor_scheduled_at TEXT,
      summary_bullets_json TEXT,
      email                TEXT,
      confirm_click_token  TEXT,
      sent_at              TEXT,
      injection_taken_at   TEXT,
      fasting_json         TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    `,
    'weekly_summary_archive'
  );
  await conn.execute(`CREATE INDEX IF NOT EXISTS idx_wsa_range ON weekly_summary_archive(from_utc, to_utc)`);
  await conn.execute(`CREATE INDEX IF NOT EXISTS idx_wsa_sent_at ON weekly_summary_archive(sent_at)`);

  await ensureTable(
    conn,
    `
    CREATE TABLE IF NOT EXISTS weekly_summary_charts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      archive_id INTEGER NOT NULL,
      metric TEXT NOT NULL,
      png_base64 TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (archive_id) REFERENCES weekly_summary_archive(id) ON DELETE CASCADE,
      UNIQUE (archive_id, metric)
    );
    `,
    'weekly_summary_charts'
  );
  await conn.execute(`CREATE INDEX IF NOT EXISTS idx_wsc_archive ON weekly_summary_charts(archive_id)`);
  await conn.execute(`CREATE INDEX IF NOT EXISTS idx_wsc_metric ON weekly_summary_charts(metric)`);

  logger.info('[runMigrations] Complete');

// ─────────────────────────────────────────
// glp1_graph_archive (hunger/nausea graph archives)
// ─────────────────────────────────────────
await ensureTable(
  conn,
  `
  CREATE TABLE IF NOT EXISTS glp1_graph_archive (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    timezone TEXT NOT NULL,
    injection_day TEXT NOT NULL,
    from_date TEXT NOT NULL,
    to_date TEXT NOT NULL,
    archived_at TEXT NOT NULL DEFAULT (datetime('now')),
    chart_uri TEXT,
    chart_png TEXT,
    data_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  'glp1_graph_archive'
);

// add missing columns on existing installs
await ensureColumns(conn, 'glp1_graph_archive', [
  { name: 'chart_uri', sql: 'chart_uri TEXT' },
]);

await conn.execute(`CREATE INDEX IF NOT EXISTS idx_glp1_archive_user_date ON glp1_graph_archive(user_id, archived_at)`);
await conn.execute(`CREATE INDEX IF NOT EXISTS idx_glp1_archive_range ON glp1_graph_archive(from_date, to_date)`);




}
