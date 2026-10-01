import type { DateKey, Habit } from '../model';
import { addDays, eachDay } from './dates';
import type { DayCell } from './score';

export interface WeekProgress {
  /** First day of the week. */
  from: DateKey;
  /** Days done. */
  done: number;
  /** `perWeek`, lowered to the days the habit was active that week (a habit started mid-week). */
  target: number;
  /** Total value over the week, for metric habits. */
  total: number;
  met: boolean;
  /** The week contains today or later, so it isn't over. */
  open: boolean;
}

/**
 * Progress for the week starting `from`. `cells` may cover more or less than the week; days not
 * in it count as not done.
 */
export function weekProgress(
  habit: Habit,
  cells: readonly DayCell[],
  from: DateKey,
  today: DateKey,
): WeekProgress {
  const byDate = new Map(cells.map((c) => [c.date, c]));
  const days = eachDay({ from, to: addDays(from, 6) });
  const active = days.filter((d) => !habit.startDate || d >= habit.startDate).length;
  const target = Math.min(habit.target.perWeek, active);
  let done = 0;
  let total = 0;
  for (const day of days) {
    const cell = byDate.get(day);
    if (cell?.done) done++;
    total += cell?.value ?? 0;
  }
  return { from, done, target, total, met: target > 0 && done >= target, open: days[6] >= today };
}
