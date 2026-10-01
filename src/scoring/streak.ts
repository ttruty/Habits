import type { DateKey, Habit } from '../model';
import { addDays, startOfWeek, type Weekday } from './dates';
import { isMetric, type DayCell } from './score';
import { weekProgress } from './week';

export interface Streak {
  count: number;
  unit: 'days' | 'weeks';
}

/**
 * The current streak as of `today`, from `cells` covering history up to today (earlier days
 * missing from `cells` count as not done). Null for metric habits, which have no done state.
 *
 * - Daily habits (target 7) count consecutive done days.
 * - Weekly-target habits count consecutive weeks that met the target.
 * - Today and the current week are still open: they add to a streak once done, but never break it.
 */
export function currentStreak(
  habit: Habit,
  cells: readonly DayCell[],
  today: DateKey,
  weekStartsOn: Weekday = 1,
): Streak | null {
  if (isMetric(habit)) return null;

  if (habit.target.perWeek >= 7) {
    const done = new Set(cells.filter((c) => c.done).map((c) => c.date));
    let count = 0;
    let day = done.has(today) ? today : addDays(today, -1);
    for (; done.has(day); day = addDays(day, -1)) count++;
    return { count, unit: 'days' };
  }

  let count = 0;
  let from = startOfWeek(today, weekStartsOn);
  if (weekProgress(habit, cells, from, today).met) count++;
  for (
    from = addDays(from, -7);
    weekProgress(habit, cells, from, today).met;
    from = addDays(from, -7)
  ) {
    count++;
  }
  return { count, unit: 'weeks' };
}
