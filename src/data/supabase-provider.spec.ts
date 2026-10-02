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
    'is',
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

const URL = 'https://ref.supabase.co/';

const habit: Habit = {
  id: 'h1',
  name: 'Read',
  icon: 'book',
  color: 'green',
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
    // First the sources (no connected OAuth source, so no cache refresh), then two pages.
    const { client, calls } = fakeClient([{ data: [] }, { data: full }, { data: [eventRow] }]);
    const events = await createSupabaseProvider(client, URL).listEvents({
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
    await createSupabaseProvider(client, URL).putEvent(omitIdEvent());
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
    const p = createSupabaseProvider(client, URL);
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
    const p = createSupabaseProvider(client, URL);
    expect((await p.listSources())[0].kind).toBe('manual');
    expect(await p.listHabits()).toEqual([habit]);
  });

  it('throws database errors', async () => {
    const { client } = fakeClient([{ error: { message: 'permission denied' } }]);
    await expect(createSupabaseProvider(client, URL).listHabits()).rejects.toThrow(
      'permission denied',
    );
  });
});

function omitIdEvent() {
  const { id: _id, ...rest } = toEvent(eventRow);
  void _id;
  return rest;
}

describe('ingest tokens', () => {
  it('builds the ingest URL from the project URL', () => {
    const { client } = fakeClient([]);
    expect(createSupabaseProvider(client, URL).ingestUrl).toBe(
      'https://ref.supabase.co/functions/v1/ingest',
    );
  });

  it("revokes old tokens, then stores only the new token's hash", async () => {
    const { client, calls } = fakeClient([{}, {}]);
    const token = await createSupabaseProvider(client, URL).issueIngestToken('s1');
    expect(token).toMatch(/^hab_/);
    const update = calls.find((c) => c[0] === 'update');
    expect(update?.[1]).toHaveProperty('revoked_at');
    expect(calls).toContainEqual(['eq', 'source_id', 's1']);
    expect(calls).toContainEqual(['is', 'revoked_at', null]);
    const insert = calls.find((c) => c[0] === 'insert')?.[1] as Record<string, string>;
    expect(insert.source_id).toBe('s1');
    expect(insert.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(calls)).not.toContain(token);
  });

  it('lists token metadata and revokes', async () => {
    const { client, calls } = fakeClient([
      {
        data: [
          { id: 't1', source_id: 's1', created_at: 'C', last_used_at: null, revoked_at: null },
          { id: 't0', source_id: 's1', created_at: 'B', last_used_at: 'U', revoked_at: 'R' },
        ],
      },
      {},
    ]);
    const p = createSupabaseProvider(client, URL);
    expect(await p.listIngestTokens()).toEqual([
      { id: 't1', sourceId: 's1', createdAt: 'C' },
      { id: 't0', sourceId: 's1', createdAt: 'B', lastUsedAt: 'U', revokedAt: 'R' },
    ]);
    await p.revokeIngestTokens('s1');
    expect(calls.filter((c) => c[0] === 'update')).toHaveLength(1);
  });
});

describe('OAuth sources', () => {
  /** A client whose functions.invoke records calls and answers with `reply`. */
  function withFunctions(
    results: { data?: unknown }[],
    reply: { data?: unknown; error?: unknown },
  ) {
    const f = fakeClient(results);
    const invoked: [string, unknown][] = [];
    (f.client as unknown as { functions: unknown }).functions = {
      invoke: async (name: string, opts: unknown) => {
        invoked.push([name, opts]);
        return { data: reply.data ?? null, error: reply.error ?? null };
      },
    };
    return { ...f, invoked };
  }

  it('refreshes connected OAuth caches before reading events', async () => {
    const { client, invoked } = withFunctions(
      [
        {
          data: [
            { kind: 'strava', config: { connected: true } },
            { kind: 'strava', config: { connected: false } },
            { kind: 'deckfit', config: {} },
          ],
        },
        { data: [] },
      ],
      {},
    );
    await createSupabaseProvider(client, URL).listEvents({ from: '2026-09-01', to: '2026-10-01' });
    expect(invoked).toEqual([['oauth/strava/sync', { body: { from: '2026-09-01' } }]]);
  });

  it('still reads cached events when the refresh fails', async () => {
    const { client } = withFunctions(
      [{ data: [{ kind: 'strava', config: { connected: true } }] }, { data: [eventRow] }],
      {},
    );
    (client as unknown as { functions: { invoke: () => Promise<never> } }).functions.invoke = () =>
      Promise.reject(new Error('offline'));
    const events = await createSupabaseProvider(client, URL).listEvents({
      from: '2026-09-01',
      to: '2026-10-01',
    });
    expect(events).toHaveLength(1);
  });

  it("starts and ends a connection through the kind's function", async () => {
    const ok = withFunctions([], { data: { url: 'https://www.strava.com/oauth/authorize?x' } });
    const p = createSupabaseProvider(ok.client, URL);
    expect(p.oauth).toBe(true);
    expect(await p.connectOAuth('strava', 'https://timtruty.com/Habits/')).toContain('strava.com');
    await p.disconnectOAuth({
      id: 's9',
      kind: 'strava',
      label: 'Strava',
      config: {},
      createdAt: 'T',
    });
    expect(ok.invoked).toEqual([
      ['oauth/strava/connect', { body: { returnTo: 'https://timtruty.com/Habits/' } }],
      ['oauth/strava/disconnect', { body: { sourceId: 's9' } }],
    ]);

    const bad = withFunctions([], { error: new Error('503') });
    const q = createSupabaseProvider(bad.client, URL);
    await expect(q.connectOAuth('strava', 'x')).rejects.toThrow("Couldn't start connecting");
    await expect(
      q.disconnectOAuth({ id: 's9', kind: 'strava', label: 'Strava', config: {}, createdAt: 'T' }),
    ).rejects.toThrow("Couldn't disconnect");
  });
});
