// utils/anchorWeek.ts
export type WeekdayName =
  'Monday'|'Tuesday'|'Wednesday'|'Thursday'|'Friday'|'Saturday'|'Sunday';

export function rotateWeek(start: WeekdayName): WeekdayName[] {
  const days: WeekdayName[] = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const i = days.indexOf(start);
  return i <= 0 ? days : [...days.slice(i), ...days.slice(0, i)];
}
export function shortLabel(d: WeekdayName) {
  return d.slice(0,3); // Mon, Tue, ...
}