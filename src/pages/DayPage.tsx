// ============================================================================
// File: src/pages/DayPage.tsx
// Desc: Local-DB Day timeline (15-min blocks) with IonPage + Top/Bottom Nav
// Notes:
//  - All /api/* removed. Uses local repositories only.
//  - Keeps: fasting/eating shading, exercise overlay, reminder chips,
//           injection highlight + "mark taken", mood logging.
//  - Uses local-ISO w/ offset (no trailing 'Z') to avoid day drift.
//  - Adds: "Edit fasting…" inline action (writes to settings via setFastingScheduleStr)
// ============================================================================
import { logger } from '../utils/logger';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IonPage, IonContent } from '@ionic/react';
import { useParams } from 'react-router-dom';
import styles from './DayPage.module.css';

import TopNav from '../context/TopNav';
import BottomNav from '../context/BottomNav';

import { iconFor } from '../utils/icons';
import type { EntryType } from '../utils/icons';
import { getAnchoredWeek, rotateShortFromFull } from '../lib/time';
import type { WeekdayFull, WeekdayShort } from '../lib/time';
import { nutritionFromLogData } from '../lib/nutritionLog';

// ─────────────────────────────────────────────────────────────────────────────
// Local DB repositories
// ─────────────────────────────────────────────────────────────────────────────
import {
  initHealthTables,
  listHealthLogsRange, // (fromIsoUtc, toIsoUtc) => Promise<Array<HealthLog>>
  listExercises, // () => Promise<Array<Exercise>>
  upsertMoodLocal, // (recorded_at_localISO, score) => Promise<void>
  getLastInjectionLocal, // () => Promise<InjectionLog|null>
  insertInjectionLocal,
  deleteMoodInWindow,
} from '../db/HealthRepository';

import { listReminders, type LocalReminder } from '../db/RemindersRepository';

import {
  getSettings, // ✅ loads timezone, fasting, injection
  setInjectionSchedule, // ✅ logs injection and saves
} from '../db/SettingsRepository';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface TimeBlock {
  time: string; // 'HH:mm'
  isFasting: boolean;
  isCurrent: boolean;
  isInjectionTime: boolean;
}

// Light reminder shape used by this page
type UiReminder = Readonly<{
  id: string | number;
  title: string;
  datetime: string; // ISO
}>;

type HydrationData = { amount?: number; note?: string };
type ProteinData = { grams?: number; protein?: number; carbs?: number; fat?: number; calories?: number; notes?: string };
type GenericData = Record<string, unknown>;
type MoodData = { score?: number; note?: string; context?: Record<string, unknown> };

