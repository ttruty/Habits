import { describe, expect, it } from 'vitest';
import { normalizeSteps, normalizeWorkout, parseNotification, withings } from './withings.ts';

describe('normalizeWorkout', () => {
  const workout = {
    id: 987,
    category: 2,
    startdate: Date.parse('2026-10-01T22:00:00Z') / 1000,
    enddate: Date.parse('2026-10-01T22:40:00Z') / 1000,
    date: '2026-10-01',
    data: { steps: 4500.2, distance: 6012.7, pause_duration: 120 },
  };

  it('is active seconds on the local day, with category, distance and steps', () => {
    expect(normalizeWorkout(workout)).toEqual({
      externalId: 'workout:987',
      type: 'workout.completed',
      occurredAt: '2026-10-01T22:00:00.000Z',
      localDate: '2026-10-01',
      value: 2280,
      unit: 'seconds',
      meta: { category: 'run', distance: 6013, steps: 4500 },
    });
  });

  it('copes with no data and unknown categories', () => {
    const e = normalizeWorkout({ ...workout, category: 9999, data: undefined });
    expect(e.meta).toEqual({ category: 'other' });
    expect(e.value).toBe(2400);
    expect(
      normalizeWorkout({ ...workout, enddate: workout.startdate - 5, data: undefined }).value,
    ).toBe(0);
  });
});

it('turns daily activity into one steps.day per day, keeping the highest count', () => {
  expect(
    normalizeSteps([
      { date: '2026-10-01', steps: 4000 },
      { date: '2026-10-01', steps: 8123.4 },
      { date: '2026-10-02', steps: 12 },
      { date: '2026-10-03' },
      { date: '', steps: 5 },
    ]),
  ).toEqual([
    {
      externalId: 'steps:2026-10-01',
      type: 'steps.day',
      occurredAt: '2026-10-01T12:00:00.000Z',
      localDate: '2026-10-01',
      value: 8123,
      unit: 'count',
    },
    {
      externalId: 'steps:2026-10-02',
      type: 'steps.day',
      occurredAt: '2026-10-02T12:00:00.000Z',
      localDate: '2026-10-02',
      value: 12,
      unit: 'count',
    },
  ]);
});

describe('parseNotification', () => {
  const at = (iso: string) => String(Date.parse(iso) / 1000);
  const form = (fields: Record<string, string>) => new URLSearchParams(fields);

  it('turns an activity notification into a refetch of the days, a day wider each side', () => {
    expect(
      parseNotification(
        form({
          userid: '12345',
          appli: '16',
          startdate: at('2026-10-01T06:00:00Z'),
          enddate: at('2026-10-01T23:00:00Z'),
        }),
      ),
    ).toEqual({ kind: 'range', userId: '12345', from: '2026-09-30', to: '2026-10-02' });
  });

  it('ignores other categories and malformed ones', () => {
    expect(parseNotification(form({ userid: '1', appli: '44', startdate: '1' }))).toBeNull();
    expect(parseNotification(form({ userid: 'x', appli: '16', startdate: '1' }))).toBeNull();
    expect(parseNotification(form({ userid: '1', appli: '16', startdate: 'soon' }))).toBeNull();
    expect(parseNotification(form({ appli: '16' }))).toBeNull();
  });

  it('accepts a notification with only a start date', () => {
    expect(
      parseNotification(form({ userid: '1', appli: '16', startdate: at('2026-10-01T12:00:00Z') })),
    ).toEqual({ kind: 'range', userId: '1', from: '2026-09-30', to: '2026-10-02' });
  });
});

it('is an updating, non-ingest connector', () => {
  expect(withings).toMatchObject({ ingest: false, onConflict: 'update' });
  expect(withings.cacheDays).toBeUndefined();
});
