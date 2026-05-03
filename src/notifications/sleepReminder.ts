// ============================================================================
// File: src/notifications/sleepReminder.ts
// Desc: Daily "Bedtime" local notification based on user's HH:MM sleep prefs.
// Notes:
//  - Uses actionTypeId (Capacitor v5) instead of categoryId
//  - Strict typing for permission handling (PermissionStatus)
//  - Idempotent registration + scheduling
// ============================================================================

import { LocalNotifications } from '@capacitor/local-notifications';
import type { ScheduleOptions, PermissionStatus } from '@capacitor/local-notifications';
import { getSleepPrefs } from '../db/SleepRepository';

const SLEEP_REMINDER_ID = 90001;          // Keep stable across app runs
export const SLEEP_ACTION_TYPE = 'sleep'; // Action type for grouping / future actions

// 'display' is 'granted' | 'denied' | 'prompt' (optional in type, so narrow it)
type DisplayState = Exclude<PermissionStatus['display'], undefined>;

const parseHHMM = (hhmm: string): { hour: number; minute: number } => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) throw new Error(`Invalid HH:MM: "${hhmm}"`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
};

// Returns true only if local notification display permission is granted
export const ensureLocalNotificationPermissions = async (): Promise<boolean> => {
  const { display } = await LocalNotifications.checkPermissions(); // 'granted' | 'denied' | 'prompt' | undefined
  const state = (display ?? 'prompt') as DisplayState;
  if (state === 'granted') return true;

  const req = await LocalNotifications.requestPermissions();
  const reqState = (req.display ?? 'prompt') as DisplayState;
  return reqState === 'granted';
};

// Safe to call multiple times (idempotent per Capacitor)
export const registerSleepActionTypeIfNeeded = async (): Promise<void> => {
  await LocalNotifications.registerActionTypes({
    types: [
      {
        id: SLEEP_ACTION_TYPE,
        actions: [
          // Placeholder for future actions (e.g., Snooze)
        ],
      },
    ],
  });
};

export const cancelSleepReminder = async (): Promise<void> => {
  await LocalNotifications.cancel({ notifications: [{ id: SLEEP_REMINDER_ID }] });
};

export const scheduleSleepReminderIfSet = async (): Promise<void> => {
  const hasPerm = await ensureLocalNotificationPermissions();
  if (!hasPerm) {
    // No permission; skip silently
    return;
  }

  await registerSleepActionTypeIfNeeded();

  const prefs = await getSleepPrefs();
  const bedtime = prefs.bedtime; // "HH:MM" or null
  if (!bedtime) {
    await cancelSleepReminder();
    return;
  }

  const { hour, minute } = parseHHMM(bedtime);

  // Avoid duplicates: cancel any existing, then schedule fresh
  await cancelSleepReminder();

  const schedule: ScheduleOptions = {
    notifications: [
      {
        id: SLEEP_REMINDER_ID,
        title: 'Bedtime',
        body: 'It’s your scheduled sleep time 💡',
        schedule: {
          repeats: true,
          every: 'day',
          on: { hour, minute },
          allowWhileIdle: true,
        },
        // Android hints (safe to keep; no-op on iOS if absent):
        channelId: 'default',
        smallIcon: 'ic_stat_notification',
        actionTypeId: SLEEP_ACTION_TYPE, // correct field in Capacitor v5
        // Tag for your own filtering/badges:
        extra: { type: 'sleep' },
      },
    ],
  };

  await LocalNotifications.schedule(schedule);
};

