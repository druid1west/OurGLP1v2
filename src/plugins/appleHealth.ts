import { Capacitor, registerPlugin } from '@capacitor/core';

export type AppleHealthDailySummary = {
  day: string;
  steps: number;
  activeEnergyKcal: number;
  exerciseMinutes: number;
  sleepMinutes: number;
  restingHeartRate: number | null;
  averageHeartRate: number | null;
  latestHeartRate: number | null;
  workouts: number;
};

export type AppleHealthWorkout = {
  id: string;
  workoutType: string;
  startDate: string;
  endDate: string;
  durationMinutes: number;
  caloriesKcal: number | null;
};

type AppleHealthPlugin = {
  isAvailable(): Promise<{ available: boolean }>;
  requestAuthorization(): Promise<{ granted: boolean }>;
  getDailySummary(options: { day: string }): Promise<AppleHealthDailySummary>;
  getWorkouts(options: { day: string }): Promise<{ workouts: AppleHealthWorkout[] }>;
};

export const AppleHealth = registerPlugin<AppleHealthPlugin>('AppleHealth');

export function isAppleHealthSupportedPlatform(): boolean {
  return Capacitor.getPlatform() === 'ios';
}
