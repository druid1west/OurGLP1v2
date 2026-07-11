// ============================================================================
// File: src/pages/PersonalPlan.tsx
// Display-only Plan page with actual Sleep logs (last 7 days) + Fasting list.
// Compatible with iOS & Android WebViews. Works with local SQLite (IS_LOCAL_AUTH)
// and falls back to remote endpoints where applicable.
// ============================================================================

import { logger } from '../utils/logger';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useIonRouter, IonPage, IonButton, IonContent } from '@ionic/react';
import { useAuth } from '../context/useAuth';
import personalStyles from './personalPlan.module.css';
import { rotateShortFromFull, FULL_DAYS } from '../lib/time';
import type { WeekdayFull, WeekdayShort } from '../lib/time';
import { nutritionFromLogData } from '../lib/nutritionLog';

// Sleep — actual logs (went to bed / woke up)
import { initSleepTables, listSleepLogsRange, deleteSleepLog } from '../db/SleepRepository';

// Navigation
import TopNav from '../context/TopNav';
import BottomNav from '../context/BottomNav';

import { IS_LOCAL_AUTH } from '../config/runtime';
import {
  initHealthTables,
  // fasting
  getFastingRange, // (fromYmd, toYmd)
  clearFastingByDay, // (day)
  // health logs
  listHealthLogs, // ()
  deleteHealthLogLocal, // (id)
  // exercises
  listExercises, // ()
  deleteExerciseById, // (id)
} from '../db/HealthRepository';
// GLP-1 effectiveness
import {
listGlp1ExperienceRange,
deleteGlp1ExperienceLog,
type Glp1ExperienceLog,
type Glp1GraphPoint,
} from '../db/EffectivenessRepository';


import { computeGlp1Activity, glp1ActivityToPercent } from '../lib/glp1';
import Glp1TrendGraph from '../components/Glp1TrendGraph';

// Today label for the week overview
const todayName: WeekdayShort = new Date().toLocaleDateString('en-US', {
  weekday: 'short',
}) as WeekdayShort;

// ---------- Types ----------
type HealthLogData = {
  value?: number;
  systolic?: number;
  diastolic?: number;
  pulse?: number | null;
  grams?: number;
  protein_grams?: number;
  amount?: number;
  hydration_amount?: number;
  [key: string]: unknown;
};

type HealthLog = {
  id: number;
  entry_type: 'blood_sugar' | 'blood_pressure' | 'bowel' | 'hydration' | 'protein';
  recorded_at: string; // ISO
  data: HealthLogData;
};

type UserProfile = {
  first_name: string;
  last_name: string;
  email: string;
  medication_name: string;
  medication_dose: string;
  fasting_schedule: string;
  fasting_start: string; // 'HH:MM' or 'HH:MM:SS'
  injection_day?: string;
  injection_time?: string; // ISO or 'HH:MM[:SS]'
};

type ExerciseEntry = {
  id: string | number;
  day_of_week: string; // 'Mon'..'Sun'
  start_time: string; // 'HH:MM' or 'HH:MM:SS'
  end_time: string; // 'HH:MM' or 'HH:MM:SS'
  exercise_type: string;
  calories_burned: number | null;
  start_at?: string | null;
  end_at?: string | null;
};

// Fasting rows for display
export type FastingRow = {
  id: string | number;
  day: string;
  first_meal_at: string | null;
  last_meal_at: string | null;
};

// Local repo fasting row (optional id)
type LocalFastingRow = {
  id?: number;
  day: string;
  first_meal_at?: string | null;
  last_meal_at?: string | null;
};

// Sleep rows (actual)
type SleepLogRow = Readonly<{
  id: number;
  sleep_date: string; // e.g., "2025-10-29"
  sleep_at: string | null; // ISO
  wake_at: string | null; // ISO
}>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const safeHHMM = (s?: string | null): string =>
  typeof s === 'string' && s.length >= 5 ? s.slice(0, 5) : '--:--';

