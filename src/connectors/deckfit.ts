import type { Connector } from './types';

// DeckFit reports a game session once a card is done (outcome 'in_progress', value = seconds so
// far) and again when it ends ('finished' or 'abandoned'), with the same externalId so the last
// report wins. meta = { game, deck, outcome }. The preset counts finished ones only.
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
          { label: 'Left part-way', values: ['in_progress'] },
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
