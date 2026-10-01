import type { Connector } from './types';

// Event types only for now. Presets arrive with the connector itself (see plan.md).
export const minddrive: Connector = {
  kind: 'minddrive',
  displayName: 'MindDrive',
  mode: 'push',
  eventTypes: [{ type: 'meditation.completed', unit: 'seconds', label: 'Meditation finished' }],
  presets: [],
};
