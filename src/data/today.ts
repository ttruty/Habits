import { checkInEvent, checkInsOn, entryEvent, manualSourceOf } from '../connectors/manual';
import { formatValue } from '../format';
import type { DateKey, Habit, HabitEvent, Source, Unit } from '../model';
import { addDays, startOfWeek, type Weekday } from '../scoring/dates';
import { buildScorecard, type ScoreRow } from '../scoring/scorecard';
import { dedupe, isEntryFor, type DayCell } from '../scoring/score';
import type { NewEvent } from './provider';

/** One habit on one day, as the Today screen shows it. */
export interface HabitDay {
  habit: Habit;
  row: ScoreRow;
  cell: DayCell;
  /** goal: at least something; limit: at most; metric: just tracked. */
  kind: 'goal' | 'limit' | 'metric';
  /** Entries the owner added (check-ins, corrections) on this day: what "undo" removes. */
  own: HabitEvent[];
  /** toggle: the check marks done / not done. details: done by a source, so it shows the report. */
  check: 'toggle' | 'details' | 'none';
  /** The habit's unit (seconds, meters…), for amounts. */
  unit?: Unit;
}

export function kindOf(habit: Habit): HabitDay['kind'] {
  if (habit.rule.atLeast !== undefined) return 'goal';
  if (habit.rule.atMost !== undefined) return 'limit';
  return 'metric';
}

/** Every live habit on `date`, with its week (for streaks and the strip) scored around it. */
export function habitsOnDay(
  habits: readonly Habit[],
  sources: readonly Source[],
  events: readonly HabitEvent[],
  date: DateKey,
  today: DateKey,
  weekStartsOn: Weekday = 1,
): HabitDay[] {
  const from = startOfWeek(date, weekStartsOn);
  const rows = buildScorecard(habits, events, {
    view: { from, to: addDays(from, 6) },
    today,
    weekStartsOn,
  });
  const unique = dedupe(events);
  return rows.map((row) => {
    const { habit } = row;
    const cell = row.cells.find((c) => c.date === date)!;
    const manual = manualSourceOf(habit, sources);
    const own = unique.filter(
      (e) =>
        e.localDate === date &&
        (isEntryFor(habit, e) || (manual && checkInsOn(habit, manual, date, [e]).length > 0)),
    );
    const kind = kindOf(habit);
    const open = cell.state !== 'future' && cell.state !== 'inactive';
    const check: HabitDay['check'] =
      kind !== 'goal' || !open ? 'none' : cell.done && own.length === 0 ? 'details' : 'toggle';
    return { habit, row, cell, kind, own, check, unit: row.unit };
  });
}

/** Goal habits done on `date` out of all goal habits active that day. */
export function dayProgress(days: readonly HabitDay[]): { done: number; total: number } {
  const goals = days.filter((d) => d.kind === 'goal' && d.cell.state !== 'inactive');
  return { done: goals.filter((d) => d.cell.done).length, total: goals.length };
}

const frequency = (n: number) => (n >= 7 ? 'Every day' : `${n}× a week`);

/** "Every day · 4-day streak", "Every day · 8 min of 20 min", "Up to 1h 30m · 40 min so far". */
export function metaLine(d: HabitDay): string {
  const { habit, cell, unit } = d;
  const amount = (n: number) => formatValue(n, unit);
  if (d.kind === 'metric') return `${amount(cell.value)} today`;
  if (d.kind === 'limit')
    return `Up to ${amount(habit.rule.atMost!)} · ${amount(cell.value)} so far`;
  const parts = [frequency(habit.target.perWeek)];
  const atLeast = habit.rule.atLeast!;
  if (!cell.done && habit.rule.aggregate === 'sum' && cell.value > 0) {
    parts.push(`${amount(cell.value)} of ${amount(atLeast)}`);
  } else if (d.row.streak && d.row.streak.count > 0) {
    const { count, unit: per } = d.row.streak;
    parts.push(`${count}-${per === 'days' ? 'day' : 'week'} streak`);
  }
  return parts.join(' · ');
}

/**
 * The events that mark a goal habit done on `date`: a check-in for a hand-ticked habit, otherwise
 * one entry for exactly what's missing (the counts still needed, or the missing amount).
 */
export function markDoneEvents(
  d: HabitDay,
  manual: Source,
  date: DateKey,
  today: DateKey,
  now: Date,
): NewEvent[] {
  const { habit, cell } = d;
  const handTicked =
    habit.match.types.includes('check-in') && manual.id === habit.match.sourceIds?.[0];
  if (handTicked) return [checkInEvent(habit, manual, date, today, now)];
  const missing = Math.max(1, (habit.rule.atLeast ?? 1) - cell.value);
  if (habit.rule.aggregate === 'count') {
    return [
      entryEvent(habit, manual, date, { value: Math.ceil(missing), unit: 'count' }, today, now),
    ];
  }
  return [entryEvent(habit, manual, date, { value: missing, unit: d.unit }, today, now)];
}

/** Days of the week where every goal habit was done (the WeekStrip dots). */
export function allDoneDays(
  habits: readonly Habit[],
  sources: readonly Source[],
  events: readonly HabitEvent[],
  days: readonly DateKey[],
  today: DateKey,
  weekStartsOn: Weekday = 1,
): Set<DateKey> {
  const out = new Set<DateKey>();
  for (const date of days) {
    if (date > today) continue;
    const { done, total } = dayProgress(
      habitsOnDay(habits, sources, events, date, today, weekStartsOn),
    );
    if (total > 0 && done === total) out.add(date);
  }
  return out;
}
