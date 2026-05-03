// src/pages/HealthTracker.tsx
import { useHistory } from 'react-router-dom';
import type { CelebrationContext } from '../types/celebration';
import {
  buildSingleEntryCelebration,
  buildDailyTotalCelebration,
} from '../celebration/celebrationLogic';
import { logger } from '@/utils/logger';
import { IS_LOCAL_AUTH } from '@/config/runtime';
import {
  initHealthTables,
  insertHealthLog,
  getFastingByDay,
  upsertFasting,
  clearFastingByDay,
  insertExercise,
  listHealthLogsRange,
  upsertDailyProtein,
  upsertDailyHydration,
} from '../db/HealthRepository';
import {
  insertSleepStart,
  updateWakeTime,
  listSleepLogsRange,
} from '../db/SleepRepository';

import React, { useEffect, useState, useCallback } from 'react';
import { IonPage, IonButton, IonContent } from '@ionic/react';
import dayjs from 'dayjs';
import styles from './HealthTracker.module.css';

import { useAuth } from '../context/useAuth';
import type { User } from '../context/authTypes';

// Import navigation components
import TopNav from '../context/TopNav';
import BottomNav from '../context/BottomNav';

import { toHHMMSS, isDayShort } from '../utils/validators';
import type { DayShort } from '../utils/validators';

// ---------------------------------------------------------------------------
// Minimal TZ helpers: convert a local wall-clock time in a given IANA tz to UTC
// ---------------------------------------------------------------------------
// UTC ISO -> local YYYY-MM-DD for a given tz
const ymdFromIsoInTz = (iso: string, tz: string): string => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
};

const getDeviceTz = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

type PartType = Intl.DateTimeFormatPart['type'];
function getTzParts(d: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = fmt.formatToParts(d);
  const n = (t: PartType) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const wd = (parts.find((p) => p.type === 'weekday')?.value || 'Sun').slice(0, 3);
  const wmap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: n('year'),
    month: n('month'),
    day: n('day'),
    hour: n('hour'),
    minute: n('minute'),
    second: n('second'),
    weekday: wmap[wd] ?? 0,
  };
}

// Given a local wall time in IANA tz, return the corresponding UTC Date
function tzLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const base = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const p = getTzParts(base, tz);
  const want = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
  const diffMs = seen - want;
  return new Date(base.getTime() - diffMs);
}

// Local-day bounds (in UTC ISO) for queries
const localDayBoundsUtc = (ymdLocal: string, tz: string) => {
  const [y, m, d] = ymdLocal.split('-').map(Number);
  const start = tzLocalToUtc(y, m, d, 0, 0, tz).toISOString();
  // next local midnight
  const next = new Date(Date.UTC(y, m - 1, d) + 24 * 60 * 60 * 1000);
  const end = tzLocalToUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    0,
    0,
    tz,
  ).toISOString();
  return { start, end };
};

// From <input type="datetime-local"> "YYYY-MM-DDTHH:mm" + user tz → UTC ISO
function isoFromDatetimeLocalForTz(dtLocal: string, tz: string): string | null {
  if (!dtLocal) return null;
  const [date, time] = dtLocal.split('T');
  if (!date || !time) return null;
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return tzLocalToUtc(y, m, d, hh, mm, tz).toISOString();
}

