import type { ConnectorKind, DateRange, Habit, HabitEvent, Source } from '../model';

export type NewEvent = Omit<HabitEvent, 'id'>;

/** An ingest token's metadata. The token itself is shown once and never stored. */
export interface IngestToken {
  id: string;
  sourceId: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

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
  /** putEvent for many at once (imports). */
  putEvents(events: NewEvent[]): Promise<void>;
  deleteEvent(id: string): Promise<void>;

  /** Whether OAuth sources (Strava) can be connected; false in demo mode. */
  readonly oauth: boolean;
  /** Start connecting an OAuth source: the URL to send the browser to. */
  connectOAuth(kind: ConnectorKind, returnTo: string): Promise<string>;
  /** Revoke an OAuth source at the provider and delete its data. */
  disconnectOAuth(source: Source): Promise<void>;

  /** Where apps POST events; shown when connecting one. */
  readonly ingestUrl: string;
  listIngestTokens(): Promise<IngestToken[]>;
  /** Revoke the source's tokens and return a new one. The caller shows it once. */
  issueIngestToken(sourceId: string): Promise<string>;
  revokeIngestTokens(sourceId: string): Promise<void>;
}

export class ReadOnlyError extends Error {
  constructor() {
    super('This scorecard is read-only.');
  }
}
