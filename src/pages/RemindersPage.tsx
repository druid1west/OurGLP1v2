// src/pages/RemindersPage.tsx
import { logger } from '@/utils/logger';
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { IonPage, IonContent, IonButton } from '@ionic/react';
import {
  Activity,
  BellRing,
  CheckCircle2,
  Clock3,
  Droplets,
  Dumbbell,
  FlaskConical,
  HeartPulse,
  Pause,
  Pill,
  Play,
  RefreshCw,
  Syringe,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import styles from './RemindersPage.module.css';

import TopNav from '@/context/TopNav';
import BottomNav from '@/context/BottomNav';

import { useAuth } from '@/context/useAuth';
import { useReminderBadge } from '@/context/ReminderBadgeContext';
import { emitReminderDelta } from '@/utils/reminderEvents';
import { buildReminderNotificationText } from '@/utils/reminderMessages';

import { LocalNotifications } from '@capacitor/local-notifications';

import {
  acknowledgeReminder,
  createReminder,
  deleteReminder,
  listReminders,
  rescheduleAllReminders as rebuildReminderNotifications,
  setReminderEnabled,
  type LocalReminder,
} from '@/db/RemindersRepository';

import { getSettings, type Settings } from '@/db/SettingsRepository';
import { getPrimaryProtocol, type Protocol } from '@/db/ProtocolRepository';
import {
  checkAndPersistPermission,
  getNotificationStatus,
  requestAndPersistPermission,
  type NotificationStatus,
} from '@/db/NotificationStatus';

function getUserTimezone(u: unknown): string | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const r = u as Record<string, unknown>;
  return typeof r.timezone === 'string' ? r.timezone : undefined;
}

function getUserId(u: unknown): string | null {
  if (!u || typeof u !== 'object') return null;
  const raw = (u as Record<string, unknown>).id;
  if (typeof raw === 'string' && raw.trim()) return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return null;
}

