// src/db/WeeklySummaryRepository.ts
import { getDb } from './sqlite';
import { initHealthTables } from '../db/HealthRepository';

type RunChanges = { lastId?: number; changes?: number };
type RunResult = { changes?: RunChanges };
type QueryResult<T = unknown> = { values?: T[] };

type DB = {
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<QueryResult<T>>;
  run: (sql: string, params?: unknown[]) => Promise<RunResult>;
};

// -----------------------------
// Types used by the page
// -----------------------------
export type IncludePrefs = {
  /** @deprecated email no longer used; always null */
  email?: string | null;
  protein: boolean;
  hydration: boolean;
  bloodPressure: boolean;
  bloodSugar: boolean;
  bowel: boolean;
  exercise: boolean;
  mood: boolean;
  fasting: boolean;
  injection: boolean;
};

export type ArchiveInsert = {
  fromUtc: string;
  toUtc: string;
  tz: string;
  anchor?: {
    type?: 'taken' | 'scheduled' | 'fallback' | 'override' | null;
    used?: string | null;
    takenAt?: string | null;
    scheduledAt?: string | null;
  } | null;
  bullets?: string[];
  injectionTakenAt?: string | null;
  fastingJson?: string | null;
  snapshotJson?: string | null;
};

export type ArchiveRow = {
  id: number;
  from_utc: string;
  to_utc: string;
  tz: string;
  anchor_type: string | null;
  anchor_used: string | null;
  anchor_taken_at: string | null;
  anchor_scheduled_at: string | null;
  /** legacy fields retained for back-compat */
  email: string | null;
  confirm_click_token: string | null;
  sent_at: string | null;
  summary_bullets_json: string | null;
  injection_taken_at: string | null;
  fasting_json: string | null;
  snapshot_json: string | null;
  archived_at: string | null;
  created_at: string;
};

export type ChartRow = { metric: string; png_base64: string | null };

// -----------------------------
// Small helpers (no `any`)
// -----------------------------
function asBool(v: unknown, def: boolean): boolean {
  if (typeof v === 'number') return v === 1;
  if (typeof v === 'boolean') return v;
  return def;
}
function getChangesCount(r: RunResult | undefined): number {
  const c = r?.changes?.changes;
  return typeof c === 'number' ? c : 0;
}
function getLastIdFromRun(r: RunResult | undefined): number | null {
  const id = r?.changes?.lastId;
  return typeof id === 'number' ? id : null;
}
async function getLastInsertRowId(db: DB): Promise<number> {
  const q = await db.query<{ id: number }>('SELECT last_insert_rowid() AS id');
  const v = q.values?.[0]?.id;
  return typeof v === 'number' ? v : 0;
}
// -----------------------------
// Local day + rotation helpers for blood-sugar series
// -----------------------------
type DayKey = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
const DAY_KEYS: DayKey[] = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function localYmd(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

function ymdToDayKey(ymd: string): DayKey {
  // Use noon to dodge DST edge weirdness when constructing Date from Y-M-D
  const d = new Date(`${ymd}T12:00:00`);
  return (d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3) as DayKey) ?? 'Mon';
}


function rotateToStart<T>(arr: readonly T[], startIdx: number): T[] {
  if (startIdx <= 0) return arr.slice() as T[];
  return [...arr.slice(startIdx), ...arr.slice(0, startIdx)];
}

export type BloodSugarWeekSeries = {
  fastingAM: (number | null)[];
  preMeal:   (number | null)[];
  postMeal:  (number | null)[];
  bedtime:   (number | null)[];
};
export type MoodWeekAmPmSeries = {
  am: (number | null)[];   // Mon..Sun averages for 00:01–11:59 local
  pm: (number | null)[];   // Mon..Sun averages for 12:00–23:59 local
};

// -----------------------------
// Filename helpers (repo or UI)
// -----------------------------
export function archiveFilename(fromUtc: string, toUtc: string) {
  const d = (s: string) => new Date(s).toISOString().slice(0, 10);
  return `weekly_${d(fromUtc)}_to_${d(toUtc)}`;
}
export function toArchiveFilename(row: Pick<ArchiveRow, 'from_utc' | 'to_utc'>) {
  return archiveFilename(row.from_utc, row.to_utc);
}

