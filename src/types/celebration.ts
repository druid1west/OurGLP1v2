// src/types/celebration.ts
export type CelebrationMetric =
  | 'protein'
  | 'hydration'
  | 'exercise'
  | 'sleep'
  | 'fasting'
  | 'bowel'
  | 'weight';


export type CelebrationKind =
  | 'single_entry'  // one log is big enough (e.g. 35g protein)
  | 'daily_total'   // daily total reached (e.g. 70g protein in a day)
  | 'adherence';    // plan followed (e.g. fasting / sleep schedule)

export interface CelebrationContext {
  metric: CelebrationMetric;
  kind: CelebrationKind;
  dateYmd: string;          // local date, e.g. "2025-11-19"
  value: number | null;     // actual value, e.g. 80, 2100, 7.5
  goal: number | null;      // target, e.g. 70, 2000, 7
}
