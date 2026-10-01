import { describe, expect, it } from 'vitest';
import { buildScorecard } from './scorecard';
import { event, habit, on } from './test-helpers';

const today = '2026-10-01';
const view = { from: '2026-09-28', to: '2026-10-04' };

describe('buildScorecard', () => {
  it('returns live habits in sort order', () => {
    const habits = [
      habit({ id: 'b', sort: 2 }),
      habit({ id: 'a', sort: 1 }),
      habit({ id: 'gone', sort: 0, archivedAt: '2026-09-01T00:00:00Z' }),
    ];
    const rows = buildScorecard(habits, [], { view, today });
    expect(rows.map((r) => r.habit.id)).toEqual(['a', 'b']);
  });

  it('scores the view, the last week of the view and the streak', () => {
    const events = on(['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30']);
    const [row] = buildScorecard([habit()], events, { view, today });
    expect(row.cells).toHaveLength(7);
    expect(row.week).toMatchObject({ from: '2026-09-28', done: 3, target: 7 });
    // The streak reaches back past the view.
    expect(row.streak).toEqual({ count: 5, unit: 'days' });
  });

  it('limits streak history to historyFrom', () => {
    const events = on(['2026-09-29', '2026-09-30']);
    const [row] = buildScorecard([habit()], events, { view, today, historyFrom: '2026-09-30' });
    expect(row.streak?.count).toBe(1);
  });

  it('uses the last week of a longer view', () => {
    const month = { from: '2026-09-01', to: '2026-09-30' };
    const [row] = buildScorecard([habit()], on(['2026-09-29']), { view: month, today });
    expect(row.week.from).toBe('2026-09-28');
    expect(row.cells).toHaveLength(30);
  });

  it('dedupes before scoring', () => {
    const e = event(today, { externalId: 'same' });
    const [row] = buildScorecard(
      [habit({ rule: { aggregate: 'count', atLeast: 2 } })],
      [e, { ...e, id: 'again' }],
      { view, today },
    );
    expect(row.cells[3].value).toBe(1);
  });

  it('reports the unit of matched events', () => {
    const listen = habit({ match: { types: ['listening.day'] }, rule: { aggregate: 'sum' } });
    const events = [
      event(today, { unit: 'count' }), // a workout: doesn't match
      event(today, { type: 'listening.day', value: 60 }), // matches, no unit
      event(today, { type: 'listening.day', value: 60, unit: 'seconds' }),
    ];
    const [workout, listening] = buildScorecard([habit(), { ...listen, sort: 1 }], events, {
      view,
      today,
    });
    expect(workout.unit).toBe('count');
    expect(listening.unit).toBe('seconds');
    expect(buildScorecard([listen], [], { view, today })[0].unit).toBeUndefined();
  });

  it('honours the week start', () => {
    const [row] = buildScorecard([habit()], [], {
      view: { from: '2026-09-27', to: '2026-10-03' },
      today,
      weekStartsOn: 0,
    });
    expect(row.week.from).toBe('2026-09-27');
  });
});
