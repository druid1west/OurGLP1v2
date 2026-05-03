// Single source of truth for timezone + injection-anchored weeks.
// No external libs; fully typed; DST-safe.

import { isoFromDatetimeLocalForTz } from '../utils/time';

// ============================================================================
// Backward-compatible wrapper (DO NOT REMOVE YET)
// ============================================================================

/**
 * @deprecated Use isoFromDatetimeLocalForTz from utils/time instead.
 * Kept for backward compatibility with existing callers.
 */
export function zonedLocalToUtcISO(
  year: number,
  month: number, // 1..12
  day: number,   // 1..31
  hour: number,
  minute: number,
  tz: string
): string {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  const h = String(hour).padStart(2, '0');
  const min = String(minute).padStart(2, '0');

  const isoLocal = `${y}-${m}-${d}T${h}:${min}`;
  const iso = isoFromDatetimeLocalForTz(isoLocal, tz);

  // Fallback should never hit, but keeps function total
  return (
    iso ??
    new Date(Date.UTC(year, month - 1, day, hour, minute)).toISOString()
  );
}

// ============================================================================
// Types
// ============================================================================

export type WeekdayShort = 'Sun' | 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat';
export type WeekdayFull =
  | 'Monday'
  | 'Tuesday'
  | 'Wednesday'
  | 'Thursday'
  | 'Friday'
  | 'Saturday'
  | 'Sunday';

export const SHORT_DAYS: Readonly<WeekdayShort[]> = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
] as const;

export const FULL_DAYS: Readonly<WeekdayFull[]> = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

// Map full weekday → JS Date index (Sunday = 0)
const FULL_TO_INDEX: Record<WeekdayFull, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

const INDEX_TO_SHORT: Record<number, WeekdayShort> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Rotates week labels to start from the given full weekday.
 * Example: rotateShortFromFull('Thursday')
 * → ['Thu','Fri','Sat','Sun','Mon','Tue','Wed']
 */
export function rotateShortFromFull(anchor: WeekdayFull): WeekdayShort[] {
  const start = FULL_TO_INDEX[anchor];
  return Array.from({ length: 7 }, (_, i) =>
    INDEX_TO_SHORT[(start + i) % 7]
  );
}

/**
 * Returns the UTC ISO range [start, end) for the anchored 7-day window
 * that contains `ref`.
 *
 * Anchor definition:
 * - Week starts on `injDay`
 * - At time `injHHMM`
 * - In user timezone `tz`
 *
 * If `ref` is on the anchor day but before the anchor time,
 * the previous week's anchor is used.
 */
export function getAnchoredWeek(
  ref: Date,
  injDay: WeekdayFull,
  injHHMM: string,
  tz: string
): { startUtc: string; endUtc: string } {
  const { h, m } = parseHHMM(injHHMM || '08:00');

  const refDow = localDow(ref, tz);
  const anchorDow = FULL_TO_INDEX[injDay];

  let daysBack = (7 + refDow - anchorDow) % 7;

  // If today is anchor day but before anchor time → previous week
  if (daysBack === 0) {
    const { H, M } = localHMS(ref, tz);
    if (H < h || (H === h && M < m)) {
      daysBack = 7;
    }
  }

  const anchorLocalDate = new Date(
    ref.getTime() - daysBack * 86_400_000
  );

  const { y, mo, d } = localYMD(anchorLocalDate, tz);

  const startUtc = zonedLocalToUtcISO(y, mo, d, h, m, tz);
  const endUtc = new Date(
    new Date(startUtc).getTime() + 7 * 86_400_000
  ).toISOString();

  return { startUtc, endUtc };
}

// ============================================================================
// Helpers
// ============================================================================

export function getDeviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function parseHHMM(hhmm: string): { h: number; m: number } {
  const [hStr, mStr] = hhmm.slice(0, 5).split(':');
  return {
    h: Number.isFinite(+hStr) ? Math.min(23, Math.max(0, +hStr)) : 8,
    m: Number.isFinite(+mStr) ? Math.min(59, Math.max(0, +mStr)) : 0,
  };
}

function localDow(d: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
  });
  const map: Record<WeekdayShort, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[fmt.format(d) as WeekdayShort];
}

function localYMD(d: Date, tz: string): { y: number; mo: number; d: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const p = partsToObj(fmt.formatToParts(d));
  return { y: +p.year, mo: +p.month, d: +p.day };
}

function localHMS(d: Date, tz: string): { H: number; M: number; S: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = partsToObj(fmt.formatToParts(d));
  return { H: +p.hour, M: +p.minute, S: +p.second };
}

function partsToObj(
  parts: Intl.DateTimeFormatPart[]
): Record<string, string> {
  return parts.reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
}