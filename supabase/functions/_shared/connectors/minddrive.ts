import type { ServerConnector } from './types.ts';

export const minddrive: ServerConnector = {
  kind: 'minddrive',
  types: ['meditation.completed'],
  onConflict: 'ignore',
};
