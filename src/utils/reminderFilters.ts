// src/utils/reminderFilters.ts
import type { Reminder } from '../context/ReminderBadgeContext';

export function isActivePush(rem: Reminder) {
  const future = new Date(rem.datetime).getTime() >= Date.now();
  const enabled = rem.enabled !== false;
  const pushSelected = Array.isArray(rem.method) && rem.method.includes('push');
  return enabled && future && pushSelected;
}