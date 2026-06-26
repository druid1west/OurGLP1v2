// src/db/SettingsRepository.ts
import { getDb } from '../db/sqlite';


/* ────────────────────────────────────────────────────────────────────────────
   Types
──────────────────────────────────────────────────────────────────────────── */
export type WeekdayFull =
  | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';

export type AppSettings = {
  id?: number;
  timezone?: string | null;
  fasting_schedule?: string | null; // e.g., "16:8" (we read the first number)
  fasting_start?: string | null;    // "HH:MM"
  injection_day?: string | null;    // "Monday".."Sunday"
  injection_time?: string | null;   // "HH:MM"
  notifications_permission?: 'granted' | 'denied' | 'prompt' | null;
  notifications_enabled?: 0 | 1 | null;
  last_permission_check?: string | null;
  last_prompt_at?: string | null;

  // App toggles
  push_enabled?: boolean;
  analytics_opt_in?: boolean;
  notification_sound?: SoundId;
};

export type Settings = {
  timezone?: string;
  fasting_schedule?: string;
  fasting_start?: string;
  injection_day?: WeekdayFull;
  injection_time?: string;
};

export type SoundId = 'default' | 'beep' | 'chime';

/* ────────────────────────────────────────────────────────────────────────────
   Capacitor SQLite helpers (iOS rows can come in different shapes)
──────────────────────────────────────────────────────────────────────────── */
type SqliteRowObject = Record<string, unknown>;
type SqliteQueryResult = { values?: unknown[] | null } | null | undefined;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function firstRowObject(res: SqliteQueryResult): SqliteRowObject | null {
  const values = res?.values;
  if (!values || values.length === 0) return null;

  // A) [[col...], [val...]]
  if (Array.isArray(values[0]) && values.length >= 2 && Array.isArray(values[1])) {
    const cols = values[0] as unknown[];
    const row = values[1] as unknown[];
    const out: SqliteRowObject = {};
    cols.forEach((c, i) => { if (typeof c === 'string') out[c] = row[i]; });
    return out;
  }

  // B) [{ ios_columns:[...] }, { col: val, ... }]
  if (isRecord(values[0]) && 'ios_columns' in values[0]) {
    const cols = (values[0] as { ios_columns: unknown }).ios_columns;
    const rowObj = values[1];
    if (Array.isArray(cols) && isRecord(rowObj)) {
      const out: SqliteRowObject = {};
      cols.forEach((c) => {
        if (typeof c === 'string') {
          out[c] = Object.prototype.hasOwnProperty.call(rowObj, c)
            ? (rowObj as SqliteRowObject)[c]
            : undefined;
        }
      });
      return out;
    }
  }

  // C) [{ col: val, ... }]
  if (isRecord(values[0])) return values[0] as SqliteRowObject;

  return null;
}

type NotificationPermission = 'granted' | 'denied' | 'prompt';

function toNotificationPermission(v: unknown): NotificationPermission | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (s === 'granted' || s === 'denied' || s === 'prompt') return s;
  return null;
}

function toZeroOneOrNull(v: unknown): 0 | 1 | null {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n ? 1 : 0;
}

/* ────────────────────────────────────────────────────────────────────────────
   Normalizers
──────────────────────────────────────────────────────────────────────────── */
function toBooleanLike(v: unknown, defaultVal = true): boolean {
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n !== 0 : v.trim().toLowerCase() === 'true';
  }
  return defaultVal;
}

