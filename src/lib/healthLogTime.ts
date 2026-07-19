export function localYmd(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function timeInputValue(date = new Date()): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function timeFromRecordedAt(recordedAt: string): string {
  const date = new Date(recordedAt);
  return Number.isNaN(date.getTime()) ? '' : timeInputValue(date);
}

export function displayTimeFromRecordedAt(recordedAt: string): string {
  const date = new Date(recordedAt);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function displayDateFromRecordedAt(recordedAt: string): string {
  const date = new Date(recordedAt);
  if (Number.isNaN(date.getTime())) return 'this entry';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
}

export function maxTimeForRecordedAt(recordedAt: string, now = new Date()): string | undefined {
  const recordedDate = new Date(recordedAt);
  if (Number.isNaN(recordedDate.getTime())) return undefined;
  return localYmd(recordedDate) === localYmd(now) ? timeInputValue(now) : undefined;
}

export function recordedAtWithTime(
  recordedAt: string,
  time: string,
  now = new Date(),
): { ok: true; value: string } | { ok: false; message: string } {
  const original = new Date(recordedAt);
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (Number.isNaN(original.getTime()) || !match) {
    return { ok: false, message: 'Please choose a valid time.' };
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return { ok: false, message: 'Please choose a valid time.' };
  }

  const originalDay = localYmd(original);
  const changed = new Date(original);
  changed.setHours(hours, minutes, 0, 0);

  if (localYmd(changed) !== originalDay) {
    return { ok: false, message: 'The entry date cannot be changed.' };
  }

  if (originalDay === localYmd(now) && changed.getTime() > now.getTime()) {
    return { ok: false, message: 'The entry time cannot be in the future.' };
  }

  return { ok: true, value: changed.toISOString() };
}
