import type { IngestToken } from '../data/provider';
import type { DateKey, Habit, HabitEvent, Source } from '../model';

// How pages talk to the app shell (habits-app): bubbling, composed events.

/** Where the app is. Tabs: today, progress, sources, more; the rest are reached from them. */
export type Route =
  | { name: 'today' }
  | { name: 'grid' }
  | { name: 'progress'; habitId?: string }
  | { name: 'form'; habitId?: string }
  | { name: 'manage' }
  | { name: 'sources' }
  | { name: 'more' };

/** What every page reads. Loaded once by the shell; pages ask for a reload after changes. */
export interface AppData {
  habits: Habit[];
  sources: Source[];
  events: HabitEvent[];
  tokens: IngestToken[];
  today: DateKey;
}

/** A message with an optional undo, shown for 4 seconds above the tab bar. */
export interface Toast {
  message: string;
  undo?: () => Promise<void>;
}

/** Ask the app to go somewhere. */
export const navigate = (from: HTMLElement, route: Route) =>
  from.dispatchEvent(new CustomEvent('navigate', { detail: route, bubbles: true, composed: true }));

/** Tell the app its data changed, so it reloads. */
export const changed = (from: HTMLElement) =>
  from.dispatchEvent(new Event('changed', { bubbles: true, composed: true }));

/** Show a toast, optionally with Undo. */
export const toast = (from: HTMLElement, t: Toast) =>
  from.dispatchEvent(new CustomEvent('toast', { detail: t, bubbles: true, composed: true }));
