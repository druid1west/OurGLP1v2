import type { Glp1GraphPoint } from '../db/EffectivenessRepository';

type ShortDay = 'Sun' | 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat';

const DAY_MAP: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const DAY_LABELS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function toShortDay(day?: string | null): ShortDay | null {
  const normalized = day?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith('sun')) return 'Sun';
  if (normalized.startsWith('mon')) return 'Mon';
  if (normalized.startsWith('tue')) return 'Tue';
  if (normalized.startsWith('wed')) return 'Wed';
  if (normalized.startsWith('thu')) return 'Thu';
  if (normalized.startsWith('fri')) return 'Fri';
  if (normalized.startsWith('sat')) return 'Sat';
  return null;
}

export function getGlp1TrendAnchorDate(
  injectionDay: string | null | undefined,
  timezone: string
): Date {
  const now = new Date();
  const targetDay = DAY_MAP[toShortDay(injectionDay)?.toLowerCase() ?? 'mon'] ?? 1;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  });
  const currentDay = DAY_LABELS[fmt.format(now)] ?? 0;

  let daysBack = currentDay - targetDay;
  if (daysBack < 0) daysBack += 7;

  const anchor = new Date(now);
  anchor.setDate(anchor.getDate() - daysBack);
  anchor.setHours(0, 0, 0, 0);
  return anchor;
}

export function getGlp1VisibleWeekPoints(
  points: Glp1GraphPoint[],
  injectionDay: string | null | undefined,
  timezone: string
): Glp1GraphPoint[] {
  const anchorDate = getGlp1TrendAnchorDate(injectionDay, timezone);
  const minTime = anchorDate.getTime();
  const maxTime = minTime + 7 * 24 * 60 * 60 * 1000;

  return points
    .filter((point) => {
      const time = new Date(point.recordedAt).getTime();
      return time >= minTime && time <= maxTime;
    })
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
}
