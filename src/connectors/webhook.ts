import type { Connector } from './types';

// Event types only for now. Presets and recipes arrive in Phase 6.
export const webhook: Connector = {
  kind: 'webhook',
  displayName: 'Webhook',
  mode: 'webhook',
  eventTypes: [
    { type: 'check-in', unit: 'count', label: 'Check-in' },
    { type: 'reading.session', unit: 'seconds', label: 'Reading session' },
  ],
  presets: [],
};
