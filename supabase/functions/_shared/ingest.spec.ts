import { describe, expect, it } from 'vitest';
import { deckfit } from './connectors/deckfit.ts';
import { serverConnectorFor } from './connectors/registry.ts';
import { yarnbeard } from './connectors/yarnbeard.ts';
import {
  MAX_BATCH,
  bearer,
  corsHeaders,
  eventError,
  isDateKey,
  parseBatch,
  sha256Hex,
  toRow,
} from './ingest.ts';

const good = {
  externalId: 'session-1',
  type: 'workout.completed',
  occurredAt: '2026-10-01T18:30:00-04:00',
  localDate: '2026-10-01',
  value: 1500,
  unit: 'seconds',
  meta: { game: 'Ladder' },
};

describe('eventError', () => {
  it('accepts a valid event', () => {
    expect(eventError(good, deckfit)).toBeNull();
    expect(
      eventError({ ...good, value: undefined, unit: undefined, meta: undefined }, deckfit),
    ).toBeNull();
  });

  it.each([
    [null, 'not an object'],
    [[], 'not an object'],
    [{ ...good, externalId: '' }, 'externalId'],
    [{ ...good, externalId: 'x'.repeat(201) }, 'externalId'],
    [{ ...good, type: 'listening.day' }, 'type must be one of: workout.completed'],
    [{ ...good, occurredAt: 'yesterday' }, 'occurredAt'],
    [{ ...good, localDate: '2026-02-30' }, 'localDate'],
    [{ ...good, localDate: '10/01/2026' }, 'localDate'],
    [{ ...good, value: Number.NaN }, 'value'],
    [{ ...good, value: '5' }, 'value'],
    [{ ...good, unit: 'minutes' }, 'unit'],
    [{ ...good, meta: 'x' }, 'meta must be an object'],
    [{ ...good, meta: { big: 'x'.repeat(5000) } }, 'meta must be under'],
  ])('rejects %j', (raw, message) => {
    expect(eventError(raw, deckfit)).toContain(message);
  });
});

describe('parseBatch', () => {
  it('needs an events array of at most 100', () => {
    expect(parseBatch({}, deckfit)).toEqual({
      ok: false,
      error: 'Body must be { "events": [...] }',
    });
    expect(parseBatch(null, deckfit).ok).toBe(false);
    const big = { events: Array.from({ length: MAX_BATCH + 1 }, () => good) };
    expect(parseBatch(big, deckfit)).toEqual({
      ok: false,
      error: 'At most 100 events per request',
    });
  });

  it('keeps valid events, rejects bad ones by index, and normalises timestamps', () => {
    const result = parseBatch({ events: [good, { ...good, type: 'nope' }] }, deckfit);
    expect(result).toEqual({
      ok: true,
      events: [{ ...good, occurredAt: '2026-10-01T22:30:00.000Z' }],
      rejected: [{ index: 1, error: 'type must be one of: workout.completed' }],
    });
  });

  it('keeps the last copy of a repeated externalId', () => {
    const day = { ...good, type: 'listening.day', externalId: 'yarnbeard:2026-10-01' };
    const result = parseBatch(
      {
        events: [
          { ...day, value: 600 },
          { ...day, value: 900 },
        ],
      },
      yarnbeard,
    );
    expect(result.ok && result.events.map((e) => e.value)).toEqual([900]);
  });

  it('drops absent optional fields', () => {
    const { value: _v, unit: _u, meta: _m, ...bare } = good;
    void [_v, _u, _m];
    const result = parseBatch({ events: [bare] }, deckfit);
    expect(result.ok && result.events[0]).toEqual({
      ...bare,
      occurredAt: '2026-10-01T22:30:00.000Z',
    });
  });
});

describe('connectors', () => {
  it('chooses update or ignore per connector', () => {
    expect(serverConnectorFor('yarnbeard')?.onConflict).toBe('update');
    expect(serverConnectorFor('deckfit')?.onConflict).toBe('ignore');
    expect(serverConnectorFor('minddrive')?.onConflict).toBe('ignore');
    expect(serverConnectorFor('manual')).toBeUndefined();
    expect(serverConnectorFor('strava')?.ingest).toBe(false);
    expect(serverConnectorFor('deckfit')?.ingest).toBe(true);
  });
});

describe('helpers', () => {
  it('maps an event to a row', () => {
    const { value: _v, unit: _u, meta: _m, ...bare } = good;
    void [_v, _u, _m];
    expect(toRow(bare, 'owner', 'source')).toEqual({
      owner_id: 'owner',
      source_id: 'source',
      external_id: 'session-1',
      type: 'workout.completed',
      occurred_at: good.occurredAt,
      local_date: '2026-10-01',
      value: null,
      unit: null,
      meta: null,
    });
    expect(toRow(good as never, 'o', 's')).toMatchObject({ value: 1500, unit: 'seconds' });
    expect(toRow(good as never, 'o', 's')).not.toHaveProperty('expires_at');
    expect(toRow(good as never, 'o', 's', '2026-10-08T00:00:00.000Z').expires_at).toBe(
      '2026-10-08T00:00:00.000Z',
    );
  });

  it('reads bearer tokens', () => {
    expect(bearer('Bearer abc')).toBe('abc');
    expect(bearer('bearer abc')).toBe('abc');
    expect(bearer('Basic abc')).toBeNull();
    expect(bearer(null)).toBeNull();
  });

  it('hashes with SHA-256', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('allows the headers supabase-js sends, so functions.invoke passes the preflight', () => {
    const allowed = corsHeaders('https://timtruty.com', ['https://timtruty.com'])
      ['Access-Control-Allow-Headers'].split(',')
      .map((h) => h.trim());
    for (const h of ['authorization', 'apikey', 'content-type', 'x-client-info']) {
      expect(allowed).toContain(h);
    }
  });

  it('allows only listed origins', () => {
    const allowed = ['https://timtruty.com'];
    expect(corsHeaders('https://timtruty.com', allowed)['Access-Control-Allow-Origin']).toBe(
      'https://timtruty.com',
    );
    expect(corsHeaders('https://evil.example', allowed)).not.toHaveProperty(
      'Access-Control-Allow-Origin',
    );
    expect(corsHeaders(null, allowed)).not.toHaveProperty('Access-Control-Allow-Origin');
  });

  it('checks calendar dates', () => {
    expect(isDateKey('2028-02-29')).toBe(true);
    expect(isDateKey('2026-02-29')).toBe(false);
    expect(isDateKey(20261001)).toBe(false);
  });
});
