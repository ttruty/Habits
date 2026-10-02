import { describe, expect, it } from 'vitest';
import { manualMatch } from '../connectors/manual';
import type { Source } from '../model';
import { event, habit } from '../scoring/test-helpers';
import { allDoneDays, dayProgress, habitsOnDay, kindOf, markDoneEvents, metaLine } from './today';

const today = '2026-10-01'; // Thursday
const manual: Source = { id: 'm', kind: 'manual', label: 'Manual', config: {}, createdAt: 'T' };
const now = new Date(2026, 9, 1, 9);

const workout = habit({ id: 'w', name: 'Workout' });
const listen = habit({
  id: 'l',
  name: 'Listen',
  match: { types: ['listening.day'] },
  rule: { aggregate: 'sum', atLeast: 1200 },
});
const read = habit({ id: 'r', name: 'Read', match: manualMatch('r', 'm') });
const gaming = habit({ id: 'g', match: { types: ['gaming'] }, rule: { aggregate: 'sum' } });
const limit = habit({
  id: 'x',
  match: { types: ['gaming'] },
  rule: { aggregate: 'sum', atMost: 3600 },
});

describe('habitsOnDay', () => {
  it('scores each habit on the day and says what its check does', () => {
    const events = [
      event(today), // a workout reported by a source
      event(today, { type: 'listening.day', value: 600, unit: 'seconds' }),
    ];
    const days = habitsOnDay(
      [workout, listen, read, gaming, limit],
      [manual],
      events,
      today,
      today,
    );
    expect(days.map((d) => [d.habit.id, d.kind, d.cell.done, d.check])).toEqual([
      ['w', 'goal', true, 'details'], // done by a source: the check shows the report
      ['l', 'goal', false, 'toggle'],
      ['r', 'goal', false, 'toggle'],
      ['g', 'metric', false, 'none'],
      ['x', 'limit', false, 'none'],
    ]);
  });

  it('finds the owner’s own entries for undo', () => {
    const own = event(today, {
      sourceId: 'm',
      type: 'check-in',
      externalId: 'r:2026-10-01',
      meta: { habit_id: 'r' },
    });
    const [d] = habitsOnDay([read], [manual], [own], today, today);
    expect(d).toMatchObject({ check: 'toggle' });
    expect(d.cell.done).toBe(true);
    expect(d.own).toHaveLength(1);
  });

  it('has no check for future days or before a habit starts', () => {
    const [future] = habitsOnDay([workout], [], [], '2026-10-02', today);
    expect(future.check).toBe('none');
    const [early] = habitsOnDay([habit({ startDate: '2026-10-01' })], [], [], '2026-09-30', today);
    expect(early.check).toBe('none');
  });
});

describe('progress and the week strip', () => {
  it('counts goal habits only', () => {
    const days = habitsOnDay([workout, listen, gaming], [], [event(today)], today, today);
    expect(dayProgress(days)).toEqual({ done: 1, total: 2 });
  });

  it('marks days where every goal habit was done', () => {
    const days = ['2026-09-28', '2026-09-29', '2026-09-30', today, '2026-10-02'];
    const events = [event('2026-09-28'), event('2026-09-30'), event(today), event('2026-10-02')];
    expect([...allDoneDays([workout], [], events, days, today)]).toEqual([
      '2026-09-28',
      '2026-09-30',
      today,
    ]);
    expect(allDoneDays([gaming], [], events, days, today).size).toBe(0);
  });
});

describe('metaLine', () => {
  it('describes frequency and streak, progress so far, limits and metrics', () => {
    const streak = ['2026-09-29', '2026-09-30'].map((d) => event(d));
    const line = (h: typeof workout, events = streak) =>
      metaLine(habitsOnDay([h], [], events, today, today)[0]);
    expect(line(workout)).toBe('Every day · 2-day streak');
    expect(line(habit({ target: { perWeek: 3 } }), [])).toBe('3× a week');
    expect(
      line(listen, [event(today, { type: 'listening.day', value: 480, unit: 'seconds' })]),
    ).toBe('Every day · 8m of 20m');
    expect(line(limit, [event(today, { type: 'gaming', value: 1200, unit: 'seconds' })])).toBe(
      'Up to 1h · 20m so far',
    );
    expect(line(gaming, [event(today, { type: 'gaming', value: 900, unit: 'seconds' })])).toBe(
      '15m today',
    );
    const weekly = habit({ target: { perWeek: 1 } });
    expect(
      line(
        weekly,
        ['2026-09-21', '2026-09-28'].map((d) => event(d)),
      ),
    ).toBe('1× a week · 2-week streak');
  });
});

describe('markDoneEvents', () => {
  const on = (h: typeof workout, events = [] as ReturnType<typeof event>[]) =>
    habitsOnDay([h], [manual], events, today, today)[0];

  it('checks in a hand-ticked habit', () => {
    const [e] = markDoneEvents(on(read), manual, today, today, now);
    expect(e).toMatchObject({
      type: 'check-in',
      externalId: 'r:2026-10-01',
      meta: { habit_id: 'r' },
    });
  });

  it('adds just the missing amount to an amount habit', () => {
    const d = on(listen, [event(today, { type: 'listening.day', value: 900, unit: 'seconds' })]);
    const [e] = markDoneEvents(d, manual, today, today, now);
    expect(e).toMatchObject({
      type: 'manual.entry',
      value: 300,
      unit: 'seconds',
      meta: { habit_id: 'l' },
    });
  });

  it('adds one entry per count still needed', () => {
    const twice = habit({ id: 't', rule: { aggregate: 'count', atLeast: 3 } });
    expect(markDoneEvents(on(twice, [event(today)]), manual, today, today, now)).toHaveLength(2);
    expect(markDoneEvents(on(workout), manual, today, today, now)).toHaveLength(1);
  });

  it('knows a habit’s kind', () => {
    expect([kindOf(workout), kindOf(limit), kindOf(gaming)]).toEqual(['goal', 'limit', 'metric']);
  });
});
