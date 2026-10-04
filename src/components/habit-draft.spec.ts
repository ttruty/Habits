import { describe, expect, it } from 'vitest';
import type { Habit, Source } from '../model';
import {
  NEW_MANUAL,
  amountUnit,
  defaultAggregate,
  displayUnit,
  draftFromHabit,
  eventTypesFor,
  goalUnit,
  habitFromDraft,
  newDraft,
  validate,
} from './habit-draft';

const src = (id: string, kind: Source['kind']): Source => ({
  id,
  kind,
  label: id,
  config: {},
  createdAt: '2026-01-01T00:00:00Z',
});
const sources = [
  src('m', 'manual'),
  src('y', 'yarnbeard'),
  src('s', 'strava'),
  src('x', 'deckfit'),
  src('w', 'withings'),
];
const today = '2026-10-01';

const listen: Habit = {
  id: 'h1',
  name: 'Listen 20m',
  icon: 'listen',
  color: 'blue',
  match: { sourceIds: ['y'], types: ['listening.day'] },
  rule: { aggregate: 'sum', atLeast: 1200 },
  target: { perWeek: 7 },
  sort: 3,
};

describe('newDraft', () => {
  it('starts hand-ticked, daily, from today, using the Manual source if there is one', () => {
    expect(newDraft('n', sources, today)).toMatchObject({
      sourceId: 'm',
      type: 'check-in',
      perWeek: 7,
      startDate: today,
    });
    expect(newDraft('n', [], today).sourceId).toBe(NEW_MANUAL);
  });
});

describe('draftFromHabit / habitFromDraft', () => {
  it('shows seconds as minutes and saves them back as seconds', () => {
    const draft = draftFromHabit(listen, sources);
    expect(draft).toMatchObject({ goal: 'atLeast', amount: '20', aggregate: 'sum' });
    const saved = habitFromDraft({ ...draft, amount: '30' }, sources, listen, 0);
    expect(saved.rule).toEqual({ aggregate: 'sum', atLeast: 1800 });
    expect(saved.sort).toBe(3);
  });

  it('keeps a where filter while source and type stay the same', () => {
    // Strava's value is moving time in seconds, so a limit shows in minutes.
    const run: Habit = {
      ...listen,
      match: { sourceIds: ['s'], types: ['activity.created'], where: { sport_type: ['Run'] } },
      rule: { aggregate: 'sum', atMost: 5400 },
    };
    const draft = draftFromHabit(run, sources);
    expect(draft).toMatchObject({ goal: 'atMost', amount: '90' });
    // Same source and type: the where filter survives the edit.
    expect(habitFromDraft(draft, sources, run, 0).match.where).toEqual({ sport_type: ['Run'] });
    // New source: it doesn't.
    const moved = habitFromDraft(
      { ...draft, sourceId: 'x', type: 'workout.completed' },
      sources,
      run,
      0,
    );
    expect(moved.match).toEqual({ sourceIds: ['x'], types: ['workout.completed'] });
  });

  it('round-trips a tracked metric with no goal', () => {
    const metric: Habit = { ...listen, rule: { aggregate: 'sum' } };
    const draft = draftFromHabit(metric, sources);
    expect(draft).toMatchObject({ goal: 'track', amount: '' });
    expect(habitFromDraft(draft, sources, metric, 0).rule).toEqual({ aggregate: 'sum' });
  });

  it('makes hand-ticked habits count their own check-ins', () => {
    const draft = { ...newDraft('h9', sources, today), name: ' Read ', icon: 'book' };
    expect(habitFromDraft(draft, sources, undefined, 5)).toEqual({
      id: 'h9',
      name: 'Read',
      icon: 'book',
      color: 'green',
      match: { sourceIds: ['m'], types: ['check-in'], where: { habit_id: 'h9' } },
      rule: { aggregate: 'count', atLeast: 1 },
      target: { perWeek: 7 },
      startDate: today,
      sort: 5,
    });
  });

  it('keeps the archive state and clamps the weekly target', () => {
    const archived = { ...listen, archivedAt: '2026-09-01T00:00:00Z' };
    const saved = habitFromDraft(
      { ...draftFromHabit(archived, sources), perWeek: 9 },
      sources,
      archived,
      0,
    );
    expect(saved.archivedAt).toBe(archived.archivedAt);
    expect(saved.target.perWeek).toBe(7);
    expect(saved).not.toHaveProperty('startDate');
  });

  it('copes with a habit whose source is gone', () => {
    const orphan = { ...listen, match: { types: ['listening.day'] } };
    expect(draftFromHabit(orphan, sources)).toMatchObject({ sourceId: '', amount: '1200' });
  });
});

