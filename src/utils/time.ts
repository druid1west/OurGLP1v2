// src/utils/time.ts

type PartType = Intl.DateTimeFormatPart['type'];

function getTzParts(d: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = fmt.formatToParts(d);
  const n = (t: PartType) =>
    Number(parts.find((p) => p.type === t)?.value ?? '0');
  const wd = (parts.find((p) => p.type === 'weekday')?.value || 'Sun').slice(0, 3);
  const wmap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    year: n('year'),
    month: n('month'),
    day: n('day'),
    hour: n('hour'),
    minute: n('minute'),
    second: n('second'),
    weekday: wmap[wd] ?? 0,
  };
}

function tzLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const base = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const p = getTzParts(base, tz);
  const want = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
  const diffMs = seen - want;
  return new Date(base.getTime() - diffMs);
}

// From <input type="datetime-local"> + user tz → UTC ISO
export function isoFromDatetimeLocalForTz(
  dtLocal: string,
  tz: string,
): string | null {
  if (!dtLocal) return null;
  const [date, time] = dtLocal.split('T');
  if (!date || !time) return null;
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return tzLocalToUtc(y, m, d, hh, mm, tz).toISOString();
}