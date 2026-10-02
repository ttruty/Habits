import type { Connector } from './types';

// Withings: workouts (value = active seconds; meta = { category, distance?, steps? }) and daily
// steps (steps.day, one per day, updated as it grows). Categories are plain names like 'run',
// 'walk', 'bicycling', 'swimming', 'lift_weights', 'yoga' (see the server connector).
export const withings: Connector = {
  kind: 'withings',
  displayName: 'Withings',
  mode: 'oauth',
  eventTypes: [
    { type: 'workout.completed', unit: 'seconds', label: 'Workout' },
    { type: 'steps.day', unit: 'count', label: 'Steps per day', amountLabel: 'steps' },
  ],
  presets: [
    {
      name: 'Steps',
      icon: 'walk',
      color: 'green',
      match: { types: ['steps.day'] },
      rule: { aggregate: 'sum', atLeast: 8000 },
      target: { perWeek: 7 },
    },
    {
      name: 'Workout (Withings)',
      icon: 'dumbbell',
      color: 'violet',
      match: { types: ['workout.completed'] },
      rule: { aggregate: 'count', atLeast: 1 },
      target: { perWeek: 3 },
    },
  ],
  syncPath: 'oauth/withings/sync',
};
