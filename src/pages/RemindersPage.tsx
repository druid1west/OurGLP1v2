// src/pages/RemindersPage.tsx
import { logger } from '@/utils/logger';
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { IonPage, IonContent, IonButton } from '@ionic/react';
import styles from './RemindersPage.module.css';

import TopNav from '@/context/TopNav';
import BottomNav from '@/context/BottomNav';

import { useAuth } from '@/context/useAuth';
import { useReminderBadge } from '@/context/ReminderBadgeContext';
import { emitReminderDelta } from '@/utils/reminderEvents';

import { LocalNotifications } from '@capacitor/local-notifications';

import {
  listReminders,
  createReminder,
  deleteReminder,
  type LocalReminder,
} from '@/db/RemindersRepository';

import {
  checkAndPersistPermission,
  requestAndPersistPermission,
} from '@/db/NotificationStatus';

// ─────────────────────────────────────────────────────────────────────────────
// Types & UI constants
// ─────────────────────────────────────────────────────────────────────────────

function getUserTimezone(u: unknown): string | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const r = u as Record<string, unknown>;
  return typeof r.timezone === 'string' ? r.timezone : undefined;
}

type UiReminder = Readonly<{
  id: string;
  title: string;
  datetime: string | null; // ISO (UTC) or null
  method: string[]; // kept for display from DB; we always write ['push']
  advance_minutes: number;
  enabled: boolean;
  reminder_type?: string;
  day_of_week?: string; // 'Mon'..'Sun'
}>;

const daysFull = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

const reminderTypes = [
  'Injection',
  'Blood Sugar',
  'Blood Pressure',
  'Bowel Movement',
  'Exercise',
  'Protein',
  'Hydration',
  'Other',
] as const;

const advanceOptions = [0, 5, 10, 20, 60, 1440] as const;

const SOUND_OPTIONS = [
  { id: 'default', label: 'Default' },
  { id: 'beep', label: 'Beep (custom)' },
  { id: 'chime', label: 'Chime (custom)' },
] as const;

type SoundId = (typeof SOUND_OPTIONS)[number]['id'];

// ─────────────────────────────────────────────────────────────────────────────
// Timezone helpers
// ─────────────────────────────────────────────────────────────────────────────

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
  const n = (t: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === t)?.value ?? '0');
  const wd = (parts.find((p) => p.type === 'weekday')?.value || 'Sun').slice(0, 3);
  const wmap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
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

function nextOccurrenceIso(weekdayFull: string, hhmm: string, tz: string): string {
  const now = new Date();
  const nowTz = getTzParts(now, tz);

  const short = weekdayFull.slice(0, 3);
  const idxMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const targetIdx = idxMap[short as keyof typeof idxMap] ?? 1;

  let daysAhead = (7 + targetIdx - nowTz.weekday) % 7;

  const [hh, mm] = (hhmm || '00:00').split(':').map(Number);
  const nowMin = nowTz.hour * 60 + nowTz.minute;
  const tgtMin = hh * 60 + mm;
  if (daysAhead === 0 && tgtMin <= nowMin) daysAhead = 7;

  const baseUtc = tzLocalToUtc(nowTz.year, nowTz.month, nowTz.day, 0, 0, tz);
  const targetBaseUtc = new Date(baseUtc.getTime() + daysAhead * 24 * 3600 * 1000);
  const tParts = getTzParts(targetBaseUtc, tz);
  const instantUtc = tzLocalToUtc(tParts.year, tParts.month, tParts.day, hh, mm, tz);
  return instantUtc.toISOString();
}

const DOW_MAP = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' } as const;
type DOWKey = keyof typeof DOW_MAP;
type DOWVal = (typeof DOW_MAP)[DOWKey];
const isDOWKey = (k: string): k is DOWKey => k in DOW_MAP;
const normalizeDOW = (d: string): DOWVal => {
  const k = d.trim().slice(0, 3).toLowerCase();
  return isDOWKey(k) ? DOW_MAP[k] : 'Mon';
};

// ─────────────────────────────────────────────────────────────────────────────
// Local notifications with sound
// ─────────────────────────────────────────────────────────────────────────────

function resolveSound(soundId: SoundId): { iosSound?: string; androidChannelId: string } {
  if (soundId === 'beep') return { iosSound: 'beep.caf', androidChannelId: 'reminders_beep' };
  if (soundId === 'chime') return { iosSound: 'chime.caf', androidChannelId: 'reminders_chime' };
  return { iosSound: undefined, androidChannelId: 'reminders_default' };
}

async function ensureAndroidChannel(channelId: string, soundId: SoundId): Promise<void> {
  try {
    await LocalNotifications.createChannel({
      id: channelId,
      name: `Reminders (${soundId})`,
      importance: 4,
      sound: soundId === 'default' ? undefined : soundId,
      vibration: true,
      visibility: 1,
      lights: true,
    });
  } catch (e) {
    logger.warn('createChannel failed', e);
  }
}