function toHHMM(t?: string | null): string | undefined {
  if (!t) return undefined;
  const s = String(t).trim();
  if (/^\d{2}:\d{2}$/.test(s)) return s;
  if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s.slice(0, 5);
  const m = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (m) {
    const hh = String(Number(m[1])).padStart(2, '0');
    const mm = String(Number(m[2])).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return undefined;
}

function normalizeWeekdayFull(d?: string | null): WeekdayFull | undefined {
  if (!d) return undefined;
  const k = d.slice(0, 3).toLowerCase();
  switch (k) {
    case 'mon': return 'Monday';
    case 'tue': return 'Tuesday';
    case 'wed': return 'Wednesday';
    case 'thu': return 'Thursday';
    case 'fri': return 'Friday';
    case 'sat': return 'Saturday';
    case 'sun': return 'Sunday';
    default: return undefined;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   PRAGMA table_info(...) parsing — strictly typed (no any)
──────────────────────────────────────────────────────────────────────────── */
type PragmaTableInfoRow = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

type IOSColumnsHeader = { ios_columns: string[] };

function isIOSColumnsHeader(v: unknown): v is IOSColumnsHeader {
  return typeof v === 'object' && v !== null && 'ios_columns' in v;
}

function isPragmaRow(v: unknown): v is PragmaTableInfoRow {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.cid === 'number' &&
    typeof r.name === 'string' &&
    typeof r.type === 'string' &&
    typeof r.notnull === 'number' &&
    (typeof r.dflt_value === 'string' || r.dflt_value === null) &&
    typeof r.pk === 'number'
  );
}

function parsePragmaRows(values: unknown[] | null | undefined): PragmaTableInfoRow[] {
  if (!Array.isArray(values) || values.length === 0) return [];

  // iOS shape
  if (isIOSColumnsHeader(values[0])) {
    const rows = values.slice(1);
    return rows.filter(isPragmaRow);
  }

  // Standard object rows
  if (values.every(isPragmaRow)) {
    return values as PragmaTableInfoRow[];
  }

  // Fallback for array-of-arrays
  if (Array.isArray(values[0]) && Array.isArray(values[1])) {
    const cols = values[0] as unknown[];
    const out: PragmaTableInfoRow[] = [];
    for (let i = 1; i < values.length; i++) {
      const rowArr = values[i] as unknown[];
      const obj: Record<string, unknown> = {};
      cols.forEach((c, idx) => {
        if (typeof c === 'string') obj[c] = rowArr[idx];
      });
      if (isPragmaRow(obj)) out.push(obj);
    }
    return out;
  }

  return [];
}

/* ────────────────────────────────────────────────────────────────────────────
   Migrations (idempotent)
──────────────────────────────────────────────────────────────────────────── */
async function columnExists(table: string, column: string): Promise<boolean> {
  const db = await getDb();
  const res = await db.query(`PRAGMA table_info(${table})`);
  const rows = parsePragmaRows(res?.values ?? null);
  return rows.some((r) => r.name === column);
}

type ColumnSpec = { name: string; type: string; defaultSql?: string };
let settingsInitPromise: Promise<void> | null = null;

async function ensureColumns(table: string, cols: ReadonlyArray<ColumnSpec>): Promise<void> {
  const db = await getDb();
  for (const col of cols) {
    const has = await columnExists(table, col.name);
    if (!has) {
      await db.execute(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.type};`);
      if (col.defaultSql) {
        await db.execute(`UPDATE ${table} SET ${col.name} = ${col.defaultSql} WHERE id = 1;`);
      }
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   Table init (singleton row id = 1) + migration to match schema
──────────────────────────────────────────────────────────────────────────── */
async function doInitSettingsTable(): Promise<void> {
  const db = await getDb();

  // 1) Ensure table exists (minimal columns so ALTERs never get blocked)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_logged_in_user_id TEXT
    );
  `);

  // 2) Ensure singleton row exists
  const exists = await db.query(`SELECT 1 FROM settings WHERE id = 1 LIMIT 1`);
  if (!firstRowObject(exists)) {
    await db.run(`INSERT INTO settings (id) VALUES (1)`);
  }

  // 3) Ensure required columns exist (matches your schema)
  await ensureColumns('settings', [
    { name: 'timezone',                 type: 'TEXT' },
    { name: 'fasting_schedule',         type: 'TEXT' },
    { name: 'fasting_start',            type: 'TEXT' },
    { name: 'injection_day',            type: 'TEXT' },
    { name: 'injection_time',           type: 'TEXT' },
    { name: 'notifications_permission', type: 'TEXT' },
    { name: 'notifications_enabled',    type: 'INTEGER' },
    { name: 'last_permission_check',    type: 'TEXT' },
    { name: 'last_prompt_at',           type: 'TEXT' },
    { name: 'push_enabled',             type: 'INTEGER', defaultSql: '1' },
    { name: 'analytics_opt_in',         type: 'INTEGER', defaultSql: '1' },
    { name: 'updated_at',               type: 'TEXT',    defaultSql: `datetime('now')` },
    { name: 'notification_sound',       type: 'TEXT',    defaultSql: `'default'` },
  ]);
}

async function initSettingsTable(): Promise<void> {
  settingsInitPromise ??= doInitSettingsTable().catch((error) => {
    settingsInitPromise = null;
    throw error;
  });
  return settingsInitPromise;
}

/* ────────────────────────────────────────────────────────────────────────────
   Optional helpers: keep users table in sync if present
──────────────────────────────────────────────────────────────────────────── */
async function getLastUserId(): Promise<string | null> {
  const db = await getDb();
  const r = await db.query(`SELECT last_logged_in_user_id FROM settings WHERE id = 1`);
  const row = firstRowObject(r);
  const v = row?.last_logged_in_user_id;
  return typeof v === 'string' && v ? v : null;
}

async function tableHasColumns(table: string, cols: ReadonlyArray<string>): Promise<boolean> {
  const flags = await Promise.all(cols.map((c) => columnExists(table, c)));
  return flags.every(Boolean);
}

async function mirrorIntoUsers(patch: Partial<Settings>): Promise<void> {
  const uid = await getLastUserId();
  if (!uid) return;

  // Only if users table has these columns
  const can = await tableHasColumns('users', [
    'timezone', 'fasting_schedule', 'fasting_start', 'injection_day', 'injection_time'
  ]);
  if (!can) return;

  // Build dynamic UPDATE for only provided fields
  const sets: string[] = [];
  const vals: string[] = [];

  if (typeof patch.timezone === 'string')         { sets.push('timezone = ?');         vals.push(patch.timezone); }
  if (typeof patch.fasting_schedule === 'string') { sets.push('fasting_schedule = ?'); vals.push(patch.fasting_schedule); }
  if (typeof patch.fasting_start === 'string')    { sets.push('fasting_start = ?');    vals.push(patch.fasting_start); }
  if (typeof patch.injection_day === 'string')    { sets.push('injection_day = ?');    vals.push(patch.injection_day); }
  if (typeof patch.injection_time === 'string')   { sets.push('injection_time = ?');   vals.push(patch.injection_time); }

  if (sets.length > 0) {
    const db = await getDb();
    await db.run(
      `UPDATE users SET ${sets.join(', ')} WHERE id = ?`,
      [...vals, uid]
    );
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   Core getters/setters used by DayPage
──────────────────────────────────────────────────────────────────────────── */
export async function getSettings(): Promise<Settings> {
  await initSettingsTable();
  const db = await getDb();
  const res = await db.query(`
    SELECT timezone, fasting_schedule, fasting_start, injection_day, injection_time
    FROM settings WHERE id = 1
  `);
  const row = firstRowObject(res);

  const timezone =
    typeof row?.timezone === 'string' && row.timezone.trim()
      ? String(row.timezone)
      : (() => {
          try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; }
          catch { return undefined; }
        })();

  const fasting_schedule =
    typeof row?.fasting_schedule === 'string' && row.fasting_schedule.trim()
      ? String(row.fasting_schedule)
      : undefined;

  const fasting_start = toHHMM(typeof row?.fasting_start === 'string' ? row.fasting_start : undefined);
  const injection_day = normalizeWeekdayFull(typeof row?.injection_day === 'string' ? row.injection_day : undefined);
  const injection_time = toHHMM(typeof row?.injection_time === 'string' ? row.injection_time : undefined);

  return { timezone, fasting_schedule, fasting_start, injection_day, injection_time };
}

/** Update injection schedule and return normalized values used by the UI. */
export async function setInjectionSchedule(
  dayFull: WeekdayFull,
  hhmm: string
): Promise<{ dayFull: WeekdayFull; hhmm: string }> {
  await initSettingsTable();
  const db = await getDb();

  const normDay = normalizeWeekdayFull(dayFull) ?? 'Monday';
  const normTime = toHHMM(hhmm) ?? '08:00';

  await db.run(
    `UPDATE settings
     SET injection_day = ?, injection_time = ?, updated_at = datetime('now')
     WHERE id = 1`,
    [normDay, normTime]
  );

  await mirrorIntoUsers({ injection_day: normDay, injection_time: normTime });

  return { dayFull: normDay, hhmm: normTime };
}

/** One-call helper to set both values that DayPage needs for shading. */
export async function setFastingPlan(
  fasting_schedule: string,   // e.g. "16:8" or "16"
  fasting_start: string       // "HH:MM"
): Promise<{ fasting_schedule: string; fasting_start: string }> {
  await initSettingsTable();
  const db = await getDb();
  const start = toHHMM(fasting_start) ?? '12:00';

  await db.run(
    `UPDATE settings
     SET fasting_schedule = ?, fasting_start = ?, updated_at = datetime('now')
     WHERE id = 1`,
    [fasting_schedule, start]
  );

  await mirrorIntoUsers({ fasting_schedule, fasting_start: start });

  return { fasting_schedule, fasting_start: start };
}

/** Optional: independent setters if you prefer to update separately. */
export async function setFastingScheduleStr(s: string): Promise<string> {
  await initSettingsTable();
  const db = await getDb();
  await db.run(
    `UPDATE settings SET fasting_schedule = ?, updated_at = datetime('now') WHERE id = 1`,
    [s]
  );
  await mirrorIntoUsers({ fasting_schedule: s });
  return s;
}

export async function setFastingStartHHMM(hhmm: string): Promise<string> {
  await initSettingsTable();
  const db = await getDb();
  const norm = toHHMM(hhmm) ?? '12:00';
  await db.run(
    `UPDATE settings SET fasting_start = ?, updated_at = datetime('now') WHERE id = 1`,
    [norm]
  );
  await mirrorIntoUsers({ fasting_start: norm });
  return norm;
}
/** Get the global notification sound selection. */
export async function getNotificationSoundId(): Promise<SoundId> {
  await initSettingsTable();
  const db = await getDb();
  const res = await db.query(
    `SELECT notification_sound AS v FROM settings WHERE id = 1`
  );
  const row = firstRowObject(res);
  const raw = typeof row?.v === 'string' ? row.v.trim() : 'default';
  return raw === 'beep' || raw === 'chime' ? raw : 'default';
}

/** Set the global notification sound selection. */
export async function setNotificationSoundId(sound: SoundId): Promise<void> {
  await initSettingsTable();
  const db = await getDb();
  await db.run(
    `UPDATE settings
       SET notification_sound = ?, updated_at = datetime('now')
     WHERE id = 1`,
    [sound]
  );
}


/* ────────────────────────────────────────────────────────────────────────────
   Notifications & misc app toggles
──────────────────────────────────────────────────────────────────────────── */
export async function setNotificationFields(
  permission: 'granted' | 'denied' | 'prompt',
  enabled: boolean
): Promise<void> {
  await initSettingsTable();
  const db = await getDb();
  await db.run(
    `UPDATE settings
     SET notifications_permission = ?, notifications_enabled = ?, last_permission_check = datetime('now'), updated_at = datetime('now')
     WHERE id = 1`,
    [permission, enabled ? 1 : 0]
  );
}

export async function getAppSettings(): Promise<AppSettings> {
  await initSettingsTable();
  const db = await getDb();
  const res = await db.query(`
    SELECT
      timezone, fasting_schedule, fasting_start,
      injection_day, injection_time,
      notifications_permission, notifications_enabled, last_permission_check, last_prompt_at,
      push_enabled, analytics_opt_in,
      notification_sound
    FROM settings WHERE id = 1
  `);
  const row = firstRowObject(res);

  return {
    timezone: row?.timezone == null ? null : String(row.timezone),
    fasting_schedule: row?.fasting_schedule == null ? null : String(row.fasting_schedule),
    fasting_start:
      row?.fasting_start == null ? null : (toHHMM(String(row.fasting_start)) ?? null),
    injection_day: row?.injection_day == null ? null : String(row.injection_day),
    injection_time:
      row?.injection_time == null ? null : (toHHMM(String(row.injection_time)) ?? null),
    notifications_permission: toNotificationPermission(row?.notifications_permission),
    notifications_enabled: toZeroOneOrNull(row?.notifications_enabled),
    last_permission_check: row?.last_permission_check == null ? null : String(row.last_permission_check),
    last_prompt_at: row?.last_prompt_at == null ? null : String(row.last_prompt_at),
    push_enabled: toBooleanLike(row?.push_enabled, true),
    analytics_opt_in: toBooleanLike(row?.analytics_opt_in, true),
    notification_sound:
      row?.notification_sound === 'beep' || row?.notification_sound === 'chime'
        ? (row.notification_sound as SoundId)
        : 'default',
  };
}

export async function updateAppSettings(partial: Partial<AppSettings>): Promise<void> {
  await initSettingsTable();
  const db = await getDb();

  const cur = await getAppSettings();
  const next = { ...cur, ...partial };

  await db.run(
    `UPDATE settings
     SET push_enabled = ?, analytics_opt_in = ?, updated_at = datetime('now')
     WHERE id = 1`,
    [
      next.push_enabled ? 1 : 0,
      next.analytics_opt_in ? 1 : 0,
    ]
  );
   if (partial.notification_sound) {
    await db.run(
      `UPDATE settings
         SET notification_sound = ?, updated_at = datetime('now')
       WHERE id = 1`,
      [partial.notification_sound]
    );
  }
}
// PushToken table
export async function ensurePushTokensTable(): Promise<void> {
  
  const db = await getDb();
   
  await db.execute(`
    CREATE TABLE IF NOT EXISTS push_tokens (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL,         -- 'ios' | 'android' | 'web'
      token TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);`);
  
}

/* ────────────────────────────────────────────────────────────────────────────
   Convenience timezone setter (used by profile, etc)
──────────────────────────────────────────────────────────────────────────── */
export async function setTimezone(tz: string): Promise<void> {
  await initSettingsTable();
  const db = await getDb();
  await db.run(
    `UPDATE settings SET timezone = ?, updated_at = datetime('now') WHERE id = 1`,
    [tz]
  );
  await mirrorIntoUsers({ timezone: tz });
}



