// ============================================================================
// File: src/db/SleepRepository.ts
// Desc: Local SQLite repo for Sleep prefs, plans, and logs.
// Notes:
//  - Strict types, no `any`
//  - Uses getDb() like your other repos
//  - Emits `sleep:changed` on every mutation
//  - Stores prefs/plans as HH:MM (local wall time), logs as ISO (UTC ok)
// ============================================================================

import { getDb } from '../db/sqlite';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export type HHMM = `${number}${number}:${number}${number}`; // "23:45"

export interface SleepPrefs {
  bedtime: string | null; // HH:MM or null
  tz: string | null;
}

export interface SleepPlanRow {
  id: number;
  day: string;                    // YYYY-MM-DD
  planned_bedtime: string | null; // HH:MM
}

export interface SleepLogRow {
  id: number;
  sleep_date: string;             // YYYY-MM-DD (anchor date, usually day you go to bed)
  sleep_at: string | null;        // ISO
  wake_at: string | null;         // ISO or null if not set yet
  tz: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────
let _initialized = false;

const emitChanged = (): void => {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event('sleep:changed'));
  }
};

const ensureInit = async (): Promise<void> => {
  if (_initialized) return;
  await initSleepTables();
  _initialized = true;
};

const isYmd = (s: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(s);

const isHHMM = (s: string): s is HHMM =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

const isIso = (s: string): boolean =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(?:\.\d{3})?)?(Z|[+-]\d{2}:\d{2})?$/.test(s);

