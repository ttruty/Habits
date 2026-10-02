import type { ServerConnector } from './types.ts';

export const minddrive: ServerConnector = {
  kind: 'minddrive',
  ingest: true,
  types: ['meditation.completed'],
  onConflict: 'ignore',
};
