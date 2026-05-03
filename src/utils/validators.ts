// src/utils/validators.ts
export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;
export const has = (o: Record<string, unknown>, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

// Dates/times
export const isHHMM = (s: string) => /^\d{2}:\d{2}$/.test(s);
export const toHHMMSS = (t: string) => (t.length === 5 ? `${t}:00` : t);
export const snapToQuarter = (hhmm: string) => {
  const [H, M] = hhmm.split(':').map(n => parseInt(n, 10));
  const total = H * 60 + M;
  const snapped = Math.round(total / 15) * 15;
  const hh = String(Math.floor(snapped / 60)).padStart(2,'0');
  const mm = String(snapped % 60).padStart(2,'0');
  return `${hh}:${mm}`;
};

// Local datetime ("YYYY-MM-DDTHH:MM") -> ISO with offset using browser tz
export const localToISOWithOffset = (local: string) => {
  // safe for <input type="datetime-local">
  const d = new Date(local.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d.toISOString();
};

// Numbers
export const toInt = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isInteger(n) ? n : null;
};
export const clampInt = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Math.round(n)));

// ---- Domain checks (no `any`) ---------------------------------------------

// A precise DayShort union that you can reuse elsewhere
export const DAY_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] as const;
export type DayShort = typeof DAY_SHORT[number];

export const isDayShort = (s: string): s is DayShort =>
  (DAY_SHORT as readonly string[]).includes(s);

// Extend the Intl type (locally) to include the stage-3 API if present
type IntlWithSupportedValuesOf = typeof Intl & {
  supportedValuesOf?: (key: 'timeZone') => string[];
};

export const isIanaTz = (tz: string): boolean => {
  const intl = Intl as IntlWithSupportedValuesOf;
  try {
    // Prefer the standardized API if the runtime provides it
    if (typeof intl.supportedValuesOf === 'function') {
      const zones = intl.supportedValuesOf('timeZone');
      return Array.isArray(zones) ? zones.includes(tz) : false;
    }
    // Fallback: will throw if `tz` is not a valid IANA zone
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
