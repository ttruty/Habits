import type { ServerConnector } from './types.ts';

export const deckfit: ServerConnector = {
  kind: 'deckfit',
  types: ['workout.completed'],
  onConflict: 'ignore',
};