function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Display as local HH:MM whether input is ISO or HH:MM[:SS]
function formatDisplayTime(raw?: string | null): string {
  if (!raw) return '—';
  const s = String(raw);

  if (s.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    const hhmm = s.slice(11, 16);
    return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : '—';
  }

  const hhmm = s.slice(0, 5);
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  if (Number.isFinite(h) && Number.isFinite(m)) {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return '—';
}

function pickFirstNumber(obj: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

function formatProteinLine(log: HealthLog): string {
  const d = log.data as Record<string, unknown>;
  const foodName = typeof d.foodName === 'string' ? d.foodName : null;
  const nutrition = nutritionFromLogData(d);
  if (!nutrition.protein) return '';
  const parts = [`Protein ${Math.round(nutrition.protein)} g`];
  if (nutrition.carbs) parts.push(`Carbs ${Math.round(nutrition.carbs)} g`);
  if (nutrition.fat) parts.push(`Fat ${Math.round(nutrition.fat)} g`);
  if (nutrition.calories) parts.push(`${Math.round(nutrition.calories)} cal`);
  return `${foodName ? `${foodName} - ` : ''}${parts.join(' · ')}`;
}

function formatHydrationLine(log: HealthLog): string {
  const d = log.data as Record<string, unknown>;
  const amt = pickFirstNumber(d, 'amount', 'hydration_amount', 'value');
  return amt != null ? `${amt} mL` : '';
}

function formatBowelLine(log: HealthLog): string {
  const d = log.data as Record<string, unknown>;
  const asNumber = (k: string) => (typeof d[k] === 'number' ? (d[k] as number) : undefined);
  const asString = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : undefined);

  const bristol = asNumber('bristol') ?? asNumber('score') ?? asNumber('type') ?? asNumber('value');
  if (typeof bristol === 'number') return `Bristol ${bristol}`;
  const typeStr = asString('type');
  if (typeStr) return `Type ${typeStr}`;
  const count = asNumber('count');
  if (typeof count === 'number') return `${count}×`;
  const note = asString('note');
  return note ? note : '';
}

const WEEKDAY_FULL: Readonly<Record<'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun', WeekdayFull>> =
  {
    Mon: 'Monday',
    Tue: 'Tuesday',
    Wed: 'Wednesday',
    Thu: 'Thursday',
    Fri: 'Friday',
    Sat: 'Saturday',
    Sun: 'Sunday',
  };

// -----------------------------
// GLP-1 Effectiveness Logs (last 7 days)
// -----------------------------
const Glp1EffectivenessBox: React.FC<{
  userId: string;
  glp1Pct: number;
  injectionDay?: string | null;
  timezone: string;
}> = ({ userId, glp1Pct, injectionDay, timezone }) => {
  const router = useIonRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Glp1ExperienceLog[]>([]);
  const [graphPoints, setGraphPoints] = useState<Glp1GraphPoint[]>([]);

  useEffect(() => {
    let mounted = true;

    const load = async (): Promise<void> => {
      if (!mounted) return;
      setLoading(true);
      try {
        const today = new Date();
        const from = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
        const fromYmd = toYMD(from);
        const toYmd = toYMD(today);

        const logs = await listGlp1ExperienceRange(userId, fromYmd, toYmd);
        if (!mounted) return;

        const newestFirst = [...logs].sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1));
        const oldestFirst = [...logs].sort((a, b) => (a.recorded_at > b.recorded_at ? 1 : -1));
        setRows(newestFirst);
        setGraphPoints(
          oldestFirst.map((row) => ({
            recordedAt: row.recorded_at,
            hunger: row.hunger,
            nausea: row.nausea,
          }))
        );
      } catch (e) {
        logger.error('[GLP1] load failed', e);
        if (mounted) {
          setRows([]);
          setGraphPoints([]);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();

    const onChanged = (): void => {
      void load();
    };

    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        void load();
      }
    };

    window.addEventListener('glp1:changed', onChanged);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      mounted = false;
      window.removeEventListener('glp1:changed', onChanged);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId]);

  const onDelete = async (id: number): Promise<void> => {
    if (!window.confirm('Delete this effectiveness entry?')) return;
    await deleteGlp1ExperienceLog(id);
    setRows((prev) => prev.filter((r) => r.id !== id));
    setGraphPoints((prev) => prev.filter((point) => {
      const deleted = rows.find((row) => row.id === id);
      return deleted ? point.recordedAt !== deleted.recorded_at : true;
    }));
    window.dispatchEvent(new Event('glp1:changed'));
  };

  return (
    <div className={personalStyles.infoBox}>
      <h3 className={personalStyles.sectionTitle}>💉 Medication Effectiveness</h3>

      {loading ? (
        <p className={personalStyles.muted}>Loading…</p>
      ) : (
        <>
          <div className={personalStyles.rowBlock}>
            <div className={personalStyles.rowTitle}>This injection week</div>
            <div className={personalStyles.rowFlex}>
              <div>
                <strong>Estimated effectiveness:</strong> {glp1Pct}%
              </div>
            </div>
            <Glp1TrendGraph
              points={graphPoints}
              injectionDay={injectionDay}
              timezone={timezone}
              compact
            />
            <div className={personalStyles.rowActions}>
              <IonButton
                size="small"
                fill="outline"
                onClick={() => router.push('/effectiveness', 'forward')}
              >
                Open full effectiveness graph
              </IonButton>
            </div>
          </div>

          {rows.length === 0 ? (
            <p className={personalStyles.muted}>No effectiveness entries yet.</p>
          ) : (
            rows.map((r) => (
            <div key={r.id} className={personalStyles.rowBlock}>
              <div className={personalStyles.rowTitle}>
                {new Date(r.recorded_at).toLocaleString()}
              </div>

              <div className={personalStyles.rowFlex}>
                <div>
                  <strong>Effectiveness:</strong> {glp1Pct}%
                </div>
                <div>Hunger: {r.hunger} / 10</div>
                <div>Nausea: {r.nausea} / 10</div>
                {r.note && <div className={personalStyles.muted}>📝 {r.note}</div>}
              </div>

              <div className={personalStyles.rowActions}>
                <button
                  type="button"
                  onClick={() => void onDelete(r.id)}
                  className={personalStyles.iconButton}
                  aria-label="Delete effectiveness entry"
                >
                  🗑️
                </button>
              </div>
            </div>
            ))
          )}
        </>
      )}
    </div>
  );
};

