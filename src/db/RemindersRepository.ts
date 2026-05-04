// src/db/RemindersRepository.ts
import { getDb } from '../db/sqlite';
import { scheduleSleepReminderIfSet, cancelSleepReminder } from '../notifications/sleepReminder'; // ⬅ ADD THIS
import { LocalNotifications } from '@capacitor/local-notifications';
import { getNotificationSoundId } from '../db/SettingsRepository';
import { buildReminderNotificationText } from '../utils/reminderMessages';

export type LocalReminder = {
  id: number;
  title: string;
  datetime: string | null;
  method: string[];
  advance_minutes: number;
  enabled: 0 | 1;
  reminder_type: string | null;
  day_of_week: string | null;
  acknowledged_at: string | null;
  created_at: string;
  updated_at: string;
};

type ReminderRow = Readonly<{
  id: number | string;
  title: string | null;
  datetime: string | null;
  method: string | null;          // JSON string or NULL
  advance_minutes: number | string | null;
  enabled: number | string | null;
  reminder_type: string | null;
  day_of_week: string | null;
  acknowledged_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}>;

type QueryResult<T> = Readonly<{ values?: readonly T[] }>;
type ReminderCreateInput = Omit<LocalReminder, 'id' | 'created_at' | 'updated_at' | 'acknowledged_at'> & {
  acknowledged_at?: string | null;
};
type IOSColumnsHeader = Readonly<{ ios_columns: readonly string[] }>;

function isIOSColumnsHeader(row: unknown): row is IOSColumnsHeader {
  return Boolean(row && typeof row === 'object' && 'ios_columns' in row);
}

type SoundId = 'default' | 'beep' | 'chime';

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
      sound: soundId === 'default' ? undefined : soundId, // Android expects raw resource name for custom sounds
      vibration: true,
      visibility: 1,
      lights: true,
    });
  } catch (e) {
    console.warn('[Reminders] createChannel failed', e);
  }
}

function buildAtFromIsoWithAdvance(iso: string, advanceMinutes: number): Date | null {
  const fire = Date.parse(iso);
  if (!Number.isFinite(fire)) return null;
  const at = new Date(fire - (advanceMinutes > 0 ? advanceMinutes * 60_000 : 0));
  return at.getTime() > Date.now() ? at : null;
}

/** Rebuilds local notifications for all DB reminders (enabled + future). */
async function rescheduleDbReminders(): Promise<void> {
  const rows = await listReminders();
  const soundId = await getNotificationSoundId(); // 'default' | 'beep' | 'chime'
  const { iosSound, androidChannelId } = resolveSound(soundId as SoundId);
  await ensureAndroidChannel(androidChannelId, soundId as SoundId);

  // Cancel existing notifications for these ids first to avoid dupes
  if (rows.length > 0) {
    await LocalNotifications.cancel({
      notifications: rows.map(r => ({ id: r.id })),
    });
  }

  // Build fresh notifications
  const notifications = rows
    .filter(r => r.enabled === 1 && !r.acknowledged_at && !!r.datetime)
    .map(r => {
      const at = buildAtFromIsoWithAdvance(r.datetime as string, r.advance_minutes);
      if (!at) return null;
      const text = buildReminderNotificationText({
        title: r.title,
        reminderType: r.reminder_type,
      });
      return {
        id: r.id,                                  // keep id == row id
        title: text.title,
        body: text.body,
        schedule: { at, allowWhileIdle: true },     // one-time
        sound: iosSound,                           // iOS
        channelId: androidChannelId,               // Android
        extra: { type: r.reminder_type ?? 'generic', rowId: r.id, route: '/reminders' },
      };
    })
    .filter((n): n is NonNullable<typeof n> => !!n);

  if (notifications.length > 0) {
    await LocalNotifications.schedule({ notifications });
  }
}

function parseMethodJson(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]) : [];
  } catch {
    return [];
  }
}

function asInt(v: unknown, def = 0): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : def;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  }
  return def;
}

function asStr(v: unknown, def: string | null = null): string | null {
  return typeof v === 'string' ? v : def;
}

