// src/db/HealthRepository.ts
import { getDb } from '../db/sqlite';
import { emitHealthChanged } from '../services/healthBus';
import type { HealthEventKind } from '../services/healthBus';


/* =============================================================================
   Types
============================================================================= */
export type HealthLogRow = {
  id?: number;
  entry_type:
    | 'protein'
    | 'hydration'
    | 'exercise'
    | 'weight'
    | 'blood_pressure'
    | 'blood_sugar'
    | 'mood'
    | 'bowel'
    | 'injection';
  recorded_at: string;
  data_json: string;
  created_at?: string;
};

export type HealthLog = {
  id: number;
  entry_type: HealthLogRow['entry_type'];
  recorded_at: string;
  data: unknown;
  created_at?: string;
};

export type InjectionLog = {
  taken_at: string;
  medication_name?: string;
  medication_dose?: string;
};

export type InsertExerciseInput = {
  exercise_date: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  exercise_type: string;
  calories_burned: number | null;
};

export type ExerciseEntry = {
  id: number;
  exercise_date: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  exercise_type: string;
  calories_burned: number | null;
  created_at?: string;
};

export type HealthDailySummaryData = {
  steps?: number | null;
  activeEnergyKcal?: number | null;
  exerciseMinutes?: number | null;
  sleepMinutes?: number | null;
  restingHeartRate?: number | null;
  workouts?: number | null;
};

export type HealthDailySummary = HealthDailySummaryData & {
  day: string;
  source: 'apple_health' | 'manual' | 'preview';
  synced_at: string;
};