export interface HealthLogRow {
  id: number;
  entry_type: Exclude<EntryType, 'exercise'>; // exercise is separate
  recorded_at: string; // local or UTC ISO (consumer treats as ISO)
  data: HydrationData | ProteinData | MoodData | GenericData;
}
export interface InjectionLog {
  taken_at: string;
  medication_name?: string;
  medication_dose?: string;
}
export interface ExerciseEntry {
  id: number;
  day_of_week: string; // 'Mon'..'Sun'
  start_time: string; // 'HH:MM' or 'HH:MM:SS'
  end_time: string; // 'HH:MM' or 'HH:MM:SS'
  exercise_type: string;
  calories_burned: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

// Repo row type (what listHealthLogsRange returns)
type RepoHealthRow = {
  id: number;
  entry_type:
    | 'protein'
    | 'hydration'
    | 'weight'
    | 'blood_pressure'
    | 'blood_sugar'
    | 'mood'
    | 'bowel'
    | 'injection';
  recorded_at: string;
  // repo might give either data_json (string) or already-parsed data
  data_json?: string;
  data?: unknown;
};

/** Parse a possibly-string JSON into unknown safely. */
function safeParseJson(s: unknown): unknown {
  if (typeof s !== 'string') return s;
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/** Coerce raw -> the union the UI expects, with narrow-by-keys guards. */
function coerceLogData(
  entry_type: RepoHealthRow['entry_type'],
  raw: unknown,
): HydrationData | ProteinData | MoodData | GenericData {
  const obj = ((): Record<string, unknown> =>
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {})();

  if (entry_type === 'hydration') {
    const amount = typeof obj.amount === 'number' ? obj.amount : undefined;
    const note = typeof obj.note === 'string' ? obj.note : undefined;
    return { amount, note };
  }
  if (entry_type === 'protein') {
    const grams = typeof obj.grams === 'number' ? obj.grams : undefined;
    const notes = typeof obj.notes === 'string' ? obj.notes : undefined;
    return { grams, notes };
  }
  if (entry_type === 'mood') {
    const score = typeof obj.score === 'number' ? obj.score : undefined;
    const note = typeof obj.note === 'string' ? obj.note : undefined;
    const context =
      typeof obj.context === 'object' && obj.context !== null
        ? (obj.context as Record<string, unknown>)
        : undefined;
    return { score, note, context };
  }
  return obj; // GenericData
}

/** Map a repository health row to the page's strongly-typed HealthLogRow. */
function mapRepoRowToHealthLogRow(r: RepoHealthRow): HealthLogRow {
  const rawData = r.data ?? safeParseJson(r.data_json);
  const data = coerceLogData(r.entry_type, rawData);
  const entry = r.entry_type as Exclude<EntryType, 'exercise'>;
  return { id: r.id, entry_type: entry, recorded_at: r.recorded_at, data };
}

const abbrevToFull: Record<string, string> = {
  Mon: 'monday',
  Tue: 'tuesday',
  Wed: 'wednesday',
  Thu: 'thursday',
  Fri: 'friday',
  Sat: 'saturday',
  Sun: 'sunday',
};
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function toFullDay(s?: string | null): WeekdayFull | '' {
  if (!s) return '';
  const t = String(s).trim();
  const fulls = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
  if ((fulls as readonly string[]).includes(t)) return t as WeekdayFull;
  const map: Record<string, WeekdayFull> = {
    mon: 'Monday',
    tue: 'Tuesday',
    wed: 'Wednesday',
    thu: 'Thursday',
    fri: 'Friday',
    sat: 'Saturday',
    sun: 'Sunday',
  };
  return map[t.slice(0, 3).toLowerCase()] || '';
}

const normalizeShortDay = (s?: string): (typeof DAY_SHORT)[number] => {
  if (!s) return DAY_SHORT[new Date().getDay()];
  const k = s.slice(0, 3).toLowerCase();
  switch (k) {
    case 'sun':
      return 'Sun';
    case 'mon':
      return 'Mon';
    case 'tue':
      return 'Tue';
    case 'wed':
      return 'Wed';
    case 'thu':
      return 'Thu';
    case 'fri':
      return 'Fri';
    case 'sat':
      return 'Sat';
    default:
      return DAY_SHORT[new Date().getDay()];
  }
};

const toHHMM = (val?: string | null) => {
  if (!val) return '';
  if (val.includes('T')) return val.split('T')[1].slice(0, 5);
  if (val.includes(' ')) return val.split(' ')[1].slice(0, 5);
  return val.slice(0, 5);
};

function toLocalISOWithOffset(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = d.getFullYear(),
    m = pad(d.getMonth() + 1),
    day = pad(d.getDate());
  const H = pad(d.getHours()),
    M = pad(d.getMinutes()),
    S = pad(d.getSeconds());
  const tzo = -d.getTimezoneOffset();
  const sign = tzo >= 0 ? '+' : '-';
  const offH = pad(Math.trunc(Math.abs(tzo) / 60));
  const offM = pad(Math.abs(tzo) % 60);
  return `${y}-${m}-${day}T${H}:${M}:${S}${sign}${offH}:${offM}`;
}

function localYmd(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isoToBlockIndex(iso: string) {
  const d = new Date(iso);
  return Math.floor(d.getHours() * 4 + d.getMinutes() / 15);
}
const hhmmToIndex = (t: string) => {
  const [H, M] = t.slice(0, 5).split(':').map(Number);
  return Math.floor((H * 60 + M) / 15);
};

function moodScoreFromData(d: unknown): number | undefined {
  if (!d || typeof d !== 'object') return undefined;
  const obj = d as Record<string, unknown>;
  const raw = obj.score ?? obj.mood_score ?? obj.mood ?? obj.value;
  const score = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(score) ? Math.max(1, Math.min(5, Math.round(score))) : undefined;
}
function isHydrationData(d: unknown): d is { amount?: number; note?: string } {
  return (
    !!d &&
    typeof d === 'object' &&
    ('amount' in (d as Record<string, unknown>) || 'note' in (d as Record<string, unknown>))
  );
}
function isProteinData(d: unknown): d is ProteinData {
  return (
    !!d &&
    typeof d === 'object' &&
    ('grams' in (d as Record<string, unknown>) ||
      'protein' in (d as Record<string, unknown>) ||
      'carbs' in (d as Record<string, unknown>) ||
      'fat' in (d as Record<string, unknown>) ||
      'calories' in (d as Record<string, unknown>) ||
      'notes' in (d as Record<string, unknown>))
  );
}

const moodEmoji = (score?: number) => {
  switch (score) {
    case 1:
      return '😞';
    case 2:
      return '🙁';
    case 3:
      return '😐';
    case 4:
      return '🙂';
    case 5:
      return '😄';
    default:
      return '🙂';
  }
};

const nextInjectionDate = (injectionDay?: string, hhmm?: string, nowArg?: Date) => {
  if (!injectionDay || !hhmm) return null;
  const now = nowArg ?? new Date();
  const [hh, mm] = hhmm.split(':').map(Number);
  const targetDow = DAY_NAMES.indexOf(injectionDay as (typeof DAY_NAMES)[number]);
  if (targetDow < 0) return null;
  const todayDow = now.getDay();
  let daysAway = (targetDow - todayDow + 7) % 7;
  const candidate = new Date(now);
  candidate.setHours(hh, mm || 0, 0, 0);
  if (daysAway === 0 && candidate.getTime() <= now.getTime()) daysAway = 7;
  candidate.setDate(candidate.getDate() + daysAway);
  return candidate;
};

// ─────────────────────────────────────────────────────────────────────────────
// Adapters to Local DB (typed)
// ─────────────────────────────────────────────────────────────────────────────

async function loadRemindersForDayRange(fromIsoUtc: string, toIsoUtc: string): Promise<UiReminder[]> {
  const rows = await listReminders();
  return rows
    .filter((r: LocalReminder) => {
      if (!r.datetime) return false;
      const t = Date.parse(r.datetime);
      return Number.isFinite(t) && t >= Date.parse(fromIsoUtc) && t <= Date.parse(toIsoUtc);
    })
    .map((r): UiReminder => ({
      id: r.id,
      title: r.title,
      datetime: r.datetime!, // filtered above
    }));
}

// ─────────────────────────────────────────────────────────────────────────────

const DayPage: React.FC = () => {
  const { day } = useParams<{ day?: string }>();

  const [now, setNow] = useState(new Date());
  const [tz, setTz] = useState<string>(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  });

  // Settings
  const [fastSchedule, setFastSchedule] = useState<string>('');
  const [fastStartHHMM, setFastStartHHMM] = useState<string>('');
  const [injDay, setInjDay] = useState<WeekdayFull | ''>('');
  const [injHHMM, setInjHHMM] = useState<string>('');

  // Data
  const [dayReminders, setDayReminders] = useState<UiReminder[]>([]);
  const [dayLogs, setDayLogs] = useState<HealthLogRow[]>([]);
  const [exercises, setExercises] = useState<ExerciseEntry[]>([]);
  const [dayExercises, setDayExercises] = useState<ExerciseEntry[]>([]);
  const [lastInjection, setLastInjection] = useState<InjectionLog | null>(null);

  // UI state
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([]);
  const [selectedBlockInfo, setSelectedBlockInfo] = useState<string | null>(null);
  const [selectedBlockIdx, setSelectedBlockIdx] = useState<number | null>(null);
  const [selectedBlockMoodId, setSelectedBlockMoodId] = useState<number | null>(null);
  const [selectedBlockMoodScore, setSelectedBlockMoodScore] = useState<number | null>(null);
  const currentBlockRef = useRef<HTMLDivElement | null>(null);

  // Anchoring by injection day/time
  const injDayFull: WeekdayFull = (injDay || 'Monday') as WeekdayFull;
  const anchoredDays: WeekdayShort[] = useMemo(() => rotateShortFromFull(injDayFull), [injDayFull]);
  const anchoredIndex = useMemo(() => new Map(anchoredDays.map((d, i) => [d, i])), [anchoredDays]);
  const shortDay = useMemo(() => normalizeShortDay(day) as WeekdayShort, [day]); // normalized route day
  const dayIndex = anchoredIndex.get(shortDay) ?? 0;

  const { startUtc } = useMemo(
    () => getAnchoredWeek(new Date(), injDayFull, injHHMM || '08:00', tz),
    [injDayFull, injHHMM, tz],
  );

  const selectedDate = useMemo(
    () => new Date(new Date(startUtc).getTime() + dayIndex * 24 * 3600 * 1000),
    [startUtc, dayIndex],
  );

  const dayStartUtc = useMemo(() => {
    const d = new Date(selectedDate);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, [selectedDate]);

  const dayEndUtc = useMemo(() => {
    const d = new Date(selectedDate);
    d.setHours(23, 59, 59, 999);
    return d.toISOString();
  }, [selectedDate]);

  const todayName = DAY_NAMES[now.getDay()];
  const isTodayInjectionDay = injDay === todayName;
  const nextInjAt = useMemo(() => nextInjectionDate(injDay, injHHMM, now), [injDay, injHHMM, now]);

  // Clock tick
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    (async () => {
      await initHealthTables().catch(() => {});
      const s = await getSettings();

      const clean = (v: string | null | undefined) =>
        typeof v === 'string' ? v.replace(/^"+|"+$/g, '').trim() : '';

      let hoursPart = '';
      let startPart = '';

      const rawSchedule = clean(s.fasting_schedule);
      const rawStart = clean(s.fasting_start);

      logger.debug('[DayPage] RAW DB values', {
        fasting_schedule: s.fasting_schedule,
        fasting_start: s.fasting_start,
        cleaned_schedule: rawSchedule,
        cleaned_start: rawStart,
      });

      if (rawSchedule.includes(',')) {
        const [hRaw, stRaw] = rawSchedule.split(',');
        hoursPart = clean(hRaw);
        startPart = clean(stRaw);
        logger.debug('[DayPage] parsed composite fasting_schedule', { hoursPart, startPart });
      } else {
        hoursPart = rawSchedule || '';
        startPart = rawStart || '';
        logger.debug('[DayPage] using separate fields', { hoursPart, startPart });
      }

      if (hoursPart.includes(':')) {
        const [hOnly] = hoursPart.split(':');
        hoursPart = hOnly;
      }

      logger.debug('[DayPage] CLEANED derived fasting data', {
        derivedFastingHours: hoursPart,
        derivedFastingStartHHMM: toHHMM(startPart),
      });

      const timezone =
        s.timezone && s.timezone.trim()
          ? s.timezone
          : (() => {
              try {
                return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
              } catch {
                return 'UTC';
              }
            })();

      setTz(timezone);
      setFastSchedule(hoursPart);
      setFastStartHHMM(toHHMM(startPart));
      setInjDay(toFullDay(s.injection_day) || '');
      setInjHHMM(toHHMM(s.injection_time));
    })();
  }, []);

  useEffect(() => {
    const refreshFastingData = async () => {
      logger.info('[DayPage] settings changed → reloading fasting and anchor settings');
      const s = await getSettings();

      let hoursPart = '';
      let startPart = '';

      if (typeof s.fasting_schedule === 'string' && s.fasting_schedule.includes(',')) {
        const [hRaw, stRaw] = s.fasting_schedule.split(',');
        hoursPart = hRaw.trim();
        startPart = stRaw.trim();
      } else {
        hoursPart = s.fasting_schedule ?? '';
        startPart = s.fasting_start ?? '';
      }

      if (hoursPart.includes(':')) {
        const [hOnly] = hoursPart.split(':');
        hoursPart = hOnly;
      }

      setFastSchedule(hoursPart);
      setFastStartHHMM(toHHMM(startPart));
      setTz(
        s.timezone && s.timezone.trim()
          ? s.timezone
          : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      );
      setInjDay(toFullDay(s.injection_day) || '');
      setInjHHMM(toHHMM(s.injection_time));

      logger.debug('[DayPage] Updated fastingSchedule', { hoursPart });
      logger.debug('[DayPage] Updated fastingStartHHMM', { startHHMM: toHHMM(startPart) });
    };

    refreshFastingData();
    window.addEventListener('profile:saved', refreshFastingData);
    window.addEventListener('settings:changed', refreshFastingData);
    window.addEventListener('anchor:changed', refreshFastingData as EventListener);
    window.addEventListener('fasting:changed', refreshFastingData);
    return () => {
      window.removeEventListener('profile:saved', refreshFastingData);
      window.removeEventListener('settings:changed', refreshFastingData);
      window.removeEventListener('anchor:changed', refreshFastingData as EventListener);
      window.removeEventListener('fasting:changed', refreshFastingData);
    };
  }, []);

  // Load last injection
  useEffect(() => {
    (async () => {
      const last = await getLastInjectionLocal().catch(() => null);
      setLastInjection(last ?? null);
    })();
  }, []);

  // Load reminders for this exact calendar day
  useEffect(() => {
    (async () => {
      const rows = await loadRemindersForDayRange(dayStartUtc, dayEndUtc);
      setDayReminders(rows);
    })();
  }, [dayStartUtc, dayEndUtc]);

  // Load health logs in that exact window
  useEffect(() => {
    (async () => {
      const rows = await listHealthLogsRange(dayStartUtc, dayEndUtc).catch(() => []);
      const mapped: HealthLogRow[] = (Array.isArray(rows) ? rows : []).map((r) =>
        mapRepoRowToHealthLogRow(r as RepoHealthRow),
      );
      setDayLogs(mapped);
    })();
  }, [dayStartUtc, dayEndUtc]);

  // Load exercises (all), then filter by selected weekday
  useEffect(() => {
    (async () => {
      const rows = await listExercises().catch(() => []);
      setExercises(Array.isArray(rows) ? rows : []);
    })();
  }, []);
  useEffect(() => {
    setDayExercises(exercises.filter((e) => e.day_of_week === shortDay));
  }, [exercises, shortDay]);

  // Build the 15-min blocks
  useEffect(() => {
    const isInjectionOnThisTab = (injDay || '').toLowerCase() === abbrevToFull[shortDay];
    const hasFastingSchedule = Boolean(fastStartHHMM && fastSchedule);
    const fastingHours = hasFastingSchedule ? parseInt(fastSchedule.split(':')[0], 10) || 0 : 0;
    const [startHour, startMinute] = (fastStartHHMM || '00:00').split(':').map((x) => parseInt(x || '0', 10));

    const fastingStartMinutes = startHour * 60 + startMinute;
    const fastingEndMinutes = (fastingStartMinutes + fastingHours * 60) % (24 * 60);

    const blocks: TimeBlock[] = [];
    for (let i = 0; i < 24 * 4; i++) {
      const minutes = i * 15;
      const hour = Math.floor(minutes / 60).toString().padStart(2, '0');
      const min = (minutes % 60).toString().padStart(2, '0');
      const blockTime = `${hour}:${min}`;

      const isCurrent =
        now.getHours() === parseInt(hour, 10) &&
        now.getMinutes() >= parseInt(min, 10) &&
        now.getMinutes() < parseInt(min, 10) + 15;

      const timeInMinutes = i * 15;
      const isFasting = hasFastingSchedule
        ? fastingStartMinutes < fastingEndMinutes
          ? timeInMinutes >= fastingStartMinutes && timeInMinutes < fastingEndMinutes
          : timeInMinutes >= fastingStartMinutes || timeInMinutes < fastingEndMinutes
        : false;

      const isInjectionTime = isInjectionOnThisTab && !!injHHMM && injHHMM.startsWith(blockTime);

      blocks.push({ time: blockTime, isFasting, isCurrent, isInjectionTime });
    }

    setTimeBlocks(blocks);
  }, [fastSchedule, fastStartHHMM, now, shortDay, injDay, injHHMM]);

  // Scroll current block into view
  useEffect(() => {
    if (currentBlockRef.current) {
      requestAnimationFrame(() =>
        currentBlockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      );
    }
  }, [timeBlocks]);

  const isoForBlock = (idx: number) => {
    const minutes = idx * 15;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const base = new Date(selectedDate);
    base.setHours(h, m, 0, 0);
    return toLocalISOWithOffset(base);
  };

  const blockDateForIndex = (idx: number) => new Date(isoForBlock(idx));

  const isSelectedLocalToday = () => localYmd(selectedDate) === localYmd(new Date());

  const isBlockInFuture = (idx: number) => blockDateForIndex(idx).getTime() > Date.now();

  // Actions
  const upsertMood = async (score: number) => {
    if (selectedBlockIdx == null) return;
    if (!isSelectedLocalToday()) {
      alert('Mood logging is available on the current day only.');
      return;
    }
    if (isBlockInFuture(selectedBlockIdx)) {
      alert('Mood logging is available for the current or past time blocks only.');
      return;
    }

    try {
      const recorded_at = isoForBlock(selectedBlockIdx);
      await upsertMoodLocal(recorded_at, score);

      const rows = await listHealthLogsRange(dayStartUtc, dayEndUtc).catch(() => []);
      const arr: HealthLogRow[] = (Array.isArray(rows) ? rows : []).map((r) =>
        mapRepoRowToHealthLogRow(r as RepoHealthRow),
      );
      setDayLogs(arr);

      const moodInBlock = arr
        .filter((l) => l.entry_type === 'mood' && moodScoreFromData(l.data) != null)
        .find((l) => isoToBlockIndex(l.recorded_at) === selectedBlockIdx);
      setSelectedBlockMoodId(moodInBlock?.id ?? null);
      setSelectedBlockMoodScore(moodScoreFromData(moodInBlock?.data) ?? null);
    } catch (err) {
      logger.error('mood save failed', err);
      alert('Could not save mood.');
    }
  };

  const removeMood = async () => {
    if (selectedBlockIdx == null) return;
    if (!isSelectedLocalToday()) {
      alert('Mood removal is available on the current day only.');
      return;
    }
    if (isBlockInFuture(selectedBlockIdx)) {
      alert('Mood removal is available for the current or past time blocks only.');
      return;
    }
    try {
      const recorded_at = isoForBlock(selectedBlockIdx);
      await deleteMoodInWindow(recorded_at);

      const rows = await listHealthLogsRange(dayStartUtc, dayEndUtc).catch(() => []);
      const arr: HealthLogRow[] = (Array.isArray(rows) ? rows : []).map((r) =>
        mapRepoRowToHealthLogRow(r as RepoHealthRow),
      );
      setDayLogs(arr);
      setSelectedBlockMoodId(null);
      setSelectedBlockMoodScore(null);
    } catch (err) {
      logger.error('mood delete failed', err);
      alert('Could not remove mood.');
    }
  };

  const markInjectionTakenAt = async (idx: number | null) => {
    const recorded_at = idx != null ? isoForBlock(idx) : toLocalISOWithOffset(new Date());
    try {
      const dayFull = (toFullDay(shortDay) || 'Monday') as WeekdayFull;
      await insertInjectionLocal(recorded_at);
      setLastInjection({ taken_at: recorded_at });

      const { dayFull: serverDay, hhmm: serverTime } = await setInjectionSchedule(
        dayFull,
        new Date(recorded_at).toTimeString().slice(0, 5),
      );
      setInjDay(serverDay);
      setInjHHMM(serverTime);
      window.dispatchEvent(new Event('profile:saved'));
      alert(`💉 Injection logged and schedule set to ${serverDay} ${serverTime}.`);
    } catch (e) {
      logger.error('Failed to log/update injection', e);
      alert('Could not log injection and update schedule.');
    }
  };

  const isInjectionBlock = (idx: number) => {
    const t = timeBlocks[idx]?.time || '';
    return (
      !!injHHMM && injHHMM.startsWith(t) && (injDay || '').toLowerCase() === abbrevToFull[shortDay]
    );
  };

  const todayStr = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const nowTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <IonPage>
      <TopNav showWhenAnon />
      <IonContent fullscreen className={styles.contentPad}>
        <div className={styles.container}>
          <h1>{todayStr}</h1>
          <p>
            Current time: <strong>{nowTime}</strong>
          </p>

          {dayReminders.length > 0 && (
            <div className={styles.reminderSection}>
              <h2>Today's Reminders</h2>
              <ul>
                {dayReminders.map((rem) => (
                  <li key={rem.id}>
                    {String(rem.title).toLowerCase() === 'weekly injection' ? '💉' : '🔔'}{' '}
                    {new Date(rem.datetime).toLocaleString([], {
                      weekday: 'short',
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    — {rem.title}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={styles.card}>
            <div className={styles.injectionHeaderRow}>
              <h3 className={styles.injectionTitle}>Injection</h3>
            </div>

            {injDay && injHHMM ? (
              <>
                {isTodayInjectionDay ? (
                  <p className={styles.injectionMeta}>Today at <strong>{injHHMM}</strong></p>
                ) : (
                  <p className={styles.injectionMeta}>
                    Next:{' '}
                    <strong>
                      {nextInjAt
                        ? nextInjAt.toLocaleString(undefined, {
                            weekday: 'short',
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </strong>
                    {` (set to ${injDay} ${injHHMM})`}
                  </p>
                )}
              </>
            ) : (
              <p className={styles.injectionNotSet}>
                Not set yet. Tap <em>Profile</em> to choose a day &amp; time.
              </p>
            )}

            {lastInjection && (
              <p className={styles.lastTaken}>
                Last taken:{' '}
                <strong>
                  {new Date(lastInjection.taken_at).toLocaleString([], {
                    weekday: 'short',
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </strong>
                {lastInjection.medication_name
                  ? ` • ${lastInjection.medication_name} ${lastInjection.medication_dose || ''}`
                  : ''}
              </p>
            )}
          </div>

          {dayExercises.length > 0 && (
            <div className={styles.exerciseSection}>
              <h2>Exercise for {shortDay}</h2>
              <ul className={styles.exerciseList}>
                {dayExercises.map((ex) => (
                  <li key={ex.id}>
                    {iconFor('exercise')} {ex.exercise_type} {ex.start_time.slice(0, 5)}–
                    {ex.end_time.slice(0, 5)}
                    {typeof ex.calories_burned === 'number' ? ` — ${ex.calories_burned} cal` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={styles.timeline}>
            {timeBlocks.map((block, idx) => {
              const entry = {
                reminders: dayReminders.filter((r) => isoToBlockIndex(r.datetime) === idx),
                logs: dayLogs.filter((l) => isoToBlockIndex(l.recorded_at) === idx),
                exercises: dayExercises.filter((ex) => {
                  const s = hhmmToIndex(ex.start_time);
                  const e = Math.max(s, hhmmToIndex(ex.end_time));
                  return idx >= s && idx < e;
                }),
              };

              const hasItems =
                entry.reminders.length > 0 || entry.logs.length > 0 || entry.exercises.length > 0;

              return (
                <div
                  key={idx}
                  ref={block.isCurrent ? currentBlockRef : null}
                  className={[
                    styles.block,
                    block.isFasting ? styles.fasting : styles.eating,
                    block.isCurrent ? styles.current : '',
                    block.isInjectionTime ? styles.injection : '',
                    hasItems ? styles.hasItems : '',
                  ].join(' ')}
                  title={block.isFasting ? 'Fasting time' : 'Eating time'}
                  onClick={() => {
                    const lines: string[] = [];
                    if (block.isInjectionTime) lines.push('Injection Time 💉');

                    if (entry.reminders.length) {
                      lines.push('Reminders:');
                      for (const r of entry.reminders) {
                        lines.push(
                          `  • ${new Date(r.datetime).toLocaleString([], {
                            weekday: 'short',
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })} — ${r.title}`,
                        );
                      }
                    }

                    if (entry.logs.length) {
                      lines.push('Health logs:');
                      for (const l of entry.logs) {
                        const when = new Date(l.recorded_at).toLocaleString([], {
                          weekday: 'short',
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        });
                        let details = '';
                        if (l.entry_type === 'hydration' && isHydrationData(l.data) && typeof l.data.amount === 'number') {
                          details = `${l.data.amount} mL`;
                        } else if (l.entry_type === 'protein' && isProteinData(l.data)) {
                          const nutrition = nutritionFromLogData(l.data);
                          const parts = [`Protein ${Math.round(nutrition.protein)} g`];
                          if (nutrition.carbs) parts.push(`Carbs ${Math.round(nutrition.carbs)} g`);
                          if (nutrition.fat) parts.push(`Fat ${Math.round(nutrition.fat)} g`);
                          if (nutrition.calories) parts.push(`${Math.round(nutrition.calories)} cal`);
                          details = parts.join(' · ');
                        } else if (l.entry_type === 'mood') {
                          const sc = moodScoreFromData(l.data);
                          details = `${moodEmoji(sc)} ${sc ?? ''}/5`;
                        }
                        lines.push(
                          `  • ${when} — ${iconFor(l.entry_type)} ${l.entry_type.replace('_', ' ')}${
                            details ? ' ' + details : ''
                          }`,
                        );
                      }
                    }

                    if (entry.exercises.length) {
                      lines.push('Exercise:');
                      for (const ex of entry.exercises) {
                        lines.push(
                          `  • ${ex.exercise_type} ${ex.start_time.slice(0, 5)}–${ex.end_time.slice(0, 5)}${
                            typeof ex.calories_burned === 'number' ? ` — ${ex.calories_burned} cal` : ''
                          }`,
                        );
                      }
                    }

                    if (!lines.length) {
                      lines.push(
                        block.isFasting
                          ? 'Fasting window\nAvoid calories, drink water/tea.'
                          : 'Eating window\nFuel your body with nutrient-rich foods.',
                      );
                    }

                    setSelectedBlockInfo(`${block.time}\n` + lines.join('\n'));
                    const mood = entry.logs.find((l) => l.entry_type === 'mood');
                    setSelectedBlockIdx(idx);
                    setSelectedBlockMoodId(mood ? mood.id : null);
                    setSelectedBlockMoodScore(mood ? moodScoreFromData(mood.data) ?? null : null);
                  }}
                >
                  <div className={styles.blockTime}>
                    {block.time} {block.isInjectionTime && <span title="Injection">💉</span>}
                  </div>

                  {hasItems && (
                    <div className={styles.blockChips}>
                      {entry.reminders.map((r) => (
                        <span key={r.id} className={styles.chip}>
                          🔔
                        </span>
                      ))}
                      {entry.logs.map((l) => (
                        <span key={l.id} className={styles.chip}>
                          {l.entry_type === 'mood' ? moodEmoji(moodScoreFromData(l.data)) : iconFor(l.entry_type)}
                        </span>
                      ))}
                      {entry.exercises.length ? (
                        <span className={styles.chip} title="Exercise">
                          {iconFor('exercise')}
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {selectedBlockInfo && (
            <div className={styles.modal} onClick={() => setSelectedBlockInfo(null)}>
              <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                <div className={styles.modalHeaderRow}>
                  <span className={styles.moodLabel}>Mood:</span>

                  {[1, 2, 3, 4, 5].map((s) => (
                    <button
                      key={s}
                      onClick={(e) => {
                        e.stopPropagation();
                        void upsertMood(s);
                      }}
                      className={[
                        styles.moodBtn,
                        selectedBlockMoodScore === s ? styles.moodBtnSelected : '',
                      ].join(' ')}
                      title={['Very sad', 'Sad', 'Neutral', 'Happy', 'Very happy'][s - 1]}
                    >
                      {moodEmoji(s)}
                    </button>
                  ))}

                  {selectedBlockMoodId && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeMood();
                      }}
                      className={styles.removeBtn}
                      title="Remove mood"
                    >
                      Remove
                    </button>
                  )}
                </div>

                {selectedBlockIdx != null && isInjectionBlock(selectedBlockIdx) && (
                  <div className={styles.injectionActionsRow}>
                    <button
                      onClick={() => void markInjectionTakenAt(selectedBlockIdx)}
                      className={styles.injectionMarkBtn}
                      title="Log injection at this exact 15-minute slot"
                    >
                      💉 Mark injection taken here
                    </button>
                  </div>
                )}

                <pre className={styles.preWrap}>{selectedBlockInfo}</pre>

                <button onClick={() => setSelectedBlockInfo(null)} className={styles.closeBtn}>
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </IonContent>

      <BottomNav />
    </IonPage>
  );
};

export default DayPage;
