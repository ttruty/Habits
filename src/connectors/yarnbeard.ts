import type { Connector } from './types';

// Yarnbeard reports the day's listening total (one event per day, resent as it grows) and each
// book it finishes.
export const yarnbeard: Connector = {
  kind: 'yarnbeard',
  displayName: 'Yarnbeard',
  mode: 'push',
  eventTypes: [
    { type: 'listening.day', unit: 'seconds', label: 'Listening per day' },
    { type: 'book.finished', unit: 'count', label: 'Book finished' },
  ],
  presets: [
    {
      name: 'Listen 20 min',
      icon: '🎧',
      color: 'blue',
      match: { types: ['listening.day'] },
      rule: { aggregate: 'sum', atLeast: 1200 },
      target: { perWeek: 7 },
    },
  ],
};
