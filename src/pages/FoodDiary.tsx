import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { IonButton, IonContent, IonPage, useIonRouter } from '@ionic/react';
import { ArrowLeft, ChevronLeft, ChevronRight, Droplets, Pencil, Save, Trash2, Utensils, X } from 'lucide-react';

import BottomNav from '../context/BottomNav';
import TopNav from '../context/TopNav';
import { useAuth } from '../context/useAuth';
import {
  deleteHealthLogLocal,
  listHealthLogsRange,
  updateHealthLogAndEmit,
  upsertDailyHydration,
  upsertDailyProtein,
  type HealthLog,
} from '../db/HealthRepository';
import { nutritionFromLogData } from '../lib/nutritionLog';
import { maxTimeForRecordedAt, recordedAtWithTime } from '../lib/healthLogTime';
import { logger } from '../utils/logger';
import styles from './FoodDiary.module.css';

type DiaryTotals = {
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
  hydration: number;
};

type EditDraft = {
  label: string;
  time: string;
  amount: string;
  protein: string;
  carbs: string;
  fat: string;
  calories: string;
};

const PROTEIN_TARGET_G = 90;
const HYDRATION_TARGET_ML = 2200;

function localYmd(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function ymdToLocalDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00`);
}

function localDayBounds(ymd: string): { start: string; end: string } {
  const startDate = ymdToLocalDate(ymd);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 1);
  return { start: startDate.toISOString(), end: endDate.toISOString() };
}

function addDays(ymd: string, days: number): string {
  const date = ymdToLocalDate(ymd);
  date.setDate(date.getDate() + days);
  return localYmd(date);
}

function formatDisplayDate(ymd: string): string {
  const date = ymdToLocalDate(ymd);
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function timeFromIso(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '12:00';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function dataRecord(log: HealthLog): Record<string, unknown> {
  return log.data && typeof log.data === 'object' ? log.data as Record<string, unknown> : {};
}

function numberFrom(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function hydrationAmount(log: HealthLog): number {
  const data = dataRecord(log);
  return numberFrom(data.amount ?? data.ml ?? data.value);
}

function entryLabel(log: HealthLog): string {
  const data = dataRecord(log);
  const label = typeof data.label === 'string' ? data.label.trim() : '';
  const foodName = typeof data.foodName === 'string' ? data.foodName.trim() : '';
  if (label) return label;
  if (foodName) return foodName;
  return log.entry_type === 'hydration' ? 'Water' : 'Food';
}

function summarize(logs: HealthLog[]): DiaryTotals {
  return logs.reduce<DiaryTotals>((total, log) => {
    if (log.entry_type === 'hydration') {
      return { ...total, hydration: total.hydration + hydrationAmount(log) };
    }
    if (log.entry_type === 'protein') {
      const nutrition = nutritionFromLogData(log.data);
      return {
        protein: total.protein + nutrition.protein,
        carbs: total.carbs + nutrition.carbs,
        fat: total.fat + nutrition.fat,
        calories: total.calories + nutrition.calories,
        hydration: total.hydration,
      };
    }
    return total;
  }, { protein: 0, carbs: 0, fat: 0, calories: 0, hydration: 0 });
}

function roundDiaryTotals(totals: DiaryTotals): DiaryTotals {
  return {
    protein: Math.round(totals.protein),
    carbs: Math.round(totals.carbs),
    fat: Math.round(totals.fat),
    calories: Math.round(totals.calories),
    hydration: Math.round(totals.hydration),
  };
}

function draftFromLog(log: HealthLog): EditDraft {
  const nutrition = nutritionFromLogData(log.data);
  return {
    label: entryLabel(log),
    time: timeFromIso(log.recorded_at),
    amount: String(Math.round(hydrationAmount(log) || 250)),
    protein: String(Math.round(nutrition.protein || 0)),
    carbs: String(Math.round(nutrition.carbs || 0)),
    fat: String(Math.round(nutrition.fat || 0)),
    calories: String(Math.round(nutrition.calories || 0)),
  };
}

function clampNumber(value: string, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

function noticeFor(totals: DiaryTotals, count: number): string {
  if (count === 0) return 'Nothing logged for this date yet. Each day starts clean, and your history stays saved here.';
  if (totals.protein < 45 && totals.hydration < 1000) {
    return 'Protein and water both look light for this day. Small meals and steady drinks are worth capturing.';
  }
  if (totals.protein < 45) return 'Protein looks light for this day. A simple protein snack or meal note would make the pattern clearer.';
  if (totals.hydration < 1000) return 'Water looks light for this day. Logging drinks as they happen can make the hydration pattern easier to see.';
  if (count >= 8) return 'You logged several small entries. This is useful for spotting timing patterns across the day.';
  return 'This gives you a clearer picture of the day without needing to remember it later.';
}

const FoodDiary: React.FC = () => {
  const router = useIonRouter();
  const { user } = useAuth();
  const today = localYmd();
  const [selectedDay, setSelectedDay] = useState(today);
  const [logs, setLogs] = useState<HealthLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);

  const diaryLogs = useMemo(
    () => logs.filter((log) => log.entry_type === 'protein' || log.entry_type === 'hydration'),
    [logs]
  );
  const totals = useMemo(() => roundDiaryTotals(summarize(diaryLogs)), [diaryLogs]);
  const sortedLogs = useMemo(
    () => [...diaryLogs].sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()),
    [diaryLogs]
  );
  const isToday = selectedDay === today;

  const refreshRollups = useCallback(async (day: string, rows: HealthLog[]): Promise<void> => {
    if (!user?.id) return;
    const nextTotals = roundDiaryTotals(summarize(rows));
    await Promise.all([
      upsertDailyProtein(String(user.id), day, nextTotals.protein),
      upsertDailyHydration(String(user.id), day, nextTotals.hydration),
    ]);
  }, [user?.id]);

  const loadDiary = useCallback(async (): Promise<void> => {
    setLoading(true);
    setMessage('');
    try {
      const { start, end } = localDayBounds(selectedDay);
      const rows = await listHealthLogsRange(start, end);
      setLogs(rows);
    } catch (error) {
      logger.warn('[FoodDiary] failed to load diary', {
        msg: error instanceof Error ? error.message : String(error),
      });
      setMessage('Could not load this diary day yet.');
    } finally {
      setLoading(false);
    }
  }, [selectedDay]);

  useEffect(() => {
    void loadDiary();
  }, [loadDiary]);

  useEffect(() => {
    const refresh = () => void loadDiary();
    window.addEventListener('health:changed', refresh);
    return () => window.removeEventListener('health:changed', refresh);
  }, [loadDiary]);

  const startEdit = (log: HealthLog): void => {
    setEditingId(log.id);
    setDraft(draftFromLog(log));
    setMessage('');
  };

  const cancelEdit = (): void => {
    setEditingId(null);
    setDraft(null);
  };

  const saveEdit = async (log: HealthLog): Promise<void> => {
    if (!draft) return;
    const label = draft.label.trim() || (log.entry_type === 'hydration' ? 'Water' : 'Food');
    const data = dataRecord(log);
    const recordedAtResult = recordedAtWithTime(log.recorded_at, draft.time);
    if (!recordedAtResult.ok) {
      setMessage(recordedAtResult.message);
      return;
    }
    const recordedAt = recordedAtResult.value;
    const entryType = log.entry_type;
    const nextData = entryType === 'hydration'
      ? {
          ...data,
          label,
          amount: clampNumber(draft.amount, 250),
          unit: 'ml',
        }
      : {
          ...data,
          label,
          grams: clampNumber(draft.protein, 0),
          protein: clampNumber(draft.protein, 0),
          carbs: clampNumber(draft.carbs, 0),
          fat: clampNumber(draft.fat, 0),
          calories: clampNumber(draft.calories, 0),
        };

    try {
      await updateHealthLogAndEmit(log.id, {
        entry_type: entryType,
        recorded_at: recordedAt,
        data_json: JSON.stringify(nextData),
      });
      const { start, end } = localDayBounds(selectedDay);
      const rows = await listHealthLogsRange(start, end);
      setLogs(rows);
      await refreshRollups(selectedDay, rows);
      setEditingId(null);
      setDraft(null);
      setMessage(`${label} updated.`);
    } catch (error) {
      logger.warn('[FoodDiary] failed to update entry', {
        msg: error instanceof Error ? error.message : String(error),
      });
      setMessage('Could not update that entry yet.');
    }
  };

  const deleteEntry = async (log: HealthLog): Promise<void> => {
    const label = entryLabel(log);
    try {
      await deleteHealthLogLocal(log.id);
      const { start, end } = localDayBounds(selectedDay);
      const rows = await listHealthLogsRange(start, end);
      setLogs(rows);
      await refreshRollups(selectedDay, rows);
      setMessage(`${label} removed.`);
      window.dispatchEvent(new Event('health:changed'));
    } catch (error) {
      logger.warn('[FoodDiary] failed to delete entry', {
        msg: error instanceof Error ? error.message : String(error),
      });
      setMessage('Could not delete that entry yet.');
    }
  };

  return (
    <IonPage>
      <TopNav showWhenAnon={false} />
      <IonContent fullscreen className={styles.content}>
        <main className={styles.page}>
          <section className={styles.heroBand}>
            <button type="button" className={styles.backButton} onClick={() => router.push('/today', 'back')}>
              <ArrowLeft size={18} />
              <span>Today</span>
            </button>
            <div>
              <span className={styles.eyebrow}>Food & Water Diary</span>
              <h1>{isToday ? 'Today' : formatDisplayDate(selectedDay)}</h1>
              <p>Each day starts fresh. Your previous food and water entries stay saved here.</p>
            </div>
          </section>

          <section className={styles.dateBand} aria-label="Diary date">
            <button type="button" onClick={() => setSelectedDay((day) => addDays(day, -1))} aria-label="Previous day">
              <ChevronLeft size={20} />
            </button>
            <input
              type="date"
              value={selectedDay}
              max={today}
              onChange={(event) => setSelectedDay(event.target.value || today)}
              aria-label="Diary date"
            />
            <button
              type="button"
              onClick={() => setSelectedDay((day) => addDays(day, 1))}
              disabled={isToday}
              aria-label="Next day"
            >
              <ChevronRight size={20} />
            </button>
          </section>

          <section className={styles.totalsGrid} aria-label="Daily totals">
            <article>
              <Utensils size={18} />
              <span>Protein</span>
              <strong>{formatNumber(totals.protein)}g</strong>
              <small>Goal guide {PROTEIN_TARGET_G}g</small>
            </article>
            <article>
              <Droplets size={18} />
              <span>Water</span>
              <strong>{formatNumber(totals.hydration)}ml</strong>
              <small>Goal guide {HYDRATION_TARGET_ML}ml</small>
            </article>
            <article>
              <span>Calories</span>
              <strong>{formatNumber(totals.calories)}</strong>
              <small>Only when logged</small>
            </article>
            <article>
              <span>Carbs / Fat</span>
              <strong>{formatNumber(totals.carbs)}g / {formatNumber(totals.fat)}g</strong>
              <small>Only when logged</small>
            </article>
          </section>

          <section className={styles.noticeBand}>
            <strong>What I notice</strong>
            <p>{noticeFor(totals, sortedLogs.length)}</p>
          </section>

          <section className={styles.entriesBand} aria-label="Food and water entries">
            <div className={styles.sectionHeader}>
              <div>
                <h2>All entries</h2>
                <p>{loading ? 'Loading...' : `${sortedLogs.length} item${sortedLogs.length === 1 ? '' : 's'} for this day`}</p>
              </div>
              <IonButton className={styles.addButton} onClick={() => router.push('/today', 'forward')}>
                Add on Today
              </IonButton>
            </div>

            {message && <p className={styles.message}>{message}</p>}

            {!loading && sortedLogs.length === 0 && (
              <p className={styles.emptyState}>No food or water logged for this date yet.</p>
            )}

            <div className={styles.entryList}>
              {sortedLogs.map((log) => {
                const nutrition = nutritionFromLogData(log.data);
                const isHydration = log.entry_type === 'hydration';
                const isEditing = editingId === log.id && draft;
                return (
                  <article key={log.id} className={styles.entryCard}>
                    <div className={styles.entryIcon}>
                      {isHydration ? <Droplets size={18} /> : <Utensils size={18} />}
                    </div>
                    {isEditing ? (
                      <div className={styles.editGrid}>
                        <label>
                          <span>{isHydration ? 'Drink' : 'Food'}</span>
                          <input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
                        </label>
                        <label>
                          <span>Time</span>
                          <input
                            type="time"
                            value={draft.time}
                            max={maxTimeForRecordedAt(log.recorded_at)}
                            onChange={(event) => setDraft({ ...draft, time: event.target.value })}
                          />
                        </label>
                        {isHydration ? (
                          <label>
                            <span>Water ml</span>
                            <input inputMode="numeric" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} />
                          </label>
                        ) : (
                          <>
                            <label>
                              <span>Protein g</span>
                              <input inputMode="numeric" value={draft.protein} onChange={(event) => setDraft({ ...draft, protein: event.target.value })} />
                            </label>
                            <label>
                              <span>Calories</span>
                              <input inputMode="numeric" value={draft.calories} onChange={(event) => setDraft({ ...draft, calories: event.target.value })} />
                            </label>
                            <label>
                              <span>Carbs g</span>
                              <input inputMode="numeric" value={draft.carbs} onChange={(event) => setDraft({ ...draft, carbs: event.target.value })} />
                            </label>
                            <label>
                              <span>Fat g</span>
                              <input inputMode="numeric" value={draft.fat} onChange={(event) => setDraft({ ...draft, fat: event.target.value })} />
                            </label>
                          </>
                        )}
                        <div className={styles.entryActions}>
                          <button type="button" onClick={() => void saveEdit(log)} aria-label="Save entry">
                            <Save size={17} />
                          </button>
                          <button type="button" onClick={cancelEdit} aria-label="Cancel edit">
                            <X size={17} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className={styles.entryMain}>
                          <span>{timeFromIso(log.recorded_at)}</span>
                          <strong>{entryLabel(log)}</strong>
                          <p>
                            {isHydration
                              ? `${formatNumber(hydrationAmount(log))}ml water`
                              : `Protein ${formatNumber(nutrition.protein)}g · Carbs ${formatNumber(nutrition.carbs)}g · Fat ${formatNumber(nutrition.fat)}g · ${formatNumber(nutrition.calories)} cal`}
                          </p>
                        </div>
                        <div className={styles.entryActions}>
                          <button type="button" onClick={() => startEdit(log)} aria-label={`Edit ${entryLabel(log)}`}>
                            <Pencil size={17} />
                          </button>
                          <button type="button" onClick={() => void deleteEntry(log)} aria-label={`Delete ${entryLabel(log)}`}>
                            <Trash2 size={17} />
                          </button>
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        </main>
      </IonContent>
      <BottomNav showWhenAnon={false} />
    </IonPage>
  );
};

export default FoodDiary;