// -----------------------------
// Fasting list (last N days)
// -----------------------------
const DAYS_BACK = 7; // show last 7 days

const FastingDisplayBox: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FastingRow[]>([]);

  useEffect(() => {
    let mounted = true;

    const load = async (): Promise<void> => {
      if (!mounted) return;
      setLoading(true);

      try {
        const today = new Date();
        const from = new Date(today.getTime() - (DAYS_BACK - 1) * 24 * 60 * 60 * 1000);
        const fromYmd = toYMD(from);
        const toYmd = toYMD(today);

        if (IS_LOCAL_AUTH) {
          await initHealthTables();
          const arr = (await getFastingRange(fromYmd, toYmd)) as LocalFastingRow[];
          const normalized: FastingRow[] = arr
            .map((r): FastingRow => ({
              id: r.id ?? r.day,
              day: r.day,
              first_meal_at: r.first_meal_at ?? null,
              last_meal_at: r.last_meal_at ?? null,
            }))
            .filter((r) => r.first_meal_at != null || r.last_meal_at != null);

          normalized.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
          if (!mounted) return;
          setRows(normalized);
        } else {
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          const url = `/api/health/fasting?from=${fromYmd}&to=${toYmd}&tz=${encodeURIComponent(tz)}&_=${Date.now()}`;
          const res = await fetch(url, { credentials: 'include' });
          if (!res.ok) throw new Error(await res.text());
          const arrRaw: FastingRow[] = (await res.json()) ?? [];
          const arr = arrRaw.filter((r) => r.first_meal_at != null || r.last_meal_at != null);
          arr.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
          if (!mounted) return;
          setRows(arr);
        }
      } catch {
        if (!mounted) return;
        setRows([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();

    const onChanged = (): void => void load();
    window.addEventListener('fasting:changed', onChanged);
    return () => {
      mounted = false;
      window.removeEventListener('fasting:changed', onChanged);
    };
  }, []);

  const deleteRow = async (day: string): Promise<void> => {
    if (!window.confirm('Delete this fasting day?')) return;

    try {
      if (IS_LOCAL_AUTH) {
        await clearFastingByDay(day);
        setRows((prev) => prev.filter((r) => r.day !== day));
        window.dispatchEvent(new Event('fasting:changed'));
      } else {
        const res = await fetch(`/api/health/fasting/${encodeURIComponent(day)}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!res.ok) throw new Error(await res.text());
        setRows((prev) => prev.filter((r) => r.day !== day));
        window.dispatchEvent(new Event('fasting:changed'));
      }
    } catch {
      alert('Failed to delete.');
    }
  };

  return (
    <div className={personalStyles.infoBox}>
      <h3 className={personalStyles.sectionTitle}>
        Fasting
        <br />
        First and Last Meal
      </h3>

      {loading ? (
        <p className={personalStyles.muted}>Loading…</p>
      ) : rows.length ? (
        <div>
          {rows.map((r) => (
            <div key={`${r.id}`} className={personalStyles.rowBlock}>
              <div className={personalStyles.rowTitle}>{String(r.day || '').slice(0, 10)}</div>
              <div>First: {formatDisplayTime(r.first_meal_at)}</div>
              <div>Last: {formatDisplayTime(r.last_meal_at)}</div>

              <div className={personalStyles.rowActions}>
                <button
                  type="button"
                  onClick={() => void deleteRow(r.day)}
                  className={personalStyles.iconButton}
                  title="Delete this day"
                  aria-label={`Delete fasting day ${r.day}`}
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className={personalStyles.muted}>No eating times saved yet.</p>
      )}
    </div>
  );
};

// -----------------------------
// Actual Sleep (last 7 days)
// -----------------------------
function isRepoSleepRow(u: unknown): u is SleepLogRow {
  if (u == null || typeof u !== 'object') return false;
  const r = u as Record<string, unknown>;
  return (
    typeof r.id === 'number' &&
    typeof r.sleep_date === 'string' &&
    (typeof r.sleep_at === 'string' || r.sleep_at === null || typeof r.sleep_at === 'undefined') &&
    (typeof r.wake_at === 'string' || r.wake_at === null || typeof r.wake_at === 'undefined')
  );
}

const SleepLogsBox: React.FC = () => {
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<SleepLogRow[]>([]);

  const onDelete = useCallback(
    async (id: number): Promise<void> => {
      if (!window.confirm('Delete this sleep entry?')) return;
      try {
        await deleteSleepLog(id);
        setRows((prev) => prev.filter((r) => r.id !== id));
        window.dispatchEvent(new Event('sleep:changed'));
      } catch (e) {
        logger.error('[Sleep] delete failed', e);
        alert('Failed to delete sleep entry.');
      }
    },
    [setRows]
  );

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setErr(null);

    try {
      await initSleepTables();
      const now = new Date();
      const toYmd = now.toISOString().slice(0, 10);
      const from = new Date(now.getTime() - 6 * 24 * 3600 * 1000);
      const fromYmd = from.toISOString().slice(0, 10);

      const raw = await listSleepLogsRange(fromYmd, toYmd);

      const logs: SleepLogRow[] = Array.isArray(raw)
        ? raw
            .map((r): SleepLogRow | null => {
              if (isRepoSleepRow(r)) return r;

              const rec = r as Record<string, unknown>;
              const id = typeof rec.id === 'number' ? rec.id : Number(rec.id);
              const sleep_date =
                typeof rec.sleep_date === 'string'
                  ? rec.sleep_date
                  : typeof rec.day === 'string'
                    ? rec.day
                    : '';
              const sleep_at = typeof rec.sleep_at === 'string' ? rec.sleep_at : null;
              const wake_at = typeof rec.wake_at === 'string' ? rec.wake_at : null;

              if (!Number.isFinite(id) || !sleep_date) return null;
              return { id: Number(id), sleep_date, sleep_at, wake_at };
            })
            .filter((x): x is SleepLogRow => x !== null)
        : [];

      logs.sort((a, b) => {
        if (a.sleep_date !== b.sleep_date) return a.sleep_date < b.sleep_date ? 1 : -1;
        const as = a.sleep_at ?? '';
        const bs = b.sleep_at ?? '';
        return as < bs ? 1 : as > bs ? -1 : 0;
      });

      setRows(logs);
    } catch (e) {
      logger.warn('[PersonalPlan] load sleep logs failed', e);
      setErr('Failed to load sleep logs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const onChanged = (): void => void load();
    window.addEventListener('sleep:changed', onChanged);
    return () => window.removeEventListener('sleep:changed', onChanged);
  }, [load]);

  const fmtDate = (iso?: string | null): string =>
    iso
      ? new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' })
      : '—';

  const fmtTime = (iso?: string | null): string =>
    iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div className={personalStyles.infoBox}>
      <h3 className={personalStyles.sectionTitle}>😴 Sleep (actual, last 7 days)</h3>

      {loading ? (
        <p className={personalStyles.muted}>Loading…</p>
      ) : err ? (
        <p className={personalStyles.errorBox}>{err}</p>
      ) : rows.length === 0 ? (
        <p className={personalStyles.muted}>No sleep logs for the last week.</p>
      ) : (
        <ul className={personalStyles.cleanList}>
          {rows.map((r) => (
            <li key={r.id} className={personalStyles.listRow}>
              <div className={personalStyles.listRowTop}>
                <strong>{r.sleep_date}</strong>
                <button
                  type="button"
                  onClick={() => void onDelete(r.id)}
                  className={personalStyles.iconButton}
                  title="Delete"
                  aria-label={`Delete sleep entry ${r.id}`}
                >
                  🗑️
                </button>
              </div>
              <div>
                Went to bed: {fmtDate(r.sleep_at)} {fmtTime(r.sleep_at)}
              </div>
              <div>
                Woke up: {fmtDate(r.wake_at)} {fmtTime(r.wake_at)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// -----------------------------
// Main component
// -----------------------------
const PersonalPlan: React.FC = () => {
  const { user } = useAuth();
  const router = useIonRouter();
  const userId = user?.id;

  const [localProfile, setLocalProfile] = useState<UserProfile | null>(null);
  const [healthLogs, setHealthLogs] = useState<HealthLog[]>([]);
  const [exercises, setExercises] = useState<ExerciseEntry[]>([]);
  const [showBowel, setShowBowel] = useState<boolean>(() => {
    const v = localStorage.getItem('plan.showBowel');
    return v === null ? true : v === '1';
  });

  useEffect(() => {
    localStorage.setItem('plan.showBowel', showBowel ? '1' : '0');
  }, [showBowel]);

  useEffect(() => {
    if (IS_LOCAL_AUTH) {
      initHealthTables().catch(logger.error);
    }
  }, []);

  const loadProfile = useCallback(async (): Promise<void> => {
    if (IS_LOCAL_AUTH) {
      setLocalProfile({
        first_name: user?.first_name ?? '',
        last_name: user?.last_name ?? '',
        email: user?.email ?? '',
        medication_name: user?.medication_name ?? '',
        medication_dose: user?.medication_dose ?? '',
        fasting_schedule: user?.fasting_schedule ?? '',
        fasting_start: user?.fasting_start ?? '',
        injection_day: user?.injection_day ?? '',
        injection_time: (user?.injection_time as string | undefined) ?? '',
      });
      return;
    }

    try {
      const res = await fetch('/api/user/profile', { credentials: 'include' });
      if (!res.ok) return;
      const data: UserProfile = await res.json();
      setLocalProfile(data);
    } catch {
      // ignore
    }
  }, [user]);

  const loadExercises = useCallback(async (): Promise<void> => {
    try {
      if (IS_LOCAL_AUTH) {
        await initHealthTables();
        const rows = await listExercises();
        setExercises(rows.map((r) => ({ ...r, id: r.id })));
        return;
      }

      const res = await fetch('/api/user/exercise', { credentials: 'include' });
      if (!res.ok) return;
      const data: ExerciseEntry[] = await res.json();
      setExercises(Array.isArray(data) ? data : []);
    } catch (err) {
      logger.error('loadExercises error', err);
      setExercises([]);
    }
  }, []);

  const loadLogs = useCallback(async (): Promise<void> => {
    try {
      if (IS_LOCAL_AUTH) {
        await initHealthTables();
        const rows = await listHealthLogs();

        const parsed: HealthLog[] = rows.map((r) => {
          let data: HealthLogData = {};
          try {
            data = JSON.parse(r.data_json) as HealthLogData;
          } catch {
            // keep empty object
          }
          return {
            id: r.id!,
            entry_type: r.entry_type as HealthLog['entry_type'],
            recorded_at: r.recorded_at,
            data,
          };
        });

        setHealthLogs(parsed);
        return;
      }

      const res = await fetch('/api/health/health-logs', { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as Array<{
        id: number;
        entry_type: HealthLog['entry_type'];
        recorded_at: string;
        data: HealthLogData;
      }>;
      setHealthLogs(Array.isArray(data) ? data : []);
    } catch (err) {
      logger.error('loadLogs error', err);
      setHealthLogs([]);
    }
  }, []);

  const injDay = (localProfile?.injection_day ?? user?.injection_day) || '';
  const injTimeRaw = localProfile?.injection_time ?? (user?.injection_time as string | undefined);

  const injTime = useMemo(() => {
    if (!injTimeRaw) return 'N/A';
    const d = new Date(injTimeRaw);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    return safeHHMM(String(injTimeRaw));
  }, [injTimeRaw]);

const glp1Pct = useMemo(() => {
if (!injDay || !injTimeRaw) return 0;


return glp1ActivityToPercent(
computeGlp1Activity({
injectionDay: injDay.slice(0, 3), // Mon/Tue/…
injectionTime: safeHHMM(String(injTimeRaw)),
timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
})
);
}, [injDay, injTimeRaw]);

  const injDayFull: WeekdayFull =
    FULL_DAYS.includes(injDay as WeekdayFull)
      ? (injDay as WeekdayFull)
      : ((WEEKDAY_FULL[injDay as keyof typeof WEEKDAY_FULL] as WeekdayFull) || 'Monday');

  useEffect(() => {
    if (!userId) return;

    const bootstrap = (): void => {
      void loadLogs();
      void loadProfile();
      void loadExercises();
    };

    bootstrap();

    const onSaved = (): void => void loadProfile();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        void loadProfile();
        void loadExercises();
        void loadLogs();
      }
    };

    const onFastingChanged = (): void => void loadProfile();
    const onHealthChanged = (): void => void loadLogs();
    const onExerciseChanged = (): void => void loadExercises();

    window.addEventListener('profile:saved', onSaved as EventListener);
    document.addEventListener('visibilitychange', onVisible);

    window.addEventListener('fasting:changed', onFastingChanged);
    window.addEventListener('health:changed', onHealthChanged);
    window.addEventListener('exercise:changed', onExerciseChanged);

    return () => {
      window.removeEventListener('profile:saved', onSaved as EventListener);
      document.removeEventListener('visibilitychange', onVisible);

      window.removeEventListener('fasting:changed', onFastingChanged);
      window.removeEventListener('health:changed', onHealthChanged);
      window.removeEventListener('exercise:changed', onExerciseChanged);
    };
  }, [userId, loadProfile, loadExercises, loadLogs]);

  const deleteLog = async (id: number): Promise<void> => {
    if (!window.confirm('Are you sure you want to delete this entry?')) return;

    try {
      const numId = typeof id === 'number' ? id : Number(id);
      if (!Number.isFinite(numId)) {
        logger.warn('deleteHealthLog: invalid id', { id });
        alert('Invalid log id.');
        return;
      }

      await deleteHealthLogLocal(numId);
      setHealthLogs((prev) => prev.filter((e) => e.id !== numId));
      window.dispatchEvent(new Event('health:changed'));
    } catch (err: unknown) {
      if (err instanceof Error) {
        logger.error('deleteHealthLog failed', { id, message: err.message, stack: err.stack });
      } else {
        logger.error('deleteHealthLog failed', { id, err });
      }
      alert('Error deleting log.');
    }
  };

  const deleteExercise = async (id: string | number): Promise<void> => {
    if (!window.confirm('Delete this exercise?')) return;

    try {
      const numId = typeof id === 'number' ? id : Number(id);
      if (!Number.isFinite(numId)) {
        logger.warn('deleteExercise: invalid id', { id });
        alert('Invalid exercise id.');
        return;
      }

      await deleteExerciseById(numId);
      setExercises((prev) => prev.filter((e) => e.id !== numId));
      window.dispatchEvent(new Event('exercise:changed'));
    } catch (err) {
      logger.error('deleteExercise failed', { id, err });
      alert('Error deleting exercise.');
    }
  };

  if (!userId) return null;

  const medName = localProfile?.medication_name ?? user?.medication_name ?? 'N/A';
  const dose = localProfile?.medication_dose ?? user?.medication_dose ?? 'N/A';
  const fastingSchedule = localProfile?.fasting_schedule ?? user?.fasting_schedule ?? 'N/A';
  const fastingStart = localProfile?.fasting_start ?? user?.fasting_start ?? 'N/A';

  const bowelCount = healthLogs.filter((l) => l.entry_type === 'bowel').length;

  return (
    <IonPage>
      <TopNav showWhenAnon />

      <IonContent fullscreen className={personalStyles.contentPad}>
        <div className={personalStyles.profileContainer}>
          <div className={personalStyles.infoBox}>
            <p>
              <strong>Medication:</strong> {medName}
            </p>
            <p>
              <strong>Dose:</strong> {dose}
            </p>
            <p>
              <strong>Injection Date and Time:</strong> {injDay && injTime ? `${injDay} at ${injTime}` : 'N/A'}
            </p>
            <p>
              <strong>Fasting:</strong> {fastingSchedule}, starts at {safeHHMM(String(fastingStart))}
            </p>
            <p className={personalStyles.mt6}>
              <em>Week starts on: {injDayFull}</em>
            </p>
          </div>

          <SleepLogsBox />
          <FastingDisplayBox />
          <Glp1EffectivenessBox
            userId={userId}
            glp1Pct={glp1Pct}
            injectionDay={injDay}
            timezone={Intl.DateTimeFormat().resolvedOptions().timeZone}
          />

          <h2 className={personalStyles.subtitle}>Health Tracking</h2>

          <div className={personalStyles.infoBox}>
            <h3 className={personalStyles.sectionTitle}>Blood Sugar</h3>
            {healthLogs
              .filter((log) => log.entry_type === 'blood_sugar')
              .map((log) => (
                <p key={log.id} className={personalStyles.lineRow}>
                  {new Date(log.recorded_at).toLocaleString()}: {log.data.value} mg/dL
                  <button
                    type="button"
                    onClick={() => void deleteLog(log.id)}
                    className={personalStyles.iconButton}
                    title="Delete"
                    aria-label={`Delete blood sugar entry ${log.id}`}
                  >
                    🗑️
                  </button>
                </p>
              ))}
          </div>

          <div className={personalStyles.infoBox}>
            <h3 className={personalStyles.sectionTitle}>Blood Pressure</h3>
            {healthLogs
              .filter((log) => log.entry_type === 'blood_pressure')
              .map((log) => (
                <p key={log.id} className={personalStyles.lineRow}>
                  {new Date(log.recorded_at).toLocaleString()}: {log.data.systolic}/{log.data.diastolic} mmHg
                  {typeof log.data.pulse === 'number' ? ` (Pulse: ${log.data.pulse})` : ''}
                  <button
                    type="button"
                    onClick={() => void deleteLog(log.id)}
                    className={personalStyles.iconButton}
                    title="Delete"
                    aria-label={`Delete blood pressure entry ${log.id}`}
                  >
                    🗑️
                  </button>
                </p>
              ))}
          </div>

          <div className={personalStyles.infoBox}>
            <h3 className={personalStyles.sectionTitle}>Hydration</h3>
            {healthLogs
              .filter((log) => log.entry_type === 'hydration')
              .map((log) => (
                <p key={log.id} className={personalStyles.lineRow}>
                  {new Date(log.recorded_at).toLocaleString()}
                  {formatHydrationLine(log) ? `: ${formatHydrationLine(log)}` : ''}
                  <button
                    type="button"
                    onClick={() => void deleteLog(log.id)}
                    className={personalStyles.iconButton}
                    title="Delete"
                    aria-label={`Delete hydration entry ${log.id}`}
                  >
                    🗑️
                  </button>
                </p>
              ))}
          </div>

          <div className={personalStyles.infoBox}>
            <h3 className={personalStyles.sectionTitle}>Exercise</h3>

            {exercises.length === 0 ? (
              <p className={personalStyles.muted}>No exercises saved.</p>
            ) : (
              <ul className={personalStyles.bulletedList}>
                {exercises
                  .slice()
                  .sort((a, b) => {
                    const injDayFullLocal: WeekdayFull =
                      FULL_DAYS.includes(
                        (localProfile?.injection_day ?? user?.injection_day ?? 'Monday') as WeekdayFull
                      )
                        ? ((localProfile?.injection_day ?? user?.injection_day ?? 'Monday') as WeekdayFull)
                        : 'Monday';

                    const anchoredDaysLocal: WeekdayShort[] = Array.from(new Set(rotateShortFromFull(injDayFullLocal)));
                    const idx = new Map(anchoredDaysLocal.map((d, i) => [d, i]));
                    const ia = idx.get(a.day_of_week as WeekdayShort) ?? 99;
                    const ib = idx.get(b.day_of_week as WeekdayShort) ?? 99;
                    if (ia !== ib) return ia - ib;
                    return safeHHMM(a.start_time).localeCompare(safeHHMM(b.start_time));
                  })
                  .map((ex) => (
                    <li key={`${ex.id}`} className={personalStyles.exerciseRow}>
                      🏋️‍♂️ <strong>{ex.day_of_week}</strong>{' '}
                      {ex.start_at ? (
                        <span>
                          (
                          {new Date(ex.start_at).toLocaleDateString([], {
                            weekday: 'short',
                            month: 'short',
                            day: '2-digit',
                            year: 'numeric',
                          })}
                          ){` `}
                        </span>
                      ) : null}
                      {safeHHMM(ex.start_time)}–{safeHHMM(ex.end_time)} — {ex.exercise_type}
                      {typeof ex.calories_burned === 'number' ? ` (${ex.calories_burned} cal)` : ''}
                      <button
                        type="button"
                        onClick={() => void deleteExercise(ex.id)}
                        className={personalStyles.iconButton}
                        title="Delete"
                        aria-label={`Delete exercise ${ex.id}`}
                      >
                        🗑️
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          <div className={personalStyles.infoBox}>
            <h3 className={personalStyles.sectionTitle}>Nutrition Intake</h3>
            {healthLogs
              .filter((log) => log.entry_type === 'protein')
              .map((log) => (
                <p key={log.id} className={personalStyles.lineRow}>
                  {new Date(log.recorded_at).toLocaleString()}
                  {formatProteinLine(log) ? `: ${formatProteinLine(log)}` : ''}
                  <button
                    type="button"
                    onClick={() => void deleteLog(log.id)}
                    className={personalStyles.iconButton}
                    title="Delete"
                    aria-label={`Delete protein entry ${log.id}`}
                  >
                    🗑️
                  </button>
                </p>
              ))}
          </div>

          {/* ✅ Bowel Movements (no inline styles, accessible toggle) */}
          <div className={personalStyles.infoBox}>
            <div className={personalStyles.infoHeader}>
              <h3 className={personalStyles.infoTitle}>Bowel Movements</h3>

              <label htmlFor="showBowel" className={personalStyles.toggleLabel}>
                <input
                  id="showBowel"
                  type="checkbox"
                  checked={showBowel}
                  onChange={(e) => setShowBowel(e.target.checked)}
                  className={personalStyles.toggleInput}
                  aria-label="Show bowel movements on this page"
                />
                <span className={personalStyles.toggleVisual} />
                <span className={personalStyles.srOnly}>Toggle bowel movements</span>
              </label>
            </div>

            {showBowel ? (
              <>
                {healthLogs
                  .filter((log) => log.entry_type === 'bowel')
                  .map((log) => (
                    <p key={log.id} className={personalStyles.lineRow}>
                      {new Date(log.recorded_at).toLocaleString()}
                      {(() => {
                        const line = formatBowelLine(log);
                        return line ? `: ${line}` : '';
                      })()}
                      <button
                        type="button"
                        onClick={() => void deleteLog(log.id)}
                        className={personalStyles.iconButton}
                        title="Delete"
                        aria-label={`Delete bowel entry ${log.id}`}
                      >
                        🗑️
                      </button>
                    </p>
                  ))}

                {bowelCount === 0 && <p className={personalStyles.muted}>No bowel entries recorded.</p>}
              </>
            ) : (
              <p className={personalStyles.muted}>Hidden (toggle to display).</p>
            )}
          </div>
          <div className={personalStyles.infoBox}>
<h3 className={personalStyles.sectionTitle}>Quick check-in</h3>
<IonButton
expand="block"
className={personalStyles.weeklySummaryIon}
onClick={() => router.push(`/plan/day/${todayName.toLowerCase()}?mood=1`, 'forward')}
>
😊 Press to add your mood
</IonButton>
</div>

          <h2 className={personalStyles.subtitle}>Week Overview</h2>

          <div className={personalStyles.weekOverview}>
            {rotateShortFromFull(injDayFull).map((day, index) => {
              const isToday = day === todayName;
              const isAnchor = index === 0;

              return (
  <div
    key={day}
    onClick={() => router.push(`/plan/day/${day.toLowerCase()}`, 'forward')}
    className={`${personalStyles.dayItem} ${isToday ? personalStyles.today : ''} ${
      isAnchor ? personalStyles.anchor : ''
    } ${personalStyles.dayAnim}`}
    data-delay-index={index}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        router.push(`/plan/day/${day.toLowerCase()}`, 'forward');
      }
    }}
    aria-label={`Open ${day} plan`}
    title={`Open ${day}`}
  >
    <strong>{day}</strong>
    {isAnchor ? ' ⭐' : ''}
  </div>
);
            })}
          </div>

          <div className={personalStyles.weeklySummaryWrap}>
            <IonButton
              type="button"
              expand="block"
              className={personalStyles.weeklySummaryIon}
              onClick={() => router.push('/weeklysummary', 'forward')}
              aria-label="Open weekly summary page"
              title="Weekly Summary "
            >
              📧 Weekly Summary
            </IonButton>
          </div>
        </div>
      </IonContent>

      <BottomNav showWhenAnon={false} />
    </IonPage>
  );
};

export default PersonalPlan;





