import type { ServerConnector } from './types.ts';

export const deckfit: ServerConnector = {
  kind: 'deckfit',
  ingest: true,
  types: ['workout.completed'],
  onConflict: 'ignore',
};
