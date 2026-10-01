import type { Connector } from './types';

// Event types only for now. Presets arrive with the connector itself (see plan.md).
export const deckfit: Connector = {
  kind: 'deckfit',
  displayName: 'DeckFit',
  mode: 'push',
  eventTypes: [{ type: 'workout.completed', unit: 'seconds', label: 'Workout finished' }],
  presets: [],
};
