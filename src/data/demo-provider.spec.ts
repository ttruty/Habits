import { describe, expect, it } from 'vitest';
import { addDays } from '../scoring/dates';
import { buildScorecard } from '../scoring/scorecard';
import { createDemoProvider } from './demo-provider';

const now = new Date(2026, 9, 1, 14, 30); // Thu 1 Oct 2026, 14:30 local
const demo = createDemoProvider({ now: () => now });
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
    const later = createDemoProvider({ now: () => new Date(2026, 9, 20) });
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

describe('demo provider writes', () => {
  function memoryStorage(): Storage {
    const m = new Map<string, string>();
    return {
      get length() {
        return m.size;
      },
      clear: () => m.clear(),
      getItem: (k) => m.get(k) ?? null,
      key: (i) => [...m.keys()][i] ?? null,
      removeItem: (k) => void m.delete(k),
      setItem: (k, v) => void m.set(k, v),
    };
  }

  it('persists habits, sources and events to storage', async () => {
    const storage = memoryStorage();
    const a = createDemoProvider({ now: () => now, storage });
    const source = await a.addSource({ kind: 'manual', label: 'Manual', config: {} });
    const [first] = await a.listHabits();
    await a.saveHabit({ ...first, name: 'Lift' });
    await a.saveHabit({ ...first, id: 'new', name: 'New', sort: 9 });
    await a.putEvent({
      sourceId: source.id,
      externalId: 'new:2026-10-01',
      type: 'check-in',
      occurredAt: now.toISOString(),
      localDate: '2026-10-01',
    });

    const b = createDemoProvider({ now: () => now, storage });
    expect((await b.listSources()).map((s) => s.kind)).toContain('manual');
    const habits = await b.listHabits();
    expect(habits.map((h) => h.name)).toEqual(expect.arrayContaining(['Lift', 'New']));
    const mine = (await b.listEvents({ from: '2026-10-01', to: '2026-10-01' })).filter(
      (e) => e.sourceId === source.id,
    );
    expect(mine).toHaveLength(1);
  });

  it('upserts events on (source, external id) and deletes by id', async () => {
    const p = createDemoProvider({ now: () => now });
    const e = {
      sourceId: 'm',
      externalId: 'x',
      type: 'check-in',
      occurredAt: now.toISOString(),
      localDate: '2026-09-30',
      value: 1,
    };
    await p.putEvent(e);
    await p.putEvent({ ...e, value: 2 });
    const mine = async () =>
      (await p.listEvents({ from: '2026-09-30', to: '2026-09-30' })).filter(
        (x) => x.sourceId === 'm',
      );
    expect((await mine()).map((x) => x.value)).toEqual([2]);
    await p.deleteEvent((await mine())[0].id);
    expect(await mine()).toEqual([]);
  });

  it('reorders habits', async () => {
    const p = createDemoProvider({ now: () => now });
    const ids = (await p.listHabits()).map((h) => h.id).reverse();
    await p.saveHabitOrder(ids);
    const sorted = (await p.listHabits()).toSorted((x, y) => x.sort - y.sort);
    expect(sorted.map((h) => h.id)).toEqual(ids);
  });

  it('returns copies, so callers cannot change stored habits by accident', async () => {
    const p = createDemoProvider({ now: () => now });
    (await p.listHabits())[0].name = 'Changed';
    expect((await p.listHabits())[0].name).toBe('Workout');
  });

  it('survives unreadable and full storage', async () => {
    const broken = memoryStorage();
    broken.setItem('habits.demo.v1', '{not json');
    broken.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    const p = createDemoProvider({ now: () => now, storage: broken });
    expect(await p.listHabits()).toHaveLength(5);
    await p.saveHabitOrder([]);
  });

  it('refuses writes when read-only', async () => {
    const p = createDemoProvider({ now: () => now, readOnly: true });
    expect(p.canEdit).toBe(false);
    await expect(p.deleteEvent('x')).rejects.toThrow('read-only');
  });
});
