// src/boot/notifications.ts
import { Capacitor } from '@capacitor/core';
import {
  LocalNotifications,
  type ActionType,
  type LocalNotificationSchema,
} from '@capacitor/local-notifications';
import { getNotificationStatus, checkAndPersistPermission } from '../db/NotificationStatus';
import { listReminders, type LocalReminder } from '../db/RemindersRepository';
import { buildReminderNotificationText } from '../utils/reminderMessages';

const isAndroid = (): boolean => Capacitor.getPlatform() === 'android';
const REMINDER_CHANNEL_ID = 'reminders';

/** Android-only: ensure channel exists (no-op on iOS). */
async function ensureAndroidChannel(): Promise<void> {
  if (!isAndroid()) return;
  try {
    await LocalNotifications.createChannel({
      id: REMINDER_CHANNEL_ID,
      name: 'Reminders',
      description: 'Reminder notifications',
      importance: 4, // HIGH
      visibility: 1, // PUBLIC
      lights: true,
      vibration: true,
      sound: undefined, // set a filename in /res/raw for custom sound on Android
    });
  } catch (err) {
    
    console.warn('[Notifications] createChannel failed', err);
  }
}

/** Add channelId on Android; return unchanged on iOS. */
function addAndroidChannel(n: LocalNotificationSchema): LocalNotificationSchema {
  return isAndroid() ? { ...n, channelId: REMINDER_CHANNEL_ID } : n;
}

/** Compute the exact Date to fire a local notification for a reminder. */
function computeFireTime(rem: LocalReminder): Date | null {
  if (!rem.datetime) return null;
  const when = new Date(rem.datetime); // UTC ISO saved by your TZ math
  const ms = when.getTime() - (rem.advance_minutes || 0) * 60_000;
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

/** Schedule a single reminder (cancel first to avoid duplicates). */
async function scheduleOne(rem: LocalReminder): Promise<void> {
  const at = computeFireTime(rem);
  if (!at || !rem.enabled || rem.acknowledged_at) return;

  // Avoid scheduling in the past
  if (at.getTime() <= Date.now()) return;

  const id = rem.id;
  const text = buildReminderNotificationText({
    title: rem.title,
    reminderType: rem.reminder_type,
  });

  try {
    // Cancel any existing scheduled notification with the same id
    await LocalNotifications.cancel({ notifications: [{ id }] });

    const base: LocalNotificationSchema = {
      id,
      title: text.title,
      body: text.body,
      schedule: { at, allowWhileIdle: true },
      sound: 'default',
      extra: { type: rem.reminder_type ?? 'generic', rowId: rem.id, route: '/reminders' },
    };

    await LocalNotifications.schedule({
      notifications: [addAndroidChannel(base)],
    });
  } catch (err) {

    console.warn('[Notifications] scheduleOne failed', { id, title: rem.title }, err);
  }
}

/** Re-scan DB and schedule all eligible reminders. */
export async function rescheduleAllReminders(): Promise<void> {
  // Ensure we have permission before scheduling
  const status = await getNotificationStatus();
  if (status.permission !== 'granted') return;

  // Android-only: make sure channel exists
  await ensureAndroidChannel();

  const reminders = await listReminders();
  if (!reminders.length) return;

  await Promise.all(reminders.map(scheduleOne));
}

/** Sync OS permission → DB (and return effective permission). */
export async function syncNotificationPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  // This checks OS permission and persists it in settings
  const p = await checkAndPersistPermission();
  return p;
}

/** Optional: one-call bootstrap you can run at app start. */
export async function initNotifications(opts?: { actionTypes?: ActionType[] }): Promise<void> {
  // Sync permission first
  const perm = await syncNotificationPermission();
  if (perm !== 'granted') return;

  // Register action types (both platforms)
  if (opts?.actionTypes?.length) {
    try {
      await LocalNotifications.registerActionTypes({ types: opts.actionTypes });
    } catch (err) {
  
      console.warn('[Notifications] registerActionTypes failed', err);
    }
  }

  // Ensure Android channel, then schedule all
  await ensureAndroidChannel();
  await rescheduleAllReminders();
}
