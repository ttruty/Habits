/** Server-side connector: what a source may send to /ingest and how resends are stored. */
export interface ServerConnector {
  kind: string;
  /** Sends events to /ingest with an ingest token (first-party apps). OAuth sources don't. */
  ingest: boolean;
  /** Event types this source may send. Anything else is rejected. */
  types: readonly string[];
  /**
   * A resend with a known (source, externalId):
   * - 'ignore': a duplicate, dropped (the default; most events never change).
   * - 'update': replaces the stored value (Yarnbeard's listening.day grows during the day).
   */
  onConflict: 'ignore' | 'update';
  /**
   * The provider's terms limit how long its data may be kept (Strava: 7 days). Rows get an
   * expires_at this many days out; a daily job deletes them and the app refetches on view.
   */
  cacheDays?: number;
}
