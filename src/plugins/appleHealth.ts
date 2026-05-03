import { Capacitor, registerPlugin } from '@capacitor/core';

export type AppleHealthDailySummary = {
  day: string;
  steps: number;
  activeEnergyKcal: number;
  exerciseMinutes: number;
  sleepMinutes: number;
  restingHeartRate: number | null;
  workouts: number;
};

type AppleHealthPlugin = {
  isAvailable(): Promise<{ available: boolean }>;
  requestAuthorization(): Promise<{ granted: boolean }>;
  getDailySummary(options: { day: string }): Promise<AppleHealthDailySummary>;
};

export const AppleHealth = registerPlugin<AppleHealthPlugin>('AppleHealth');

export function isAppleHealthSupportedPlatform(): boolean {
  return Capacitor.getPlatform() === 'ios';
}
