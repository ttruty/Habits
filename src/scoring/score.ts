import type { DateKey, DateRange, Habit, HabitEvent, HabitMatch } from '../model';
import { eachDay, inRange } from './dates';

/**
 * - `done` / `missed`: decided.
 * - `pending`: today, not decided yet (goal not reached, or a limit day that isn't over).
 * - `future`: after today.
 * - `inactive`: before the habit's start date. Never counts as missed.
 * - `metric`: the habit has no goal or limit; only the value matters.
 */
export type CellState = 'done' | 'missed' | 'pending' | 'future' | 'inactive' | 'metric';

export interface DayCell {
  date: DateKey;
  /** The day's aggregate: number of events (`count`) or total of their values (`sum`). */
  value: number;
  state: CellState;
  done: boolean;
}

export function isMetric(habit: Habit): boolean {
  return habit.rule.atLeast === undefined && habit.rule.atMost === undefined;
}

/**
 * One event per `(sourceId, externalId)`. Sources may resend freely; the last copy wins, so a
 * later progress update (e.g. a Steam session still running) replaces the earlier one.
 */
export function dedupe(events: readonly HabitEvent[]): HabitEvent[] {
  const byKey = new Map<string, HabitEvent>();
  for (const e of events) byKey.set(`${e.sourceId}\u0000${e.externalId}`, e);
  return [...byKey.values()];
}

/**
 * An entry added by hand to correct a habit's day (a source missed it, or under-counted). It
 * names its habit in meta.habit_id and counts for that habit whatever the habit's match says.
 */
export const MANUAL_ENTRY = 'manual.entry';

export function isEntryFor(habit: Habit, event: HabitEvent): boolean {
  return event.type === MANUAL_ENTRY && event.meta?.habit_id === habit.id;
}

/** Whether `event` counts towards `habit`: it matches the habit, or it's an entry for it. */
export function countsFor(habit: Habit, event: HabitEvent): boolean {
  return isEntryFor(habit, event) || matches(habit.match, event);
}

export function matches(match: HabitMatch, event: HabitEvent): boolean {
  if (!match.types.includes(event.type)) return false;
  if (match.sourceIds && !match.sourceIds.includes(event.sourceId)) return false;
  for (const [key, want] of Object.entries(match.where ?? {})) {
    const have = event.meta?.[key];
    if (Array.isArray(want) ? !want.includes(have) : have !== want) return false;
  }
  return true;
}

/**
 * What one event adds to a `count` habit's day: 1, except an entry in counts, which adds its
 * value (one "Mark done" entry stands in for everything that was missing).
 */
function countOf(habit: Habit, e: HabitEvent): number {
  return isEntryFor(habit, e) && e.unit === 'count' ? (e.value ?? 1) : 1;
}

/** Per-day cells for `range`. `today` decides what's still open; nothing here reads the clock. */
export function scoreHabit(
  habit: Habit,
  events: readonly HabitEvent[],
  range: DateRange,
  today: DateKey,
): DayCell[] {
  const totals = new Map<DateKey, number>();
  for (const e of dedupe(events)) {
    if (!inRange(e.localDate, range) || !countsFor(habit, e)) continue;
    const amount = habit.rule.aggregate === 'count' ? countOf(habit, e) : (e.value ?? 0);
    totals.set(e.localDate, (totals.get(e.localDate) ?? 0) + amount);
  }

  return eachDay(range).map((date) => {
    const value = totals.get(date) ?? 0;
    const state = cellState(habit, date, value, today);
    return { date, value, state, done: state === 'done' };
  });
}

function cellState(habit: Habit, date: DateKey, value: number, today: DateKey): CellState {
  if (date > today) return 'future';
  if (habit.startDate && date < habit.startDate) return 'inactive';
  if (isMetric(habit)) return 'metric';

  const { atLeast, atMost } = habit.rule;
  // A day's total only grows, so going over a limit is final even today.
  if (atMost !== undefined && value > atMost) return 'missed';
  const short = atLeast !== undefined && value < atLeast;
  if (date === today) return short || atMost !== undefined ? 'pending' : 'done';
  return short ? 'missed' : 'done';
}
