// src/db/_maintenance.ts
import { getDb } from '../db/sqlite';

export type DropAllLocalDataResult =
  | { ok: true }
  | { ok: false; errors: string[] };

/** Safe string for unknown errors (TS/ESLint friendly). */
function errToString(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  try { return JSON.stringify(e); } catch { return String(e); }
}

/** Errors we consider harmless during a best-effort local wipe. */
function isBenignSqliteError(message: string): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes('no such table') ||
    msg.includes('no such savepoint') ||
    // some drivers format as “sqlite error: no such table: …”
    (/sqlite.*no such (table|savepoint)/i).test(message)
  );
}

/* -------------------------------------------------------------------------- */
/*                               ENSURE HELPERS                               */
/* -------------------------------------------------------------------------- */

/**
 * Create a table if it doesn't exist.
 * Use for "safety nets" where call order might hit a table before migrations ran.
 * This is idempotent thanks to IF NOT EXISTS.
 */
async function ensureTable(sql: string, label: string): Promise<void> {
  const db = await getDb();
  try {
    await db.execute(sql);
  } catch (e) {
    // Surface only non-benign errors; IF NOT EXISTS should keep this quiet normally.
    const msg = errToString(e);
    if (!isBenignSqliteError(msg)) {
      throw new Error(`ensureTable(${label}) failed: ${msg}`);
    }
  }
}

/**
 * Ensure the daily_hydration_intake table exists.
 * Call this early in boot, or before the first hydration upsert.
 */
export async function ensureHydrationTable(): Promise<void> {
  await ensureTable(
    `
    CREATE TABLE IF NOT EXISTS daily_hydration_intake (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,               -- ISO date (YYYY-MM-DD)
      hydration_ml INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, date)
    );
    `,
    'daily_hydration_intake'
  );

  // Optional but useful index to speed up per-user/date queries
  await ensureTable(
    `
    CREATE INDEX IF NOT EXISTS idx_daily_hydration_user_date
      ON daily_hydration_intake(user_id, date);
    `,
    'idx_daily_hydration_user_date'
  );
}

/* -------------------------------------------------------------------------- */
/*                           DROP / RESET (BEST-EFFORT)                       */
/* -------------------------------------------------------------------------- */

/**
 * Permanently delete all locally-stored account data.
 * Keep TABLES in sync with your schema.
 */
export async function dropAllLocalData(): Promise<DropAllLocalDataResult> {
  const db = await getDb();

  // Expanded to cover all tables seen in logs/schema
  const TABLES: readonly string[] = [
    'weekly_summary_charts',
    'weekly_summary_archive',
    'glp1_graph_archive',
    'protocol_events',
    'protocols',
    'coach_checkins',
    'glp1_experience_logs',
    'health_daily_summaries',
    'daily_hydration_intake',
    'daily_protein_intake',
    'fasting_days',
    'exercises',
    'health_logs',
    'sleep_logs',
    'sleep_plans',
    'sleep_prefs',
    'reminders',
    'weekly_summary_prefs',
    'push_tokens', // may not exist on older installs
    'pending_sync',
    'sync_state',
    'settings',
    'user_profile',
    'users',
  ];

  const rawErrors: string[] = [];
  const pushErr = (label: string, e: unknown): void => {
    rawErrors.push(`${label}: ${errToString(e)}`);
  };

  // Foreign keys OFF (best-effort)
  try {
    await db.execute('PRAGMA foreign_keys = OFF;');
  } catch (e: unknown) {
    pushErr('disable FKs failed', e);
  }

  let savepointOpened = false;

  // Use SAVEPOINT (nested-safe) instead of BEGIN
  try {
    await db.execute('SAVEPOINT wipe_all;');
    savepointOpened = true;
  } catch (e: unknown) {
    pushErr('SAVEPOINT failed', e);
    try {
      await db.execute('PRAGMA foreign_keys = ON;');
    } catch (e2: unknown) {
      pushErr('re-enable FKs failed', e2);
    }
    // If we cannot even open the savepoint, treat as a hard failure.
    const nonBenign = rawErrors.filter((err) => !isBenignSqliteError(err));
    return nonBenign.length === 0 ? { ok: true } : { ok: false, errors: nonBenign };
  }

  // DELETE rows per table (best-effort)
  for (const t of TABLES) {
    try {
      await db.execute(`DELETE FROM "${t}";`);
    } catch (e: unknown) {
      const msg = errToString(e);
      if (!isBenignSqliteError(msg)) {
        pushErr(`delete ${t} failed`, msg);
      }
      // else ignore missing tables
    }
  }

  // Reset AUTOINCREMENT counters (if present). Benign to fail on fresh DBs.
  try {
    await db.execute('DELETE FROM sqlite_sequence;');
  } catch (e: unknown) {
    const msg = errToString(e);
    if (!isBenignSqliteError(msg)) {
      pushErr('reset sqlite_sequence failed', msg);
    }
  }

  let released = false;

  // RELEASE or ROLLBACK TO on failure
  if (savepointOpened) {
    try {
      await db.execute('RELEASE SAVEPOINT wipe_all;');
      released = true;
    } catch (e: unknown) {
      pushErr('RELEASE SAVEPOINT failed', e);
      try {
        await db.execute('ROLLBACK TO SAVEPOINT wipe_all;');
      } catch (e2: unknown) {
        const msg2 = errToString(e2);
        if (!isBenignSqliteError(msg2)) {
          pushErr('ROLLBACK TO SAVEPOINT failed', msg2);
        }
      }
      try {
        await db.execute('RELEASE SAVEPOINT wipe_all;');
      } catch (e3: unknown) {
        const msg3 = errToString(e3);
        if (!isBenignSqliteError(msg3)) {
          pushErr('final RELEASE SAVEPOINT failed', msg3);
        }
      }
    }
  }

  // VACUUM (best-effort). Note: VACUUM cannot run inside *any* transaction.
  if (released) {
    try {
      await db.execute('VACUUM;');
    } catch (e: unknown) {
      // If this ever fails, surface it (usually indicates a locked DB).
      pushErr('VACUUM failed', e);
    }
  }

  // Re-enable FKs (best-effort)
  try {
    await db.execute('PRAGMA foreign_keys = ON;');
  } catch (e: unknown) {
    pushErr('re-enable FKs failed', e);
  }

  // Only fail if there are non-benign errors.
  const nonBenignErrors = rawErrors.filter((err) => !isBenignSqliteError(err));
  return nonBenignErrors.length === 0 ? { ok: true } : { ok: false, errors: nonBenignErrors };
}