// ─────────────────────────────────────────────────────────────────────────────
// Schema init
// ─────────────────────────────────────────────────────────────────────────────
export const initSleepTables = async (): Promise<void> => {
  const db = await getDb();

  // prefs: single row table (id=1)
  await db.run(`
    CREATE TABLE IF NOT EXISTS sleep_prefs (
      id       INTEGER PRIMARY KEY CHECK (id = 1),
      bedtime  TEXT,   -- "HH:MM"
      tz       TEXT
    );
  `);

  // plans: planned bedtime per day
  await db.run(`
    CREATE TABLE IF NOT EXISTS sleep_plans (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      day              TEXT NOT NULL UNIQUE,   -- "YYYY-MM-DD"
      planned_bedtime  TEXT,                   -- "HH:MM"
      tz               TEXT
    );
  `);

  // logs: actual sleep start/end
  await db.run(`
    CREATE TABLE IF NOT EXISTS sleep_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      sleep_date  TEXT NOT NULL,   -- "YYYY-MM-DD"
      sleep_at    TEXT,            -- ISO (UTC/local ISO ok)
      wake_at     TEXT,            -- ISO or NULL
      tz          TEXT
    );
  `);

  // indices to speed up range queries
  await db.run(`CREATE INDEX IF NOT EXISTS idx_sleep_plans_day ON sleep_plans(day);`);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_sleep_logs_date ON sleep_logs(sleep_date);`);
};

// ─────────────────────────────────────────────────────────────────────────────
// Prefs
// ─────────────────────────────────────────────────────────────────────────────
export const getSleepPrefs = async (): Promise<SleepPrefs> => {
  await ensureInit();
  const db = await getDb();
  const res = await db.query(`SELECT bedtime, tz FROM sleep_prefs WHERE id = 1;`);
  if (res.values && res.values.length > 0) {
    const row = res.values[0] as { bedtime: string | null; tz: string | null };
    return { bedtime: row.bedtime, tz: row.tz };
  }
  // Ensure a row exists for id=1 (empty defaults)
  await db.run(`INSERT OR IGNORE INTO sleep_prefs (id, bedtime, tz) VALUES (1, NULL, NULL);`);
  return { bedtime: null, tz: null };
};

export const upsertSleepPrefs = async (bedtime: string | null, tz: string): Promise<void> => {
  await ensureInit();
  const db = await getDb();

  if (bedtime !== null && !isHHMM(bedtime)) {
    throw new Error(`Invalid HH:MM bedtime: "${bedtime}"`);
  }

  await db.run(
    `INSERT INTO sleep_prefs (id, bedtime, tz)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET bedtime = excluded.bedtime, tz = excluded.tz;`,
    [bedtime, tz]
  );

  emitChanged();
};

// ─────────────────────────────────────────────────────────────────────────────
// Plans
// ─────────────────────────────────────────────────────────────────────────────
export const upsertPlannedBedtime = async (
  day: string,
  bedtimeHHMM: string,
  tz: string
): Promise<void> => {
  await ensureInit();
  if (!isYmd(day)) throw new Error(`Invalid day (YYYY-MM-DD): "${day}"`);
  if (!isHHMM(bedtimeHHMM)) throw new Error(`Invalid HH:MM: "${bedtimeHHMM}"`);

  const db = await getDb();
  await db.run(
    `INSERT INTO sleep_plans (day, planned_bedtime, tz)
     VALUES (?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET planned_bedtime = excluded.planned_bedtime, tz = excluded.tz;`,
    [day, bedtimeHHMM, tz]
  );

  emitChanged();
};

export const getPlannedRange = async (
  fromYmd: string,
  toYmd: string
): Promise<Array<SleepPlanRow>> => {
  await ensureInit();
  if (!isYmd(fromYmd) || !isYmd(toYmd)) {
    throw new Error(`Invalid date range: "${fromYmd}".."${toYmd}"`);
  }
  const db = await getDb();
  const res = await db.query(
    `SELECT id, day, planned_bedtime
     FROM sleep_plans
     WHERE day >= ? AND day <= ?
     ORDER BY day DESC;`,
    [fromYmd, toYmd]
  );

  const values = (res.values ?? []) as Array<{ id: number; day: string; planned_bedtime: string | null }>;
  return values.map(v => ({
    id: v.id,
    day: v.day,
    planned_bedtime: v.planned_bedtime,
  }));
};

export const deletePlannedByDay = async (day: string): Promise<void> => {
  await ensureInit();
  if (!isYmd(day)) throw new Error(`Invalid day (YYYY-MM-DD): "${day}"`);
  const db = await getDb();
  await db.run(`DELETE FROM sleep_plans WHERE day = ?;`, [day]);
  emitChanged();
};

// ─────────────────────────────────────────────────────────────────────────────
// Logs
// ─────────────────────────────────────────────────────────────────────────────
export const insertSleepStart = async (
  sleepDate: string,
  sleepAtIso: string,
  tz: string
): Promise<number> => {
  await ensureInit();
  if (!isYmd(sleepDate)) throw new Error(`Invalid sleepDate (YYYY-MM-DD): "${sleepDate}"`);
  if (!isIso(sleepAtIso)) throw new Error(`Invalid ISO datetime: "${sleepAtIso}"`);

  const db = await getDb();
  await db.run(
    `INSERT INTO sleep_logs (sleep_date, sleep_at, wake_at, tz)
     VALUES (?, ?, NULL, ?);`,
    [sleepDate, sleepAtIso, tz]
  );

  // Fetch the last inserted id for this connection
  const row = await db.query(`SELECT last_insert_rowid() AS id;`);
  const idVal = (row.values?.[0] as { id: number } | undefined)?.id;
  if (typeof idVal !== 'number') {
    throw new Error('Failed to retrieve last inserted sleep_logs id');
  }

  emitChanged();
  return idVal;
};

export const updateWakeTime = async (id: number, wakeIso: string): Promise<void> => {
  await ensureInit();
  if (!Number.isInteger(id) || id <= 0) throw new Error(`Invalid sleep_log id: ${id}`);
  if (!isIso(wakeIso)) throw new Error(`Invalid ISO datetime: "${wakeIso}"`);

  const db = await getDb();
  await db.run(
    `UPDATE sleep_logs SET wake_at = ? WHERE id = ?;`,
    [wakeIso, id]
  );

  emitChanged();
};

export const listSleepLogsRange = async (
  fromYmd: string,
  toYmd: string
): Promise<Array<SleepLogRow>> => {
  await ensureInit();
  if (!isYmd(fromYmd) || !isYmd(toYmd)) {
    throw new Error(`Invalid date range: "${fromYmd}".."${toYmd}"`);
  }

  const db = await getDb();
  const res = await db.query(
    `SELECT id, sleep_date, sleep_at, wake_at, tz
     FROM sleep_logs
     WHERE sleep_date >= ? AND sleep_date <= ?
     ORDER BY sleep_date DESC, id DESC;`,
    [fromYmd, toYmd]
  );

  const rows = (res.values ?? []) as Array<{
    id: number; sleep_date: string; sleep_at: string | null; wake_at: string | null; tz: string | null;
  }>;

  return rows.map(r => ({
    id: r.id,
    sleep_date: r.sleep_date,
    sleep_at: r.sleep_at,
    wake_at: r.wake_at,
    tz: r.tz,
  }));
};

export const deleteSleepLog = async (id: number): Promise<void> => {
  await ensureInit();
  if (!Number.isInteger(id) || id <= 0) throw new Error(`Invalid sleep_log id: ${id}`);
  const db = await getDb();
  await db.run(`DELETE FROM sleep_logs WHERE id = ?;`, [id]);
  emitChanged();
};

