import { describe, expect, it } from 'vitest';
import { hasScope, normalizeActivity, parseWebhook, strava, webhookChallenge } from './strava.ts';

const run = {
  id: 12345678901,
  sport_type: 'TrailRun',
  start_date: '2026-10-02T03:30:00Z',
  // 8:30 pm on 1 Oct in Los Angeles, written with a "Z" that isn't UTC.
  start_date_local: '2026-10-01T20:30:00Z',
  moving_time: 1834.6,
  distance: 5012.4,
};

describe('normalizeActivity', () => {
  it('keeps only sport, moving time and distance, on the local day', () => {
    expect(normalizeActivity(run)).toEqual({
      externalId: '12345678901',
      type: 'activity.created',
      occurredAt: '2026-10-02T03:30:00.000Z',
      localDate: '2026-10-01',
      value: 1835,
      unit: 'seconds',
      meta: { sport_type: 'TrailRun', distance: 5012 },
    });
  });

  it('copes without a distance', () => {
    const { distance: _d, ...yoga } = { ...run, sport_type: 'Yoga' };
    void _d;
    expect(normalizeActivity(yoga).meta).toEqual({ sport_type: 'Yoga' });
  });

  it('is a cached, updating, non-ingest connector', () => {
    expect(strava).toMatchObject({ ingest: false, onConflict: 'update', cacheDays: 7 });
  });
});

it('needs activity:read_all', () => {
  expect(hasScope('read,activity:read_all')).toBe(true);
  expect(hasScope('read,activity:read')).toBe(false);
  expect(hasScope(null)).toBe(false);
});

describe('webhooks', () => {
  it('answers the subscription check only with the right verify token', () => {
    const q = (s: string) => new URLSearchParams(s);
    expect(
      webhookChallenge(q('hub.mode=subscribe&hub.verify_token=v&hub.challenge=abc'), 'v'),
    ).toBe('abc');
    expect(
      webhookChallenge(q('hub.mode=subscribe&hub.verify_token=x&hub.challenge=abc'), 'v'),
    ).toBeNull();
    expect(
      webhookChallenge(q('hub.mode=other&hub.verify_token=v&hub.challenge=abc'), 'v'),
    ).toBeNull();
    expect(
      webhookChallenge(q('hub.mode=subscribe&hub.verify_token=&hub.challenge=abc'), ''),
    ).toBeNull();
  });

  it('turns every activity change into a refetch of that activity', () => {
    for (const aspect_type of ['create', 'update', 'delete']) {
      expect(
        parseWebhook({
          object_type: 'activity',
          object_id: 99,
          aspect_type,
          owner_id: 7,
          updates: {},
        }),
      ).toEqual({ kind: 'item', userId: '7', itemId: '99' });
    }
  });

  it('recognises deauthorization and ignores the rest', () => {
    expect(
      parseWebhook({
        object_type: 'athlete',
        object_id: 7,
        owner_id: 7,
        updates: { authorized: 'false' },
      }),
    ).toEqual({ kind: 'deauthorize', userId: '7' });
    expect(
      parseWebhook({ object_type: 'athlete', owner_id: 7, updates: { name: 'x' } }),
    ).toBeNull();
    expect(parseWebhook({ object_type: 'activity', object_id: 'x', owner_id: 7 })).toBeNull();
    expect(parseWebhook({ object_type: 'activity', object_id: 1, owner_id: -1 })).toBeNull();
    expect(parseWebhook(null)).toBeNull();
  });
});
