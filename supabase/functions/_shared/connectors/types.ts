/** Server-side connector: what a source may send to /ingest and how resends are stored. */
export interface ServerConnector {
  kind: string;
  /** Event types this source may send. Anything else is rejected. */
  types: readonly string[];
  /**
   * A resend with a known (source, externalId):
   * - 'ignore': a duplicate, dropped (the default; most events never change).
   * - 'update': replaces the stored value (Yarnbeard's listening.day grows during the day).
   */
  onConflict: 'ignore' | 'update';
}
