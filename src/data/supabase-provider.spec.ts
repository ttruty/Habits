import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Habit } from '../model';
import {
  PAGE,
  createSupabaseProvider,
  fromEvent,
  fromHabit,
  toEvent,
  toHabit,
  toSource,
  type EventRow,
} from './supabase-provider';

/** Records every query-builder call; resolves each query with the next queued result. */
function fakeClient(results: { data?: unknown; error?: { message: string } | null }[]) {
  const calls: unknown[][] = [];
  const builder: Record<string, unknown> = {};
  for (const name of [
    'select',
    'insert',
    'upsert',
    'update',
    'delete',
    'eq',
    'gte',
    'lte',
    'order',
    'range',
    'single',
  ]) {
    builder[name] = (...args: unknown[]) => {
      calls.push([name, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => void) => {
    const next = results.shift() ?? { data: [], error: null };
    resolve({ data: next.data ?? null, error: next.error ?? null });
  };
  const client = {
    from: (table: string) => {
      calls.push(['from', table]);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const habit: Habit = {
  id: 'h1',
  name: 'Read',
  icon: '📖',
  color: 'teal',
  match: { sourceIds: ['s1'], types: ['check-in'], where: { habit_id: 'h1' } },
  rule: { aggregate: 'count', atLeast: 1 },
  target: { perWeek: 7 },
  startDate: '2026-10-01',
  sort: 2,
};

const eventRow: EventRow = {
  id: 'e1',
  source_id: 's1',
  external_id: 'h1:2026-10-01',
  type: 'check-in',
  occurred_at: '2026-10-01T14:00:00+00:00',
  local_date: '2026-10-01',
  value: 1,
  unit: 'count',
  meta: { habit_id: 'h1' },
};

describe('row mapping', () => {
  it('round-trips habits, dropping empty optionals', () => {
    expect(toHabit(fromHabit(habit))).toEqual(habit);
    const bare = toHabit({ ...fromHabit(habit), start_date: null, archived_at: null });
    expect(bare).not.toHaveProperty('startDate');
    expect(bare).not.toHaveProperty('archivedAt');
    expect(toHabit({ ...fromHabit(habit), archived_at: '2026-10-02T00:00:00Z' }).archivedAt).toBe(
      '2026-10-02T00:00:00Z',
    );
  });

  it('maps events both ways, dropping nulls', () => {
    const { id, ...rest } = toEvent(eventRow);
    expect(id).toBe('e1');
    expect(fromEvent(rest)).toEqual(omitId(eventRow));
    const bare = toEvent({ ...eventRow, value: null, unit: null, meta: null });
    expect(bare).not.toHaveProperty('value');
    expect(bare).not.toHaveProperty('unit');
    expect(bare).not.toHaveProperty('meta');
    expect(
      fromEvent({ ...rest, value: undefined, unit: undefined, meta: undefined }),
    ).toMatchObject({
      value: null,
      unit: null,
      meta: null,
    });
  });

  it('maps sources', () => {
    expect(
      toSource({ id: 's1', kind: 'manual', label: 'Manual', config: {}, created_at: 'T' }),
    ).toEqual({ id: 's1', kind: 'manual', label: 'Manual', config: {}, createdAt: 'T' });
  });
});

function omitId(row: EventRow) {
  const { id: _id, ...rest } = row;
  void _id;
  return rest;
}

describe('createSupabaseProvider', () => {
  it('pages through events until a short page', async () => {
    const full = Array.from({ length: PAGE }, (_, i) => ({ ...eventRow, id: `e${i}` }));
    const { client, calls } = fakeClient([{ data: full }, { data: [eventRow] }]);
    const events = await createSupabaseProvider(client).listEvents({
      from: '2026-01-01',
      to: '2026-10-01',
    });
    expect(events).toHaveLength(PAGE + 1);
    expect(calls.filter((c) => c[0] === 'range')).toEqual([
      ['range', 0, PAGE - 1],
      ['range', PAGE, 2 * PAGE - 1],
    ]);
    expect(calls).toContainEqual(['gte', 'local_date', '2026-01-01']);
    expect(calls).toContainEqual(['lte', 'local_date', '2026-10-01']);
  });

  it('upserts events on (source_id, external_id)', async () => {
    const { client, calls } = fakeClient([{}]);
    await createSupabaseProvider(client).putEvent(omitIdEvent());
    expect(calls).toContainEqual(['from', 'events']);
    expect(calls.find((c) => c[0] === 'upsert')?.[2]).toEqual({
      onConflict: 'source_id,external_id',
    });
  });

  it('writes habits, order, sources and deletes', async () => {
    const { client, calls } = fakeClient([
      {},
      {},
      {},
      { data: { id: 's9', kind: 'manual', label: 'Manual', config: {}, created_at: 'T' } },
      {},
    ]);
    const p = createSupabaseProvider(client);
    await p.saveHabit(habit);
    await p.saveHabitOrder(['b', 'a']);
    const source = await p.addSource({ kind: 'manual', label: 'Manual', config: {} });
    await p.deleteEvent('e1');
    expect(source.id).toBe('s9');
    expect(calls).toContainEqual(['upsert', fromHabit(habit)]);
    expect(calls).toContainEqual(['update', { sort: 0 }]);
    expect(calls).toContainEqual(['eq', 'id', 'a']);
    expect(calls).toContainEqual(['delete']);
    expect(calls).toContainEqual(['eq', 'id', 'e1']);
  });

  it('lists sources and habits', async () => {
    const { client } = fakeClient([
      { data: [{ id: 's1', kind: 'manual', label: 'M', config: {}, created_at: 'T' }] },
      { data: [fromHabit(habit)] },
    ]);
    const p = createSupabaseProvider(client);
    expect((await p.listSources())[0].kind).toBe('manual');
    expect(await p.listHabits()).toEqual([habit]);
  });

  it('throws database errors', async () => {
    const { client } = fakeClient([{ error: { message: 'permission denied' } }]);
    await expect(createSupabaseProvider(client).listHabits()).rejects.toThrow('permission denied');
  });
});

function omitIdEvent() {
  const { id: _id, ...rest } = toEvent(eventRow);
  void _id;
  return rest;
}