type UiReminder = Readonly<{
  id: string;
  title: string;
  datetime: string | null;
  method: string[];
  advance_minutes: number;
  enabled: boolean;
  reminder_type?: string;
  day_of_week?: string;
  acknowledged_at?: string | null;
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

type DayFull = (typeof daysFull)[number];

const reminderTypes = [
  { value: 'injection', label: 'Injection' },
  { value: 'blood_sugar', label: 'Blood Sugar' },
  { value: 'blood_pressure', label: 'Blood Pressure' },
  { value: 'bowel_movement', label: 'Bowel Movement' },
  { value: 'exercise', label: 'Exercise' },
  { value: 'protein', label: 'Protein' },
  { value: 'hydration', label: 'Hydration' },
  { value: 'effectiveness', label: 'Hunger / Nausea' },
  { value: 'weekly_summary', label: 'Weekly Summary' },
  { value: 'protocol', label: 'Protocol' },
  { value: 'other', label: 'Other' },
] as const;

const typeLabels = reminderTypes.reduce<Record<string, string>>((acc, item) => {
  acc[item.value] = item.label;
  return acc;
}, {});

const advanceOptions = [0, 5, 10, 15, 20, 30, 60, 1440] as const;

const SOUND_OPTIONS = [
  { id: 'default', label: 'Default' },
  { id: 'beep', label: 'Beep' },
  { id: 'chime', label: 'Chime' },
] as const;

type SoundId = (typeof SOUND_OPTIONS)[number]['id'];

type ReminderPreset = Readonly<{
  key: string;
  title: string;
  label: string;
  detail: string;
  reminderType: string;
  day: DayFull;
  time: string;
  advance: number;
  Icon: LucideIcon;
}>;

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

function resolveSound(soundId: SoundId): { iosSound?: string; androidChannelId: string } {
  if (soundId === 'beep') return { iosSound: 'beep.caf', androidChannelId: 'reminders_beep' };
  if (soundId === 'chime') return { iosSound: 'chime.caf', androidChannelId: 'reminders_chime' };
  return { iosSound: 'default', androidChannelId: 'reminders_default' };
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
  rem: Pick<UiReminder, 'id' | 'title' | 'datetime' | 'advance_minutes' | 'reminder_type'>,
  soundId: SoundId,
): Promise<boolean> {
  if (!rem.datetime) return false;
  const at = new Date(new Date(rem.datetime).getTime() - rem.advance_minutes * 60_000);
  if (!Number.isFinite(at.getTime()) || at.getTime() <= Date.now()) return false;

  const idNum = Number(rem.id);
  const { iosSound, androidChannelId } = resolveSound(soundId);
  const text = buildReminderNotificationText({
    title: rem.title,
    reminderType: rem.reminder_type,
  });
  await ensureAndroidChannel(androidChannelId, soundId);

  await LocalNotifications.cancel({ notifications: [{ id: idNum }] });
  await LocalNotifications.schedule({
    notifications: [
      {
        id: idNum,
        title: text.title,
        body: text.body,
        schedule: { at, allowWhileIdle: true },
        sound: iosSound,
        channelId: androidChannelId,
        extra: { type: rem.reminder_type ?? 'generic', rowId: idNum, route: '/reminders' },
      },
    ],
  });

  await wait(250);
  const pending = await LocalNotifications.getPending();
  return pending.notifications.some((notification) => notification.id === idNum);
}

async function ensureNotificationPermission(): Promise<NotificationStatus> {
  await checkAndPersistPermission();
  await requestAndPersistPermission();
  return getNotificationStatus();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatAdvance(mins: number): string {
  if (mins === 0) return 'At time';
  if (mins < 60) return `${mins} min before`;
  if (mins === 60) return '1 hour before';
  if (mins === 1440) return '1 day before';
  return `${mins / 60} hours before`;
}

function toReminderTypeLabel(value?: string): string {
  if (!value) return 'General';
  return typeLabels[value] ?? value.replace(/_/g, ' ');
}

function dayFromDate(date: Date, tz: string): DayFull {
  const label = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: tz }).format(date);
  return daysFull.includes(label as DayFull) ? (label as DayFull) : 'Monday';
}

function nextDay(day: DayFull): DayFull {
  const idx = daysFull.indexOf(day);
  return daysFull[(idx + 1) % daysFull.length];
}

function coerceDay(day?: string): DayFull {
  if (day && daysFull.includes(day as DayFull)) return day as DayFull;
  return 'Monday';
}

