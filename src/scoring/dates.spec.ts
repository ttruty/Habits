import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  dayNumber,
  diffDays,
  eachDay,
  fromDayNumber,
  inRange,
  localDateKey,
  monthRange,
  startOfWeek,
  toLocalNoon,
  weekRange,
  weekday,
} from './dates';

// Vitest runs with TZ=America/Chicago (see vite.config.ts), so DST is real here.

describe('localDateKey', () => {
  it('uses the runtime zone by default', () => {
    // 03:30 UTC on 1 Oct is still 30 Sep in Chicago.
    expect(localDateKey(new Date('2026-10-01T03:30:00Z'))).toBe('2026-09-30');
  });

  it('uses the given IANA zone', () => {
    const instant = new Date('2026-10-01T03:30:00Z');
    expect(localDateKey(instant, 'Europe/Berlin')).toBe('2026-10-01');
    expect(localDateKey(instant, 'America/Los_Angeles')).toBe('2026-09-30');
  });
});

describe('day numbers', () => {
  it('round-trips', () => {
    expect(dayNumber('1970-01-01')).toBe(0);
    expect(fromDayNumber(dayNumber('2026-10-01'))).toBe('2026-10-01');
  });

  it('steps one day across DST weekends, both ways', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08'); // US spring forward on the 8th
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02'); // US fall back on 1 Nov
    expect(addDays('2026-11-02', -1)).toBe('2026-11-01');
    expect(diffDays('2026-03-01', '2026-03-15')).toBe(14);
    expect(diffDays('2026-11-08', '2026-10-25')).toBe(-14);
  });

  it('crosses months, years and leap days', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });
});

describe('weeks', () => {
  it('knows the weekday', () => {
    expect(weekday('2026-10-01')).toBe(4); // Thursday
    expect(weekday('1969-12-28')).toBe(0); // Sunday, before day 0
  });

  it('starts weeks on Monday by default', () => {
    expect(startOfWeek('2026-10-01')).toBe('2026-09-28');
    expect(startOfWeek('2026-09-28')).toBe('2026-09-28');
    expect(startOfWeek('2026-10-04')).toBe('2026-09-28'); // Sunday belongs to the week before
  });

  it('can start weeks on another day', () => {
    expect(startOfWeek('2026-10-01', 0)).toBe('2026-09-27');
    expect(startOfWeek('2026-10-04', 0)).toBe('2026-10-04');
    expect(startOfWeek('2026-10-01', 6)).toBe('2026-09-26');
  });

  it('builds a week range across DST', () => {
    expect(weekRange('2026-11-01')).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    expect(eachDay(weekRange('2026-03-08'))).toHaveLength(7);
  });
});

describe('months', () => {
  it('builds month ranges', () => {
    expect(monthRange('2026-02-14')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2028-02-01')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange('2026-12-31')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('adds months, clamping the day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });
});

describe('ranges', () => {
  it('lists days inclusively', () => {
    expect(eachDay({ from: '2026-09-29', to: '2026-10-01' })).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
    ]);
    expect(eachDay({ from: '2026-10-02', to: '2026-10-01' })).toEqual([]);
  });

  it('checks membership inclusively', () => {
    const r = { from: '2026-09-28', to: '2026-10-04' };
    expect(inRange('2026-09-28', r)).toBe(true);
    expect(inRange('2026-10-04', r)).toBe(true);
    expect(inRange('2026-10-05', r)).toBe(false);
  });

  it('makes a local-noon Date for formatting', () => {
    const d = toLocalNoon('2026-03-08');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 2, 8, 12]);
  });
});
