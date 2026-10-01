import { describe, expect, it } from 'vitest';
import { addDays } from '../scoring/dates';
import { buildScorecard } from '../scoring/scorecard';
import { createDemoProvider } from './demo-provider';

const now = new Date(2026, 9, 1, 14, 30); // Thu 1 Oct 2026, 14:30 local
const demo = createDemoProvider(() => now);
const all = { from: '2000-01-01', to: '2100-01-01' };

describe('demo provider', () => {
  it('has five habits whose sources exist', async () => {
    const [habits, sources] = await Promise.all([demo.listHabits(), demo.listSources()]);
    expect(habits).toHaveLength(5);
    const ids = new Set(sources.map((s) => s.id));
    for (const h of habits) for (const id of h.match.sourceIds ?? []) expect(ids).toContain(id);
  });

  it('covers eight weeks up to now, and nothing later', async () => {
    const events = await demo.listEvents(all);
    const days = new Set(events.map((e) => e.localDate));
    expect(Math.min(...[...days].map((d) => Date.parse(d)))).toBeGreaterThanOrEqual(
      Date.parse('2026-08-07'),
    );
    expect([...days].every((d) => d <= '2026-10-01')).toBe(true);
    expect(events.every((e) => new Date(e.occurredAt) <= now)).toBe(true);
  });

  it('returns only the requested range', async () => {
    const events = await demo.listEvents({ from: '2026-09-28', to: '2026-09-29' });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.localDate >= '2026-09-28' && e.localDate <= '2026-09-29')).toBe(
      true,
    );
  });

  it('gives the same events for a day on every load', async () => {
    const later = createDemoProvider(() => new Date(2026, 9, 20));
    const day = { from: '2026-09-15', to: '2026-09-15' };
    expect(await later.listEvents(day)).toEqual(await demo.listEvents(day));
  });

  it('has unique (source, external id) pairs', async () => {
    const events = await demo.listEvents(all);
    const keys = new Set(events.map((e) => `${e.sourceId}|${e.externalId}`));
    expect(keys.size).toBe(events.length);
  });

  it('produces a mix of done and missed days for every habit', async () => {
    const habits = await demo.listHabits();
    const events = await demo.listEvents(all);
    const rows = buildScorecard(habits, events, {
      view: { from: addDays('2026-10-01', -55), to: '2026-10-01' },
      today: '2026-10-01',
    });
    for (const row of rows) {
      const states = new Set(row.cells.map((c) => c.state));
      expect(states, row.habit.name).toContain('done');
      expect(states, row.habit.name).toContain('missed');
    }
  });

  it('includes rides that the Run habit filters out', async () => {
    const events = await demo.listEvents(all);
    expect(events.some((e) => e.meta?.sport_type === 'Ride')).toBe(true);
  });
});
