import type { Connector } from './types';

// Event types only for now. Presets arrive with the connector itself (see plan.md).
export const yarnbeard: Connector = {
  kind: 'yarnbeard',
  displayName: 'Yarnbeard',
  mode: 'push',
  eventTypes: [
    { type: 'listening.day', unit: 'seconds', label: 'Listening per day' },
    { type: 'book.finished', unit: 'count', label: 'Book finished' },
  ],
  presets: [],
};
