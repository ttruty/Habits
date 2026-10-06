import type { ConnectorKind, Habit, Unit } from '../model';

/**
 * A meta field the habit editor can narrow a habit by ("Activities that count"). Each option
 * stands for one or more raw values; the habit stores the values in `match.where[key]`.
 */
export interface MetaFilter {
  key: string;
  /** The editor's legend, e.g. "Activities that count". */
  label: string;
  options: { label: string; values: string[] }[];
}

/** Client-side connector descriptor. Server-side `normalize` lives in supabase/functions. */
export interface Connector {
  kind: ConnectorKind;
  displayName: string;
  /** How events arrive: pushed by the app, pulled or received server-side, or entered by hand. */
  mode: 'push' | 'oauth' | 'webhook' | 'manual';
  /** Event types this connector can emit, with a default unit. Used by the habit editor. */
  /** `amountLabel` names the editor's amount when the unit alone doesn't ("steps", not "times"). */
  /** `filter` lets a habit count only some of these events, e.g. runs but not walks. */
  eventTypes: {
    type: string;
    unit?: Unit;
    label: string;
    amountLabel?: string;
    filter?: MetaFilter;
  }[];
  /** Suggested habits shown when the source is first connected. */
  presets: Omit<Habit, 'id' | 'sort'>[];
  /** Required credit wherever this source's data shows (e.g. "Powered by Strava"). */
  attribution?: { text: string; href: string };
  /**
   * OAuth sources whose provider limits caching: the Edge Function route that refetches a range
   * before it's read (see CLAUDE.md, Strava).
   */
  syncPath?: string;
}
