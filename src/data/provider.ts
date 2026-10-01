import type { DateRange, Habit, HabitEvent, Source } from '../model';

/** Everything the UI reads. The demo and Supabase providers both implement it. */
export interface DataProvider {
  listSources(): Promise<Source[]>;
  listHabits(): Promise<Habit[]>;
  /** Events whose `localDate` falls in the range. */
  listEvents(range: DateRange): Promise<HabitEvent[]>;
}