async function scheduleLocalForReminder(
  rem: Pick<UiReminder, 'id' | 'title' | 'datetime' | 'advance_minutes'>,
  soundId: SoundId,
): Promise<void> {
  if (!rem.datetime) return;
  const at = new Date(new Date(rem.datetime).getTime() - rem.advance_minutes * 60_000);
  if (!Number.isFinite(at.getTime()) || at.getTime() <= Date.now()) return;

  const idNum = Number(rem.id);
  const { iosSound, androidChannelId } = resolveSound(soundId);
  await ensureAndroidChannel(androidChannelId, soundId);

  await LocalNotifications.cancel({ notifications: [{ id: idNum }] });
  await LocalNotifications.schedule({
    notifications: [
      {
        id: idNum,
        title: 'OurGLP1 Reminder',
        body: rem.title,
        schedule: { at },
        sound: iosSound,
        channelId: androidChannelId,
      },
    ],
  });
}

async function ensureNotificationPermission(): Promise<void> {
  await checkAndPersistPermission();
  await requestAndPersistPermission();
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

const RemindersPage: React.FC = () => {
  const { user: authUser } = useAuth() as { user?: unknown };

  const userTz =
    getUserTimezone(authUser) ||
    (() => {
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
      catch { return 'UTC'; }
    })();

  const tzFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: userTz,
      }),
    [userTz],
  );

  const [form, setForm] = useState<{
    title: string;
    day: (typeof daysFull)[number];
    time: string;
    advance: number;
    reminder_type: string;
    soundId: SoundId;
  }>({
    title: '',
    day: 'Monday',
    time: '08:00',
    advance: 0,
    reminder_type: '',
    soundId: 'default',
  });

  const [reminders, setReminders] = useState<UiReminder[]>([]);
  const { refreshCount } = useReminderBadge();

  const loadReminders = useCallback(async (): Promise<void> => {
    const rows = await listReminders();
    setReminders(
      rows.map(
        (r: LocalReminder): UiReminder => ({
          id: String(r.id),
          title: r.title,
          datetime: r.datetime,
          method: r.method,
          advance_minutes: r.advance_minutes,
          enabled: Boolean(r.enabled),
          reminder_type: r.reminder_type ?? undefined,
          day_of_week: r.day_of_week ?? undefined,
        }),
      ),
    );
  }, []);

  useEffect(() => { void loadReminders(); }, [loadReminders]);

  const cleanupOldReminders = useCallback(async (): Promise<void> => {
    const rows = await listReminders();
    const cutoff = Date.now() - 24 * 3600 * 1000;

    const expired = rows.filter((r: LocalReminder) => {
      if (!r.datetime) return false;
      const t = Date.parse(r.datetime);
      return Number.isFinite(t) && t < cutoff;
    });

    if (expired.length === 0) return;

    setReminders((prev) => prev.filter((r) => !expired.some((e) => String(e.id) === r.id)));

    for (const r of expired) {
      try {
        await deleteReminder(Number(r.id));
        await LocalNotifications.cancel({ notifications: [{ id: Number(r.id) }] });
      } catch (e) {
        logger.warn('cleanup delete failed', e);
      }
    }

    emitReminderDelta(-expired.length);
    await refreshCount();
  }, [refreshCount]);

  useEffect(() => {
    void cleanupOldReminders();
    const id = setInterval(() => void cleanupOldReminders(), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [cleanupOldReminders]);

  const saveReminder = useCallback(async (): Promise<void> => {
    const title = form.title.trim();
    if (!title) {
      alert('Please add a title');
      return;
    }

    await ensureNotificationPermission();

    const datetime = nextOccurrenceIso(form.day, form.time, userTz);

    const newId = await createReminder({
      title,
      datetime,
      method: ['push'],
      advance_minutes: form.advance ?? 0,
      enabled: 1,
      reminder_type: form.reminder_type || null,
      day_of_week: normalizeDOW(form.day),
    });

    await scheduleLocalForReminder(
      { id: String(newId), title, datetime, advance_minutes: form.advance ?? 0 },
      form.soundId,
    );

    emitReminderDelta(+1);
    await loadReminders();
    await refreshCount();
    alert('✅ Reminder saved');
  }, [
    form.advance,
    form.day,
    form.reminder_type,
    form.soundId,
    form.time,
    form.title,
    loadReminders,
    refreshCount,
    userTz,
  ]);

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm('Are you sure you want to delete this reminder?')) return;

      const snapshot = reminders;
      setReminders((prev) => prev.filter((r) => r.id !== id));

      try {
        await deleteReminder(Number(id));
        await LocalNotifications.cancel({ notifications: [{ id: Number(id) }] });
        emitReminderDelta(-1);
        await refreshCount();
        alert('🗑️ Reminder deleted!');
      } catch (err) {
        logger.error('Failed to delete reminder:', err);
        setReminders(snapshot);
        await loadReminders();
        await refreshCount();
        alert('Failed to delete reminder.');
      }
    },
    [loadReminders, refreshCount, reminders],
  );

  const sortedReminders = useMemo(() => {
    return [...reminders].sort((a, b) => {
      const ta = a.datetime ? Date.parse(a.datetime) : Number.POSITIVE_INFINITY;
      const tb = b.datetime ? Date.parse(b.datetime) : Number.POSITIVE_INFINITY;
      return ta - tb;
    });
  }, [reminders]);

  return (
    <IonPage>
      <TopNav showWhenAnon />

      <IonContent fullscreen className={styles.contentPad}>
        <div className={styles.pageInner}>
          <h1 className={styles.subtitle} id="remindersTitle">
            🗓️ Weekly Reminder Planner
          </h1>

          <p className={styles.bodyText}>
            This tool lets you plan reminders for the week. Each new week overwrites the last.
          </p>

          {/* Title */}
          <div className={styles.fieldGroup}>
            <label id="remTitleLabel" htmlFor="remTitleInput" className={styles.label}>
              Reminder Title
            </label>
            <input
              id="remTitleInput"
              className={styles.input}
              type="text"
              placeholder="e.g. Protein shake time"
              value={form.title}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setForm({ ...form, title: e.target.value })
              }
              aria-labelledby="remTitleLabel"
            />
          </div>

          {/* Type */}
          <div className={styles.fieldGroup}>
            <label id="remTypeLabel" htmlFor="remTypeSelect" className={styles.label}>
              Reminder Type
            </label>
            <select
              id="remTypeSelect"
              className={styles.input}
              value={form.reminder_type}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setForm({ ...form, reminder_type: e.target.value })
              }
              aria-labelledby="remTypeLabel"
            >
              <option value="">Select...</option>
              {reminderTypes.map((type) => (
                <option key={type} value={type.toLowerCase().replace(/ /g, '_')}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          {/* Day */}
          <div className={styles.fieldGroup}>
            <label id="remDayLabel" htmlFor="remDaySelect" className={styles.label}>
              Day of Week
            </label>
            <select
              id="remDaySelect"
              className={styles.input}
              value={form.day}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setForm({ ...form, day: e.target.value as (typeof daysFull)[number] })
              }
              aria-labelledby="remDayLabel"
            >
              {daysFull.map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
          </div>

          {/* Time */}
          <div className={styles.fieldGroup}>
            <label id="remTimeLabel" htmlFor="remTimeInput" className={styles.label}>
              Time
            </label>
            <input
              id="remTimeInput"
              className={styles.inputField}
              type="time"
              value={form.time}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setForm({ ...form, time: e.target.value })
              }
              aria-labelledby="remTimeLabel"
            />
          </div>

          {/* Sound */}
          <div className={styles.fieldGroup}>
            <label id="remSoundLabel" htmlFor="remSoundSelect" className={styles.label}>
              Notification Sound
            </label>
            <select
              id="remSoundSelect"
              className={styles.input}
              value={form.soundId}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setForm({ ...form, soundId: e.target.value as SoundId })
              }
              aria-labelledby="remSoundLabel"
            >
              {SOUND_OPTIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <div className={styles.helperText}>
              iOS: sound file must be in the app bundle (e.g. <code>beep.caf</code>). Android: sound is tied to the channel.
            </div>
          </div>

          {/* Advance */}
          <div className={styles.fieldGroup}>
            <label id="remAdvanceLabel" htmlFor="remAdvanceSelect" className={styles.label}>
              Advance Notice
            </label>
            <select
              id="remAdvanceSelect"
              className={styles.input}
              value={form.advance}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setForm({ ...form, advance: Number(e.target.value) })
              }
              aria-labelledby="remAdvanceLabel"
            >
              {advanceOptions.map((mins) => (
                <option key={mins} value={mins}>
                  {mins === 0 ? 'No advance notice' : mins < 60 ? `${mins} min` : `${mins / 60} hr`}
                </option>
              ))}
            </select>
          </div>

          <IonButton
            onClick={() => void saveReminder()}
            expand="block"
            className={`${styles.mt12} custom-button`}
            aria-label="Save reminder"
          >
            Save Reminder
          </IonButton>

          <hr className={styles.hr} />

          <h3 className={styles.savedTitle}>🔔 Saved Reminders</h3>

          {sortedReminders.length === 0 ? (
            <p className={styles.muted}>No reminders yet.</p>
          ) : (
            <ul className={styles.reminderList} aria-label="Saved reminders list">
              {sortedReminders.map((rem) => (
                <li key={rem.id} className={styles.reminderItem}>
                  <div className={styles.reminderMain}>
                    <strong>{rem.title}</strong>
                    {rem.reminder_type && (
                      <>
                        {' '}
                        — <em>{rem.reminder_type.replace(/_/g, ' ')}</em>
                      </>
                    )}
                    {' — '}
                    {rem.datetime ? tzFormatter.format(new Date(rem.datetime)) : '—'}
                    {' — '}
                    {rem.method.join(', ')}
                  </div>

                  <button
                    type="button"
                    className={styles.deleteBtn}
                    onClick={() => void handleDelete(rem.id)}
                    aria-label={`Delete reminder ${rem.title}`}
                    title="Delete reminder"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div aria-hidden className={styles.bottomSpacer} />
        </div>
      </IonContent>

      <BottomNav />
    </IonPage>
  );
};

export default RemindersPage;








