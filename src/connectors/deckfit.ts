import type { Connector } from './types';

// DeckFit reports each game session when it ends: value = seconds, meta = { game, deck, outcome }.
// outcome is 'finished' or 'abandoned'; the preset counts finished ones only.
export const deckfit: Connector = {
  kind: 'deckfit',
  displayName: 'DeckFit',
  mode: 'push',
  eventTypes: [
    {
      type: 'workout.completed',
      unit: 'seconds',
      label: 'Workout',
      filter: {
        key: 'outcome',
        label: 'Workouts that count',
        options: [
          { label: 'Finished', values: ['finished'] },
          { label: 'Ended early', values: ['abandoned'] },
        ],
      },
    },
  ],
  presets: [
    {
      name: 'Workout',
      icon: 'dumbbell',
      color: 'green',
      match: { types: ['workout.completed'], where: { outcome: 'finished' } },
      rule: { aggregate: 'count', atLeast: 1 },
      target: { perWeek: 4 },
    },
  ],
};
