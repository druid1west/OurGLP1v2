// src/db/sqlite.ts
import { logger } from '../utils/logger';
import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import { runMigrations } from './migrations';

let db: SQLiteDBConnection | null = null;
let sqlite: SQLiteConnection | null = null;
let initPromise: Promise<void> | null = null;

const DB_NAME = 'ourglp1';

type PragmaTableInfo = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
};

export async function initDbOnce(): Promise<void> {
  if (initPromise) {
    logger.info('[sqlite] Init already in progress, awaiting...');
    return initPromise;
  }
  if (db) {
    logger.info('[sqlite] Already initialized, skipping');
    return;
  }

  initPromise = (async () => {
    logger.info('[initDbOnce] Starting database initialization...');
    const platform = Capacitor.getPlatform();
    if (platform === 'web') {
      logger.warn('[sqlite] Web platform not fully supported yet; skipping init');
      return;
    }

    sqlite = sqlite ?? new SQLiteConnection(CapacitorSQLite);

    // Always try to reuse an existing connection first
    try {
      const consistency = await sqlite.checkConnectionsConsistency();
      const isConn = (await sqlite.isConnection(DB_NAME, false)).result;
      if (consistency.result && isConn) {
        logger.info('[initDbOnce] Reusing existing connection');
        db = await sqlite.retrieveConnection(DB_NAME, false);
      }
    } catch {
      // ignore
    }

    // If no connection was retrieved, create a new one
    if (!db) {
      try {
        logger.info('[initDbOnce] Creating new connection');
        db = await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
      } catch (createErr) {
        // If plugin reports "already exists" due to race, retrieve instead
        try {
          db = await sqlite.retrieveConnection(DB_NAME, false);
        } catch {
          throw createErr;
        }
      }
    }

    if (!db) throw new Error('Failed to create or retrieve database connection');
    const conn = db;

    // Open (no-op if already open)
    const isOpen = (await conn.isDBOpen()).result;
    if (!isOpen) {
      logger.info('[initDbOnce] Opening database');
      await conn.open();
    }

    // Schema
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
        has_pro INTEGER NOT NULL DEFAULT 0,
        date_of_birth TEXT,
        address1 TEXT,
        address2 TEXT,
        city TEXT,
        country TEXT,
        postcode TEXT,
        start_weight REAL,
        weight_unit TEXT NOT NULL DEFAULT 'kg',
        height_unit TEXT NOT NULL DEFAULT 'cm',
        glp1_status TEXT,
        glp1_start_date TEXT,
        main_reason TEXT,
        biggest_challenge TEXT,
        main_concerns_json TEXT,
        coach_onboarding_completed_at TEXT,
        coach_checkin_frequency TEXT NOT NULL DEFAULT 'morning_evening',
        monthly_anchor_day INTEGER,
        monthly_dose_count INTEGER NOT NULL DEFAULT 4
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

      -- Users: mapped from Postgres for local auth/session cache
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
        date_of_birth TEXT,
        start_weight REAL,
        weight_unit TEXT NOT NULL DEFAULT 'kg',
        height_unit TEXT NOT NULL DEFAULT 'cm',
        glp1_status TEXT,
        glp1_start_date TEXT,
        main_reason TEXT,
        biggest_challenge TEXT,
        main_concerns_json TEXT,
        coach_onboarding_completed_at TEXT,
        coach_checkin_frequency TEXT NOT NULL DEFAULT 'morning_evening',
        monthly_anchor_day INTEGER,
        monthly_dose_count INTEGER NOT NULL DEFAULT 4
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
        updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO settings (id, updated_at) VALUES (1, datetime('now'));
    `);

    // Ensure settings columns exist
    const cols = await conn.query('PRAGMA table_info(settings)');
    const names = ((cols.values ?? []) as PragmaTableInfo[]).map((r) => r.name);

    if (!names.includes('push_enabled')) {
      await conn.execute(
        'ALTER TABLE settings ADD COLUMN push_enabled INTEGER NOT NULL DEFAULT 1;'
      );
    }
    if (!names.includes('analytics_opt_in')) {
      await conn.execute(
        'ALTER TABLE settings ADD COLUMN analytics_opt_in INTEGER NOT NULL DEFAULT 1;'
      );
    }

    // ✅ Run all migrations (no nested transaction inside)
    logger.info('[initDbOnce] Running migrations');
    await runMigrations(conn);
    logger.info('[initDbOnce] Database ready');
  })().catch((err) => {
    logger.error('[initDbOnce] Failed:', err);
    // Reset so next call can retry
    initPromise = null;
    db = null;
    throw err;
  });

  await initPromise;
  initPromise = null;
}

export async function getDb(): Promise<SQLiteDBConnection> {
  if (db) return db;

  if (initPromise) {
    await initPromise;
    if (db) return db;
    throw new Error('SQLite not initialized after initPromise');
  }

  await initDbOnce();
  if (!db) throw new Error('SQLite not initialized');
  return db;
}

export { db };
