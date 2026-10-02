import type { Connector } from './types';

// MindDrive reports a session when it plays to the end: value = its length in seconds.
export const minddrive: Connector = {
  kind: 'minddrive',
  displayName: 'MindDrive',
  mode: 'push',
  eventTypes: [{ type: 'meditation.completed', unit: 'seconds', label: 'Session finished' }],
  presets: [
    {
      name: 'Meditate',
      icon: 'mind',
      color: 'violet',
      match: { types: ['meditation.completed'] },
      rule: { aggregate: 'count', atLeast: 1 },
      target: { perWeek: 7 },
    },
  ],
};
