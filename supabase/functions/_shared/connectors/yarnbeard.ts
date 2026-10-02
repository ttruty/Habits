import type { ServerConnector } from './types.ts';

// listening.day is sent again as the day's total grows (same externalId, larger value).
export const yarnbeard: ServerConnector = {
  kind: 'yarnbeard',
  ingest: true,
  types: ['listening.day', 'book.finished'],
  onConflict: 'update',
};
