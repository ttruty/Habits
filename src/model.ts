// Core model. See CLAUDE.md, "Core model".

export type ConnectorKind =
  | 'deckfit'
  | 'minddrive'
  | 'yarnbeard'
  | 'strava'
  | 'withings'
  | 'steam-windows'
  | 'webhook'
  | 'manual';

export type Unit = 'count' | 'seconds' | 'meters' | 'pages' | 'percent';

/** A local calendar day, 'YYYY-MM-DD'. */
export type DateKey = string;

/** Inclusive range of local days. */
export interface DateRange {
  from: DateKey;
  to: DateKey;
}

/** A place events come from. One row per connected account or app install. */
export interface Source {
  id: string;
  kind: ConnectorKind;
  label: string;
  /** Connector-specific, non-secret. */
  config: Record<string, unknown>;
  createdAt: string;
}

/** A fact reported by a source. Append-only. */
export interface HabitEvent {
  id: string;
  sourceId: string;
  /** Idempotency key from the source (session id, activity id, …). */
  externalId: string;
  type: string;
  /** ISO UTC. */
  occurredAt: string;
  /** The user's local day when it happened. Scoring uses this only. */
  localDate: DateKey;
  value?: number;
  unit?: Unit;
  /** Title, sport_type, deck name… never required for scoring. */
  meta?: Record<string, unknown>;
}

export interface HabitMatch {
  sourceIds?: string[];
  types: string[];
  /** Compared against `event.meta`. An array value means "any of". */
  where?: Record<string, unknown>;
}

export interface HabitRule {
  aggregate: 'count' | 'sum';
  /** A goal: done when the day's total reaches it. */
  atLeast?: number;
  /** A limit: missed when the day's total goes over it. */
  atMost?: number;
  // Neither = a tracked metric: the cell shows the amount, with no done/missed state.
}

/** The habit palette (design/tokens.css): render with var(--habit-<key>) / var(--habit-<key>-on). */
export const HABIT_COLORS = ['blue', 'violet', 'orange', 'coral', 'green', 'amber'] as const;
export type HabitColor = (typeof HABIT_COLORS)[number];

/** What I'm trying to do. Turns events into daily done / not-done. */
export interface Habit {
  id: string;
  name: string;
  /** An icon key from src/ui/icons.ts (HABIT_ICONS), never an emoji. */
  icon: string;
  /** A palette key, never a hex value. */
  color: HabitColor;
  match: HabitMatch;
  /** Per local day. */
  rule: HabitRule;
  /** 7 = daily; 3 = three times a week. */
  target: { perWeek: number };
  /** First local day the habit counts. Earlier days are never "missed". Absent = no start. */
  startDate?: DateKey;
  archivedAt?: string;
  sort: number;
}
