import type { DateKey, DateRange } from '../model';

// Day maths works on calendar-day numbers (days since 1970-01-01 via Date.UTC), never on
// wall-clock milliseconds, so DST changes can't shift or skip a day.

/** 0 = Sunday … 6 = Saturday, as in Date#getDay. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** The local day of `date`: in `timeZone` (an IANA name) if given, else in the runtime's zone. */
export function localDateKey(date: Date, timeZone?: string): DateKey {
  if (!timeZone) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function dayNumber(key: DateKey): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromDayNumber(n: number): DateKey {
  const date = new Date(n * DAY_MS);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addDays(key: DateKey, days: number): DateKey {
  return fromDayNumber(dayNumber(key) + days);
}

/** Whole days from `a` to `b` (negative if `b` is earlier). */
export function diffDays(a: DateKey, b: DateKey): number {
  return dayNumber(b) - dayNumber(a);
}

export function weekday(key: DateKey): Weekday {
  // Day 0 (1970-01-01) was a Thursday.
  return ((((dayNumber(key) + 4) % 7) + 7) % 7) as Weekday;
}

/** The first day of the week containing `key`. Weeks start on Monday unless told otherwise. */
export function startOfWeek(key: DateKey, weekStartsOn: Weekday = 1): DateKey {
  return addDays(key, -((weekday(key) - weekStartsOn + 7) % 7));
}

export function weekRange(key: DateKey, weekStartsOn: Weekday = 1): DateRange {
  const from = startOfWeek(key, weekStartsOn);
  return { from, to: addDays(from, 6) };
}

export function monthRange(key: DateKey): DateRange {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}

/** Same day-of-month `months` months away, clamped to the target month's length. */
export function addMonths(key: DateKey, months: number): DateKey {
  const [y, m, d] = key.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const ty = first.getUTCFullYear();
  const tm = first.getUTCMonth() + 1;
  const last = monthRange(`${ty}-${pad(tm)}-01`).to;
  return `${ty}-${pad(tm)}-${pad(Math.min(d, Number(last.slice(8))))}`;
}

/** Every day in the range, in order. Empty if `to` is before `from`. */
export function eachDay({ from, to }: DateRange): DateKey[] {
  const out: DateKey[] = [];
  for (let n = dayNumber(from), end = dayNumber(to); n <= end; n++) out.push(fromDayNumber(n));
  return out;
}

export function inRange(key: DateKey, { from, to }: DateRange): boolean {
  return key >= from && key <= to;
}

/** A Date at local noon on `key`, for formatting with Intl (noon dodges DST edge hours). */
export function toLocalNoon(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}
