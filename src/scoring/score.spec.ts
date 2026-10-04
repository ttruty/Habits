import { describe, expect, it } from 'vitest';
import { MANUAL_ENTRY, countsFor, dedupe, matches, scoreHabit } from './score';
import { event, habit, on } from './test-helpers';

const week = { from: '2026-09-28', to: '2026-10-04' };
const today = '2026-10-01'; // Thursday
const states = (cells: { state: string }[]) => cells.map((c) => c.state);

describe('scoreHabit', () => {
  it('marks done, missed, pending and future days', () => {
    const cells = scoreHabit(habit(), on(['2026-09-28', '2026-09-30']), week, today);
    expect(states(cells)).toEqual([
      'done',
      'missed',
      'done',
      'pending', // today, nothing yet
      'future',
      'future',
      'future',
    ]);
    expect(cells.map((c) => c.done)).toEqual([true, false, true, false, false, false, false]);
  });

  it('marks today done once the goal is reached', () => {
    const [cell] = scoreHabit(habit(), on([today]), { from: today, to: today }, today);
    expect(cell).toEqual({ date: today, value: 1, state: 'done', done: true });
  });

  it('counts events per day', () => {
    const h = habit({ rule: { aggregate: 'count', atLeast: 2 } });
    const cells = scoreHabit(h, on(['2026-09-28', '2026-09-29', '2026-09-29']), week, today);
    expect(cells.slice(0, 2).map((c) => [c.value, c.state])).toEqual([
      [1, 'missed'],
      [2, 'done'],
    ]);
  });

  it('sums values against a threshold, at the boundary', () => {
    const h = habit({
      match: { types: ['listening.day'] },
      rule: { aggregate: 'sum', atLeast: 1200 },
    });
    const events = [
      event('2026-09-28', { type: 'listening.day', value: 1199, unit: 'seconds' }),
      event('2026-09-29', { type: 'listening.day', value: 1200, unit: 'seconds' }),
      event('2026-09-30', { type: 'listening.day', value: 600 }),
      event('2026-09-30', { type: 'listening.day', value: 700 }),
      event('2026-10-01', { type: 'listening.day' }), // no value counts as 0
    ];
    const cells = scoreHabit(h, events, week, today);
    expect(cells.slice(0, 4).map((c) => [c.value, c.state])).toEqual([
      [1199, 'missed'],
      [1200, 'done'],
      [1300, 'done'],
      [0, 'pending'],
    ]);
  });

  it('re-scores history when the goal changes', () => {
    const events = [event('2026-09-28', { type: 'listening.day', value: 1500 })];
    const goal = (atLeast: number) =>
      habit({ match: { types: ['listening.day'] }, rule: { aggregate: 'sum', atLeast } });
    expect(scoreHabit(goal(1200), events, week, today)[0].state).toBe('done');
    expect(scoreHabit(goal(1800), events, week, today)[0].state).toBe('missed');
  });

  it('applies limits: over is missed at once, under is done only when the day is over', () => {
    const h = habit({
      match: { types: ['gaming.session'] },
      rule: { aggregate: 'sum', atMost: 5400 },
    });
    const events = [
      event('2026-09-28', { type: 'gaming.session', value: 5400 }),
      event('2026-09-29', { type: 'gaming.session', value: 5401 }),
      event(today, { type: 'gaming.session', value: 6000 }),
    ];
    const cells = scoreHabit(h, events, { from: '2026-09-28', to: today }, today);
    expect(states(cells)).toEqual(['done', 'missed', 'done', 'missed']);

    const quiet = scoreHabit(h, [], { from: today, to: today }, today);
    expect(quiet[0].state).toBe('pending');
  });

  it('needs both a goal and a limit when both are set', () => {
    const h = habit({ rule: { aggregate: 'count', atLeast: 1, atMost: 2 } });
    const events = on(['2026-09-29', '2026-09-30', '2026-09-30', '2026-09-30', today]);
    const cells = scoreHabit(h, events, { from: '2026-09-28', to: today }, today);
    expect(states(cells)).toEqual(['missed', 'done', 'missed', 'pending']);
  });

  it('shows metric habits as values with no done state', () => {
    const h = habit({ match: { types: ['gaming.session'] }, rule: { aggregate: 'sum' } });
    const events = [event('2026-09-28', { type: 'gaming.session', value: 1800 })];
    const cells = scoreHabit(h, events, week, today);
    expect(cells[0]).toMatchObject({ value: 1800, state: 'metric', done: false });
    expect(cells[1]).toMatchObject({ value: 0, state: 'metric' });
    expect(cells[4].state).toBe('future');
  });

  it('never marks days before a mid-week start date as missed', () => {
    const h = habit({ startDate: '2026-09-30' });
    const cells = scoreHabit(h, on(['2026-09-28']), week, today);
    expect(states(cells).slice(0, 4)).toEqual(['inactive', 'inactive', 'missed', 'pending']);
  });

  it('counts duplicate events once', () => {
    const dup = event('2026-09-28', { externalId: 'session-1' });
    const cells = scoreHabit(
      habit({ rule: { aggregate: 'count', atLeast: 2 } }),
      [dup, { ...dup, id: 'resent' }],
      week,
      today,
    );
    expect(cells[0]).toMatchObject({ value: 1, state: 'missed' });
  });

  it('ignores events outside the range', () => {
    const cells = scoreHabit(habit(), on(['2026-09-27', '2026-10-05']), week, today);
    expect(cells.every((c) => c.value === 0)).toBe(true);
  });

  it('scores on local date, not the UTC timestamp', () => {
    // 01:00 UTC on the 29th, but the user's day was the 28th.
    const late = event('2026-09-28', { occurredAt: '2026-09-29T01:00:00Z' });
    const cells = scoreHabit(habit(), [late], week, today);
    expect(cells.slice(0, 2).map((c) => c.value)).toEqual([1, 0]);
  });

  it('keeps every day across a DST weekend', () => {
    const range = { from: '2026-10-30', to: '2026-11-02' };
    const cells = scoreHabit(habit(), on(['2026-11-01', '2026-11-02']), range, '2026-11-05');
    expect(cells.map((c) => [c.date, c.state])).toEqual([
      ['2026-10-30', 'missed'],
      ['2026-10-31', 'missed'],
      ['2026-11-01', 'done'],
      ['2026-11-02', 'done'],
    ]);
  });
});

