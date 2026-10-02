import { describe, expect, it } from 'vitest';
import { RateLimited, StravaError } from '../strava-api.ts';
import { WithingsError } from '../withings-api.ts';
import {
  FRESH_MS,
  expiresAt,
  isAuthFailure,
  safeReturnTo,
  syncWindow,
  utcDay,
  withOutcome,
} from './pure.ts';

it('expires cached rows days out', () => {
  expect(expiresAt(new Date('2026-10-01T00:00:00Z'), 7)).toBe('2026-10-08T00:00:00.000Z');
});

it('only returns to the Habits app, and says how it went', () => {
  const allowed = ['https://timtruty.com'];
  expect(safeReturnTo('https://timtruty.com/Habits/?x=1', allowed)).toBe(
    'https://timtruty.com/Habits/?x=1',
  );
  expect(safeReturnTo('https://evil.example/Habits/', allowed)).toBeNull();
  expect(safeReturnTo('not a url', allowed)).toBeNull();
  expect(safeReturnTo(42, allowed)).toBeNull();
  expect(withOutcome('https://timtruty.com/Habits/?x=1', 'withings', 'connected')).toBe(
    'https://timtruty.com/Habits/?x=1&oauth=withings%3Aconnected',
  );
});

it('turns epoch seconds into UTC days', () => {
  expect(utcDay(Date.parse('2026-10-01T23:30:00Z') / 1000)).toBe('2026-10-01');
  expect(utcDay(Date.parse('2026-10-01T23:30:00Z') / 1000, 1)).toBe('2026-10-02');
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
    expect(syncWindow('2026-09-01', { synced_from: null, synced_at: null }, now)).toBe(
      '2026-09-01',
    );
    expect(syncWindow('2026-09-01', { synced_from: '2026-08-01', synced_at: stale }, now)).toBe(
      '2026-09-01',
    );
    expect(syncWindow('2026-07-01', { synced_from: '2026-08-01', synced_at: recent }, now)).toBe(
      '2026-07-01',
    );
  });
});

it('treats only refused credentials as needing a reconnect', () => {
  expect(isAuthFailure(new StravaError(400, 'invalid_grant'))).toBe(true);
  expect(isAuthFailure(new StravaError(401, 'unauthorized'))).toBe(true);
  expect(isAuthFailure(new StravaError(500, 'server'))).toBe(false);
  expect(isAuthFailure(new WithingsError(401, 'invalid token'))).toBe(true);
  expect(isAuthFailure(new WithingsError(503, 'invalid params'))).toBe(false);
  expect(isAuthFailure(new RateLimited())).toBe(false);
  expect(isAuthFailure(new TypeError('fetch failed'))).toBe(false);
  expect(isAuthFailure(null)).toBe(false);
});