// -----------------------------
// Init (create tables + indexes)
// -----------------------------
async function initWeeklySummaryTables(db: DB): Promise<void> {
  // Ensure FK behavior is on (harmless if already set in your adapter)
  await db.run('PRAGMA foreign_keys = ON');

  await db.run(`
    CREATE TABLE IF NOT EXISTS weekly_summary_prefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT,
      include_protein INTEGER NOT NULL DEFAULT 1,
      include_hydration INTEGER NOT NULL DEFAULT 1,
      include_blood_pressure INTEGER NOT NULL DEFAULT 0,
      include_blood_sugar INTEGER NOT NULL DEFAULT 0,
      include_bowel INTEGER NOT NULL DEFAULT 0,
      include_exercise INTEGER NOT NULL DEFAULT 1,
      include_mood INTEGER NOT NULL DEFAULT 1,
      include_fasting INTEGER NOT NULL DEFAULT 1,
      include_injection INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS weekly_summary_archive (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_utc TEXT NOT NULL,
      to_utc TEXT NOT NULL,
      tz TEXT NOT NULL,
      anchor_type TEXT,
      anchor_used TEXT,
      anchor_taken_at TEXT,
      anchor_scheduled_at TEXT,
      summary_bullets_json TEXT,
      -- legacy columns retained for back-compat
      email TEXT,
      confirm_click_token TEXT,
      sent_at TEXT,
      injection_taken_at TEXT,
      fasting_json TEXT,
      snapshot_json TEXT,
      archived_at TEXT,             -- source of truth for archive time
      created_at TEXT NOT NULL
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS weekly_summary_charts (
      archive_id INTEGER NOT NULL,
      metric TEXT NOT NULL,
      png_base64 TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (archive_id, metric),
      FOREIGN KEY (archive_id) REFERENCES weekly_summary_archive(id) ON DELETE CASCADE
    )
  `);

  // --- Lightweight migration: add archived_at if missing, then backfill ---
  {
    const info = await db.query<{ name: string }>(`PRAGMA table_info('weekly_summary_archive')`);
    const cols = new Set((info.values ?? []).map(r => r.name));
    if (!cols.has('archived_at')) {
      await db.run(`ALTER TABLE weekly_summary_archive ADD COLUMN archived_at TEXT`);
      // Backfill: prefer sent_at, else created_at
      await db.run(`
        UPDATE weekly_summary_archive
           SET archived_at = COALESCE(sent_at, created_at)
        WHERE archived_at IS NULL
      `);
    }
    if (!cols.has('snapshot_json')) {
      await db.run(`ALTER TABLE weekly_summary_archive ADD COLUMN snapshot_json TEXT`);
    }
  }

  // Legacy index (kept if it already exists)
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_weekly_summary_archive_sent_created
    ON weekly_summary_archive (
      COALESCE(sent_at, created_at)
    )
  `);
  // New index ordering by archived_at (falls back to created_at)
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_weekly_summary_archive_archived_created
    ON weekly_summary_archive (
      COALESCE(archived_at, created_at)
    )
  `);
}

// Call before each public op
async function getDbInit(): Promise<DB> {
  const db = (await getDb()) as DB;
  await initWeeklySummaryTables(db);
  // Make sure all health tables (incl. daily_hydration_intake) exist
  await initHealthTables();
  return db;
}

// -----------------------------
// Public API
// -----------------------------
export async function getPrefs(): Promise<IncludePrefs> {
  const db = await getDbInit();
  const res = await db.query('SELECT * FROM weekly_summary_prefs ORDER BY id DESC LIMIT 1');
  const row = (res.values?.[0] ?? {}) as Record<string, unknown>;

  return {
    // email no longer used
    email: null,
    protein:       asBool(row.include_protein,        true),
    hydration:     asBool(row.include_hydration,      true),
    bloodPressure: asBool(row.include_blood_pressure, false),
    bloodSugar:    asBool(row.include_blood_sugar,    false),
    bowel:         asBool(row.include_bowel,          false),
    exercise:      asBool(row.include_exercise,       true),
    mood:          asBool(row.include_mood,           true),
    fasting:       asBool(row.include_fasting,        true),
    injection:     asBool(row.include_injection,      true),
  };
}