/* =============================================================================
   Helpers
============================================================================= */
// Ensure time strings are 'HH:MM:SS'
function toHHMMSS(t: string): string {
  const s = t.trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s;
  if (/^\d{2}:\d{2}$/.test(s)) return `${s}:00`;
  const m = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (m) {
    const hh = String(Number(m[1])).padStart(2, '0');
    const mm = String(Number(m[2])).padStart(2, '0');
    return `${hh}:${mm}:00`;
  }
  return s;
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// Round a Date to the nearest 15-min block (by floor to block start).
function floorToQuarter(d: Date): Date {
  const copy = new Date(d.getTime());
  const mins = copy.getMinutes();
  const floored = Math.floor(mins / 15) * 15;
  copy.setMinutes(floored, 0, 0);
  return copy;
}

// Extract a numeric mood value from an unknown data payload
function extractMoodValue(u: unknown): number | null {
  if (!u || typeof u !== 'object') return null;
  const o = u as Record<string, unknown>;
  const tryNum = (x: unknown): number | null =>
    typeof x === 'number' && Number.isFinite(x) ? x : null;
  return (
    tryNum(o.mood) ??
    tryNum(o.mood_score) ??
    tryNum(o.score) ??
    tryNum(o.value) ??
    null
  );
}

/**
 * Best-effort extraction of YYYY-MM-DD from various inputs.
 * Returns null if unable to produce a valid date string.
 */
export function toYmdSafe(x?: unknown): string | null {
  if (x == null) return null;
  const s = String(x).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    // use ISO date (UTC). This provides a deterministic YYYY-MM-DD.
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

/* =============================================================================
   Capacitor SQLite mappers (no `any`)
============================================================================= */
type SqliteRowObject = Record<string, unknown>;
type SqliteQueryResult = { values?: unknown[] } | null | undefined;

function mapSingleRow(result: SqliteQueryResult): SqliteRowObject | null {
  const values = result?.values;
  if (!values || values.length === 0) return null;

  // A: [ [col1, col2, ...], [val1, val2, ...] ]
  if (Array.isArray(values[0]) && values.length >= 2 && Array.isArray(values[1])) {
    const cols = values[0] as string[];
    const row = values[1] as unknown[];
    const rec: SqliteRowObject = {};
    cols.forEach((c, i) => {
      rec[c] = row[i];
    });
    return rec;
  }

  // B (iOS): [ { ios_columns:[...] }, { col1:val1, ... } ]
  if (
    values.length >= 2 &&
    typeof values[0] === 'object' &&
    values[0] !== null &&
    'ios_columns' in (values[0] as Record<string, unknown>)
  ) {
    const iosWrapper = values[0] as { ios_columns: string[] };
    const rowObj = values[1] as Record<string, unknown>;
    const rec: SqliteRowObject = {};
    iosWrapper.ios_columns.forEach((c) => {
      rec[c] = Object.prototype.hasOwnProperty.call(rowObj, c) ? rowObj[c] : undefined;
    });
    return rec;
  }

  // C: [ { col1:val1, ... } ]
  if (
    values.length === 1 &&
    typeof values[0] === 'object' &&
    values[0] !== null &&
    !Array.isArray(values[0]) &&
    !('ios_columns' in (values[0] as Record<string, unknown>))
  ) {
    return values[0] as Record<string, unknown>;
  }

  return null;
}

function mapRows(result: SqliteQueryResult): SqliteRowObject[] {
  const values = result?.values;
  if (!values || values.length === 0) return [];

  // A: [ [col1, col2, ...], [v1, v2, ...], [v1, v2, ...], ... ]
  if (Array.isArray(values[0]) && values.length >= 2 && Array.isArray(values[1])) {
    const cols = values[0] as string[];
    const rows = values.slice(1) as unknown[][];
    return rows.map((arr) => {
      const rec: SqliteRowObject = {};
      cols.forEach((c, i) => {
        rec[c] = (arr as unknown[])[i];
      });
      return rec;
    });
  }

  // B (iOS): [ { ios_columns:[...] }, { col:val,... }, { col:val,... }, ... ]
  if (
    typeof values[0] === 'object' &&
    values[0] !== null &&
    'ios_columns' in (values[0] as Record<string, unknown>)
  ) {
    const cols = (values[0] as { ios_columns: string[] }).ios_columns;
    const objs = values.slice(1).filter((v) => v && typeof v === 'object') as Record<string, unknown>[];
    return objs.map((rowObj) => {
      const rec: SqliteRowObject = {};
      cols.forEach((c) => {
        rec[c] = Object.prototype.hasOwnProperty.call(rowObj, c) ? rowObj[c] : undefined;
      });
      return rec;
    });
  }

  // C: [ { col:val,... }, { col:val,... }, ... ]
  if (typeof values[0] === 'object' && values[0] !== null && !Array.isArray(values[0])) {
    return values as Record<string, unknown>[];
  }

  return [];
}

/* =============================================================================
   Table init
============================================================================= */
export async function initHealthTables(): Promise<void> {
  
  const db = await getDb();
  
  // health logs
  await db.execute(`
    CREATE TABLE IF NOT EXISTS health_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_type TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

// Speed-ups for time- and type-filtered queries
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_health_logs_recorded_at
      ON health_logs (recorded_at);
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_health_logs_entry_type_recorded_at
      ON health_logs (entry_type, recorded_at);
  `);

  // fasting – 1 row per day
  await db.execute(`
    CREATE TABLE IF NOT EXISTS fasting_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day TEXT NOT NULL UNIQUE,
      first_meal_at TEXT,
      last_meal_at TEXT,
      tz TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // exercise
  await db.execute(`
    CREATE TABLE IF NOT EXISTS exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exercise_date TEXT NOT NULL,
      day_of_week TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      exercise_type TEXT NOT NULL,
      calories_burned INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // daily protein rollups
  await db.execute(`
    CREATE TABLE IF NOT EXISTS daily_protein_intake (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      protein_grams INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, date)
    );
  `);

await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_daily_protein_user_date
      ON daily_protein_intake (user_id, date);
  `);

  // daily hydration rollups
  await db.execute(`
    CREATE TABLE IF NOT EXISTS daily_hydration_intake (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      hydration_ml INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, date)
    );
  `);
await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_daily_hydration_user_date
      ON daily_hydration_intake (user_id, date);
  `);

  // Imported daily summaries from Apple Health / Apple Watch.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS health_daily_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day TEXT NOT NULL,
      source TEXT NOT NULL,
      data_json TEXT NOT NULL,
      synced_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(day, source)
    );
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_health_daily_summaries_day_source
      ON health_daily_summaries (day, source);
  `);

}

/* =============================================================================
   Health logs
============================================================================= */
export async function insertHealthLog(row: Omit<HealthLogRow, 'id' | 'created_at'>): Promise<void> {
  const db = await getDb();
  await db.run(
    `INSERT INTO health_logs (entry_type, recorded_at, data_json) VALUES (?, ?, ?)`,
    [row.entry_type, row.recorded_at, row.data_json]
  );
}

export async function listHealthLogs(): Promise<
  Array<{ id: number; entry_type: string; recorded_at: string; data_json: string; created_at?: string }>
> {
  const db = await getDb();
  const q = await db.query(
    `SELECT id, entry_type, recorded_at, data_json, created_at
     FROM health_logs
     ORDER BY datetime(recorded_at) DESC, id DESC`
  );
  const rows = mapRows(q);
  return rows.map((r) => {
    const idVal = r.id;
    const id =
      typeof idVal === 'number'
        ? idVal
        : typeof idVal === 'string' && idVal.trim() !== '' && Number.isFinite(Number(idVal))
        ? Number(idVal)
        : 0;
    return {
      id,
      entry_type: String(r.entry_type ?? ''),
      recorded_at: String(r.recorded_at ?? ''),
      data_json: String(r.data_json ?? '{}'),
      created_at: r.created_at == null ? undefined : String(r.created_at),
    };
  });
}

/** Parsed variant (kept separate so you can migrate call sites gradually). */
export async function listHealthLogsParsed(): Promise<HealthLog[]> {
  const raw = await listHealthLogs();
  return raw.map((r) => {
    let data: unknown = null;
    try {
      data = JSON.parse(r.data_json);
    } catch {
      data = null;
    }
    return {
      id: r.id,
      entry_type: r.entry_type as HealthLogRow['entry_type'],
      recorded_at: r.recorded_at,
      data,
      created_at: r.created_at,
    };
  });
}

/**
 * Option B (cleaner): range helper filtered in SQL and parsed here.
 *
 * NOTE: uses inclusive start (>=) and exclusive end (<). Caller should pass
 * a toIsoUtc that is exclusive (e.g. start + 7 days).
 */
export async function listHealthLogsRange(fromIsoUtc: string, toIsoUtc: string): Promise<HealthLog[]> {
  const db = await getDb();
  const q = await db.query(
    `SELECT id, entry_type, recorded_at, data_json, created_at
     FROM health_logs
     WHERE datetime(recorded_at) >= datetime(?)
       AND datetime(recorded_at) <  datetime(?)
     ORDER BY datetime(recorded_at) ASC, id ASC`,
    [fromIsoUtc, toIsoUtc]
  );
  const rows = mapRows(q);
  return rows.map((r) => {
    let data: unknown = null;
    try {
      data = typeof r.data_json === 'string' ? JSON.parse(r.data_json) : null;
    } catch {
      data = null;
    }
    return {
      id:
        typeof r.id === 'number'
          ? r.id
          : typeof r.id === 'string' && r.id.trim() !== '' && Number.isFinite(Number(r.id))
          ? Number(r.id)
          : 0,
      entry_type: (String(r.entry_type ?? 'mood') as HealthLogRow['entry_type']),
      recorded_at: String(r.recorded_at ?? ''),
      data,
      created_at: r.created_at == null ? undefined : String(r.created_at),
    };
  });
}

export async function deleteHealthLogLocal(id: number): Promise<void> {
  const db = await getDb();
  await db.run(`DELETE FROM health_logs WHERE id = ?`, [id]);
}

/* =============================================================================
   Mood helpers (used by DayPage)
============================================================================= */
export async function upsertMoodLocal(recorded_at_localISO: string, score: number): Promise<void> {
  const db = await getDb();

  // snap to 15-min block (start of block)
  const base = floorToQuarter(new Date(recorded_at_localISO));
  const windowStart = base.toISOString();
  const windowEnd = new Date(base.getTime() + 15 * 60_000).toISOString();
 

  await db.run(
    `DELETE FROM health_logs
     WHERE entry_type = 'mood'
       AND datetime(recorded_at) >= datetime(?)
       AND datetime(recorded_at) <  datetime(?)`,
    [windowStart, windowEnd]
  );

  const clamped = Math.max(1, Math.min(5, Math.round(Number(score) || 0)));
  const payload = JSON.stringify({ score: clamped });
  await db.run(
    `INSERT INTO health_logs (entry_type, recorded_at, data_json)
     VALUES ('mood', ?, ?)`,
   // store the ROUNDED timestamp so charts align with 15-min blocks
    [windowStart, payload]
  );
  emitHealthChanged('mood');
}
/** Delete a mood in the exact 15-min window that contains the provided local ISO. */
export async function deleteMoodInWindow(recorded_at_localISO: string): Promise<void> {
  const db = await getDb();
  const base = new Date(recorded_at_localISO);
  const floorMin = Math.floor(base.getMinutes() / 15) * 15;
  base.setMinutes(floorMin, 0, 0);
  const windowStart = base.toISOString();
  const windowEnd = new Date(base.getTime() + 15 * 60_000).toISOString();
  await db.run(
    `DELETE FROM health_logs
     WHERE entry_type = 'mood'
       AND datetime(recorded_at) >= datetime(?)
       AND datetime(recorded_at) <  datetime(?)`,
    [windowStart, windowEnd]
  );
}
/**
+ * Convenience: log a mood now (or at provided local ISO), snapping to 15-min blocks.
+ * Pass a local ISO string (e.g., from your 15-min grid) or omit to use current time.
+ */
export async function logMood(score: number, atLocalIso?: string): Promise<void> {
  const when = atLocalIso ?? new Date().toISOString();
  await upsertMoodLocal(when, score);
}

/**
 * Compute AM/PM mood averages for Mon..Sun within [fromIsoUtc, toIsoUtc),
 * bucketing by LOCAL time in the provided IANA time zone.
 *
 * - AM window: 00:01–11:59 (inclusive of 00:01, exclusive of 12:00)
 * - PM window: 12:00–24:00
 * Returns two arrays (length 7) rotated later by caller if needed.
 */
export async function getMoodWeekAmPmSeries(
  fromIsoUtc: string,
  toIsoUtc: string,
  tz: string,
  anchorStartIdx: number = 0
): Promise<{ am: number[]; pm: number[] }> {
  const rows = await listHealthLogsRange(fromIsoUtc, toIsoUtc);
  // Helpers: local day + local minutes
  const toLocalYmd = (iso: string): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(iso));
  const localHM = (iso: string): { hh: number; mm: number } => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(iso));
    const hh = Number(parts.find(p => p.type === 'hour')?.value ?? '0');
    const mm = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
    return { hh, mm };
  };
  const minutes = (h: number, m: number) => h * 60 + m;
  const dayKey = (ymd: string): 0|1|2|3|4|5|6 => {
    const d = new Date(`${ymd}T12:00:00Z`); // stable day lookup
    const wk = d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3);
    const map: Record<string, number> = { Mon:0, Tue:1, Wed:2, Thu:3, Fri:4, Sat:5, Sun:6 };
    return (map[wk] ?? 0) as 0|1|2|3|4|5|6;
  };
  const seven = () => Array.from({ length: 7 }, () => [] as number[]);
  const amAcc = seven();
  const pmAcc = seven();

  for (const r of rows) {
    if (r.entry_type !== 'mood') continue;
    const v = extractMoodValue(r.data);
    if (v == null || !Number.isFinite(v)) continue;
    const ymd = toLocalYmd(r.recorded_at);
    const di = dayKey(ymd);
    const { hh, mm } = localHM(r.recorded_at);
    const t = minutes(hh, mm);
    // AM: 00:01 – 11:59  (exclude exactly 00:00 to match spec)
    if (t >= 1 && t < 12 * 60) amAcc[di].push(v);
    // PM: 12:00 – 24:00
    else pmAcc[di].push(v);
  }

  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
  const am = amAcc.map(avg);
  const pm = pmAcc.map(avg);

  // Rotate Mon..Sun to caller’s anchor start if requested
  const rotate = <T,>(arr: readonly T[], idx: number): T[] =>
    idx > 0 ? [...arr.slice(idx), ...arr.slice(0, idx)] : [...arr];
  const rot = Math.max(0, Math.min(6, anchorStartIdx));
  return {
    am: rotate(am, rot),
    pm: rotate(pm, rot),
  };
}


/* =============================================================================
   Daily protein / hydration rollups
============================================================================= */
export async function upsertDailyProtein(
  userId: string,
  date: string,
  proteinGrams: number
): Promise<void> {
  const db = await getDb();
  await db.run(
    `
    INSERT INTO daily_protein_intake (user_id, date, protein_grams)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET protein_grams = excluded.protein_grams
    `,
    [userId, date, proteinGrams]
  );
}

export async function getWeeklyProteinIntake(
  userId: string,
  weekStart: string
): Promise<{ date: string; protein_grams: number }[]> {
  const db = await getDb();
  const res = await db.query(
    `
    SELECT date, protein_grams
    FROM daily_protein_intake
    WHERE user_id = ? AND date >= ? AND date < date(?, '+7 days')
    ORDER BY date ASC
    `,
    [userId, weekStart, weekStart]
  );

  const rows = mapRows(res);
  return rows.map((r) => {
    const rawDate = r.date;
    const normDate = toYmdSafe(rawDate) ?? String(rawDate ?? '');
    const grams =
      typeof r.protein_grams === 'number'
        ? r.protein_grams
        : Number(r.protein_grams ?? 0);
    return {
      date: normDate,
      protein_grams: Number.isFinite(grams) ? grams : 0,
    };
  });
}

export async function upsertDailyHydration(
  userId: string,
  date: string,
  hydrationMl: number
): Promise<void> {
  const db = await getDb();
  const v = Math.max(0, Math.round(Number(hydrationMl) || 0));

  const run = () =>
    db.run(
      `
      INSERT INTO daily_hydration_intake (user_id, date, hydration_ml)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, date) DO UPDATE SET hydration_ml = excluded.hydration_ml
      `,
      [userId, date, v]
    );

  try {
    await run();
  } catch (e) {
    const msg = String(e ?? '');
    if (msg.includes('no such table: daily_hydration_intake')) {
      // ensure schema then retry once
      await initHealthTables();
      await run();
    } else {
      throw e;
    }
  }
}

export type WeeklyHydrationRow = { date: string; hydration_ml: number };
export async function getWeeklyHydrationIntake(
  userId: string,
  weekStart: string
): Promise<WeeklyHydrationRow[]> {
  const db = await getDb();

  const query = () =>
    db.query(
      `
      SELECT date, hydration_ml
      FROM daily_hydration_intake
      WHERE user_id = ? AND date >= ? AND date < date(?, '+7 days')
      ORDER BY date ASC
      `,
      [userId, weekStart, weekStart]
    );

  let res;
  try {
    res = await query();
  } catch (e) {
    const msg = String(e ?? '');
    if (msg.includes('no such table: daily_hydration_intake')) {
      await initHealthTables();
      res = await query();
    } else {
      throw e;
    }
  }

  const rows = mapRows(res);
  return rows.map((r) => {
    const rawDate = r.date;
    const normDate = toYmdSafe(rawDate) ?? String(rawDate ?? '');
    const ml =
      typeof r.hydration_ml === 'number'
        ? r.hydration_ml
        : Number(r.hydration_ml ?? 0);
    return {
      date: normDate,
      hydration_ml: Number.isFinite(ml) ? ml : 0,
    };
  });
}

/* =============================================================================
   Injection helpers (DayPage reads last taken)
============================================================================= */
export async function insertInjectionLocal(taken_at_localISO: string): Promise<void> {
  const db = await getDb();
  const payload = JSON.stringify({ event: 'injection_taken' });
  await db.run(
    `INSERT INTO health_logs (entry_type, recorded_at, data_json)
     VALUES ('injection', ?, ?)`,
    [taken_at_localISO, payload]
  );
}

export async function getLastInjectionLocal(): Promise<InjectionLog | null> {
  const db = await getDb();
  const q = await db.query(
    `SELECT recorded_at, data_json
     FROM health_logs
     WHERE entry_type = 'injection'
     ORDER BY datetime(recorded_at) DESC, rowid DESC
     LIMIT 1`
  );
  const rec = mapSingleRow(q);
  if (!rec) return null;

  const recorded_at =
    typeof rec.recorded_at === 'string' ? rec.recorded_at : String(rec.recorded_at ?? '');
  if (!recorded_at) return null;

  let data: Record<string, unknown> | null = null;
  try {
    data = typeof rec.data_json === 'string' ? JSON.parse(rec.data_json) : null;
  } catch {
    data = null;
  }

  return {
    taken_at: recorded_at,
    medication_name: data && typeof data.medication_name === 'string' ? data.medication_name : undefined,
    medication_dose: data && typeof data.medication_dose === 'string' ? data.medication_dose : undefined,
  };
}

/* =============================================================================
   Fasting
============================================================================= */
export type FastingRow = {
  id?: number;
  day: string;
  first_meal_at?: string | null;
  last_meal_at?: string | null;
  tz?: string | null;
};

export async function getFastingByDay(day: string): Promise<FastingRow | null> {
  const db = await getDb();
  const q = await db.query(
    `SELECT id, day, first_meal_at, last_meal_at, tz
     FROM fasting_days
     WHERE day = ?
     LIMIT 1`,
    [day]
  );
  const rec = mapSingleRow(q);
  if (!rec) return null;

  const idRaw = rec.id;
  const id =
    typeof idRaw === 'number'
      ? idRaw
      : typeof idRaw === 'string' && idRaw.trim() !== '' && Number.isFinite(Number(idRaw))
      ? Number(idRaw)
      : undefined;

  return {
    id,
    day: typeof rec.day === 'string' ? rec.day : String(rec.day ?? ''),
    first_meal_at: rec.first_meal_at == null ? null : String(rec.first_meal_at),
    last_meal_at: rec.last_meal_at == null ? null : String(rec.last_meal_at),
    tz: rec.tz == null ? null : String(rec.tz),
  };
}

export async function getFastingRange(
  fromYmd: string,
  toYmd: string
): Promise<Array<{ id: number; day: string; first_meal_at: string | null; last_meal_at: string | null }>> {
  const db = await getDb();
  const q = await db.query(
    `SELECT id, day, first_meal_at, last_meal_at
     FROM fasting_days
     WHERE day BETWEEN ? AND ?
     AND (first_meal_at IS NOT NULL OR last_meal_at IS NOT NULL)
     ORDER BY day DESC`,
    [fromYmd, toYmd]
  );
  const rows = mapRows(q);
  return rows.map((r) => {
    const idVal = r.id;
    const id =
      typeof idVal === 'number'
        ? idVal
        : typeof idVal === 'string' && idVal.trim() !== '' && Number.isFinite(Number(idVal))
        ? Number(idVal)
        : 0;
    return {
      id,
      day: String(r.day ?? ''),
      first_meal_at: r.first_meal_at == null ? null : String(r.first_meal_at),
      last_meal_at: r.last_meal_at == null ? null : String(r.last_meal_at),
    };
  });
}

export async function upsertFasting(
  day: string,
  first: string | null,
  last: string | null,
  tz?: string
): Promise<void> {
  const db = await getDb();
  await db.run(
    `
    INSERT INTO fasting_days (day, first_meal_at, last_meal_at, tz, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(day) DO UPDATE SET
      first_meal_at = excluded.first_meal_at,
      last_meal_at  = excluded.last_meal_at,
      tz            = COALESCE(excluded.tz, fasting_days.tz),
      updated_at    = datetime('now')
    `,
    [day, first, last, tz ?? null]
  );
}

export async function clearFastingByDay(day: string): Promise<void> {
  const db = await getDb();
  await db.run(
    `UPDATE fasting_days
     SET first_meal_at = NULL,
         last_meal_at  = NULL,
         updated_at    = datetime('now')
     WHERE day = ?`,
    [day]
  );
}

/* =============================================================================
   Exercises
============================================================================= */
export async function insertExercise(input: InsertExerciseInput): Promise<void> {
  const db = await getDb();
  const start = toHHMMSS(input.start_time);
  const end = toHHMMSS(input.end_time);

  await db.run(
    `INSERT INTO exercises (exercise_date, day_of_week, start_time, end_time, exercise_type, calories_burned)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [input.exercise_date, input.day_of_week, start, end, input.exercise_type, input.calories_burned]
  );
}