function rowToReminder(row: ReminderRow): LocalReminder {
  return {
    id: asInt(row.id, 0),
    title: String(asStr(row.title, '') ?? ''),
    datetime: asStr(row.datetime, null),
    method: parseMethodJson(row.method),
    advance_minutes: asInt(row.advance_minutes, 0),
    enabled: (asInt(row.enabled, 1) ? 1 : 0) as 0 | 1,
    reminder_type: asStr(row.reminder_type, null),
    day_of_week: asStr(row.day_of_week, null),
    acknowledged_at: asStr(row.acknowledged_at, null),
    created_at: asStr(row.created_at, new Date().toISOString())!,
    updated_at: asStr(row.updated_at, new Date().toISOString())!,
  };
}

export async function listReminders(): Promise<LocalReminder[]> {
  const db = await getDb();
  const res = (await db.query(
    `
    SELECT id, title, datetime, method, advance_minutes, enabled, reminder_type,
           day_of_week, acknowledged_at, created_at, updated_at
    FROM reminders
    ORDER BY CASE WHEN datetime IS NULL THEN 1 ELSE 0 END,
             datetime(datetime) ASC
    `
  )) as QueryResult<ReminderRow>;

  const rows = res.values ?? [];
  return rows.filter((row) => !isIOSColumnsHeader(row)).map(rowToReminder);
}

export async function createReminder(input: ReminderCreateInput): Promise<number> {
  const db = await getDb();
  const now = new Date().toISOString();
  const methodJson = JSON.stringify(input.method ?? []);

  await db.run(
    `INSERT INTO reminders
      (title, datetime, method, advance_minutes, enabled, reminder_type, day_of_week, acknowledged_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.title,
      input.datetime,
      methodJson,
      input.advance_minutes ?? 0,
      input.enabled ?? 1,
      input.reminder_type ?? null,
      input.day_of_week ?? null,
      input.acknowledged_at ?? null,
      now,
      now,
    ]
  );

  // Portable last-insert-id
  const idRes = (await db.query(
    `SELECT last_insert_rowid() AS id`
  )) as QueryResult<Readonly<{ id: number | string }>>;

  const idRaw = idRes.values?.[0]?.id;
  const id = typeof idRaw === 'number' ? idRaw : Number(idRaw ?? 0);
  return Number.isFinite(id) ? id : 0;
}

export async function deleteReminder(id: number): Promise<void> {
  const db = await getDb();
  await db.run(`DELETE FROM reminders WHERE id = ?`, [id]);
  try {
    await LocalNotifications.cancel({ notifications: [{ id }] });
  } catch (e) {
    console.warn('[Reminders] cancel after delete failed', e);
  }
}

export async function acknowledgeReminder(id: number): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.run(
    `UPDATE reminders
     SET acknowledged_at = ?, updated_at = ?
     WHERE id = ?`,
    [now, now, id]
  );
  try {
    await LocalNotifications.cancel({ notifications: [{ id }] });
  } catch (e) {
    console.warn('[Reminders] cancel after acknowledge failed', e);
  }
}

export async function setReminderEnabled(id: number, enabled: boolean): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.run(
    `UPDATE reminders
     SET enabled = ?,
         acknowledged_at = CASE WHEN ? = 1 THEN NULL ELSE acknowledged_at END,
         updated_at = ?
     WHERE id = ?`,
    [enabled ? 1 : 0, enabled ? 1 : 0, now, id]
  );

  if (!enabled) {
    try {
      await LocalNotifications.cancel({ notifications: [{ id }] });
    } catch (e) {
      console.warn('[Reminders] cancel after pause failed', e);
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   Central rescheduler (single source of truth)
   - Cancels/schedules all local reminders.
   - Includes the daily SLEEP reminder ("Bedtime").
   - Extend here as you add more categories.
──────────────────────────────────────────────────────────────────────────── */
export async function rescheduleAllReminders(): Promise<void> {
  // 1) Cancel per-category (prevents duplicates)
  await cancelSleepReminder();
  // DB reminders cancel is done inside rescheduleDbReminders()

  // 2) Rebuild from current DB/prefs
  await rescheduleDbReminders();     // ← weekly/one-off reminders from RemindersPage
  await scheduleSleepReminderIfSet(); // ← daily bedtime reminder
}
