import { describe, expect, it } from 'vitest';
import { scoreHabit } from './score';
import { event, habit, on } from './test-helpers';
import { weekProgress } from './week';

const week = { from: '2026-09-28', to: '2026-10-04' };
const today = '2026-10-01';

describe('weekProgress', () => {
  it('counts done days against the weekly target', () => {
    const h = habit({ target: { perWeek: 3 } });
    const cells = scoreHabit(h, on(['2026-09-28', '2026-09-30', today]), week, today);
    expect(weekProgress(h, cells, week.from, today)).toEqual({
      from: week.from,
      done: 3,
      target: 3,
      total: 3,
      met: true,
      open: true,
    });
  });

  it('is closed once the week is over', () => {
    const h = habit();
    const cells = scoreHabit(h, [], week, '2026-10-05');
    expect(weekProgress(h, cells, week.from, '2026-10-05')).toMatchObject({
      done: 0,
      target: 7,
      met: false,
      open: false,
    });
  });

  it('lowers the target for a habit started mid-week', () => {
    // Started Thursday: only 4 days left this week.
    const daily = habit({ startDate: today });
    const cells = scoreHabit(daily, on([today]), week, today);
    expect(weekProgress(daily, cells, week.from, today).target).toBe(4);

    // A 3×/week habit started Thursday still needs 3.
    const thrice = habit({ startDate: today, target: { perWeek: 3 } });
    expect(weekProgress(thrice, cells, week.from, today).target).toBe(3);

    // Started Saturday: 2 days left, so 3×/week becomes 2.
    const late = habit({ startDate: '2026-10-03', target: { perWeek: 3 } });
    expect(weekProgress(late, cells, week.from, today).target).toBe(2);
  });

  it('has no target before the habit started, and so is never met', () => {
    const h = habit({ startDate: '2026-10-05' });
    const cells = scoreHabit(h, [], week, today);
    expect(weekProgress(h, cells, week.from, today)).toMatchObject({ target: 0, met: false });
  });

  it('totals values for metric habits', () => {
    const h = habit({ match: { types: ['gaming.session'] }, rule: { aggregate: 'sum' } });
    const events = [
      event('2026-09-28', { type: 'gaming.session', value: 600 }),
      event('2026-09-30', { type: 'gaming.session', value: 900 }),
    ];
    const cells = scoreHabit(h, events, week, today);
    expect(weekProgress(h, cells, week.from, today)).toMatchObject({ done: 0, total: 1500 });
  });

  it('treats days missing from the cells as not done', () => {
    const h = habit();
    const cells = scoreHabit(
      h,
      on(['2026-09-28', '2026-09-29']),
      { from: '2026-09-28', to: '2026-09-28' },
      today,
    );
    expect(weekProgress(h, cells, week.from, today).done).toBe(1);
  });
});