export async function listExercises(): Promise<ExerciseEntry[]> {
  const db = await getDb();
  const q = await db.query(
    `SELECT id, exercise_date, day_of_week, start_time, end_time, exercise_type, calories_burned, created_at
     FROM exercises
     ORDER BY exercise_date DESC, start_time ASC, id DESC`
  );
  const rows = mapRows(q);
  return rows.map((r) => {
    const idVal = r.id;
    const id =
      typeof idVal === 'number'
        ? idVal
        : typeof idVal === 'string' && idVal.trim() !== '' && Number.isFinite(Number(idVal))
        ? Number(idVal)
        : 0;

    const calRaw = r.calories_burned;
    const calories_burned =
      calRaw == null
        ? null
        : typeof calRaw === 'number'
        ? calRaw
        : typeof calRaw === 'string' && calRaw.trim() !== '' && Number.isFinite(Number(calRaw))
        ? Number(calRaw)
        : null;

    return {
      id,
      exercise_date: String(r.exercise_date ?? ''),
      day_of_week: String(r.day_of_week ?? ''),
      start_time: String(r.start_time ?? ''),
      end_time: String(r.end_time ?? ''),
      exercise_type: String(r.exercise_type ?? ''),
      calories_burned,
      created_at: r.created_at == null ? undefined : String(r.created_at),
    };
  });
}

