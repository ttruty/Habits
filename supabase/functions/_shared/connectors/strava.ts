// Strava: pure parts (no network). API calls live in ../strava-api.ts.

import type { IngestEvent } from '../ingest.ts';
import type { ServerConnector } from './types.ts';

export const strava: ServerConnector = {
  kind: 'strava',
  ingest: false,
  types: ['activity.created'],
  // An edited activity (new sport type, trimmed time) replaces the stored one.
  onConflict: 'update',
  // Strava API Policy §6.2: Strava data may be cached for at most 7 days.
  cacheDays: 7,
};

/** Private ("Only You") activities count too, so the scorecard needs read_all. */
export const STRAVA_SCOPE = 'activity:read_all';

/** The fields Habits uses from a Strava activity (summary or detailed). */
export interface StravaActivity {
  id: number;
  sport_type: string;
  /** UTC, ISO. */
  start_date: string;
  /** Local wall-clock time, written with a misleading "Z": the date part is the local day. */
  start_date_local: string;
  /** Seconds. */
  moving_time: number;
  /** Meters. */
  distance?: number;
}

/**
 * An activity as a Habits event. Only what scoring needs: sport, moving time, distance. No title,
 * description, location or route (API Policy §6.4: keep only what the purpose needs).
 */
export function normalizeActivity(a: StravaActivity): IngestEvent {
  return {
    externalId: String(a.id),
    type: 'activity.created',
    occurredAt: new Date(a.start_date).toISOString(),
    localDate: a.start_date_local.slice(0, 10),
    value: Math.round(a.moving_time),
    unit: 'seconds',
    meta: {
      sport_type: a.sport_type,
      ...(typeof a.distance === 'number' ? { distance: Math.round(a.distance) } : {}),
    },
  };
}

/** Whether the scope Strava granted (comma-separated, from the callback) includes `needed`. */
export function hasScope(granted: string | null, needed = STRAVA_SCOPE): boolean {
  return (granted ?? '')
    .split(',')
    .map((s) => s.trim())
    .includes(needed);
}

/** Cached rows expire this long after they were fetched. */
export function expiresAt(now: Date, days = strava.cacheDays!): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

export const FRESH_MS = 6 * 3600_000;

/**
 * What to fetch for a view of `from`…today: null when the last fetch covers it and is recent.
 * `after` (epoch seconds) starts a day early, because Strava filters by UTC and local days can
 * start up to 14 hours before UTC midnight.
 */
export function syncWindow(
  from: string,
  last: { synced_from: string | null; synced_at: string | null },
  now: Date,
  freshMs = FRESH_MS,
): { from: string; after: number } | null {
  const fresh =
    last.synced_at &&
    last.synced_from &&
    last.synced_from <= from &&
    now.getTime() - Date.parse(last.synced_at) < freshMs;
  if (fresh) return null;
  const after = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000) - 86_400;
  return { from, after };
}

/** The reply to Strava's subscription check (GET ?hub.mode=subscribe…), or null to refuse. */
export function webhookChallenge(params: URLSearchParams, verifyToken: string): string | null {
  if (params.get('hub.mode') !== 'subscribe') return null;
  if (!verifyToken || params.get('hub.verify_token') !== verifyToken) return null;
  return params.get('hub.challenge');
}

export type WebhookAction =
  | { kind: 'refresh'; athleteId: number; activityId: number }
  | { kind: 'deauthorize'; athleteId: number }
  | { kind: 'ignore' };

/**
 * What a webhook POST asks for. Strava doesn't sign webhooks, so nothing in the payload is
 * trusted: every activity change (create, update or delete) becomes "refetch this activity from
 * Strava", which stores it, or deletes it if Strava no longer returns it.
 */
export function parseWebhook(body: unknown): WebhookAction {
  if (typeof body !== 'object' || body === null) return { kind: 'ignore' };
  const b = body as Record<string, unknown>;
  const athleteId = Number(b.owner_id);
  const objectId = Number(b.object_id);
  if (!Number.isSafeInteger(athleteId) || athleteId <= 0) return { kind: 'ignore' };
  if (b.object_type === 'athlete') {
    const updates = b.updates as Record<string, unknown> | undefined;
    return updates?.authorized === 'false'
      ? { kind: 'deauthorize', athleteId }
      : { kind: 'ignore' };
  }
  if (b.object_type === 'activity' && Number.isSafeInteger(objectId) && objectId > 0) {
    return { kind: 'refresh', athleteId, activityId: objectId };
  }
  return { kind: 'ignore' };
}

/** `url` if it's on an allowed origin (where to send the browser after connecting), else null. */
export function safeReturnTo(url: unknown, allowedOrigins: readonly string[]): string | null {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    return allowedOrigins.includes(u.origin) ? u.href : null;
  } catch {
    return null;
  }
}

/** `returnTo` with ?strava=<outcome> added, for the app to show what happened. */
export function withOutcome(returnTo: string, outcome: string): string {
  const u = new URL(returnTo);
  u.searchParams.set('strava', outcome);
  return u.href;
}