export async function savePrefs(p: IncludePrefs): Promise<void> {
  const db = await getDbInit();
  await db.run(
    `INSERT INTO weekly_summary_prefs
      (email, include_protein, include_hydration, include_blood_pressure, include_blood_sugar,
       include_bowel, include_exercise, include_mood, include_fasting, include_injection, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      null, // email deprecated
      p.protein ? 1 : 0,
      p.hydration ? 1 : 0,
      p.bloodPressure ? 1 : 0,
      p.bloodSugar ? 1 : 0,
      p.bowel ? 1 : 0,
      p.exercise ? 1 : 0,
      p.mood ? 1 : 0,
      p.fasting ? 1 : 0,
      p.injection ? 1 : 0,
    ]
  );
}

export async function insertArchive(a: ArchiveInsert): Promise<number> {
  const db = await getDbInit();
  const bulletsJson = a.bullets ? JSON.stringify(a.bullets) : null;
  const an = a.anchor ?? {};

  const r = await db.run(
    `INSERT INTO weekly_summary_archive
      (from_utc, to_utc, tz,
       anchor_type, anchor_used, anchor_taken_at, anchor_scheduled_at,
       summary_bullets_json,
       injection_taken_at, fasting_json, snapshot_json, archived_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      a.fromUtc, a.toUtc, a.tz,
      an.type ?? null, an.used ?? null, an.takenAt ?? null, an.scheduledAt ?? null,
      bulletsJson,
      a.injectionTakenAt ?? null, a.fastingJson ?? null, a.snapshotJson ?? null,
    ]
  );

  const fromRun = getLastIdFromRun(r);
  return fromRun !== null ? fromRun : await getLastInsertRowId(db);
}

export async function listArchive(limit = 12): Promise<ArchiveRow[]> {
  const db = await getDbInit();
  const res = await db.query<ArchiveRow>(
    `SELECT * FROM weekly_summary_archive
       ORDER BY COALESCE(archived_at, created_at) DESC
       LIMIT ?`,
    [limit]
  );
  return res.values ?? [];
}

// Fetch a single archive record (for detail page)
export async function getArchive(id: number): Promise<ArchiveRow | null> {
  const db = await getDbInit();
  const res = await db.query<ArchiveRow>(
    `SELECT * FROM weekly_summary_archive WHERE id = ? LIMIT 1`,
    [id]
  );
  return (res.values?.[0] as ArchiveRow) ?? null;
}

// Nicety alias for detail page naming
export async function getArchiveCharts(archiveId: number): Promise<Record<string, string>> {
  const rows = await getChartsForArchive(archiveId);
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.png_base64) out[r.metric] = r.png_base64;
  }
  return out;
}

