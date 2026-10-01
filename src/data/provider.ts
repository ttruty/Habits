import type { DateRange, Habit, HabitEvent, Source } from '../model';

export type NewEvent = Omit<HabitEvent, 'id'>;

/** Everything the UI reads and writes. The demo and Supabase providers both implement it. */
export interface DataProvider {
  /** False for read-only providers (embeds); their write methods throw. */
  readonly canEdit: boolean;

  listSources(): Promise<Source[]>;
  listHabits(): Promise<Habit[]>;
  /** Events whose `localDate` falls in the range. */
  listEvents(range: DateRange): Promise<HabitEvent[]>;

  addSource(source: Pick<Source, 'kind' | 'label' | 'config'>): Promise<Source>;
  /** Insert or update by id. */
  saveHabit(habit: Habit): Promise<void>;
  /** Set `sort` to each habit's position in `ids`. */
  saveHabitOrder(ids: string[]): Promise<void>;
  /** Insert, or update the event with the same (sourceId, externalId). */
  putEvent(event: NewEvent): Promise<void>;
  deleteEvent(id: string): Promise<void>;
}

export class ReadOnlyError extends Error {
  constructor() {
    super('This scorecard is read-only.');
  }
}
