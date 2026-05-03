// -----------------------------------------------------------------------------
// GLP-1 medication effectiveness helpers
// Pure, deterministic, UI-agnostic
// -----------------------------------------------------------------------------

import {
  getAnchoredWeek,
  type WeekdayFull,
} from '../lib/time';

// -----------------------------------------------------------------------------
// Core model
// -----------------------------------------------------------------------------

/**
 * Compute estimated GLP-1 medication activity (0 → 1)
 * based on the user's *anchored* weekly injection schedule.
 *
 * Anchor definition:
 * - Week starts on injection day
 * - At injection time
 * - In user's timezone
 *
 * This is NOT a medical measurement.
 * It is a linear decay model for visualization & journaling context.
 */
export function computeGlp1Activity(params: {
  injectionDay?: string;   // 'Mon' | 'Tue' | ...
  injectionTime?: string;  // 'HH:MM'
  timezone?: string;
  now?: Date;              // optional override (tests / charts)
}): number {
  const {
    injectionDay,
    injectionTime,
    timezone,
    now = new Date(),
  } = params;

  if (!injectionDay || !injectionTime || !timezone) return 0;

  // Normalize short → full weekday
  const dayMap: Record<string, WeekdayFull> = {
    Sun: 'Sunday',
    Mon: 'Monday',
    Tue: 'Tuesday',
    Wed: 'Wednesday',
    Thu: 'Thursday',
    Fri: 'Friday',
    Sat: 'Saturday',
  };

  const fullDay = dayMap[injectionDay];
  if (!fullDay) return 0;

  try {
    // Anchored week that CONTAINS `now`
    const { startUtc } = getAnchoredWeek(
      now,
      fullDay,
      injectionTime,
      timezone
    );

    const start = Date.parse(startUtc);
    const current = now.getTime();

    if (!Number.isFinite(start) || current <= start) return 1;

    const elapsedDays =
      (current - start) / (1000 * 60 * 60 * 24);

    // 7-day linear decay
    return clamp01(1 - elapsedDays / 7);
  } catch {
    return 0;
  }
}

// -----------------------------------------------------------------------------
// Formatting helpers
// -----------------------------------------------------------------------------

/**
 * Convert activity ratio (0 → 1) into a rounded percentage (0 → 100)
 */
export function glp1ActivityToPercent(activity: number): number {
  if (!Number.isFinite(activity)) return 0;
  return Math.round(clamp01(activity) * 100);
}

/**
 * Bucket a percentage into a CSS-safe progress class
 *
 * Example: 67 → "p65"
 */
export function glp1PercentToBucket(pct: number): string {
  if (!Number.isFinite(pct)) return 'p0';
  const clamped = Math.max(0, Math.min(100, pct));
  return `p${Math.round(clamped / 5) * 5}`;
}

// -----------------------------------------------------------------------------
// Utils
// -----------------------------------------------------------------------------

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}