describe('dedupe', () => {
  it('keeps the last copy of each (source, external id)', () => {
    const first = event('2026-09-28', { externalId: 'steam:1', value: 900 });
    const update = { ...first, id: 'later', value: 1800 };
    const other = event('2026-09-28', { sourceId: 's2', externalId: 'steam:1' });
    expect(dedupe([first, update, other])).toEqual([update, other]);
  });
});

describe('matches', () => {
  const run = event(today, { type: 'activity.created', meta: { sport_type: 'Run' } });

  it('filters by type', () => {
    expect(matches({ types: ['activity.created'] }, run)).toBe(true);
    expect(matches({ types: ['check-in'] }, run)).toBe(false);
  });

  it('filters by source', () => {
    expect(matches({ types: ['activity.created'], sourceIds: ['s1'] }, run)).toBe(true);
    expect(matches({ types: ['activity.created'], sourceIds: ['s2'] }, run)).toBe(false);
  });

  it('filters by meta, with arrays meaning any of', () => {
    const where = (w: Record<string, unknown>) =>
      matches({ types: ['activity.created'], where: w }, run);
    expect(where({ sport_type: ['Run', 'TrailRun'] })).toBe(true);
    expect(where({ sport_type: ['Ride'] })).toBe(false);
    expect(where({ sport_type: 'Run' })).toBe(true);
    expect(where({ sport_type: 'Ride' })).toBe(false);
  });

  it('fails a where filter when the event has no meta', () => {
    const bare = event(today, { type: 'activity.created' });
    expect(matches({ types: ['activity.created'], where: { sport_type: 'Run' } }, bare)).toBe(
      false,
    );
  });
});

describe('manual entries', () => {
  const entry = (habitId: string, date: string, value?: number) =>
    event(date, { type: MANUAL_ENTRY, sourceId: 'manual', value, meta: { habit_id: habitId } });

  it('count for their habit even past its source, type and where filter', () => {
    const run = habit({
      id: 'run',
      match: { sourceIds: ['strava'], types: ['activity.created'], where: { sport_type: ['Run'] } },
    });
    const cells = scoreHabit(run, [entry('run', '2026-09-29')], week, today);
    expect(cells[1]).toMatchObject({ value: 1, state: 'done' });
    expect(countsFor(run, entry('run', today))).toBe(true);
  });

  it('add their amount to what a source reported', () => {
    const listen = habit({
      id: 'listen',
      match: { types: ['listening.day'] },
      rule: { aggregate: 'sum', atLeast: 1200 },
    });
    const events = [
      event('2026-09-29', { type: 'listening.day', value: 600 }),
      entry('listen', '2026-09-29', 900),
    ];
    expect(scoreHabit(listen, events, week, today)[1]).toMatchObject({
      value: 1500,
      state: 'done',
    });
  });

  it('count their value in a count habit when they are in counts, else count once', () => {
    const thrice = habit({ id: 't', rule: { aggregate: 'count', atLeast: 3 } });
    const counted = { ...entry('t', '2026-09-29', 2), unit: 'count' as const };
    const timed = { ...entry('t', '2026-09-30', 300), unit: 'seconds' as const };
    const bare = { ...entry('t', '2026-10-01'), unit: 'count' as const };
    const cells = scoreHabit(thrice, [event('2026-09-29'), counted, timed, bare], week, today);
    expect(cells[1]).toMatchObject({ value: 3, state: 'done' });
    expect(cells[2].value).toBe(1);
    expect(cells[3].value).toBe(1);
  });

  it("don't count for other habits", () => {
    const cells = scoreHabit(habit({ id: 'a' }), [entry('b', '2026-09-29')], week, today);
    expect(cells[1].value).toBe(0);
  });
});
