import { getDb } from './sqlite';
import { logger } from '../utils/logger';

export async function resetLocalDbDev(): Promise<void> {
  const conn = await getDb(); // ensures a connection is open
  logger.warn('[DB] Dev reset: dropping local tables');

  // Drop existing tables
  await conn.execute(`
    PRAGMA foreign_keys=OFF;
    DROP TABLE IF EXISTS user_profile;
    DROP TABLE IF EXISTS sync_state;
    DROP TABLE IF EXISTS pending_sync;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS settings;
    PRAGMA foreign_keys=ON;
  `);

  // Recreate schema EXACTLY matching your initDbOnce schema (including new columns)
  await conn.execute(`
    PRAGMA foreign_keys=ON;

    -- Local singleton profile cache
    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      user_id TEXT NOT NULL,
      email TEXT,
      first_name TEXT,
      last_name TEXT,
      weight REAL,
      goal_weight REAL,
      medication_name TEXT,
      medication_dose TEXT,
      profile_photo TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      fasting_schedule TEXT,
      fasting_start TEXT,
      injection_day TEXT,
      injection_time TEXT,
      height REAL,
      bmi REAL,
      is_active INTEGER NOT NULL DEFAULT 1,
      auth_provider TEXT NOT NULL DEFAULT 'email',
      provider_sub TEXT,
      apple_private_relay INTEGER NOT NULL DEFAULT 0,
      email_verified_at TEXT,
      last_login_at TEXT,
      updated_at TEXT,
      created_at TEXT,
      synced_at INTEGER,
      has_pro INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS pending_sync (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity TEXT NOT NULL,
      entity_id TEXT,
      operation TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0
    );

    -- Users table with all columns your code reads/writes
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT,
      email_lower TEXT,
      password_hash TEXT,
      first_name TEXT,
      last_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      weight REAL,
      goal_weight REAL,
      medication_name TEXT,
      medication_dose TEXT,
      profile_photo TEXT,
      address1 TEXT,
      address2 TEXT,
      city TEXT,
      country TEXT,
      postcode TEXT,
      injection_day TEXT,
      reset_token TEXT,
      reset_token_expiry TEXT,
      height REAL,
      fasting_schedule TEXT,
      fasting_start TEXT,
      fasting_end TEXT,               -- added: selected by getLocalCurrentUser
      bmi REAL,
      push_subscription TEXT,
      injection_time TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      deleted_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      auth_provider TEXT NOT NULL DEFAULT 'email',
      provider_sub TEXT,
      email_verified_at TEXT,
      email_verify_token TEXT,
      email_verify_expiry TEXT,
      apple_private_relay INTEGER NOT NULL DEFAULT 0,
      has_pro INTEGER NOT NULL DEFAULT 0,      -- added
      subscription_tier TEXT DEFAULT 'free',   -- added
      pro_until TEXT                           -- added
    );

    CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
      ON users(email_lower)
      WHERE email IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS users_provider_sub_unique
      ON users(auth_provider, provider_sub)
      WHERE provider_sub IS NOT NULL;

    CREATE INDEX IF NOT EXISTS users_last_login_at_idx ON users(last_login_at);
    CREATE INDEX IF NOT EXISTS users_reset_token_idx ON users(reset_token);

    -- Local settings singleton
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_logged_in_user_id TEXT,
      push_token TEXT,
      analytics_opt_in INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      push_enabled INTEGER NOT NULL DEFAULT 1
    );
    INSERT OR IGNORE INTO settings (id, updated_at) VALUES (1, datetime('now'));
  `);

  logger.info('[DB] Dev reset complete.');
}