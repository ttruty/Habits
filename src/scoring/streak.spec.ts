import { describe, expect, it } from 'vitest';
import { addDays, eachDay } from './dates';
import { scoreHabit } from './score';
import { currentStreak } from './streak';
import { habit, on } from './test-helpers';

const today = '2026-10-01'; // Thursday
const history = { from: '2026-06-01', to: today };

function streak(h: ReturnType<typeof habit>, days: string[], t = today, weekStartsOn?: 0 | 1) {
  const cells = scoreHabit(h, on(days), { from: history.from, to: t }, t);
  return currentStreak(h, cells, t, weekStartsOn);
}

describe('daily streaks', () => {
  const daily = habit();

  it('counts consecutive done days ending today', () => {
    expect(streak(daily, ['2026-09-29', '2026-09-30', today])).toEqual({ count: 3, unit: 'days' });
  });

  it('keeps the streak while today is still open', () => {
    expect(streak(daily, ['2026-09-29', '2026-09-30'])).toEqual({ count: 2, unit: 'days' });
  });

  it('is zero after a missed day', () => {
    expect(streak(daily, ['2026-09-28', '2026-09-29'])).toEqual({ count: 0, unit: 'days' });
  });

  it('runs straight through a DST weekend', () => {
    const days = eachDay({ from: '2026-10-28', to: '2026-11-03' });
    expect(streak(daily, days, '2026-11-03')?.count).toBe(7);
  });

  it('stops at the start date', () => {
    const h = habit({ startDate: '2026-09-30' });
    expect(streak(h, ['2026-09-29', '2026-09-30', today])?.count).toBe(2);
  });

  it('keeps the streak through today for a limit habit that is under so far', () => {
    const limit = habit({ rule: { aggregate: 'count', atMost: 1 } });
    // No events at all: every past day is under the limit, today is pending.
    expect(streak(limit, [], '2026-06-03')?.count).toBe(2);
  });
});

describe('weekly streaks', () => {
  const thrice = habit({ target: { perWeek: 3 } });
  // Weeks start Monday: …, 14 Sep, 21 Sep, 28 Sep (current).
  const metWeek = (monday: string) => [monday, addDays(monday, 2), addDays(monday, 4)];

  it('counts consecutive weeks that met the target', () => {
    const days = [...metWeek('2026-09-14'), ...metWeek('2026-09-21')];
    expect(streak(thrice, days)).toEqual({ count: 2, unit: 'weeks' });
  });

  it('adds the current week once it is met', () => {
    const days = [...metWeek('2026-09-21'), '2026-09-28', '2026-09-29', today];
    expect(streak(thrice, days)?.count).toBe(2);
  });

  it('never breaks on the open current week', () => {
    const days = [...metWeek('2026-09-14'), ...metWeek('2026-09-21')];
    expect(streak(thrice, days, '2026-09-28')?.count).toBe(2); // Monday, nothing yet
  });

  it('breaks on a closed week that fell short', () => {
    const days = [...metWeek('2026-09-07'), '2026-09-14', ...metWeek('2026-09-21')];
    expect(streak(thrice, days)?.count).toBe(1);
  });

  it('counts a short first week at its lowered target', () => {
    // Started Saturday 19 Sep: that week needed only 2.
    const h = habit({ target: { perWeek: 3 }, startDate: '2026-09-19' });
    const days = ['2026-09-19', '2026-09-20', ...metWeek('2026-09-21')];
    expect(streak(h, days)?.count).toBe(2);
  });

  it('follows the configured week start', () => {
    // Sunday-start weeks: 20–26 Sep has three, 27 Sep – 3 Oct is current.
    const days = ['2026-09-20', '2026-09-22', '2026-09-26'];
    expect(streak(thrice, days, today, 0)?.count).toBe(1);
    // Monday-start: the same days split 2 + 1 across two weeks, so neither met.
    expect(streak(thrice, days, today, 1)?.count).toBe(0);
  });
});

it('has no streak for metric habits', () => {
  const metric = habit({ rule: { aggregate: 'sum' } });
  expect(streak(metric, [today])).toBeNull();
});
