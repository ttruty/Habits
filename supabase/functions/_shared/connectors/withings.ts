// Withings: pure parts (no network). The OAuth provider is ../oauth/withings.ts.

import type { IngestEvent } from '../ingest.ts';
import { utcDay } from '../oauth/pure.ts';
import type { WebhookHint } from '../oauth/types.ts';
import type { ServerConnector } from './types.ts';

export const withings: ServerConnector = {
  kind: 'withings',
  ingest: false,
  // A day's steps grow during the day; an edited workout replaces the stored one.
  onConflict: 'update',
  types: ['workout.completed', 'steps.day'],
};

/** Activity (steps, workouts) only. */
export const WITHINGS_SCOPE = 'user.activity';

/** Notification category for activity: steps, distance and workouts. */
export const APPLI_ACTIVITY = 16;

/** Withings workout categories (Measure v2 getworkouts), as plain names for habit filters. */
export const WORKOUT_CATEGORIES: Record<number, string> = {
  1: 'walk',
  2: 'run',
  3: 'hiking',
  4: 'skating',
  5: 'bmx',
  6: 'bicycling',
  7: 'swimming',
  8: 'surfing',
  9: 'kitesurfing',
  10: 'windsurfing',
  11: 'bodyboard',
  12: 'tennis',
  13: 'table_tennis',
  14: 'squash',
  15: 'badminton',
  16: 'lift_weights',
  17: 'calisthenics',
  18: 'elliptical',
  19: 'pilates',
  20: 'basketball',
  21: 'soccer',
  22: 'football',
  23: 'rugby',
  24: 'volleyball',
  25: 'waterpolo',
  26: 'horse_riding',
  27: 'golf',
  28: 'yoga',
  29: 'dancing',
  30: 'boxing',
  31: 'fencing',
  32: 'wrestling',
  33: 'martial_arts',
  34: 'skiing',
  35: 'snowboarding',
  36: 'other',
  128: 'no_activity',
  187: 'rowing',
  188: 'zumba',
  191: 'baseball',
  192: 'handball',
  193: 'hockey',
  194: 'ice_hockey',
  195: 'climbing',
  196: 'ice_skating',
  272: 'multi_sport',
  306: 'indoor_walk',
  307: 'indoor_running',
  308: 'indoor_cycling',
};

/** A getworkouts series entry (fields Habits uses). */
export interface WithingsWorkout {
  id: number;
  category: number;
  /** Epoch seconds. */
  startdate: number;
  enddate: number;
  /** The local day, 'YYYY-MM-DD'. */
  date: string;
  data?: { steps?: number; distance?: number; pause_duration?: number };
}

/** A getactivity entry: one per local day. */
export interface WithingsActivity {
  date: string;
  steps?: number;
}

/** A workout as `workout.completed`: value = active seconds (end − start − pauses). */
export function normalizeWorkout(w: WithingsWorkout): IngestEvent {
  const pause = w.data?.pause_duration ?? 0;
  return {
    externalId: `workout:${w.id}`,
    type: 'workout.completed',
    occurredAt: new Date(w.startdate * 1000).toISOString(),
    localDate: w.date,
    value: Math.max(0, Math.round(w.enddate - w.startdate - pause)),
    unit: 'seconds',
    meta: {
      category: WORKOUT_CATEGORIES[w.category] ?? 'other',
      ...(w.data?.distance ? { distance: Math.round(w.data.distance) } : {}),
      ...(w.data?.steps ? { steps: Math.round(w.data.steps) } : {}),
    },
  };
}

/**
 * A day's steps as `steps.day` (one per day, updated as it grows). Days with several entries
 * (more than one tracker) keep the highest count.
 */
export function normalizeSteps(days: readonly WithingsActivity[]): IngestEvent[] {
  const best = new Map<string, number>();
  for (const d of days) {
    if (!d.date || typeof d.steps !== 'number') continue;
    best.set(d.date, Math.max(best.get(d.date) ?? 0, d.steps));
  }
  return [...best].map(([date, steps]) => ({
    externalId: `steps:${date}`,
    type: 'steps.day',
    occurredAt: `${date}T12:00:00.000Z`,
    localDate: date,
    value: Math.round(steps),
    unit: 'count',
  }));
}

/**
 * A Withings notification (form-encoded POST: userid, appli, startdate, enddate) as "refetch these
 * days". Withings doesn't sign notifications, so this is only a hint. The span is widened by a day
 * on each side because it's in UTC and the days are local.
 */
export function parseNotification(form: URLSearchParams): WebhookHint | null {
  const userId = form.get('userid');
  if (!userId || !/^\d+$/.test(userId)) return null;
  if (Number(form.get('appli')) !== APPLI_ACTIVITY) return null;
  const start = Number(form.get('startdate'));
  const end = Number(form.get('enddate') ?? form.get('startdate'));
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0) return null;
  return { kind: 'range', userId, from: utcDay(start, -1), to: utcDay(Math.max(start, end), 1) };
}
