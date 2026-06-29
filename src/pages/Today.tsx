import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { IonButton, IonContent, IonPage } from '@ionic/react';
import { useIonRouter } from '@ionic/react';
import {
  Activity,
  ArrowRight,
  BarChart3,
  CalendarDays,
  ClipboardList,
  Droplets,
  Dumbbell,
  Flame,
  HeartPulse,
  Moon,
  Pill,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Syringe,
  Utensils,
  Watch,
} from 'lucide-react';

import TopNav from '../context/TopNav';
import BottomNav from '../context/BottomNav';
import { useAuth } from '../context/useAuth';
import {
  getHealthDailySummaryByDay,
  getLastInjectionLocal,
  importAppleHealthWorkoutsAndEmit,
  initHealthTables,
  listExercises,
  listHealthLogsRange,
  upsertHealthDailySummary,
  type ExerciseEntry,
  type HealthDailySummary,
  type HealthLog,
} from '../db/HealthRepository';
import { listSleepLogsRange, type SleepLogRow } from '../db/SleepRepository';
import {
  initProtocolTables,
  listProtocolEventsForDay,
  listProtocols,
  logProtocolEvent,
  type Protocol,
  type ProtocolEvent,
} from '../db/ProtocolRepository';
import {
  AppleHealth,
  isAppleHealthSupportedPlatform,
  type AppleHealthDailySummary,
} from '../plugins/appleHealth';
import { getSettings, type Settings as StoredSettings } from '../db/SettingsRepository';
import { rotateShortFromFull, type WeekdayFull, type WeekdayShort } from '../lib/time';
import { addNutritionTotals, nutritionFromLogData, roundNutritionTotals } from '../lib/nutritionLog';
import { logger } from '../utils/logger';
import { getCoachProfile } from '../db/CoachRepository';
import styles from './Today.module.css';

type TodayStats = {
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
  hydration: number;
  manualExerciseMinutes: number;
  manualSleepMinutes: number;
  moodAverage: number | null;
  latestBloodPressure: string | null;
  latestBloodSugar: string | null;
  lastInjectionLabel: string;
};

type RhythmBlock = {
  time: string;
  isFasting: boolean;
  isCurrent: boolean;
  isInjectionTime: boolean;
};

type TodayRhythm = {
  injectionDay: WeekdayFull | null;
  injectionTime: string | null;
  anchorDays: WeekdayShort[];
  todayShort: WeekdayShort;
  fastingLabel: string;
  eatingLabel: string;
  nextInjectionLabel: string;
  isInjectionDay: boolean;
  blocks: RhythmBlock[];
};

type LoadState = 'loading' | 'ready' | 'error';
type SyncState = 'idle' | 'syncing' | 'synced' | 'unavailable' | 'error';

const PROTEIN_TARGET_G = 90;
const HYDRATION_TARGET_ML = 2200;
const STEPS_TARGET = 8000;
const SLEEP_TARGET_MINUTES = 7 * 60;

function localYmd(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function localDayBounds(ymd: string): { start: string; end: string } {
  const startDate = new Date(`${ymd}T00:00:00`);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 1);
  return { start: startDate.toISOString(), end: endDate.toISOString() };
}

function ymdToLocalDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00`);
}

function enumerateYmdRange(fromYmd: string, toYmd: string): string[] {
  const days: string[] = [];
  const cursor = ymdToLocalDate(fromYmd);
  const end = ymdToLocalDate(toYmd);

  while (cursor.getTime() <= end.getTime()) {
    days.push(localYmd(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

function anchorWeekStartYmd(todayYmd: string, injectionDay: WeekdayFull | null): string {
  const todayDate = ymdToLocalDate(todayYmd);
  const anchorDow = injectionDay ? FULL_FROM_INDEX.indexOf(injectionDay) : FULL_FROM_INDEX.indexOf('Monday');
  const safeAnchorDow = anchorDow >= 0 ? anchorDow : FULL_FROM_INDEX.indexOf('Monday');
  const daysSinceAnchor = (todayDate.getDay() - safeAnchorDow + 7) % 7;
  todayDate.setDate(todayDate.getDate() - daysSinceAnchor);
  return localYmd(todayDate);
}

function minutesBetween(start?: string | null, end?: string | null): number {
  if (!start || !end) return 0;
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.round((b - a) / 60000);
}

function exerciseMinutes(entry: ExerciseEntry): number {
  const start = new Date(`2000-01-01T${entry.start_time}`);
  const end = new Date(`2000-01-01T${entry.end_time}`);
  const diff = end.getTime() - start.getTime();
  if (!Number.isFinite(diff) || diff <= 0) return 0;
  return Math.round(diff / 60000);
}

function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function heartRateLabel(summary: HealthDailySummary | null): string {
  if (summary?.restingHeartRate) return `Resting ${Math.round(summary.restingHeartRate)} bpm`;
  if (summary?.averageHeartRate) return `Avg ${Math.round(summary.averageHeartRate)} bpm`;
  if (summary?.latestHeartRate) return `Latest ${Math.round(summary.latestHeartRate)} bpm`;
  return 'No HR';
}

function percentage(value: number, target: number): number {
  if (!target || target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / target) * 100)));
}

function toNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

const FULL_TO_SHORT: Record<WeekdayFull, WeekdayShort> = {
  Sunday: 'Sun',
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
};

const SHORT_FROM_INDEX: WeekdayShort[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_FROM_INDEX: WeekdayFull[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function normalizeHHMM(value?: string | null): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  const match = text.match(/(\d{1,2}):(\d{1,2})/);
  if (!match) return null;
  const hours = Math.max(0, Math.min(23, Number(match[1]) || 0));
  const minutes = Math.max(0, Math.min(59, Number(match[2]) || 0));
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function parseFastingHours(value?: string | null): number | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  const match = text.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const hours = Number(match[0]);
  return Number.isFinite(hours) ? Math.max(0, Math.min(24, hours)) : null;
}

function hhmmToMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map((part) => Number(part));
  return (Math.max(0, Math.min(23, hours || 0)) * 60) + Math.max(0, Math.min(59, minutes || 0));
}

function minutesToHHMM(total: number): string {
  const dayMinutes = 24 * 60;
  const normalized = ((Math.round(total) % dayMinutes) + dayMinutes) % dayMinutes;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function normalizeWeekdayFull(value?: string | null): WeekdayFull | null {
  const key = typeof value === 'string' ? value.slice(0, 3).toLowerCase() : '';
  switch (key) {
    case 'sun':
      return 'Sunday';
    case 'mon':
      return 'Monday';
    case 'tue':
      return 'Tuesday';
    case 'wed':
      return 'Wednesday';
    case 'thu':
      return 'Thursday';
    case 'fri':
      return 'Friday';
    case 'sat':
      return 'Saturday';
    default:
      return null;
  }
}

function nextInjectionDate(injectionDay: WeekdayFull | null, hhmm: string | null): Date | null {
  if (!injectionDay || !hhmm) return null;
  const now = new Date();
  const [hours, minutes] = hhmm.split(':').map((part) => Number(part));
  const targetDow = FULL_FROM_INDEX.indexOf(injectionDay);
  if (targetDow < 0) return null;
  let daysAway = (targetDow - now.getDay() + 7) % 7;
  const candidate = new Date(now);
  candidate.setHours(hours || 0, minutes || 0, 0, 0);
  if (daysAway === 0 && candidate.getTime() <= now.getTime()) daysAway = 7;
  candidate.setDate(candidate.getDate() + daysAway);
  return candidate;
}

function buildTodayRhythm(settings: StoredSettings): TodayRhythm {
  const injectionDay = normalizeWeekdayFull(settings.injection_day);
  const injectionTime = normalizeHHMM(settings.injection_time);
  const todayShort = SHORT_FROM_INDEX[new Date().getDay()];
  const anchorDays = rotateShortFromFull(injectionDay ?? 'Monday');
  const fastingStart = normalizeHHMM(settings.fasting_start);
  const fastingHours = parseFastingHours(settings.fasting_schedule);
  const currentIndex = Math.floor((new Date().getHours() * 60 + new Date().getMinutes()) / 15);
  const injectionIndex =
    injectionDay && injectionTime && FULL_TO_SHORT[injectionDay] === todayShort
      ? Math.floor(hhmmToMinutes(injectionTime) / 15)
      : -1;

  const blocks: RhythmBlock[] = [];

  const hasFastingSchedule = Boolean(fastingStart && fastingHours !== null);
  const fastingStartMinutes = hasFastingSchedule ? hhmmToMinutes(fastingStart as string) : 0;
  const fastingEndMinutes = hasFastingSchedule && fastingHours !== null
    ? (fastingStartMinutes + fastingHours * 60) % (24 * 60)
    : 0;

  for (let i = 0; i < 24 * 4; i += 1) {
    const minutes = i * 15;
    const isFasting = hasFastingSchedule && fastingHours !== null
      ? (
        fastingStartMinutes < fastingEndMinutes
          ? minutes >= fastingStartMinutes && minutes < fastingEndMinutes
          : minutes >= fastingStartMinutes || minutes < fastingEndMinutes
      )
      : false;

    blocks.push({
      time: minutesToHHMM(minutes),
      isFasting,
      isCurrent: i === currentIndex,
      isInjectionTime: i === injectionIndex,
    });
  }

  const fastingEnd = fastingStart && fastingHours !== null
    ? minutesToHHMM(hhmmToMinutes(fastingStart) + fastingHours * 60)
    : null;
  const eatingHours = fastingHours !== null ? Math.max(0, 24 - fastingHours) : null;
  const nextInjection = nextInjectionDate(injectionDay, injectionTime);

  return {
    injectionDay,
    injectionTime,
    anchorDays,
    todayShort,
    fastingLabel: fastingStart && fastingEnd && fastingHours !== null
      ? `${fastingHours}h ${fastingStart}-${fastingEnd}`
      : 'No fasting',
    eatingLabel: fastingStart && fastingEnd && eatingHours !== null
      ? `${eatingHours}h ${fastingEnd}-${fastingStart}`
      : '24h eating',
    nextInjectionLabel: nextInjection
      ? new Intl.DateTimeFormat(undefined, {
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }).format(nextInjection)
      : 'Set in Profile',
    isInjectionDay: !!injectionDay && FULL_TO_SHORT[injectionDay] === todayShort,
    blocks,
  };
}

function summarizeLogs(logs: HealthLog[]): Pick<
  TodayStats,
  'protein' | 'carbs' | 'fat' | 'calories' | 'hydration' | 'moodAverage' | 'latestBloodPressure' | 'latestBloodSugar'
> {
  let nutrition = { protein: 0, carbs: 0, fat: 0, calories: 0 };
  let hydration = 0;
  const mood: number[] = [];
  let latestBloodPressure: string | null = null;
  let latestBloodSugar: string | null = null;

  for (const log of logs) {
    const data = log.data as Record<string, unknown> | null;
    if (!data) continue;

    if (log.entry_type === 'protein') {
      nutrition = addNutritionTotals(nutrition, nutritionFromLogData(data));
    }

    if (log.entry_type === 'hydration') {
      hydration += toNumber(data.amount) ?? 0;
    }

    if (log.entry_type === 'mood') {
      const score = toNumber(data.score ?? data.mood ?? data.value);
      if (score !== null) mood.push(score);
    }

    if (log.entry_type === 'blood_pressure') {
      const systolic = toNumber(data.systolic);
      const diastolic = toNumber(data.diastolic);
      if (systolic && diastolic) latestBloodPressure = `${systolic}/${diastolic}`;
    }

    if (log.entry_type === 'blood_sugar') {
      const value = toNumber(data.value);
      const unit = typeof data.unit === 'string' ? data.unit : '';
      if (value !== null) latestBloodSugar = `${value} ${unit}`.trim();
    }
  }

  const roundedNutrition = roundNutritionTotals(nutrition);
  return {
    protein: roundedNutrition.protein,
    carbs: roundedNutrition.carbs,
    fat: roundedNutrition.fat,
    calories: roundedNutrition.calories,
    hydration: Math.round(hydration),
    moodAverage: mood.length
      ? Math.round((mood.reduce((sum, n) => sum + n, 0) / mood.length) * 10) / 10
      : null,
    latestBloodPressure,
    latestBloodSugar,
  };
}

function syncLabel(state: SyncState): string {
  switch (state) {
    case 'syncing':
      return 'Syncing';
    case 'synced':
      return 'Synced today';
    case 'unavailable':
      return 'iPhone only';
    case 'error':
      return 'Needs attention';
    default:
      return 'Not synced';
  }
}

const Today: React.FC = () => {
  const router = useIonRouter();
  const { user, isPro } = useAuth();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [stats, setStats] = useState<TodayStats | null>(null);
  const [appleSummary, setAppleSummary] = useState<HealthDailySummary | null>(null);
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [protocolEvents, setProtocolEvents] = useState<ProtocolEvent[]>([]);
  const [rhythm, setRhythm] = useState<TodayRhythm | null>(null);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncMessage, setSyncMessage] = useState<string>('');
  const [setupComplete, setSetupComplete] = useState(false);
  const [protocolLogBusy, setProtocolLogBusy] = useState(false);
  const [protocolLogMessage, setProtocolLogMessage] = useState('');

  const today = useMemo(() => localYmd(), []);

  const loadToday = useCallback(async () => {
    setLoadState('loading');
    try {
      await initHealthTables();
      await initProtocolTables();
      const { start, end } = localDayBounds(today);
      const [
        logs,
        exercises,
        sleepLogs,
        imported,
        lastInjection,
        protocolRows,
        protocolEventRows,
        settings,
        coachProfile,
      ] = await Promise.all([
        listHealthLogsRange(start, end),
        listExercises(),
        listSleepLogsRange(today, today),
        getHealthDailySummaryByDay(today),
        getLastInjectionLocal(),
        user?.id ? listProtocols(user.id) : Promise.resolve([]),
        user?.id ? listProtocolEventsForDay(user.id, today) : Promise.resolve([]),
        getSettings(),
        user?.id ? getCoachProfile(user.id).catch(() => null) : Promise.resolve(null),
      ]);

      const logSummary = summarizeLogs(logs);
      const todaysExercises = exercises.filter((entry) => entry.exercise_date === today);
      const manualExerciseMinutes = todaysExercises.reduce(
        (sum, entry) => sum + exerciseMinutes(entry),
        0
      );
      const manualSleepMinutes = (sleepLogs as SleepLogRow[]).reduce(
        (sum, entry) => sum + minutesBetween(entry.sleep_at, entry.wake_at),
        0
      );

      setAppleSummary(imported);
      setProtocols(protocolRows);
      setProtocolEvents(protocolEventRows);
      setRhythm(buildTodayRhythm(settings));
      setSetupComplete(Boolean(coachProfile?.coach_onboarding_completed_at));
      setStats({
        ...logSummary,
        manualExerciseMinutes,
        manualSleepMinutes,
        lastInjectionLabel: lastInjection?.taken_at
          ? new Intl.DateTimeFormat(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date(lastInjection.taken_at))
          : 'No injection logged yet',
      });
      setLoadState('ready');
    } catch (error) {
      logger.warn('[Today] failed to load dashboard', {
        msg: error instanceof Error ? error.message : String(error),
      });
      setLoadState('error');
    }
  }, [today, user?.id]);

  useEffect(() => {
    void loadToday();
    const refresh = () => void loadToday();
    window.addEventListener('health:changed', refresh);
    window.addEventListener('exercise:changed', refresh);
    window.addEventListener('sleep:changed', refresh);
    window.addEventListener('profile:saved', refresh);
    window.addEventListener('settings:changed', refresh);
    window.addEventListener('protocols:changed', refresh);
    window.addEventListener('anchor:changed', refresh as EventListener);
    window.addEventListener('fasting:changed', refresh);
    return () => {
      window.removeEventListener('health:changed', refresh);
      window.removeEventListener('exercise:changed', refresh);
      window.removeEventListener('sleep:changed', refresh);
      window.removeEventListener('profile:saved', refresh);
      window.removeEventListener('settings:changed', refresh);
      window.removeEventListener('protocols:changed', refresh);
      window.removeEventListener('anchor:changed', refresh as EventListener);
      window.removeEventListener('fasting:changed', refresh);
    };
  }, [loadToday]);

  const handleAppleHealthSync = async (): Promise<void> => {
    setSyncMessage('');

    if (!isAppleHealthSupportedPlatform()) {
      setSyncState('unavailable');
      setSyncMessage('Apple Health sync is available on iPhone builds.');
      return;
    }

    setSyncState('syncing');
    try {
      const availability = await AppleHealth.isAvailable();
      if (!availability.available) {
        setSyncState('unavailable');
        setSyncMessage('Apple Health is not available on this device.');
        return;
      }

      await AppleHealth.requestAuthorization();

      const settings = await getSettings();
      const syncAnchorDay = primaryIsDaily
        ? 'Monday'
        : normalizeWeekdayFull(primaryProtocol?.anchor_day ?? settings.injection_day);
      const weekStart = anchorWeekStartYmd(today, syncAnchorDay);
      const syncDays = enumerateYmdRange(weekStart, today);
      let insertedWorkouts = 0;
      let daysWithHealthData = 0;

      for (const day of syncDays) {
        const summary: AppleHealthDailySummary = await AppleHealth.getDailySummary({ day });
        const workoutResult = await AppleHealth.getWorkouts({ day });
        const dayHasData = Boolean(
          summary.steps ||
          summary.activeEnergyKcal ||
          summary.exerciseMinutes ||
          summary.sleepMinutes ||
          summary.restingHeartRate ||
          summary.averageHeartRate ||
          summary.latestHeartRate ||
          summary.workouts ||
          workoutResult.workouts.length
        );

        await upsertHealthDailySummary({
          day: summary.day,
          source: 'apple_health',
          steps: summary.steps,
          activeEnergyKcal: summary.activeEnergyKcal,
          exerciseMinutes: summary.exerciseMinutes,
          sleepMinutes: summary.sleepMinutes,
          restingHeartRate: summary.restingHeartRate,
          averageHeartRate: summary.averageHeartRate,
          latestHeartRate: summary.latestHeartRate,
          workouts: summary.workouts,
        });

        const imported = await importAppleHealthWorkoutsAndEmit(workoutResult.workouts);
        insertedWorkouts += imported.inserted;
        if (dayHasData) daysWithHealthData += 1;
      }

      setSyncState('synced');
      const syncRangeLabel = primaryIsDaily ? 'review week' : 'injection week';
      const syncedRange = `${weekStart} to ${today}`;
      setSyncMessage(
        insertedWorkouts > 0
          ? `Apple Health is up to date for this ${syncRangeLabel} (${syncedRange}). Synced ${syncDays.length} day${syncDays.length === 1 ? '' : 's'}, found data on ${daysWithHealthData}, and added ${insertedWorkouts} workout${insertedWorkouts === 1 ? '' : 's'}.`
          : `Apple Health is up to date for this ${syncRangeLabel} (${syncedRange}). Synced ${syncDays.length} day${syncDays.length === 1 ? '' : 's'} and found data on ${daysWithHealthData}.`
      );
      await loadToday();
    } catch (error) {
      logger.warn('[Today] Apple Health sync failed', {
        msg: error instanceof Error ? error.message : String(error),
      });
      setSyncState('error');
      setSyncMessage('Apple Health could not sync yet.');
    }
  };

  const firstName = user?.first_name?.trim() || 'there';
  const importedSteps = appleSummary?.steps ?? 0;
  const importedExercise = appleSummary?.exerciseMinutes ?? 0;
  const importedSleep = appleSummary?.sleepMinutes ?? 0;
  const importedEnergy = appleSummary?.activeEnergyKcal ?? 0;
  const activityMinutes = Math.max(importedExercise, stats?.manualExerciseMinutes ?? 0);
  const sleepMinutes = Math.max(importedSleep, stats?.manualSleepMinutes ?? 0);
  const activeProtocols = protocols.filter((protocol) => protocol.is_active);
  const primaryProtocol = activeProtocols.find((protocol) => protocol.is_primary) ?? activeProtocols[0] ?? null;
  const primaryIsDaily = primaryProtocol?.cadence_type === 'daily';
  const primaryDoseLabel = primaryProtocol?.dose_time
    ? `${primaryProtocol.name} ${primaryProtocol.dose_time}`
    : primaryProtocol?.name ?? null;
  const rhythmDays = primaryIsDaily ? rotateShortFromFull('Monday') : (rhythm?.anchorDays ?? rotateShortFromFull('Monday'));
  const protocolLoggedIds = new Set(protocolEvents.map((event) => event.protocol_id));
  const primaryLoggedToday = primaryProtocol ? protocolLoggedIds.has(primaryProtocol.id) : false;

  const handleLogPrimaryProtocol = async (): Promise<void> => {
    if (!primaryProtocol || protocolLogBusy) return;
    setProtocolLogBusy(true);
    setProtocolLogMessage('');
    try {
      await logProtocolEvent(
        primaryProtocol,
        primaryIsDaily ? 'Daily pill logged from Today' : 'Dose logged from Today'
      );
      setProtocolLogMessage(primaryIsDaily ? 'Daily pill logged for today.' : 'Dose logged for today.');
      window.dispatchEvent(new Event('protocols:changed'));
      window.dispatchEvent(new Event('glp1:changed'));
      await loadToday();
    } catch (error) {
      logger.warn('[Today] protocol log failed', {
        msg: error instanceof Error ? error.message : String(error),
      });
      setProtocolLogMessage('Could not log that dose yet.');
    } finally {
      setProtocolLogBusy(false);
    }
  };

  const focusText = useMemo(() => {
    if (!stats) return 'Loading your day';
    if (primaryIsDaily) return 'Daily rhythm. Keep the dose, food, and water steady';
    if (rhythm?.isInjectionDay) return 'Anchor day. Keep the plan simple and steady';
    if ((stats.protein ?? 0) < 45) return 'Make protein the easy win today';
    if ((stats.hydration ?? 0) < 1000) return 'A steadier water day would help';
    if (sleepMinutes > 0 && sleepMinutes < 360) return 'Keep today gentle after shorter sleep';
    if (importedSteps >= 7000) return 'Movement is carrying the day nicely';
    return 'Small steady choices are enough today';
  }, [importedSteps, primaryIsDaily, rhythm?.isInjectionDay, sleepMinutes, stats]);

  return (
    <IonPage>
      <TopNav showWhenAnon={false} />
      <IonContent fullscreen className={styles.content}>
        <main className={styles.page}>
          <section className={styles.heroBand}>
            <div className={styles.heroCopy}>
              <div className={styles.eyebrow}>
                <CalendarDays size={16} />
                <span>{new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}</span>
              </div>
              <h1>Today, {firstName}</h1>
              <p>{focusText}</p>
            </div>
            <div className={styles.heroScore} aria-label="Daily rhythm score">
              <span>{loadState === 'ready' ? percentage((stats?.protein ?? 0) + (stats?.hydration ?? 0) / 30 + activityMinutes, 190) : 0}</span>
              <small>rhythm</small>
            </div>
          </section>

          <section className={styles.metricsGrid} aria-label="Today metrics">
            <article className={`${styles.metricCard} ${styles.protein}`}>
              <Utensils size={21} />
              <div>
                <span>Protein</span>
                <strong>{formatNumber(stats?.protein ?? 0)}g</strong>
              </div>
              <div className={styles.progressTrack}>
                <i style={{ width: `${percentage(stats?.protein ?? 0, PROTEIN_TARGET_G)}%` }} />
              </div>
            </article>

            <article className={`${styles.metricCard} ${styles.protein}`}>
              <Utensils size={21} />
              <div>
                <span>Carbs</span>
                <strong>{formatNumber(stats?.carbs ?? 0)}g</strong>
              </div>
              <div className={styles.progressTrack}>
                <i style={{ width: `${percentage(stats?.carbs ?? 0, 150)}%` }} />
              </div>
            </article>

            <article className={`${styles.metricCard} ${styles.protein}`}>
              <Flame size={21} />
              <div>
                <span>Fat</span>
                <strong>{formatNumber(stats?.fat ?? 0)}g</strong>
              </div>
              <div className={styles.progressTrack}>
                <i style={{ width: `${percentage(stats?.fat ?? 0, 80)}%` }} />
              </div>
            </article>

            <article className={`${styles.metricCard} ${styles.protein}`}>
              <Flame size={21} />
              <div>
                <span>Calories</span>
                <strong>{formatNumber(stats?.calories ?? 0)}</strong>
              </div>
              <div className={styles.progressTrack}>
                <i style={{ width: `${percentage(stats?.calories ?? 0, 2200)}%` }} />
              </div>
            </article>

            <article className={`${styles.metricCard} ${styles.hydration}`}>
              <Droplets size={21} />
              <div>
                <span>Hydration</span>
                <strong>{formatNumber(stats?.hydration ?? 0)}ml</strong>
              </div>
              <div className={styles.progressTrack}>
                <i style={{ width: `${percentage(stats?.hydration ?? 0, HYDRATION_TARGET_ML)}%` }} />
              </div>
            </article>

            <article className={`${styles.metricCard} ${styles.steps}`}>
              <Activity size={21} />
              <div>
                <span>Steps</span>
                <strong>{formatNumber(importedSteps)}</strong>
              </div>
              <div className={styles.progressTrack}>
                <i style={{ width: `${percentage(importedSteps, STEPS_TARGET)}%` }} />
              </div>
            </article>

            <article className={`${styles.metricCard} ${styles.sleep}`}>
              <Moon size={21} />
              <div>
                <span>Sleep</span>
                <strong>{formatMinutes(sleepMinutes)}</strong>
              </div>
              <div className={styles.progressTrack}>
                <i style={{ width: `${percentage(sleepMinutes, SLEEP_TARGET_MINUTES)}%` }} />
              </div>
            </article>
          </section>

          {!isPro && (
            <section className={styles.freeJourneyBand}>
              <div>
                <div className={styles.proKicker}>
                  <Sparkles size={16} />
                  <span>Free start</span>
                </div>
                <h2>Your first goal is simple: prove the app is useful.</h2>
                <p>
                  Use Coach setup, daily check-ins, and the Today rhythm to see how your GLP-1
                  routine is coming together. Pro adds the deeper reports, archives, and
                  clinic-ready review tools when you are ready.
                </p>
              </div>
              <div className={styles.freeJourneyActions}>
                {!setupComplete && (
                  <IonButton className={styles.primaryAction} onClick={() => router.push('/coach', 'forward')}>
                    Continue setup
                    <ArrowRight size={17} />
                  </IonButton>
                )}
                {setupComplete && (
                  <IonButton className={styles.primaryAction} onClick={() => router.push('/profile', 'forward')}>
                    Review profile
                    <ArrowRight size={17} />
                  </IonButton>
                )}
                <IonButton className={styles.secondaryAction} fill="outline" onClick={() => router.push('/paywall?returnTo=/today', 'forward')}>
                  See what Pro adds
                </IonButton>
              </div>
            </section>
          )}

          <section className={styles.rhythmBand}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>{primaryIsDaily ? 'Daily rhythm' : 'Week rhythm'}</h2>
                <p>
                  {primaryIsDaily && primaryProtocol?.dose_time
                    ? `Daily dose ${primaryProtocol.dose_time}`
                    : rhythm?.injectionDay && rhythm.injectionTime
                    ? `Anchor ${rhythm.injectionDay} ${rhythm.injectionTime}`
                    : 'Anchor not set yet'}
                </p>
              </div>
              <IonButton
                className={styles.iconButton}
                fill="clear"
                onClick={() => router.push(isPro ? `/plan/day/${(rhythm?.todayShort ?? 'Mon').toLowerCase()}` : '/coach', 'forward')}
                aria-label={isPro ? "Open today's plan" : 'Open coach setup'}
              >
                <CalendarDays size={20} />
              </IonButton>
            </div>

            <div className={styles.anchorStrip} aria-label={primaryIsDaily ? 'Monday to Sunday review week' : 'Injection anchored week'}>
              {rhythmDays.map((day, index) => (
                <button
                  key={day}
                  type="button"
                  className={[
                    styles.anchorDay,
                    index === 0 ? styles.anchorStart : '',
                    day === rhythm?.todayShort ? styles.anchorToday : '',
                  ].join(' ')}
                  onClick={() => router.push(isPro ? `/plan/day/${day.toLowerCase()}` : '/coach', 'forward')}
                  aria-label={isPro ? `Open ${day} plan` : `Review ${day} with Coach`}
                >
                  <span>{day}</span>
                  {index === 0 && <strong>{primaryIsDaily ? 'Review' : 'Anchor'}</strong>}
                </button>
              ))}
            </div>

            <div className={styles.rhythmMeta}>
              <div>
                <span>{primaryIsDaily ? 'Daily dose' : 'Next injection'}</span>
                <strong>
                  {primaryIsDaily
                    ? primaryDoseLabel ?? 'Set protocol'
                    : rhythm?.nextInjectionLabel ?? 'Set in Profile'}
                </strong>
              </div>
              <div>
                <span>Fasting</span>
                <strong>{rhythm?.fastingLabel ?? 'Set in Profile'}</strong>
              </div>
              <div>
                <span>Eating</span>
                <strong>{rhythm?.eatingLabel ?? 'Set in Profile'}</strong>
              </div>
            </div>

            {primaryProtocol && (
              <div className={styles.doseActionPanel}>
                <div>
                  <span>{primaryIsDaily ? '24-hour pill coverage' : 'Protocol dose'}</span>
                  <strong>
                    {primaryLoggedToday
                      ? primaryIsDaily
                        ? 'Pill logged today'
                        : 'Dose logged today'
                      : primaryIsDaily
                        ? `Usual time ${primaryProtocol.dose_time ?? '08:00'}`
                        : 'Not logged today'}
                  </strong>
                  <p>
                    {primaryIsDaily
                      ? 'Tap when you take the pill so effectiveness counts down from the real dose time.'
                      : 'Tap when this dose happens so today and effectiveness stay in sync.'}
                  </p>
                </div>
                <IonButton
                  className={primaryLoggedToday ? styles.secondaryAction : styles.primaryAction}
                  fill={primaryLoggedToday ? 'outline' : 'solid'}
                  onClick={() => void handleLogPrimaryProtocol()}
                  disabled={protocolLogBusy}
                >
                  {primaryLoggedToday ? 'Log again' : primaryIsDaily ? 'I took my pill' : 'Log dose'}
                </IonButton>
              </div>
            )}

            {protocolLogMessage && <p className={styles.protocolLogMessage}>{protocolLogMessage}</p>}

            {rhythm?.blocks.length ? (
              <>
                <div className={styles.rhythmTimeline} aria-label="Today fasting and eating blocks">
                  {rhythm.blocks.map((block) => (
                    <i
                      key={block.time}
                      className={[
                        block.isFasting ? styles.rhythmFasting : styles.rhythmEating,
                        block.isCurrent ? styles.rhythmCurrent : '',
                        block.isInjectionTime ? styles.rhythmInjection : '',
                      ].join(' ')}
                      title={`${block.time} ${block.isFasting ? 'fasting' : 'eating'}`}
                    />
                  ))}
                </div>
                <div className={styles.rhythmLegend}>
                  <span><i className={styles.rhythmFasting} /> Fasting</span>
                  <span><i className={styles.rhythmEating} /> Eating</span>
                  <span><i className={styles.rhythmInjection} /> {primaryIsDaily ? 'Dose' : 'Injection'}</span>
                </div>
              </>
            ) : (
              <p className={styles.rhythmEmpty}>
                Fasting and {primaryIsDaily ? 'dose' : 'injection'} schedule not set yet.
              </p>
            )}
          </section>

          <section className={styles.monthlyBand}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Monthly anchor</h2>
                <p>
                  {primaryIsDaily
                    ? 'Daily protocols use a Monday-Sunday review rhythm for check-ins and trends.'
                    : 'Most GLP-1 supplies run as 4 weekly doses. This becomes your review and reorder rhythm.'}
                </p>
              </div>
              <CalendarDays size={22} />
            </div>
            <div className={styles.monthlySteps}>
              <div><span>1</span><strong>Dose week</strong></div>
              <div><span>2</span><strong>Check side effects</strong></div>
              <div><span>3</span><strong>Spot patterns</strong></div>
              <div><span>4</span><strong>Prepare review</strong></div>
            </div>
            {!isPro && (
              <p className={styles.monthlyHint}>
                Free users can set the anchor in Coach. Pro will turn it into a fuller clinic-ready monthly report.
              </p>
            )}
          </section>

          <section className={styles.healthBand}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Apple Health</h2>
                <p>{syncLabel(syncState)}</p>
              </div>
              <IonButton
                className={styles.iconButton}
                fill="clear"
                onClick={() => void handleAppleHealthSync()}
                disabled={syncState === 'syncing'}
                aria-label="Sync Apple Health"
              >
                {syncState === 'syncing' ? <RefreshCw className={styles.spin} size={20} /> : <Watch size={20} />}
              </IonButton>
            </div>

            <div className={styles.healthStats}>
              <div>
                <Flame size={18} />
                <span>{formatNumber(importedEnergy)} kcal</span>
              </div>
              <div>
                <Dumbbell size={18} />
                <span>{formatMinutes(activityMinutes)}</span>
              </div>
              <div>
                <HeartPulse size={18} />
                <span>{heartRateLabel(appleSummary)}</span>
              </div>
            </div>

            {syncMessage && <p className={styles.syncMessage}>{syncMessage}</p>}
          </section>

          {!isPro && (
            <section className={styles.proPreview}>
              <div>
                <div className={styles.proKicker}>
                  <Sparkles size={16} />
                  <span>Pro insight</span>
                </div>
                <h2>Turn today into a weekly pattern</h2>
                <p>
                  Pro keeps the longer view: personal plan, saved summaries,
                  day detail, and GLP-1 trend archives.
                </p>
              </div>
              <IonButton
                className={styles.proAction}
                onClick={() => router.push('/paywall?returnTo=/today', 'forward')}
              >
                <BarChart3 size={17} />
                See Pro
              </IonButton>
            </section>
          )}

          <section className={styles.protocolBand}>
            <div className={styles.sectionHeader}>
              <div>
                <h2>Protocols</h2>
                <p>
                  {activeProtocols.length
                    ? `${activeProtocols.length} active routine${activeProtocols.length === 1 ? '' : 's'}`
                    : 'GLP-1 and peptide tracking'}
                </p>
              </div>
              <IonButton
                className={styles.iconButton}
                fill="clear"
                onClick={() => router.push('/protocols', 'forward')}
                aria-label="Open protocols"
              >
                <ClipboardList size={20} />
              </IonButton>
            </div>

            {activeProtocols.length === 0 ? (
              <p className={styles.protocolEmpty}>
                Add GLP-1, copper peptide, or another protocol to keep timing, dose labels, and observations together.
              </p>
            ) : (
              <div className={styles.protocolList}>
                {activeProtocols.slice(0, 3).map((protocol) => (
                  <div className={styles.protocolPill} key={protocol.id}>
                    <span>{protocol.name}</span>
                    <strong>
                      {protocolLoggedIds.has(protocol.id)
                        ? 'Logged today'
                        : protocol.cadence_label || 'As directed'}
                    </strong>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={styles.insightGrid}>
            <article className={styles.insightCard}>
              {primaryIsDaily ? <Pill size={20} /> : <Syringe size={20} />}
              <span>{primaryIsDaily ? 'Daily Dose' : 'Injection Anchor'}</span>
              <strong>
                {primaryIsDaily
                  ? primaryDoseLabel ?? 'Set protocol'
                  : rhythm?.injectionDay && rhythm.injectionTime
                  ? `${rhythm.injectionDay} ${rhythm.injectionTime}`
                  : stats?.lastInjectionLabel ?? 'Loading'}
              </strong>
            </article>

            <article className={styles.insightCard}>
              <Utensils size={20} />
              <span>Planned Fast</span>
              <strong>
                {rhythm?.fastingLabel ?? 'Set in Profile'}
              </strong>
            </article>

            <article className={styles.insightCard}>
              <ShieldCheck size={20} />
              <span>Body Check</span>
              <strong>{stats?.latestBloodPressure || stats?.latestBloodSugar || 'No reading today'}</strong>
            </article>
          </section>

          <section className={styles.actionBand}>
            <IonButton className={styles.primaryAction} onClick={() => router.push('/healthtracker', 'forward')}>
              Log something
              <ArrowRight size={17} />
            </IonButton>
            <IonButton className={styles.secondaryAction} fill="outline" onClick={() => router.push('/weeklysummary', 'forward')}>
              Weekly review
            </IonButton>
          </section>
        </main>
      </IonContent>
      <BottomNav showWhenAnon={false} />
    </IonPage>
  );
};

export default Today;
