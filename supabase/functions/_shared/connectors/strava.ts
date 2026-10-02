// Strava: pure parts (no network). The OAuth provider is ../oauth/strava.ts.

import type { IngestEvent } from '../ingest.ts';
import type { WebhookHint } from '../oauth/types.ts';
import type { ServerConnector } from './types.ts';

export const strava: ServerConnector = {
  kind: 'strava',
  ingest: false,
  // An edited activity (new sport type, trimmed time) replaces the stored one.
  onConflict: 'update',
  // Strava API Policy §6.2: Strava data may be cached for at most 7 days.
  cacheDays: 7,
  types: ['activity.created'],
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

/** The reply to Strava's subscription check (GET ?hub.mode=subscribe…), or null to refuse. */
export function webhookChallenge(params: URLSearchParams, verifyToken: string): string | null {
  if (params.get('hub.mode') !== 'subscribe') return null;
  if (!verifyToken || params.get('hub.verify_token') !== verifyToken) return null;
  return params.get('hub.challenge');
}

/**
 * What a webhook POST asks for. Strava doesn't sign webhooks, so nothing in the payload is
 * trusted: every activity change (create, update or delete) becomes "refetch this activity from
 * Strava", which stores it, or deletes it if Strava no longer returns it.
 */
export function parseWebhook(body: unknown): WebhookHint | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const athleteId = Number(b.owner_id);
  const objectId = Number(b.object_id);
  if (!Number.isSafeInteger(athleteId) || athleteId <= 0) return null;
  const userId = String(athleteId);
  if (b.object_type === 'athlete') {
    const updates = b.updates as Record<string, unknown> | undefined;
    return updates?.authorized === 'false' ? { kind: 'deauthorize', userId } : null;
  }
  if (b.object_type === 'activity' && Number.isSafeInteger(objectId) && objectId > 0) {
    return { kind: 'item', userId, itemId: String(objectId) };
  }
  return null;
}