function isOpenReminder(rem: UiReminder): boolean {
  return rem.enabled && !rem.acknowledged_at;
}

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
    day: DayFull;
    time: string;
    advance: number;
    reminder_type: string;
    soundId: SoundId;
  }>({
    title: '',
    day: dayFromDate(new Date(), userTz),
    time: '08:00',
    advance: 0,
    reminder_type: 'other',
    soundId: 'default',
  });

  const [reminders, setReminders] = useState<UiReminder[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [primaryProtocol, setPrimaryProtocol] = useState<Protocol | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<NotificationStatus | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const { count, refreshCount } = useReminderBadge();

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
          acknowledged_at: r.acknowledged_at,
        }),
      ),
    );
  }, []);

  const loadPageData = useCallback(async (): Promise<void> => {
    const userId = getUserId(authUser);
    const [rowsStatus, rowsSettings, protocol] = await Promise.all([
      getNotificationStatus(),
      getSettings().catch(() => null),
      userId ? getPrimaryProtocol(userId).catch(() => null) : Promise.resolve(null),
    ]);
    setNotificationStatus(rowsStatus);
    setSettings(rowsSettings);
    setPrimaryProtocol(protocol);
    await loadReminders();
    await refreshCount();
  }, [authUser, loadReminders, refreshCount]);

  useEffect(() => {
    void loadPageData();
  }, [loadPageData]);

  const presets = useMemo<ReminderPreset[]>(() => {
    const injectionDay = coerceDay(settings?.injection_day);
    const primaryIsDaily = primaryProtocol?.cadence_type === 'daily';
    const primaryIsWeekly = primaryProtocol?.cadence_type === 'weekly';
    const protocolDay = coerceDay(primaryProtocol?.anchor_day ?? settings?.injection_day);
    const protocolTime = primaryProtocol?.dose_time || settings?.injection_time || '09:00';
    const symptomDay = nextDay(injectionDay);
    const primaryMedicationPreset: ReminderPreset = primaryIsDaily
      ? {
          key: 'daily-primary-protocol',
          label: 'Daily medication',
          title: `Daily ${primaryProtocol?.name ?? 'medication'}`,
          detail: `Every day at ${protocolTime}`,
          reminderType: 'protocol',
          day: dayFromDate(new Date(), userTz),
          time: protocolTime,
          advance: 0,
          Icon: Pill,
        }
      : {
          key: 'weekly-primary-protocol',
          label: primaryIsWeekly ? 'Injection' : 'Medication',
          title: primaryIsWeekly
            ? `Weekly ${primaryProtocol?.name ?? 'injection'}`
            : 'Weekly injection',
          detail: `${protocolDay} at ${protocolTime}`,
          reminderType: primaryIsWeekly ? 'injection' : 'protocol',
          day: protocolDay,
          time: protocolTime,
          advance: 60,
          Icon: primaryIsWeekly ? Syringe : FlaskConical,
        };

    return [
      primaryMedicationPreset,
      {
        key: 'hydration',
        label: 'Hydration',
        title: 'Hydration check',
        detail: 'Midday fluids',
        reminderType: 'hydration',
        day: dayFromDate(new Date(), userTz),
        time: '12:00',
        advance: 0,
        Icon: Droplets,
      },
      {
        key: 'protein',
        label: 'Protein',
        title: 'Protein check-in',
        detail: 'Meal support',
        reminderType: 'protein',
        day: dayFromDate(new Date(), userTz),
        time: '13:00',
        advance: 0,
        Icon: Pill,
      },
      {
        key: 'symptoms',
        label: 'Hunger / nausea',
        title: 'Hunger and nausea log',
        detail: `${symptomDay} after injection`,
        reminderType: 'effectiveness',
        day: symptomDay,
        time: '10:00',
        advance: 0,
        Icon: HeartPulse,
      },
      {
        key: 'exercise',
        label: 'Activity',
        title: 'Activity check',
        detail: 'Steps or exercise',
        reminderType: 'exercise',
        day: dayFromDate(new Date(), userTz),
        time: '18:00',
        advance: 0,
        Icon: Dumbbell,
      },
      {
        key: 'summary',
        label: 'Weekly review',
        title: 'Weekly summary review',
        detail: 'Sunday evening',
        reminderType: 'weekly_summary',
        day: 'Sunday',
        time: '18:00',
        advance: 30,
        Icon: Activity,
      },
      {
        key: 'protocol',
        label: 'Protocol',
        title: 'Protocol check-in',
        detail: 'Dose, effects, notes',
        reminderType: 'protocol',
        day: dayFromDate(new Date(), userTz),
        time: '09:00',
        advance: 0,
        Icon: FlaskConical,
      },
    ];
  }, [primaryProtocol, settings, userTz]);

  const sortedReminders = useMemo(() => {
    return [...reminders].sort((a, b) => {
      const aOpen = isOpenReminder(a) ? 0 : 1;
      const bOpen = isOpenReminder(b) ? 0 : 1;
      if (aOpen !== bOpen) return aOpen - bOpen;
      const ta = a.datetime ? Date.parse(a.datetime) : Number.POSITIVE_INFINITY;
      const tb = b.datetime ? Date.parse(b.datetime) : Number.POSITIVE_INFINITY;
      return ta - tb;
    });
  }, [reminders]);

  const openReminders = useMemo(
    () => sortedReminders.filter(isOpenReminder),
    [sortedReminders],
  );

  const pausedReminders = useMemo(
    () => sortedReminders.filter((rem) => !rem.enabled && !rem.acknowledged_at),
    [sortedReminders],
  );

  const acknowledgedReminders = useMemo(
    () => sortedReminders.filter((rem) => Boolean(rem.acknowledged_at)),
    [sortedReminders],
  );

  const nextReminder = openReminders[0];

  const applyPreset = useCallback((preset: ReminderPreset): void => {
    setForm((prev) => ({
      ...prev,
      title: preset.title,
      day: preset.day,
      time: preset.time,
      advance: preset.advance,
      reminder_type: preset.reminderType,
    }));
    setNotice(`${preset.label} reminder loaded. Save it when it looks right.`);
  }, []);

  const syncStatus = useCallback(async (): Promise<void> => {
    const status = await checkAndPersistPermission();
    const nextStatus = await getNotificationStatus();
    setNotificationStatus(nextStatus);
    setNotice(status === 'granted' ? 'Notifications are enabled.' : 'Notifications still need permission.');
  }, []);

  const saveReminder = useCallback(async (): Promise<void> => {
    const title = form.title.trim();
    if (!title) {
      setNotice('Add a reminder title first.');
      return;
    }

    const permission = await ensureNotificationPermission();
    setNotificationStatus(permission);

    if (permission.permission !== 'granted') {
      setNotice('Notification permission is not granted yet. The reminder was not saved.');
      return;
    }

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

    const acceptedByPhone = await scheduleLocalForReminder(
      {
        id: String(newId),
        title,
        datetime,
        advance_minutes: form.advance ?? 0,
        reminder_type: form.reminder_type,
      },
      form.soundId,
    );

    emitReminderDelta(+1);
    await loadReminders();
    await refreshCount();
    setNotice(
      acceptedByPhone
        ? 'Reminder saved and accepted by the phone notification queue.'
        : 'Reminder saved, but the phone did not report it as pending. Check notification settings if it does not appear.',
    );
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

  const handleAcknowledge = useCallback(
    async (rem: UiReminder): Promise<void> => {
      if (rem.acknowledged_at) return;
      setBusyId(rem.id);
      const wasOpen = isOpenReminder(rem);
      const acknowledgedAt = new Date().toISOString();
      setReminders((prev) =>
        prev.map((item) =>
          item.id === rem.id ? { ...item, acknowledged_at: acknowledgedAt } : item,
        ),
      );

      try {
        await acknowledgeReminder(Number(rem.id));
        if (wasOpen) emitReminderDelta(-1);
        await refreshCount();
        setNotice(`${rem.title} acknowledged.`);
      } catch (err) {
        logger.error('Failed to acknowledge reminder:', err);
        await loadReminders();
        await refreshCount();
        setNotice('Could not acknowledge reminder.');
      } finally {
        setBusyId(null);
      }
    },
    [loadReminders, refreshCount],
  );

  const handleToggleEnabled = useCallback(
    async (rem: UiReminder): Promise<void> => {
      setBusyId(rem.id);
      const nextEnabled = !rem.enabled;
      const wasOpen = isOpenReminder(rem);
      const willOpen = nextEnabled;

      setReminders((prev) =>
        prev.map((item) =>
          item.id === rem.id
            ? { ...item, enabled: nextEnabled, acknowledged_at: nextEnabled ? null : item.acknowledged_at }
            : item,
        ),
      );

      try {
        await setReminderEnabled(Number(rem.id), nextEnabled);
        await rebuildReminderNotifications();
        if (wasOpen && !willOpen) emitReminderDelta(-1);
        if (!wasOpen && willOpen) emitReminderDelta(+1);
        await refreshCount();
        setNotice(nextEnabled ? `${rem.title} resumed.` : `${rem.title} paused.`);
      } catch (err) {
        logger.error('Failed to toggle reminder:', err);
        await loadReminders();
        await refreshCount();
        setNotice('Could not update reminder.');
      } finally {
        setBusyId(null);
      }
    },
    [loadReminders, refreshCount],
  );

  const handleDelete = useCallback(
    async (rem: UiReminder): Promise<void> => {
      if (!confirm(`Delete "${rem.title}"?`)) return;

      setBusyId(rem.id);
      const wasOpen = isOpenReminder(rem);
      const snapshot = reminders;
      setReminders((prev) => prev.filter((r) => r.id !== rem.id));

      try {
        await deleteReminder(Number(rem.id));
        if (wasOpen) emitReminderDelta(-1);
        await refreshCount();
        setNotice('Reminder deleted.');
      } catch (err) {
        logger.error('Failed to delete reminder:', err);
        setReminders(snapshot);
        await loadReminders();
        await refreshCount();
        setNotice('Could not delete reminder.');
      } finally {
        setBusyId(null);
      }
    },
    [loadReminders, refreshCount, reminders],
  );

  const handleAcknowledgeAll = useCallback(async (): Promise<void> => {
    if (openReminders.length === 0) return;

    setBusyId('all');
    const now = new Date().toISOString();
    setReminders((prev) =>
      prev.map((item) => (isOpenReminder(item) ? { ...item, acknowledged_at: now } : item)),
    );

    try {
      await Promise.all(openReminders.map((rem) => acknowledgeReminder(Number(rem.id))));
      emitReminderDelta(-openReminders.length);
      await refreshCount();
      setNotice('All open reminders acknowledged.');
    } catch (err) {
      logger.error('Failed to acknowledge all reminders:', err);
      await loadReminders();
      await refreshCount();
      setNotice('Could not acknowledge all reminders.');
    } finally {
      setBusyId(null);
    }
  }, [loadReminders, openReminders, refreshCount]);

  const handleTestNotification = useCallback(async (): Promise<void> => {
    try {
      const permission = await ensureNotificationPermission();
      setNotificationStatus(permission);

      if (permission.permission !== 'granted') {
        setNotice('Notification permission is not granted yet.');
        return;
      }

      const id = Math.floor(Date.now() % 2_000_000_000);
      const { iosSound, androidChannelId } = resolveSound(form.soundId);
      await ensureAndroidChannel(androidChannelId, form.soundId);
      const at = new Date(Date.now() + 15_000);
      await LocalNotifications.schedule({
        notifications: [
          {
            id,
            title: 'OurGLP1 reminder test',
            body: 'Notifications are working.',
            schedule: { at, allowWhileIdle: true },
            sound: iosSound,
            channelId: androidChannelId,
            extra: { route: '/reminders', type: 'test' },
          },
        ],
      });

      await wait(250);
      const pending = await LocalNotifications.getPending();
      const accepted = pending.notifications.some((n) => n.id === id);
      setNotice(
        accepted
          ? 'Test notification accepted by the phone. It should appear in about 15 seconds.'
          : 'The phone did not keep the test notification pending. Check iOS Settings > Notifications > OurGLP1v2.',
      );
    } catch (err) {
      logger.error('Test notification failed:', err);
      setNotice(err instanceof Error ? err.message : 'Test notification failed.');
    }
  }, [form.soundId]);

  const renderReminder = (rem: UiReminder) => {
    const isOpen = isOpenReminder(rem);
    const isPaused = !rem.enabled && !rem.acknowledged_at;
    const isDone = Boolean(rem.acknowledged_at);
    const busy = busyId === rem.id || busyId === 'all';

    return (
      <li
        key={rem.id}
        className={styles.reminderItem}
        data-state={isDone ? 'done' : isPaused ? 'paused' : 'open'}
      >
        <div className={styles.reminderMain}>
          <div className={styles.reminderTopLine}>
            <strong>{rem.title}</strong>
            <span className={styles.typePill}>{toReminderTypeLabel(rem.reminder_type)}</span>
          </div>

          <div className={styles.reminderMeta}>
            <span>
              <Clock3 size={14} aria-hidden />
              {rem.datetime ? tzFormatter.format(new Date(rem.datetime)) : 'No scheduled time'}
            </span>
            <span>{formatAdvance(rem.advance_minutes)}</span>
            <span>{rem.method.length ? rem.method.join(', ') : 'push'}</span>
          </div>

          {isDone && (
            <div className={styles.doneLine}>
              Acknowledged {rem.acknowledged_at ? tzFormatter.format(new Date(rem.acknowledged_at)) : ''}
            </div>
          )}
        </div>

        <div className={styles.itemActions}>
          {isOpen && (
            <button
              type="button"
              className={styles.iconAction}
              onClick={() => void handleAcknowledge(rem)}
              disabled={busy}
              aria-label={`Acknowledge ${rem.title}`}
              title="Acknowledge reminder"
            >
              <CheckCircle2 size={18} aria-hidden />
            </button>
          )}

          {!isDone && (
            <button
              type="button"
              className={styles.iconAction}
              onClick={() => void handleToggleEnabled(rem)}
              disabled={busy}
              aria-label={rem.enabled ? `Pause ${rem.title}` : `Resume ${rem.title}`}
              title={rem.enabled ? 'Pause reminder' : 'Resume reminder'}
            >
              {rem.enabled ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
            </button>
          )}

          <button
            type="button"
            className={`${styles.iconAction} ${styles.deleteAction}`}
            onClick={() => void handleDelete(rem)}
            disabled={busy}
            aria-label={`Delete ${rem.title}`}
            title="Delete reminder"
          >
            <Trash2 size={18} aria-hidden />
          </button>
        </div>
      </li>
    );
  };

  return (
    <IonPage>
      <TopNav showWhenAnon />

      <IonContent fullscreen className={styles.contentPad}>
        <div className={styles.pageInner}>
          <section className={styles.hero} aria-labelledby="remindersTitle">
            <div>
              <p className={styles.kicker}>Routine reminders</p>
              <h1 className={styles.title} id="remindersTitle">
                Keep the next health action visible
              </h1>
              <p className={styles.bodyText}>
                Scheduled reminders send local notifications. The red counter shows reminders that
                still need acknowledgement.
              </p>
            </div>

            <div className={styles.counterPanel} aria-label={`${count} reminders need acknowledgement`}>
              <span className={styles.counterValue}>{count}</span>
              <span className={styles.counterLabel}>open</span>
            </div>
          </section>

          <section className={styles.statusGrid} aria-label="Reminder status">
            <div className={styles.statusCard}>
              <span>Notifications</span>
              <strong data-status={notificationStatus?.permission ?? 'unknown'}>
                {notificationStatus?.permission ?? 'unknown'}
              </strong>
            </div>
            <div className={styles.statusCard}>
              <span>Next reminder</span>
              <strong>
                {nextReminder?.datetime ? tzFormatter.format(new Date(nextReminder.datetime)) : 'None'}
              </strong>
            </div>
            <div className={styles.statusCard}>
              <span>Time zone</span>
              <strong>{userTz}</strong>
            </div>
          </section>

          {notice && <div className={styles.notice}>{notice}</div>}

          <section className={styles.panel} aria-labelledby="quickAddTitle">
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="quickAddTitle">Quick Add</h2>
                <p>Start with a useful routine, then adjust the day or time.</p>
              </div>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void syncStatus()}
              >
                <RefreshCw size={16} aria-hidden />
                Check permission
              </button>
            </div>

            <div className={styles.presetGrid}>
              {presets.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className={styles.presetButton}
                  onClick={() => applyPreset(preset)}
                >
                  <preset.Icon size={20} aria-hidden />
                  <span>
                    <strong>{preset.label}</strong>
                    <small>{preset.detail}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="createReminderTitle">
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="createReminderTitle">Create Reminder</h2>
                <p>These are on-device notifications, so they keep working without a backend.</p>
              </div>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void handleTestNotification()}
              >
                <BellRing size={16} aria-hidden />
                Test
              </button>
            </div>

            <div className={styles.formGrid}>
              <div className={styles.fieldGroup}>
                <label id="remTitleLabel" htmlFor="remTitleInput" className={styles.label}>
                  Title
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

              <div className={styles.fieldGroup}>
                <label id="remTypeLabel" htmlFor="remTypeSelect" className={styles.label}>
                  Type
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
                  {reminderTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.fieldGroup}>
                <label id="remDayLabel" htmlFor="remDaySelect" className={styles.label}>
                  Day
                </label>
                <select
                  id="remDaySelect"
                  className={styles.input}
                  value={form.day}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                    setForm({ ...form, day: e.target.value as DayFull })
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

              <div className={styles.fieldGroup}>
                <label id="remTimeLabel" htmlFor="remTimeInput" className={styles.label}>
                  Time
                </label>
                <input
                  id="remTimeInput"
                  className={styles.input}
                  type="time"
                  value={form.time}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setForm({ ...form, time: e.target.value })
                  }
                  aria-labelledby="remTimeLabel"
                />
              </div>

              <div className={styles.fieldGroup}>
                <label id="remAdvanceLabel" htmlFor="remAdvanceSelect" className={styles.label}>
                  Notice
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
                      {formatAdvance(mins)}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.fieldGroup}>
                <label id="remSoundLabel" htmlFor="remSoundSelect" className={styles.label}>
                  Sound
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
              </div>
            </div>

            <IonButton
              onClick={() => void saveReminder()}
              expand="block"
              className={`${styles.saveButton} custom-button`}
              aria-label="Save reminder"
            >
              Save Reminder
            </IonButton>
          </section>

          <section className={styles.panel} aria-labelledby="openRemindersTitle">
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="openRemindersTitle">Needs Acknowledgement</h2>
                <p>Tick reminders off here to lower the red counter and app badge.</p>
              </div>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void handleAcknowledgeAll()}
                disabled={openReminders.length === 0 || busyId === 'all'}
              >
                <CheckCircle2 size={16} aria-hidden />
                Clear all
              </button>
            </div>

            {openReminders.length === 0 ? (
              <p className={styles.emptyText}>No open reminders.</p>
            ) : (
              <ul className={styles.reminderList} aria-label="Open reminders">
                {openReminders.map(renderReminder)}
              </ul>
            )}
          </section>

          {pausedReminders.length > 0 && (
            <section className={styles.panel} aria-labelledby="pausedRemindersTitle">
              <div className={styles.sectionHeader}>
                <div>
                  <h2 id="pausedRemindersTitle">Paused</h2>
                  <p>Paused reminders stay listed but do not send notifications.</p>
                </div>
              </div>
              <ul className={styles.reminderList} aria-label="Paused reminders">
                {pausedReminders.map(renderReminder)}
              </ul>
            </section>
          )}

          {acknowledgedReminders.length > 0 && (
            <section className={styles.panel} aria-labelledby="acknowledgedRemindersTitle">
              <div className={styles.sectionHeader}>
                <div>
                  <h2 id="acknowledgedRemindersTitle">Acknowledged</h2>
                  <p>Keep these for reference or delete them when you are done.</p>
                </div>
              </div>
              <ul className={styles.reminderList} aria-label="Acknowledged reminders">
                {acknowledgedReminders.map(renderReminder)}
              </ul>
            </section>
          )}

          <div aria-hidden className={styles.bottomSpacer} />
        </div>
      </IonContent>

      <BottomNav />
    </IonPage>
  );
};

export default RemindersPage;