export async function deleteExerciseById(id: number | string): Promise<void> {
  const db = await getDb();
  const n = typeof id === 'number' ? id : Number(id);
  if (!Number.isFinite(n)) return;
  await db.run(`DELETE FROM exercises WHERE id = ?`, [n]);
}

/**
 * Inserts a health log and emits a typed event based on entry_type.
 */
export async function insertHealthLogAndEmit(
  row: Omit<HealthLogRow, 'id' | 'created_at'>
): Promise<void> {
  await insertHealthLog(row);
  const kind = mapEntryTypeToKind(row.entry_type);
  emitHealthChanged(kind);
}

/**
 * Updates canonical protein totals and emits change.
 */
export async function upsertDailyProteinAndEmit(
  userId: string,
  date: string,
  proteinGrams: number
): Promise<void> {
  await upsertDailyProtein(userId, date, proteinGrams);
  emitHealthChanged('protein');
}

/**
 * Updates hydration totals and emits change.
 */
export async function upsertDailyHydrationAndEmit(
  userId: string,
  date: string,
  hydrationMl: number
): Promise<void> {
  await upsertDailyHydration(userId, date, hydrationMl);
  emitHealthChanged('hydration');
}

export async function upsertHealthDailySummary(
  row: Omit<HealthDailySummary, 'synced_at'>
): Promise<void> {
  const db = await getDb();
  const payload: HealthDailySummaryData = {
    steps: row.steps ?? null,
    activeEnergyKcal: row.activeEnergyKcal ?? null,
    exerciseMinutes: row.exerciseMinutes ?? null,
    sleepMinutes: row.sleepMinutes ?? null,
    restingHeartRate: row.restingHeartRate ?? null,
    workouts: row.workouts ?? null,
  };

  await db.run(
    `
    INSERT INTO health_daily_summaries (day, source, data_json, synced_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(day, source) DO UPDATE SET
      data_json = excluded.data_json,
      synced_at = datetime('now')
    `,
    [row.day, row.source, JSON.stringify(payload)]
  );

  emitHealthChanged('exercise');
}