export async function upsertChart(archiveId: number, metric: string, pngBase64: string): Promise<void> {
  const db = await getDbInit();
  const upd = await db.run(
    `UPDATE weekly_summary_charts
       SET png_base64 = ?, created_at = datetime('now')
     WHERE archive_id = ? AND metric = ?`,
    [pngBase64, archiveId, metric]
  );

  if (getChangesCount(upd) === 0) {
    await db.run(
      `INSERT OR IGNORE INTO weekly_summary_charts (archive_id, metric, png_base64, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [archiveId, metric, pngBase64]
    );
  }
}

export async function getChartsForArchive(archiveId: number): Promise<ChartRow[]> {
  const db = await getDbInit();
  const res = await db.query<ChartRow>(
    `SELECT metric, png_base64
       FROM weekly_summary_charts
      WHERE archive_id = ?
      ORDER BY metric ASC`,
    [archiveId]
  );
  return res.values ?? [];
}

export async function deleteArchive(id: number): Promise<void> {
  const db = await getDbInit();
  await db.run('DELETE FROM weekly_summary_charts WHERE archive_id = ?', [id]);
  await db.run('DELETE FROM weekly_summary_archive WHERE id = ?', [id]);
}
// -----------------------------
// Mood week series (AM / PM averages)
// -----------------------------
export async function getMoodWeekAmPmSeries(
  fromUtc: string,
  toUtc: string,
  tz: string,
  anchorStartIdx: number
): Promise<MoodWeekAmPmSeries> {
  const db = await getDbInit();

  // Prepare sums and counts per weekday index 0..6
  const amSum = Array(7).fill(0) as number[];
  const amCnt = Array(7).fill(0) as number[];
  const pmSum = Array(7).fill(0) as number[];
  const pmCnt = Array(7).fill(0) as number[];

 // getMoodWeekAmPmSeries
const res = await db.query<{ recorded_at: string; data_json: string }>(
  `
    SELECT recorded_at, data_json
      FROM health_logs
     WHERE entry_type = 'mood'
       AND datetime(recorded_at) >= datetime(?)
       AND datetime(recorded_at) <  datetime(?)
     ORDER BY recorded_at ASC
  `,
  [fromUtc, toUtc]
);

  // Bin by local weekday + AM/PM window
  for (const r of (res.values ?? [])) {
    if (!r?.recorded_at || !r?.data_json) continue;
    const iso = r.recorded_at;
    const ymd = localYmd(iso, tz);
    const dayKey = ymdToDayKey(ymd);
    const idx = DAY_KEYS.indexOf(dayKey);
    if (idx < 0) continue;

    let value: number | null = null;
    try {
     // Accept several keys: value | score | mood | mood_score
      type MoodKey = 'value' | 'score' | 'mood' | 'mood_score';
      const j = JSON.parse(r.data_json) as Record<string, unknown>;

      const toNumber = (u: unknown): number | null => {
        if (typeof u === 'number') return Number.isFinite(u) ? u : null;
        if (typeof u === 'string') {
          const n = Number(u.trim());
          return Number.isFinite(n) ? n : null;
        }
        return null;
      };

      const keys: readonly MoodKey[] = ['value', 'score', 'mood', 'mood_score'] as const;
      let v: number | null = null;
      for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(j, k)) {
          const maybe = toNumber(j[k]);
          if (maybe != null) { v = maybe; break; }
        }
      }
      if (v != null && v >= 1 && v <= 5) value = v;
    } catch { /* ignore parse errors */ }
    if (value == null) continue;
   // Use hour+minute so we can match the spec precisely (AM = 00:01–11:59)
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date(iso));
    const hh = Number(parts.find(p => p.type === 'hour')?.value ?? '0');
    const mm = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
    const minutes = hh * 60 + mm;
    const isAm = minutes >= 1 && minutes < 12 * 60;
    if (isAm) {
      amSum[idx] += value;
      amCnt[idx] += 1;
    } else {
      pmSum[idx] += value;
      pmCnt[idx] += 1;
    }
  }

  // Compute averages, convert 0-count to null
  const amAvg = amSum.map((s, i) => (amCnt[i] > 0 ? s / amCnt[i] : null));
  const pmAvg = pmSum.map((s, i) => (pmCnt[i] > 0 ? s / pmCnt[i] : null));

  // Rotate to anchored start
  const start = Math.max(0, anchorStartIdx);
  return {
    am: rotateToStart(amAvg, start),
    pm: rotateToStart(pmAvg, start),
  };
}

// -----------------------------
// Blood sugar week series (4 categories)
// -----------------------------
export async function getBloodSugarWeekSeries(
  fromUtc: string,
  toUtc: string,
  tz: string,
  anchorStartIdx: number
): Promise<BloodSugarWeekSeries> {
  const db = await getDbInit();

  // Pre-seed series
  const fastingAM = Array(7).fill(null) as (number | null)[];
  const preMeal   = Array(7).fill(null) as (number | null)[];
  const postMeal  = Array(7).fill(null) as (number | null)[];
  const bedtime   = Array(7).fill(null) as (number | null)[];

  // getBloodSugarWeekSeries
const res = await db.query<{ recorded_at: string; data_json: string }>(
  `
    SELECT recorded_at, data_json
      FROM health_logs
     WHERE entry_type = 'blood_sugar'
       AND datetime(recorded_at) >= datetime(?)
       AND datetime(recorded_at) <  datetime(?)
     ORDER BY recorded_at ASC
  `,
  [fromUtc, toUtc]
);

  // Keep latest per (local day, category)
  const latest: Record<string, { t: number; value: number }> = Object.create(null);
  for (const r of (res.values ?? [])) {
    if (!r?.recorded_at || !r?.data_json) continue;
    const iso = r.recorded_at;
    const ymd = localYmd(iso, tz);
    let cat = '';
    let value: unknown = null;
    try {
      const j = JSON.parse(r.data_json);
      cat = String(j?.category ?? '');
      value = j?.value;
    } catch { /* ignore parse errors */ }
    if (!cat) continue;
    const v = typeof value === 'number' && Number.isFinite(value) ? value : NaN;
    if (!Number.isFinite(v)) continue;
    const key = `${ymd}::${cat}`;
    const t = Date.parse(iso);
    const prev = latest[key];
    if (!prev || t >= prev.t) latest[key] = { t, value: v };
  }

  // Place into weekday slots
  for (const key of Object.keys(latest)) {
    const [ymd, cat] = key.split('::');
    const idx = DAY_KEYS.indexOf(ymdToDayKey(ymd));
    if (idx < 0) continue;
    const val = latest[key].value;
    if (cat === 'fasting_am') fastingAM[idx] = val;
    else if (cat === 'pre_meal') preMeal[idx] = val;
    else if (cat === 'post_meal') postMeal[idx] = val;
    else if (cat === 'bedtime')   bedtime[idx] = val;
  }

  // Rotate to anchored start
  return {
    fastingAM: rotateToStart(fastingAM, Math.max(0, anchorStartIdx)),
    preMeal:   rotateToStart(preMeal,   Math.max(0, anchorStartIdx)),
    postMeal:  rotateToStart(postMeal,  Math.max(0, anchorStartIdx)),
    bedtime:   rotateToStart(bedtime,   Math.max(0, anchorStartIdx)),
  };
}
