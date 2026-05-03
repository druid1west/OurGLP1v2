// src/celebration/celebrationConfig.ts
import type { CelebrationMetric } from '../types/celebration';

export type DailyGoalType = 'grams' | 'ml' | 'minutes' | 'kcal' | 'hours' | 'adherence';

export interface MetricGoalConfig {
  metric: CelebrationMetric;

  // Friendly labels for UI
  friendlyName: string;
  unitLabel: string | null;          // e.g. "g", "ml", "min", "h", or null for adherence

  // How we interpret the daily value
  dailyGoalType: DailyGoalType;
  dailyGoalValue: number | null;     // null for pure adherence goals

  // Toggle daily-total celebrations for this metric
  enableDailyTotal: boolean;

  // Single-entry thresholds (e.g. 35g protein in one go)
  singleEntryThreshold: number | null;
  enableSingleEntry: boolean;
}

// 🎯 All the numbers you’ll tweak live here
const METRIC_GOAL_CONFIG: Record<CelebrationMetric, MetricGoalConfig> = {
  protein: {
    metric: 'protein',
    friendlyName: 'Protein',
    unitLabel: 'g',
    dailyGoalType: 'grams',
    // ✅ DAILY PROTEIN GOAL (default)
    dailyGoalValue: 70,
    enableDailyTotal: true,
    // ✅ SINGLE ENTRY PROTEIN HIT (e.g. 35g in one go)
    singleEntryThreshold: 35,
    enableSingleEntry: true,
  },

  hydration: {
    metric: 'hydration',
    friendlyName: 'Hydration',
    unitLabel: 'ml',
    dailyGoalType: 'ml',
    // ✅ DAILY HYDRATION GOAL (default)
    dailyGoalValue: 2000, // 2 litres
    enableDailyTotal: true,
    // ✅ SINGLE GLASS / BOTTLE MILESTONE
    singleEntryThreshold: 500,
    enableSingleEntry: true,
  },

  exercise: {
    metric: 'exercise',
    friendlyName: 'Exercise',
    unitLabel: 'min',
    dailyGoalType: 'minutes',
    // ✅ DAILY EXERCISE GOAL (we’ll hook this later)
    dailyGoalValue: 30,
    enableDailyTotal: true,
    singleEntryThreshold: 30,
    enableSingleEntry: true,
  },

  sleep: {
    metric: 'sleep',
    friendlyName: 'Sleep',
    unitLabel: 'h',
    dailyGoalType: 'hours',
    // ✅ NIGHTLY SLEEP GOAL
    dailyGoalValue: 7,
    enableDailyTotal: true,
    singleEntryThreshold: 7,  // single sleep of >=7h
    enableSingleEntry: true,
  },

  fasting: {
    metric: 'fasting',
    friendlyName: 'Fasting',
    unitLabel: null,
    dailyGoalType: 'adherence',
    // ✅ Fasting is adherence-based (no numeric target here)
    dailyGoalValue: null,
    enableDailyTotal: true,   // "adherence" celebration
    singleEntryThreshold: null,
    enableSingleEntry: false,
  },
  bowel: {
    metric: 'bowel',
    friendlyName: 'Bowel movement',
    unitLabel: null,              // we’ll just say “You logged X for {date}”
    dailyGoalType: 'adherence',   // doesn’t really matter since we won’t use daily totals
    dailyGoalValue: null,
    enableDailyTotal: false,      // no daily total celebrations (optional)
    // Single-entry: celebrate each log (or at least first per day)
    singleEntryThreshold: 1,      // treat each log as "1 poop"
    enableSingleEntry: true,
  },

};

export function getMetricConfig(metric: CelebrationMetric): MetricGoalConfig {
  return METRIC_GOAL_CONFIG[metric];
}

export function getDailyGoal(metric: CelebrationMetric): number | null {
  const cfg = METRIC_GOAL_CONFIG[metric];
  return cfg.dailyGoalValue;
}


export function getSingleEntryThreshold(metric: CelebrationMetric): number | null {
  const cfg = METRIC_GOAL_CONFIG[metric];
  return cfg.singleEntryThreshold;
}