export async function getHealthDailySummaryByDay(
  day: string,
  source: HealthDailySummary['source'] = 'apple_health'
): Promise<HealthDailySummary | null> {
  const db = await getDb();
  const q = await db.query(
    `
    SELECT day, source, data_json, synced_at
    FROM health_daily_summaries
    WHERE day = ? AND source = ?
    LIMIT 1
    `,
    [day, source]
  );
  const rec = mapSingleRow(q);
  if (!rec) return null;

  let data: HealthDailySummaryData = {};
  try {
    data = typeof rec.data_json === 'string'
      ? JSON.parse(rec.data_json) as HealthDailySummaryData
      : {};
  } catch {
    data = {};
  }

  return {
    day: String(rec.day ?? day),
    source: (String(rec.source ?? source) as HealthDailySummary['source']),
    steps: toNumberOrNull(data.steps),
    activeEnergyKcal: toNumberOrNull(data.activeEnergyKcal),
    exerciseMinutes: toNumberOrNull(data.exerciseMinutes),
    sleepMinutes: toNumberOrNull(data.sleepMinutes),
    restingHeartRate: toNumberOrNull(data.restingHeartRate),
    workouts: toNumberOrNull(data.workouts),
    synced_at: String(rec.synced_at ?? ''),
  };
}

