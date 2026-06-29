// src/lib/nutrition.ts
export type NutritionRange = { min: number; max: number };
export type ProteinRange = NutritionRange;

/** 1.6-2.2 g protein per kg body weight. */
export function computeProteinRange(weightKg: number): ProteinRange | null {
  const w = Number(weightKg);
  if (!Number.isFinite(w) || w <= 0) return null;
  const min = Math.round(Math.max(0, w * 1.6));
  const max = Math.round(Math.max(min, w * 2.2));
  return { min, max };
}

export function computeFatRange(weightKg: number): NutritionRange | null {
  const w = Number(weightKg);
  if (!Number.isFinite(w) || w <= 0) return null;
  const min = Math.round(Math.max(0, w * 0.6));
  const max = Math.round(Math.max(min, w * 1.0));
  return { min, max };
}

export function computeCalorieRange(weightKg: number): NutritionRange | null {
  const w = Number(weightKg);
  if (!Number.isFinite(w) || w <= 0) return null;
  const min = Math.round(Math.max(0, w * 25));
  const max = Math.round(Math.max(min, w * 35));
  return { min, max };
}

export function computeCarbRange(): NutritionRange {
  return { min: 50, max: 150 };
}

// Hydration (mL/day)
export type HydrationRange = { min: number; max: number };

/**
 * 35–40 mL fluid per kg body weight (daily).
 * Returns integers in milliliters.
 */
export function computeHydrationRange(weightKg: number): HydrationRange | null {
  const w = Number(weightKg);
  if (!Number.isFinite(w) || w <= 0) return null;
  const min = Math.round(w * 35);
  const max = Math.round(Math.max(min, w * 40));
  return { min, max };
}

// ---------------------------------------------------------------------------
// Sleep helpers / recommended bands
// ---------------------------------------------------------------------------
export type SleepColor = 'green' | 'yellow' | 'red';

/** Official adult recommendation: prefer 7–9 hours per night. */
export const SLEEP_RECOMMENDED = { min: 7, max: 9 };

/**
 * Return a simple color code for an average nightly sleep duration (hours).
 * Logic (adult-focused):
 *  green: 7.0–9.0 (recommended)
 *  yellow: 6.0–6.9 OR 9.1–10.0 (borderline / watch)
 *  red: < 6.0 OR > 10.0
 */
export function getSleepColor(avgHours: number): SleepColor {
  if (!Number.isFinite(avgHours)) return 'red';
  if (avgHours >= SLEEP_RECOMMENDED.min && avgHours <= SLEEP_RECOMMENDED.max) return 'green';
  if ((avgHours >= 6.0 && avgHours < SLEEP_RECOMMENDED.min) ||
      (avgHours > SLEEP_RECOMMENDED.max && avgHours <= 10.0)) {
    return 'yellow';
  }
  return 'red';
}
