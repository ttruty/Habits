import type { Connector } from './types';

// Event types only for now. Presets arrive with the connector itself (see plan.md).
export const strava: Connector = {
  kind: 'strava',
  displayName: 'Strava',
  mode: 'oauth',
  eventTypes: [{ type: 'activity.created', unit: 'meters', label: 'Activity' }],
  presets: [],
};