export async function listHealthDailySummariesRange(
  fromYmd: string,
  toYmd: string,
  source: HealthDailySummary['source'] = 'apple_health'
): Promise<HealthDailySummary[]> {
  const db = await getDb();
  const q = await db.query(
    `
    SELECT day, source, data_json, synced_at
    FROM health_daily_summaries
    WHERE day >= ? AND day <= ? AND source = ?
    ORDER BY day ASC
    `,
    [fromYmd, toYmd, source]
  );

  return mapRows(q).map((rec) => {
    let data: HealthDailySummaryData = {};
    try {
      data = typeof rec.data_json === 'string'
        ? JSON.parse(rec.data_json) as HealthDailySummaryData
        : {};
    } catch {
      data = {};
    }

    return {
      day: String(rec.day ?? ''),
      source: (String(rec.source ?? source) as HealthDailySummary['source']),
      steps: toNumberOrNull(data.steps),
      activeEnergyKcal: toNumberOrNull(data.activeEnergyKcal),
      exerciseMinutes: toNumberOrNull(data.exerciseMinutes),
      sleepMinutes: toNumberOrNull(data.sleepMinutes),
      restingHeartRate: toNumberOrNull(data.restingHeartRate),
      workouts: toNumberOrNull(data.workouts),
      synced_at: String(rec.synced_at ?? ''),
    };
  });
}

/**
 * Inserts exercise and emits change.
 */
export async function insertExerciseAndEmit(input: InsertExerciseInput): Promise<void> {
  await insertExercise(input);
  emitHealthChanged('exercise');
}

/**
 * Upserts fasting window and emits change.
 */
export async function upsertFastingAndEmit(
  day: string,
  first: string | null,
  last: string | null,
  tz?: string
): Promise<void> {
  await upsertFasting(day, first, last, tz);
  emitHealthChanged('fasting');
}

/**
 * Maps entry_type to a typed HealthEventKind.
 */
function mapEntryTypeToKind(t: string): HealthEventKind {
  switch (t) {
    case 'protein':
      return 'protein';
    case 'hydration':
      return 'hydration';
    case 'exercise':
      return 'exercise';
    case 'blood_pressure':
      return 'blood_pressure';
    case 'blood_sugar':
      return 'blood_sugar';
    case 'mood':
      return 'mood';
    case 'bowel':
      return 'bowel';
    case 'injection':
      return 'unknown';
    default:
      return 'unknown';
  }
}
