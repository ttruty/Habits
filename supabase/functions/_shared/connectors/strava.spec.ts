import { describe, expect, it } from 'vitest';
import {
  FRESH_MS,
  expiresAt,
  hasScope,
  normalizeActivity,
  parseWebhook,
  safeReturnTo,
  strava,
  syncWindow,
  webhookChallenge,
  withOutcome,
} from './strava.ts';

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

describe('scope, expiry, return URLs', () => {
  it('needs activity:read_all', () => {
    expect(hasScope('read,activity:read_all')).toBe(true);
    expect(hasScope('read,activity:read')).toBe(false);
    expect(hasScope(null)).toBe(false);
  });

  it('expires cached rows 7 days out', () => {
    expect(expiresAt(new Date('2026-10-01T00:00:00Z'))).toBe('2026-10-08T00:00:00.000Z');
  });

  it('only returns to the Habits app', () => {
    const allowed = ['https://timtruty.com'];
    expect(safeReturnTo('https://timtruty.com/Habits/?x=1', allowed)).toBe(
      'https://timtruty.com/Habits/?x=1',
    );
    expect(safeReturnTo('https://evil.example/Habits/', allowed)).toBeNull();
    expect(safeReturnTo('not a url', allowed)).toBeNull();
    expect(safeReturnTo(42, allowed)).toBeNull();
    expect(withOutcome('https://timtruty.com/Habits/?x=1', 'connected')).toBe(
      'https://timtruty.com/Habits/?x=1&strava=connected',
    );
  });
});

describe('syncWindow', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const recent = new Date(now.getTime() - FRESH_MS + 60_000).toISOString();
  const stale = new Date(now.getTime() - FRESH_MS - 60_000).toISOString();

  it('does nothing when a recent fetch covers the range', () => {
    expect(
      syncWindow('2026-09-01', { synced_from: '2026-08-01', synced_at: recent }, now),
    ).toBeNull();
  });

  it('fetches when never synced, stale, or the range starts earlier', () => {
    const after = Date.parse('2026-09-01T00:00:00Z') / 1000 - 86_400;
    expect(syncWindow('2026-09-01', { synced_from: null, synced_at: null }, now)).toEqual({
      from: '2026-09-01',
      after,
    });
    expect(
      syncWindow('2026-09-01', { synced_from: '2026-08-01', synced_at: stale }, now),
    ).not.toBeNull();
    expect(
      syncWindow('2026-07-01', { synced_from: '2026-08-01', synced_at: recent }, now),
    ).not.toBeNull();
  });
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

  it('turns every activity change into a refetch', () => {
    for (const aspect_type of ['create', 'update', 'delete']) {
      expect(
        parseWebhook({
          object_type: 'activity',
          object_id: 99,
          aspect_type,
          owner_id: 7,
          updates: {},
        }),
      ).toEqual({ kind: 'refresh', athleteId: 7, activityId: 99 });
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
    ).toEqual({ kind: 'deauthorize', athleteId: 7 });
    expect(parseWebhook({ object_type: 'athlete', owner_id: 7, updates: { name: 'x' } })).toEqual({
      kind: 'ignore',
    });
    expect(parseWebhook({ object_type: 'activity', object_id: 'x', owner_id: 7 })).toEqual({
      kind: 'ignore',
    });
    expect(parseWebhook({ object_type: 'activity', object_id: 1, owner_id: -1 })).toEqual({
      kind: 'ignore',
    });
    expect(parseWebhook(null)).toEqual({ kind: 'ignore' });
  });
});
