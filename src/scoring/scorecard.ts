import type { DateKey, DateRange, Habit, HabitEvent, Unit } from '../model';
import { addDays, startOfWeek, type Weekday } from './dates';
import { dedupe, matches, scoreHabit, type DayCell } from './score';
import { currentStreak, type Streak } from './streak';
import { weekProgress, type WeekProgress } from './week';

export interface ScoreRow {
  habit: Habit;
  /** One per day of the view. */
  cells: DayCell[];
  /** The last week of the view. */
  week: WeekProgress;
  /** As of today, whatever the view shows. */
  streak: Streak | null;
  /** Unit of the matched events, for display. Undefined if none matched. */
  unit?: Unit;
}

export interface ScorecardOptions {
  view: DateRange;
  today: DateKey;
  weekStartsOn?: Weekday;
  /** How far back streaks look. Defaults to a year before today. */
  historyFrom?: DateKey;
}

/** Everything the grid shows: one row per live habit, in `sort` order. */
export function buildScorecard(
  habits: readonly Habit[],
  events: readonly HabitEvent[],
  { view, today, weekStartsOn = 1, historyFrom = addDays(today, -365) }: ScorecardOptions,
): ScoreRow[] {
  const unique = dedupe(events);
  return habits
    .filter((h) => !h.archivedAt)
    .toSorted((a, b) => a.sort - b.sort)
    .map((habit) => {
      const cells = scoreHabit(habit, unique, view, today);
      const history = scoreHabit(habit, unique, { from: historyFrom, to: today }, today);
      const lastWeek = startOfWeek(view.to, weekStartsOn);
      return {
        habit,
        cells,
        week: weekProgress(habit, cells, lastWeek, today),
        streak: currentStreak(habit, history, today, weekStartsOn),
        unit: unique.find((e) => e.unit && matches(habit.match, e))?.unit,
      };
    });
}