describe('validate', () => {
  const draft = { ...draftFromHabit(listen, sources) };

  it('needs a name, a source and an amount', () => {
    expect(validate(draft, sources)).toEqual({});
    expect(validate({ ...draft, name: '  ' }, sources).name).toBeTruthy();
    expect(validate({ ...draft, sourceId: '' }, sources).source).toBeTruthy();
    expect(validate({ ...draft, amount: '' }, sources).amount).toBeTruthy();
    expect(validate({ ...draft, amount: '-1' }, sources).amount).toBeTruthy();
    expect(validate({ ...draft, amount: 'abc' }, sources).amount).toBeTruthy();
  });

  it('needs no amount for tracked metrics or hand-ticked habits', () => {
    expect(validate({ ...draft, goal: 'track', amount: '' }, sources)).toEqual({});
    expect(validate({ ...newDraft('n', [], today), name: 'Read', amount: '' }, [])).toEqual({});
  });
});

describe('units and event types', () => {
  it('maps units to display units', () => {
    expect(displayUnit('seconds')).toEqual({ label: 'minutes', factor: 60 });
    expect(displayUnit('meters')).toEqual({ label: 'km', factor: 1000 });
    expect(displayUnit('pages').label).toBe('pages');
    expect(displayUnit('percent').label).toBe('%');
    expect(displayUnit(undefined)).toEqual({ label: 'times', factor: 1 });
  });

  it('lists event types from the connector registry', () => {
    expect(eventTypesFor('y', sources).map((t) => t.type)).toContain('listening.day');
    expect(eventTypesFor(NEW_MANUAL, sources).map((t) => t.type)).toEqual(['check-in']);
    expect(eventTypesFor('nope', sources)).toEqual([]);
  });
});

it('labels the amount from the event type, e.g. steps', () => {
  expect(amountUnit({ sourceId: 'w', type: 'steps.day' }, sources)).toEqual({
    label: 'steps',
    factor: 1,
  });
  expect(amountUnit({ sourceId: 'w', type: 'workout.completed' }, sources).label).toBe('minutes');
});

describe('counting workouts (not minutes)', () => {
  const workout: Habit = {
    ...listen,
    id: 'h2',
    match: { sourceIds: ['x'], types: ['workout.completed'] },
    rule: { aggregate: 'count', atLeast: 1 },
  };

  it('shows and saves a count goal in times, even for an event measured in seconds', () => {
    const draft = draftFromHabit(workout, sources);
    expect(draft.amount).toBe('1');
    expect(goalUnit(draft, sources)).toEqual({ label: 'times', factor: 1 });
    expect(habitFromDraft({ ...draft, amount: '2' }, sources, workout, 0).rule).toEqual({
      aggregate: 'count',
      atLeast: 2,
    });
  });

  it('uses minutes once the habit totals the time instead', () => {
    const draft = { ...draftFromHabit(workout, sources), aggregate: 'sum' as const, amount: '5' };
    expect(goalUnit(draft, sources).label).toBe('minutes');
    expect(habitFromDraft(draft, sources, workout, 0).rule).toEqual({
      aggregate: 'sum',
      atLeast: 300,
    });
  });

  it("defaults to how the connector's preset adds up: workouts count, steps sum", () => {
    expect(defaultAggregate({ sourceId: 'x', type: 'workout.completed' }, sources)).toBe('count');
    expect(defaultAggregate({ sourceId: 'w', type: 'steps.day' }, sources)).toBe('sum');
    expect(defaultAggregate({ sourceId: 'y', type: 'listening.day' }, sources)).toBe('sum');
    expect(defaultAggregate({ sourceId: 'nope', type: 'x' }, sources)).toBe('sum');
    expect(defaultAggregate({ sourceId: 'm', type: 'check-in' }, sources)).toBe('count');
  });
});
