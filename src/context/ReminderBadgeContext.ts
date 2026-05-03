import React, { createContext, useContext } from 'react';

export interface Reminder {
  id: string;
  title: string;
  datetime: string; // ISO date
  enabled?: boolean;
  method?: string[]; // ✅ add this so .method is allowed
  reminder_type?: string;
  day_of_week?: string;
}

export interface ReminderBadgeContextValue {
  count: number;
  setCount: React.Dispatch<React.SetStateAction<number>>;
  refreshCount: () => Promise<void>;
}

export const ReminderBadgeContext =
  createContext<ReminderBadgeContextValue | undefined>(undefined);

export function useReminderBadge() {
  const ctx = useContext(ReminderBadgeContext);
  if (!ctx) {
    throw new Error('useReminderBadge must be used within ReminderBadgeProvider');
  }
  return ctx;
}