// ---------------------------------------------------------------------------
// Allowed health-log entry types
// ---------------------------------------------------------------------------
const ALLOWED_ENTRY_TYPES = [
  'protein',
  'hydration',
  'exercise',
  'weight',
  'blood_pressure',
  'blood_sugar',
  'mood',
  'bowel',
] as const;
type AllowedEntryType = (typeof ALLOWED_ENTRY_TYPES)[number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ProteinSource =
  | 'egg'
  | 'chicken'
  | 'yogurt'
  | 'peanutButter'
  | 'whey'
  | 'lentils'
  | 'tofu'
  | 'other';

type HydrationData = { amount: number; note?: string };
type ProteinData = { grams: number; notes?: string };
type BloodSugarData = { value: number; unit: GlucoseUnit; note?: string };
type BloodPressureData = { systolic: number; diastolic: number; pulse: number | null };

type GlucoseUnit = 'mg/dL' | 'mmol/L';
type BloodSugarInput = { value?: unknown; unit?: unknown; note?: unknown };

type HealthLogData =
  | BloodSugarData // blood_sugar
  | { systolic: number; diastolic: number; pulse: number | null } // blood_pressure
  | Record<string, never> // bowel
  | { grams: number; notes?: string } // protein
  | { amount: number; note?: string }; // hydration

type Profile = { fasting_schedule?: string; fasting_start?: string };

// ---------------------------------------------------------------------------
// Validators & helpers (typed, no "any")
// ---------------------------------------------------------------------------
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;
const has = (o: Record<string, unknown>, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

const isHydrationData = (d: unknown): d is HydrationData => isObj(d) && has(d, 'amount');
const isProteinData = (d: unknown): d is ProteinData => isObj(d) && has(d, 'grams');
const isBloodPressureData = (d: unknown): d is BloodPressureData =>
  isObj(d) && has(d, 'systolic') && has(d, 'diastolic');

const toNumberOrNull = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

type Ok<T> = { ok: true; value: T };
type Bad = { ok: false; message: string };
const ok = <T,>(value: T): Ok<T> => ({ ok: true, value });
const bad = (message: string): Bad => ({ ok: false, message });

const intBetween = (n: unknown, lo: number, hi: number) =>
  Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;
const numBetween = (n: unknown, lo: number, hi: number) => {
  const v = Number(n);
  return Number.isFinite(v) && v >= lo && v <= hi;
};

const validateHydration = (u: unknown): Ok<HydrationData> | Bad => {
  if (!isHydrationData(u)) return bad('Invalid hydration payload.');
  const amount = Number((u as HydrationData).amount);
  if (!intBetween(amount, 0, 5000)) return bad('Water must be 0–5000 mL.');
  const noteRaw = (u as HydrationData).note;
  const note =
    typeof noteRaw === 'string'
      ? noteRaw.slice(0, 500)
      : noteRaw == null
        ? undefined
        : String(noteRaw).slice(0, 500);
  return ok({ amount, note });
};

const validateProtein = (u: unknown): Ok<ProteinData> | Bad => {
  if (!isProteinData(u)) return bad('Invalid protein payload.');
  const gramsRaw = (u as ProteinData).grams;
  const grams = Number(gramsRaw);
  if (!Number.isFinite(grams)) return bad('Protein must be a number.');
  if (!intBetween(grams, 0, 300)) return bad('Protein must be 0–300 g.');
  const notesRaw = (u as ProteinData).notes;
  const notes =
    typeof notesRaw === 'string'
      ? notesRaw.slice(0, 500)
      : notesRaw == null
        ? undefined
        : String(notesRaw).slice(0, 500);
  return ok({ grams, notes });
};

const GLUCOSE_BOUNDS: Record<GlucoseUnit, { min: number; max: number }> = {
  'mg/dL': { min: 20, max: 600 },
  'mmol/L': { min: 1.1, max: 33.3 },
};

const isUnit = (x: unknown): x is GlucoseUnit => x === 'mg/dL' || x === 'mmol/L';
const isBloodSugarInput = (u: unknown): u is BloodSugarInput =>
  typeof u === 'object' && u !== null && 'value' in u;

const validateBloodSugar = (u: unknown): Ok<BloodSugarData> | Bad => {
  if (!isBloodSugarInput(u)) return bad('Invalid blood sugar payload.');
  const unit: GlucoseUnit = isUnit(u.unit) ? u.unit : 'mg/dL';
  const value =
    typeof u.value === 'number'
      ? u.value
      : typeof u.value === 'string'
        ? Number(u.value)
        : NaN;
  if (!Number.isFinite(value)) return bad('Enter a number');
  const { min, max } = GLUCOSE_BOUNDS[unit];
  if (value < min || value > max) return bad(`Blood sugar must be ${min}–${max} ${unit}.`);
  const note =
    typeof u.note === 'string'
      ? u.note.slice(0, 500)
      : u.note == null
        ? undefined
        : String(u.note).slice(0, 500);
  return ok({ value, unit, note });
};

const validateBloodPressure = (u: unknown): Ok<BloodPressureData> | Bad => {
  if (!isBloodPressureData(u)) return bad('Invalid blood pressure payload.');
  const systolic = Number((u as Record<string, unknown>).systolic);
  const diastolic = Number((u as Record<string, unknown>).diastolic);
  const pulse = toNumberOrNull((u as Record<string, unknown>).pulse);
  if (!numBetween(systolic, 70, 250)) return bad('Systolic must be 70–250.');
  if (!numBetween(diastolic, 40, 150)) return bad('Diastolic must be 40–150.');
  if (pulse !== null && !numBetween(pulse, 30, 220)) return bad('Pulse must be 30–220.');
  return ok({ systolic, diastolic, pulse });
};

// Small helper to pull a timezone off the auth user (unknown shape-safe)
function getUserTimezone(u: unknown): string | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const r = u as Record<string, unknown>;
  return typeof r.timezone === 'string' ? r.timezone : undefined;
}

// Safely extract a string user id without assuming a strict shape
function getUserIdString(u: unknown): string | null {
  if (!u || typeof u !== 'object') return null;
  const r = u as Record<string, unknown>;
  const raw = r.id;
  if (typeof raw === 'string' && raw.trim() !== '') return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const HealthTracker: React.FC = () => {
  const { user: authUser, isPro } = useAuth() as {
    user: User | null;
    isPro: boolean;
  };

  const history = useHistory();

  const LAST_CELEBRATION_KEY = 'lastCelebrationCtx';

  const navigateToCelebration = React.useCallback(
    (ctx: CelebrationContext): void => {
      try {
        // Persist the context so CelebrationPage can recover it
        window.sessionStorage.setItem(LAST_CELEBRATION_KEY, JSON.stringify(ctx));
      } catch {
        // If storage is unavailable, just ignore – navigation still works.
      }

      history.push('/celebrate', ctx);
    },
    [history],
  );

  // keep your tracker timezone logic, but don’t assume shape
  const userTz = getUserTimezone(authUser) || getDeviceTz();

  // Blood Sugar
  const [bloodSugar, setBloodSugar] = useState('');
  const [bloodSugarTime, setBloodSugarTime] = useState('');
  const [bsUnit, setBsUnit] = useState<GlucoseUnit>('mg/dL');
  const [bsCategory, setBsCategory] = useState<
    'fasting_am' | 'pre_meal' | 'post_meal' | 'bedtime'
  >('fasting_am');

  // Blood Pressure
  const [systolic, setSystolic] = useState('');
  const [diastolic, setDiastolic] = useState('');
  const [pulse, setPulse] = useState('');
  const [bpTime, setBpTime] = useState('');

  // Bowel
  const [bowelTime, setBowelTime] = useState('');

  // Protein
  const [selectedProteinSource, setSelectedProteinSource] = useState<ProteinSource | ''>('');
  const [proteinGrams, setProteinGrams] = useState<number | ''>('');
  const [proteinNotes, setProteinNotes] = useState('');
  const [proteinTime, setProteinTime] = useState(
    dayjs().format('YYYY-MM-DDTHH:mm'),
  );

  // Hydration
  const [hydration, setHydration] = useState('');
  const [hydrationNote, setHydrationNote] = useState('');
  const [hydrationTime, setHydrationTime] = useState(
    dayjs().format('YYYY-MM-DDTHH:mm'),
  );

  // Fasting (first/last meal)
  const [profile, setProfile] = useState<Profile>({});
  const [fastingDate, setFastingDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [firstMeal, setFirstMeal] = useState(''); // "HH:MM"
  const [lastMeal, setLastMeal] = useState(''); // "HH:MM"

  // Exercise
  const [exTitle, setExTitle] = useState('');
  const [exDate, setExDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [exDay, setExDay] = useState<DayShort>('Mon');
  const [exStart, setExStart] = useState('08:00');
  const [exEnd, setExEnd] = useState('09:00');
  const [exCals, setExCals] = useState<number | ''>('');

  // Sleep — inputs for actual start/wake
  const [actualStartLocal, setActualStartLocal] = useState<string>(''); // 'YYYY-MM-DDTHH:MM'
  const [actualWakeLocal, setActualWakeLocal] = useState<string>(''); // 'YYYY-MM-DDTHH:MM'
  const [openSleepLogId, setOpenSleepLogId] = useState<number | null>(null); // last un-closed row id

  const ymdFromLocal = useCallback((localDt: string): string => {
    if (localDt && /^\d{4}-\d{2}-\d{2}T/.test(localDt)) {
      return localDt.slice(0, 10);
    }
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }, []);

  /** Find the most recent sleep_logs row that has wake_at = NULL in the last 3 days. */
  const refreshOpenSleepLog = useCallback(async (): Promise<void> => {
    const now = new Date();
    const toYmd = now.toISOString().slice(0, 10);
    const from = new Date(now.getTime() - 3 * 24 * 3600 * 1000);
    const fromYmd = from.toISOString().slice(0, 10);
    const rows = await listSleepLogsRange(fromYmd, toYmd);
    const open = rows.find((r) => !r.wake_at);
    setOpenSleepLogId(open?.id ?? null);
  }, []);

  // -------------------------------------------------------------------------
  // Fasting: init tables (local) + load profile once
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (IS_LOCAL_AUTH) {
      void initHealthTables();
    }
  }, []);

  useEffect(() => {
    setProfile({
      fasting_schedule: authUser?.fasting_schedule ?? undefined,
      fasting_start: authUser?.fasting_start ?? undefined,
    });
  }, [authUser]);

  // Fasting: load row for selected date (LOCAL ONLY)
  useEffect(() => {
    (async () => {
      const row = await getFastingByDay(fastingDate);
      if (row) {
        setFirstMeal(toHHMM(row.first_meal_at ?? ''));
        setLastMeal(toHHMM(row.last_meal_at ?? ''));
      } else {
        setFirstMeal('');
        setLastMeal('');
      }
    })();
  }, [fastingDate]);

  // Save fasting (LOCAL ONLY)
  async function saveFasting(): Promise<void> {
    const day = fastingDate;
    const tz = userTz;

    // Validate inputs
    if (!firstMeal && !lastMeal) {
      alert('Enter at least a first or last meal time (HH:MM).');
      return;
    }
    if (firstMeal && !/^\d{2}:\d{2}$/.test(firstMeal)) {
      alert('First meal must be HH:MM');
      return;
    }
    if (lastMeal && !/^\d{2}:\d{2}$/.test(lastMeal)) {
      alert('Last meal must be HH:MM');
      return;
    }

    try {
      await upsertFasting(day, firstMeal || null, lastMeal || null, tz);
      alert(
        firstMeal && lastMeal
          ? 'Fasting window saved.'
          : firstMeal
            ? 'First meal saved.'
            : 'Last meal saved.',
      );
      window.dispatchEvent(new Event('fasting:changed'));
    } catch (err) {
      logger.error('saveFasting failed', { err });
      alert('Failed to save fasting time.');
    }
  }

  async function clearFasting(): Promise<void> {
    const okGo = window.confirm('Clear this date’s fasting times?');
    if (!okGo) return;

    try {
      await clearFastingByDay(fastingDate);
      setFirstMeal('');
      setLastMeal('');
      alert('Cleared.');
      window.dispatchEvent(new Event('fasting:changed'));
    } catch (err: unknown) {
      if (err instanceof Error) {
        logger.error('clearFasting failed', {
          message: err.message,
          stack: err.stack,
        });
      } else {
        logger.error('clearFasting failed', { err });
      }
      alert('Failed to clear.');
    }
  }

  // Keep exercise weekday label in sync with chosen date
  useEffect(() => {
    if (!exDate) return;
    const dow = dayjs(exDate).format('ddd'); // "Mon" | "Tue" | ...
    if (isDayShort(dow)) setExDay(dow);
    else setExDay('Mon');
  }, [exDate]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Sleep — detect open log
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    void refreshOpenSleepLog();
  }, [refreshOpenSleepLog]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Sleep — handlers (use existing isoFromDatetimeLocalForTz helper)
  // ─────────────────────────────────────────────────────────────────────────────
  const onLogSleepStart = useCallback(async (): Promise<void> => {
    if (!actualStartLocal) {
      alert('Pick a “Went to bed” time first.');
      return;
    }
    const iso = isoFromDatetimeLocalForTz(actualStartLocal, userTz);
    if (!iso) {
      alert('Invalid “Went to bed” time.');
      return;
    }
    const day = ymdFromLocal(actualStartLocal);
    const id = await insertSleepStart(day, iso, userTz);
    setOpenSleepLogId(id);
    window.dispatchEvent(new Event('sleep:changed'));
    alert('🌙 Logged “went to bed”.');
  }, [actualStartLocal, userTz, ymdFromLocal]);

  const onLogWake = useCallback(async (): Promise<void> => {
    if (!actualWakeLocal) {
      alert('Pick a “Woke up” time first.');
      return;
    }

    const wakeIso = isoFromDatetimeLocalForTz(actualWakeLocal, userTz);
    if (!wakeIso) {
      alert('Invalid “Woke up” time.');
      return;
    }

    if (!openSleepLogId) {
      // no open row — allow “log both” if start provided
      if (!actualStartLocal) {
        alert(
          'No open sleep to close. Log a start first or provide both start and wake.',
        );
        return;
      }

      const startIso = isoFromDatetimeLocalForTz(actualStartLocal, userTz);
      if (!startIso) {
        alert('Invalid “Went to bed” time.');
        return;
      }

      const day = ymdFromLocal(actualStartLocal);
      const id = await insertSleepStart(day, startIso, userTz);
      await updateWakeTime(id, wakeIso);
      setOpenSleepLogId(null);
      window.dispatchEvent(new Event('sleep:changed'));
      alert('⏰ Logged start and wake.');
      return;
    }

    // Close the open one
    await updateWakeTime(openSleepLogId, wakeIso);
    setOpenSleepLogId(null);
    window.dispatchEvent(new Event('sleep:changed'));
    alert('✅ Logged “woke up”.');
  }, [actualWakeLocal, actualStartLocal, openSleepLogId, userTz, ymdFromLocal]);

  // Small helpers used by fasting UI
  const toHHMM = (raw?: string | null): string => {
    if (!raw) return '';
    const s = String(raw);
    if (s.includes('T')) {
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) {
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
      }
      return s.slice(11, 16);
    }
    return s.slice(0, 5);
  };

  function parseScheduleEatingHours(s: string | undefined): number | null {
    if (!s) return null;
    const m = s.match(/^(\d+)\s*:\s*(\d+)$/);
    if (!m) return null;
    const eat = Number(m[2]);
    return Number.isFinite(eat) ? eat : null;
  }

  function hhmmToToday(hhmm: string) {
    const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
    return dayjs().hour(h || 0).minute(m || 0).second(0).millisecond(0);
  }

  function statusForTime(hhmm: string): 'eating' | 'fasting' | null {
    if (!hhmm) return null;
    const eatHours = parseScheduleEatingHours(profile.fasting_schedule);
    if (eatHours == null) return null;
    const startStr = (profile.fasting_start || '').slice(0, 5);
    if (!startStr) return null;

    const fastingStart = hhmmToToday(startStr);
    const eatingStart = fastingStart.subtract(eatHours, 'hour');
    const t = hhmmToToday(hhmm);

    if (t.isAfter(eatingStart) && t.isBefore(fastingStart)) return 'eating';
    if (t.isSame(eatingStart) || t.isSame(fastingStart)) return 'eating';
    return 'fasting';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // LOCAL helper: compute total protein (grams) for a given YYYY-MM-DD
  // ─────────────────────────────────────────────────────────────────────────────
  async function computeDailyProteinTotalLocalDay(
    ymdLocal: string,
    tz: string,
  ): Promise<number> {
    const { start, end } = localDayBoundsUtc(ymdLocal, tz);
    const logs = await listHealthLogsRange(start, end); // expects UTC ISO range
    let total = 0;
    for (const row of logs) {
      if (row.entry_type !== 'protein') continue;
      const data = row.data as { grams?: unknown } | null;
      const g =
        data &&
        (typeof data.grams === 'number' ? data.grams : Number(data?.grams));
      if (Number.isFinite(g)) total += Number(g);
    }
    return total;
  }

  // NEW (local-day aware): compute hydration total (mL) for a local YYYY-MM-DD in tz
  async function computeDailyHydrationTotalLocalDay(
    ymdLocal: string,
    tz: string,
  ): Promise<number> {
    const { start, end } = localDayBoundsUtc(ymdLocal, tz);
    const logs = await listHealthLogsRange(start, end);
    let total = 0;
    for (const row of logs) {
      if (row.entry_type !== 'hydration') continue;
      const d = row.data as { amount?: unknown } | null;
      const ml =
        d &&
        (typeof d.amount === 'number'
          ? d.amount
          : typeof d?.amount === 'string'
            ? Number(d.amount)
            : NaN);
      if (Number.isFinite(ml)) total += Number(ml);
    }
    return total;
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <IonPage>
      {/* Top fixed navigation from shared component */}
      <TopNav showWhenAnon />
      <IonContent fullscreen className={styles.contentPad}>
        <div className={styles.trackerContainer}>
          <h1 className={`${styles.subtitle} ${styles.pageTitle}`}>Health Tracker</h1>

          {/* Fasting (first / last meal) */}
          <div className={styles.infoBox}>
            <h2 className={styles.subtitle}>Fasting (first / last meal)</h2>
            <div className={styles.formGroup}>
  <label className={styles.label} htmlFor="fasting-date">
    Date
  </label>

  <input
    id="fasting-date"
    name="fastingDate"
    type="date"
    className={styles.inputField}
    value={fastingDate}
    onChange={(e) => setFastingDate(e.target.value)}
    title="Fasting date"
    aria-label="Fasting date"
    placeholder="YYYY-MM-DD"
  />
</div>

            <div className={styles.formGroup}>
  <label className={styles.label} htmlFor="first-meal">
    First meal
  </label>

  <input
    id="first-meal"
    name="firstMeal"
    type="time"
    className={styles.inputField}
    value={firstMeal}
    onChange={(e) => setFirstMeal(e.target.value)}
    title="Time of first meal"
    aria-label="Time of first meal"
    placeholder="HH:MM"
  />

  {(() => {
    const s = statusForTime(firstMeal);
    return s ? (
      <div className={`${styles.label} ${styles.mt4}`}>
        Status:{' '}
        {s === 'eating' ? '✅ Eating window' : '⏳ Fasting window'}
      </div>
    ) : null;
  })()}
</div>

            <div className={styles.formGroup}>
  <label className={styles.label} htmlFor="last-meal">
    Last meal
  </label>

  <input
    id="last-meal"
    name="lastMeal"
    type="time"
    className={styles.inputField}
    value={lastMeal}
    onChange={(e) => setLastMeal(e.target.value)}
    title="Time of last meal"
    aria-label="Time of last meal"
    placeholder="HH:MM"
  />

  {(() => {
    const s = statusForTime(lastMeal);
    return s ? (
      <div className={`${styles.label} ${styles.mt4}`}>
        Status:{' '}
        {s === 'eating' ? '✅ Eating window' : '⏳ Fasting window'}
      </div>
    ) : null;
  })()}
</div>

            <div className={styles.buttonRow}>
              <IonButton
                className="custom-button"
                expand="block"
                onClick={saveFasting}
              >
                {firstMeal && !lastMeal
                  ? 'Save First Meal'
                  : !firstMeal && lastMeal
                    ? 'Save Last Meal'
                    : 'Save Fasting Window'}
              </IonButton>
              <IonButton
                className="custom-danger"
                expand="block"
                onClick={clearFasting}
              >
                Clear Today
              </IonButton>
            </div>
          </div>

          {/* Sleep (Actual only: went to bed / woke up) */}
          <div className={styles.infoBox}>
            <h3 className={styles.sectionTitle}>😴 Sleep</h3>
            <div className={styles.formRow}>
              <label className={styles.label}>Actual</label>
              <div className={styles.inlineStack}>
               <div className={styles.inlineRow}>
  <label className={styles.subLabel} htmlFor="sleep-went-to-bed">
    Went to bed
  </label>

  <input
    id="sleep-went-to-bed"
    name="sleepWentToBed"
    className={styles.inputField}
    type="datetime-local"
    value={actualStartLocal}
    onChange={(e) => setActualStartLocal(e.target.value)}
    title="Went to bed date and time"
    aria-label="Went to bed date and time"
    placeholder="YYYY-MM-DDThh:mm"
  />

  <IonButton
    className="custom-button"
    expand="block"
    onClick={() => void onLogSleepStart()}
  >
    Log Went to Bed
  </IonButton>
</div>

                <div className={styles.inlineRow}>
  <label className={styles.subLabel} htmlFor="sleep-woke-up">
    Woke up
  </label>

  <input
    id="sleep-woke-up"
    name="sleepWokeUp"
    className={styles.inputField}
    type="datetime-local"
    value={actualWakeLocal}
    onChange={(e) => setActualWakeLocal(e.target.value)}
    title="Woke up date and time"
    aria-label="Woke up date and time"
    placeholder="YYYY-MM-DDThh:mm"
  />

  <IonButton
    className="custom-button"
    expand="block"
    onClick={() => void onLogWake()}
  >
    {openSleepLogId ? 'Close Open Sleep' : 'Log Woke / Both'}
  </IonButton>
</div>

<div className={styles.hintSmall}>
  {openSleepLogId
    ? `Open sleep session detected (id ${openSleepLogId}).`
    : 'No open sleep session. You can log start+wake in one go.'}
</div>
</div>
</div>
</div>

{/* Blood Sugar */}
<div className={styles.infoBox}>
  <h2 className={styles.subtitle}>Blood Sugar</h2>

  {/* Category selector */}
  <div className={styles.formGroup}>
    <label className={styles.label} htmlFor="bs-category">
      Category
    </label>
    <select
      id="bs-category"
      name="bsCategory"
      className={styles.inputField}
      value={bsCategory}
      title="Blood sugar category"
      aria-label="Blood sugar category"
      onChange={(e) =>
        setBsCategory(
          e.target.value as 'fasting_am' | 'pre_meal' | 'post_meal' | 'bedtime',
        )
      }
    >
      <option value="fasting_am">Fasting (AM)</option>
      <option value="pre_meal">Pre-meal</option>
      <option value="post_meal">Post-meal</option>
      <option value="bedtime">Bedtime</option>
    </select>
  </div>

  <div className={styles.formGroup}>
    <label className={styles.label} htmlFor="bs-unit">
      Unit
    </label>
    <select
      id="bs-unit"
      name="bsUnit"
      className={styles.inputField}
      value={bsUnit}
      title="Blood sugar unit"
      aria-label="Blood sugar unit"
      onChange={(e) => setBsUnit(e.target.value as GlucoseUnit)}
    >
      <option value="mg/dL">mg/dL</option>
      <option value="mmol/L">mmol/L</option>
    </select>
  </div>

  <div className={styles.formGroup}>
    <label className={styles.label} htmlFor="bs-value">
      Blood Sugar ({bsUnit})
    </label>
    <input
      id="bs-value"
      name="bloodSugar"
      type="number"
      step={bsUnit === 'mmol/L' ? '0.1' : '1'}
      className={styles.inputField}
      value={bloodSugar}
      onChange={(e) => setBloodSugar(e.target.value)}
      title={`Blood sugar value in ${bsUnit}`}
      aria-label={`Blood sugar value in ${bsUnit}`}
      placeholder={bsUnit === 'mmol/L' ? 'e.g. 5.6' : 'e.g. 100'}
      inputMode="decimal"
    />
  </div>

  <div className={styles.formGroup}>
    <label className={styles.label} htmlFor="bs-time">
      Timestamp
    </label>
    <input
      id="bs-time"
      name="bloodSugarTime"
      type="datetime-local"
      className={styles.inputField}
      value={bloodSugarTime}
      onChange={(e) => setBloodSugarTime(e.target.value)}
      title="Blood sugar timestamp"
      aria-label="Blood sugar timestamp"
      placeholder="YYYY-MM-DDThh:mm"
    />
  </div>

  <IonButton
    className="custom-button"
    expand="block"
    onClick={() =>
      submitLog(
        'blood_sugar',
        { value: parseFloat(bloodSugar), unit: bsUnit },
        bloodSugarTime,
      )
    }
  >
    Submit Blood Sugar
  </IonButton>
</div>

{/* Blood Pressure */}
<div className={styles.infoBox}>
  <h2 className={styles.subtitle}>Blood Pressure</h2>

  <div className={styles.formGroup}>
    <label className={styles.label} htmlFor="bp-systolic">
      Systolic
    </label>
    <input
      id="bp-systolic"
      name="systolic"
      type="number"
      className={styles.inputField}
      value={systolic}
      onChange={(e) => setSystolic(e.target.value)}
      title="Systolic blood pressure"
      aria-label="Systolic blood pressure"
      placeholder="e.g. 120"
      inputMode="numeric"
    />
  </div>

  <div className={styles.formGroup}>
    <label className={styles.label} htmlFor="bp-diastolic">
      Diastolic
    </label>
    <input
      id="bp-diastolic"
      name="diastolic"
      type="number"
      className={styles.inputField}
      value={diastolic}
      onChange={(e) => setDiastolic(e.target.value)}
      title="Diastolic blood pressure"
      aria-label="Diastolic blood pressure"
      placeholder="e.g. 80"
      inputMode="numeric"
    />
  </div>

  <div className={styles.formGroup}>
    <label className={styles.label} htmlFor="bp-pulse">
      Pulse (optional)
    </label>
    <input
      id="bp-pulse"
      name="pulse"
      type="number"
      className={styles.inputField}
      value={pulse}
      onChange={(e) => setPulse(e.target.value)}
      title="Pulse (optional)"
      aria-label="Pulse (optional)"
      placeholder="e.g. 70"
      inputMode="numeric"
    />
  </div>

  <div className={styles.formGroup}>
    <label className={styles.label} htmlFor="bp-time">
      Timestamp
    </label>
    <input
      id="bp-time"
      name="bpTime"
      type="datetime-local"
      className={styles.inputField}
      value={bpTime}
      onChange={(e) => setBpTime(e.target.value)}
      title="Blood pressure timestamp"
      aria-label="Blood pressure timestamp"
      placeholder="YYYY-MM-DDThh:mm"
    />
  </div>

  <IonButton
    className="custom-button"
    expand="block"
    onClick={() =>
      submitLog(
        'blood_pressure',
        {
          systolic: parseInt(systolic, 10),
          diastolic: parseInt(diastolic, 10),
          pulse: pulse ? parseInt(pulse, 10) : null,
        },
        bpTime,
      )
    }
  >
    Submit Blood Pressure
  </IonButton>
</div>

{/* Protein Intake */}
<div className={styles.infoBox}>
  <h2 className={styles.subtitle}>Protein Intake</h2>

  <div className={styles.formGroup}>
    <label className={styles.label} htmlFor="protein-source">
      Protein Source
    </label>
    <select
      id="protein-source"
      name="selectedProteinSource"
      className={styles.inputField}
      value={selectedProteinSource}
      title="Protein source"
      aria-label="Protein source"
      onChange={(e) => {
        const selected = e.target.value as ProteinSource;
        setSelectedProteinSource(selected);

        // Map known sources to a default grams value:
        const defaults: Partial<Record<ProteinSource, number>> = {
          egg: 6,
          chicken: 31,
          yogurt: 10,
          peanutButter: 7,
          whey: 25,
          lentils: 9,
          tofu: 10,
          // no entry for "other" on purpose
        };

        // If we have a default, use it; otherwise clear the field
        const grams = defaults[selected] ?? '';

        setProteinGrams(grams);
        setProteinNotes('');
      }}
    >
      <option value="">Select protein source</option>
      <option value="egg">Egg (1 large) – 6g</option>
      <option value="chicken">Chicken breast (100g) – 31g</option>
      <option value="yogurt">Greek yogurt (100g) – 10g</option>
      <option value="peanutButter">Peanut butter (2 tbsp) – 7g</option>
      <option value="whey">Whey protein (1 scoop) – 25g</option>
      <option value="lentils">Lentils (100g cooked) – 9g</option>
      <option value="tofu">Tofu (100g) – 10g</option>
      <option value="other">Other (custom)</option>
    </select>
  </div>

  {selectedProteinSource === 'other' && (
    <div className={styles.formGroup}>
      <label className={styles.label} htmlFor="protein-custom-food">
        Custom Food
      </label>
      <input
        id="protein-custom-food"
        name="proteinNotes"
        type="text"
        className={styles.inputField}
        placeholder="e.g. Salmon, Protein bar"
        value={proteinNotes}
        onChange={(e) => setProteinNotes(e.target.value)}
        title="Custom protein food"
        aria-label="Custom protein food"
      />
    </div>
  )}

  <div className={styles.formGroup}>
    <label className={styles.label} htmlFor="protein-grams">
      Protein (grams)
    </label>
    <input
      id="protein-grams"
      name="proteinGrams"
      type="number"
      className={styles.inputField}
      value={proteinGrams}
      onChange={(e) => {
        const raw = e.target.value;

        if (raw === '') {
          // user cleared the field – keep it empty
          setProteinGrams('');
          return;
        }

        const n = Number(raw);
        if (Number.isFinite(n)) {
          setProteinGrams(n);
        }
      }}
      title="Protein grams"
      aria-label="Protein grams"
      placeholder="e.g. 25"
      inputMode="numeric"
    />
  </div>

  <div className={styles.formGroup}>
    <label className={styles.label} htmlFor="protein-time">
      Timestamp
    </label>
    <input
      id="protein-time"
      name="proteinTime"
      type="datetime-local"
      className={styles.inputField}
      value={proteinTime}
      onChange={(e) => setProteinTime(e.target.value)}
      title="Protein intake timestamp"
      aria-label="Protein intake timestamp"
      placeholder="YYYY-MM-DDThh:mm"
    />
  </div>

  <IonButton
    className="custom-button"
    expand="block"
    onClick={() => {
      // 1) Make sure grams is filled
      if (proteinGrams === '') {
        alert('Please enter protein grams');
        return;
      }

      // 2) (Optional) make sure timestamp is filled too
      if (!proteinTime) {
        alert('Please choose a timestamp.');
        return;
      }

      // From here, TS knows proteinGrams is a number
      submitLog(
        'protein',
        {
          grams: proteinGrams,
          notes: proteinNotes || selectedProteinSource || undefined,
        },
        proteinTime,
      );
    }}
  >
    Submit Protein Intake
  </IonButton>
</div>

{/* Exercise */}
<div className={styles.infoBox}>
  <h2 className={styles.subtitle}>Exercise</h2>

  <div className={styles.formGroup}>
    <label className={styles.label} htmlFor="exercise-title">
      Title
    </label>
    <input
      id="exercise-title"
      name="exTitle"
      className={styles.inputField}
      value={exTitle}
      onChange={(e) => setExTitle(e.target.value)}
      placeholder="e.g. Jog, Spin Class"
      title="Exercise title"
      aria-label="Exercise title"
    />
  </div>

  <div className={styles.formGroup}>
    <label className={styles.label} htmlFor="exercise-date">
      Date
    </label>
    <input
      id="exercise-date"
      name="exDate"
      type="date"
      className={styles.inputField}
      value={exDate}
      onChange={(e) => setExDate(e.target.value)}
      title="Exercise date"
      aria-label="Exercise date"
      placeholder="YYYY-MM-DD"
    />
    <div className={`${styles.label} ${styles.mt4}`}>
      Weekday: {exDay}
    </div>
  </div>

  <div className={styles.formGroup}>
    <label className={styles.label} htmlFor="exercise-start">
      Start
    </label>
    <input
      id="exercise-start"
      name="exStart"
      type="time"
      className={styles.inputField}
      value={exStart}
      onChange={(e) => setExStart(e.target.value)}
      title="Exercise start time"
      aria-label="Exercise start time"
      placeholder="HH:MM"
    />
  </div>

  <div className={styles.formGroup}>
    <label className={styles.label} htmlFor="exercise-end">
      End
    </label>
    <input
      id="exercise-end"
      name="exEnd"
      type="time"
      className={styles.inputField}
      value={exEnd}
      onChange={(e) => setExEnd(e.target.value)}
      title="Exercise end time"
      aria-label="Exercise end time"
      placeholder="HH:MM"
    />
  </div>

  <div className={styles.formGroup}>
    <label className={styles.label} htmlFor="exercise-cals">
      Calories burned (optional)
    </label>
    <input
      id="exercise-cals"
      name="exCals"
      type="number"
      className={styles.inputField}
      value={exCals}
      onChange={(e) =>
        setExCals(e.target.value === '' ? '' : Number(e.target.value))
      }
      title="Calories burned (optional)"
      aria-label="Calories burned (optional)"
      placeholder="e.g. 250"
      inputMode="numeric"
    />
  </div>

  <IonButton
    className="custom-button"
    expand="block"
    onClick={async () => {
      if (!exTitle || !exStart || !exEnd || !exDay) {
        alert('Please fill title, day, start & end');
        return;
      }

      const start = dayjs(`2000-01-01T${exStart}`);
      const end = dayjs(`2000-01-01T${exEnd}`);
      if (!start.isValid() || !end.isValid()) {
        alert('Invalid start or end time');
        return;
      }
      if (!end.isAfter(start)) {
        alert('End time must be after start time');
        return;
      }

      try {
        await insertExercise({
          exercise_date: exDate,
          day_of_week: exDay,
          start_time: toHHMMSS(exStart),
          end_time: toHHMMSS(exEnd),
          exercise_type: exTitle.trim(),
          calories_burned: exCals === '' ? null : Number(exCals),
        });

        const durationMinutes = end.diff(start, 'minute');
        const ymdLocal = exDate;

        const exerciseCtx = buildSingleEntryCelebration(
          'exercise',
          ymdLocal,
          durationMinutes,
        );

        logger.debug('[exercise] singleEntryCtx', {
          ymdLocal,
          durationMinutes,
          exerciseCtx,
        });

        if (exerciseCtx) {
          navigateToCelebration(exerciseCtx);
        }

        window.dispatchEvent(new Event('exercise:changed'));
        setExTitle('');
        setExCals('');
      } catch (e: unknown) {
        if (e instanceof Error) {
          logger.error('insertExercise failed', {
            message: e.message,
            stack: e.stack,
          });
        } else {
          logger.error('insertExercise failed', { error: e });
        }
        alert('Failed to save exercise');
      }
    }}
  >
    Save Exercise
  </IonButton>
</div>

{/* Hydration */}
<div className={styles.infoBox}>
  <h2 className={styles.subtitle}>Hydration</h2>

  <div className={styles.formGroup}>
    <label className={styles.label} htmlFor="hydration-amount">
      Water Consumed (ml)
    </label>
    <input
      id="hydration-amount"
      name="hydration"
      type="number"
      className={styles.inputField}
      value={hydration}
      onChange={(e) => setHydration(e.target.value)}
      placeholder="e.g. 250"
      title="Water consumed in milliliters"
      aria-label="Water consumed in milliliters"
      inputMode="numeric"
    />
  </div>

  <div className={styles.formGroup}>
    <label className={styles.label} htmlFor="hydration-note">
      Notes (optional)
    </label>
    <input
      id="hydration-note"
      name="hydrationNote"
      type="text"
      className={styles.inputField}
      value={hydrationNote}
      onChange={(e) => setHydrationNote(e.target.value)}
      placeholder="e.g. After gym, lemon water"
      title="Hydration notes (optional)"
      aria-label="Hydration notes (optional)"
    />
  </div>

  <div className={styles.formGroup}>
    <label className={styles.label} htmlFor="hydration-time">
      Timestamp
    </label>
    <input
      id="hydration-time"
      name="hydrationTime"
      type="datetime-local"
      className={styles.inputField}
      value={hydrationTime}
      onChange={(e) => setHydrationTime(e.target.value)}
      title="Hydration timestamp"
      aria-label="Hydration timestamp"
      placeholder="YYYY-MM-DDThh:mm"
    />
  </div>

  <IonButton
    className="custom-button"
    expand="block"
    onClick={() =>
      submitLog(
        'hydration',
        { amount: parseInt(hydration, 10), note: hydrationNote },
        hydrationTime,
      )
    }
  >
    Submit Hydration
  </IonButton>
</div>

{/* Bowel Movement */}
<div className={styles.infoBox}>
  <h2 className={styles.subtitle}>Bowel Movement</h2>

  <div className={styles.formGroup}>
    <label className={styles.label} htmlFor="bowel-time">
      Timestamp
    </label>
    <input
      id="bowel-time"
      name="bowelTime"
      type="datetime-local"
      className={styles.inputField}
      value={bowelTime}
      onChange={(e) => setBowelTime(e.target.value)}
      title="Bowel movement timestamp"
      aria-label="Bowel movement timestamp"
      placeholder="YYYY-MM-DDThh:mm"
    />
  </div>

  <IonButton
    className="custom-button"
    expand="block"
    onClick={() => submitLog('bowel', {}, bowelTime)}
  >
    Log Bowel Movement
  </IonButton>
</div>

<div aria-hidden className={styles.spacer24} />
</div>
</IonContent>

{/* Bottom shared nav (fixed) */}
<BottomNav showWhenAnon={false} />
</IonPage>
);

// Health log submitter – LOCAL ONLY
async function submitLog(
entryType: 'blood_sugar' | 'blood_pressure' | 'bowel' | 'hydration' | 'protein',
data: HealthLogData,
time: string,
): Promise<void> {
if (!time) {
alert('Please choose a timestamp.');
return;
}

logger.debug('[health-log] submitLog called', {
entryType,
rawData: data,
time,
userTz,
});

// Free vs Pro gating: only bowel is free. All other health-log types are Pro.
const isFreeType = entryType === 'bowel';

if (!isPro && !isFreeType) {
alert(
'This log type is part of OurGLP1 Pro. On the free plan you can still log bowel movements.',
);
try {
history.push('/paywall?returnTo=/healthtracker');
} catch {
// If routing fails, just stay on the page.
}
return;
}

// validate & sanitize payload based on entryType
let payloadData: HealthLogData;
if (entryType === 'hydration') {
const r = validateHydration(data);
if (!r.ok) {
alert(r.message);
return;
}
payloadData = r.value;
} else if (entryType === 'protein') {
const r = validateProtein(data);
if (!r.ok) {
alert(r.message);
return;
}
payloadData = r.value;
} else if (entryType === 'blood_sugar') {
const r = validateBloodSugar(data);
if (!r.ok) {
alert(r.message);
return;
}
// normalize to mg/dL for consistent charting
const mgdl =
r.value.unit === 'mmol/L'
? Math.round(r.value.value * 18)
: Math.round(r.value.value);

payloadData = {
value: mgdl,
unit: 'mg/dL',
note: r.value.note,
// store semantic category for summaries
category: bsCategory,
} as unknown as HealthLogData;
} else if (entryType === 'blood_pressure') {
const r = validateBloodPressure(data);
if (!r.ok) {
alert(r.message);
return;
}
payloadData = r.value;
} else {
// bowel
payloadData = {};
}

const onProfile = window.location.pathname.includes('/profile');
const isAllowed = ALLOWED_ENTRY_TYPES.includes(entryType as AllowedEntryType);
if (onProfile || !isAllowed) {
logger.debug('[health-log] Skipping health-log insert', {
entryType,
reason: onProfile ? 'onProfile' : 'notAllowed',
});
return;
}

try {
const recordedIso = isoFromDatetimeLocalForTz(time, userTz) || dayjs(time).toISOString();

logger.debug('[health-log] Normalized recordedIso', { recordedIso });

// Local DB write (single source of truth)
await insertHealthLog({
entry_type: entryType,
recorded_at: recordedIso,
data_json: JSON.stringify(payloadData),
});

// ─────────────────────────────────────────────────────────────
// PROTEIN: update daily total + celebrations
// ─────────────────────────────────────────────────────────────
if (entryType === 'protein') {
const ymdLocal = ymdFromIsoInTz(recordedIso, userTz);
const proteinPayload = payloadData as ProteinData;

logger.debug('[protein] after insert', {
ymdLocal,
grams: proteinPayload.grams,
payloadData,
});

// Single-entry celebration (e.g. ≥36g in one go)
const singleEntryCtx = buildSingleEntryCelebration(
'protein',
ymdLocal,
proteinPayload.grams,
);
logger.debug('[protein] singleEntryCtx', { singleEntryCtx });

if (singleEntryCtx) {
logger.debug('[protein] navigating to /celebrate with singleEntryCtx', {
ctx: singleEntryCtx,
});
navigateToCelebration(singleEntryCtx);
} else {
logger.debug('[protein] no single-entry celebration built', {
ymdLocal,
grams: proteinPayload.grams,
});
}

const todaysTotal = await computeDailyProteinTotalLocalDay(ymdLocal, userTz);
const uid = getUserIdString(authUser);

logger.debug('[protein] daily total + uid', {
todaysTotal,
uid,
});

if (uid) {
await upsertDailyProtein(uid, ymdLocal, todaysTotal);
window.dispatchEvent(new Event('protein:changed'));

const dailyCtx = buildDailyTotalCelebration(
'protein',
ymdLocal,
todaysTotal,
);
logger.debug('[protein] dailyCtx', { dailyCtx });

if (dailyCtx) {
logger.debug('[protein] navigating to /celebrate with dailyCtx', {
ctx: dailyCtx,
});
navigateToCelebration(dailyCtx);
} else {
logger.debug('[protein] no daily-total celebration built', {
todaysTotal,
});
}
} else {
logger.warn('[protein] Cannot upsert daily total: missing user id', {
todaysTotal,
});
}
}

// ─────────────────────────────────────────────────────────────
// HYDRATION: update daily total + celebrations
// ─────────────────────────────────────────────────────────────
if (entryType === 'hydration') {
const ymdLocal = ymdFromIsoInTz(recordedIso, userTz);
const hydrationPayload = payloadData as HydrationData;

logger.debug('[hydration] after insert', {
ymdLocal,
amount: hydrationPayload.amount,
});

const singleHydrationCtx = buildSingleEntryCelebration(
'hydration',
ymdLocal,
hydrationPayload.amount,
);
logger.debug('[hydration] singleHydrationCtx', { singleHydrationCtx });

if (singleHydrationCtx) {
navigateToCelebration(singleHydrationCtx);
}

const uid = getUserIdString(authUser);
const totalMl = await computeDailyHydrationTotalLocalDay(ymdLocal, userTz);

logger.debug('[hydration] daily total + uid', { totalMl, uid });

if (uid) {
await upsertDailyHydration(uid, ymdLocal, totalMl);
window.dispatchEvent(new Event('hydration:changed'));

const dailyHydrationCtx = buildDailyTotalCelebration(
'hydration',
ymdLocal,
totalMl,
);
logger.debug('[hydration] dailyHydrationCtx', { dailyHydrationCtx });

if (dailyHydrationCtx) {
navigateToCelebration(dailyHydrationCtx);
}
} else {
logger.warn('[hydration] Cannot upsert daily total: missing user id');
}
}

// ─────────────────────────────────────────────────────────────
// BOWEL: “Nice hit!” celebration per poop (first per day)
// ─────────────────────────────────────────────────────────────
if (entryType === 'bowel') {
const ymdLocal = ymdFromIsoInTz(recordedIso, userTz);

// We don't have a numeric field, so treat each log as value 1
const poopCtx = buildSingleEntryCelebration('bowel', ymdLocal, 1);

logger.debug('[bowel] singleEntryCtx', { poopCtx });

if (poopCtx) {
navigateToCelebration(poopCtx);
}
}

// ─────────────────────────────────────────────────────────────
// Common post-save stuff
// ─────────────────────────────────────────────────────────────
alert(`${entryType.replace('_', ' ')} entry saved!`);
window.dispatchEvent(new Event('health:changed'));
if (entryType === 'blood_sugar') {
window.dispatchEvent(new Event('blood_sugar:changed'));
}
} catch (e: unknown) {
logger.error('[health-log] save failed', e);
alert('Error saving health data.');
}
}
};

export default HealthTracker;







