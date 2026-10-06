import type { Connector } from './types';

const RUNS = ['Run', 'TrailRun', 'VirtualRun'];
const RIDES = [
  'Ride',
  'VirtualRide',
  'GravelRide',
  'MountainBikeRide',
  'EBikeRide',
  'EMountainBikeRide',
];

// Strava activities arrive by webhook and are refetched on view: Strava's API Policy allows caching
// its data for 7 days at most. value = moving time (s); meta = { sport_type, distance (m) }.
export const strava: Connector = {
  kind: 'strava',
  displayName: 'Strava',
  mode: 'oauth',
  eventTypes: [
    {
      type: 'activity.created',
      unit: 'seconds',
      label: 'Activity',
      filter: {
        key: 'sport_type',
        label: 'Activities that count',
        options: [
          { label: 'Run', values: RUNS },
          { label: 'Ride', values: RIDES },
          { label: 'Walk', values: ['Walk'] },
          { label: 'Hike', values: ['Hike'] },
          { label: 'Swim', values: ['Swim'] },
          { label: 'Weights', values: ['WeightTraining'] },
          { label: 'Workout', values: ['Workout', 'HighIntensityIntervalTraining', 'Crossfit'] },
          { label: 'Yoga and pilates', values: ['Yoga', 'Pilates'] },
          { label: 'Rowing', values: ['Rowing', 'VirtualRow'] },
        ],
      },
    },
  ],
  presets: [
    {
      name: 'Run',
      icon: 'run',
      color: 'orange',
      match: { types: ['activity.created'], where: { sport_type: RUNS } },
      rule: { aggregate: 'count', atLeast: 1 },
      target: { perWeek: 3 },
    },
    {
      name: 'Ride',
      icon: 'bike',
      color: 'blue',
      match: { types: ['activity.created'], where: { sport_type: RIDES } },
      rule: { aggregate: 'count', atLeast: 1 },
      target: { perWeek: 2 },
    },
    {
      name: 'Any activity',
      icon: 'flame',
      color: 'coral',
      match: { types: ['activity.created'] },
      rule: { aggregate: 'count', atLeast: 1 },
      target: { perWeek: 5 },
    },
  ],
  attribution: { text: 'Powered by Strava', href: 'https://www.strava.com' },
  syncPath: 'oauth/strava/sync',
};
