import type { ConnectorKind, Habit, Unit } from '../model';

/** Client-side connector descriptor. Server-side `normalize` lives in supabase/functions. */
export interface Connector {
  kind: ConnectorKind;
  displayName: string;
  /** How events arrive: pushed by the app, pulled or received server-side, or entered by hand. */
  mode: 'push' | 'oauth' | 'webhook' | 'manual';
  /** Event types this connector can emit, with a default unit. Used by the habit editor. */
  eventTypes: { type: string; unit?: Unit; label: string }[];
  /** Suggested habits shown when the source is first connected. */
  presets: Omit<Habit, 'id' | 'sort'>[];
}
