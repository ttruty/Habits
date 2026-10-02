import type { Habit, HabitEvent } from '../model';

let seq = 0;

export function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    name: 'Workout',
    icon: 'dumbbell',
    color: 'green',
    match: { types: ['workout.completed'] },
    rule: { aggregate: 'count', atLeast: 1 },
    target: { perWeek: 7 },
    sort: 0,
    ...overrides,
  };
}

export function event(localDate: string, overrides: Partial<HabitEvent> = {}): HabitEvent {
  seq++;
  return {
    id: `e${seq}`,
    sourceId: 's1',
    externalId: `x${seq}`,
    type: 'workout.completed',
    occurredAt: `${localDate}T12:00:00.000Z`,
    localDate,
    ...overrides,
  };
}

/** Events on each given day. */
export function on(days: string[], overrides: Partial<HabitEvent> = {}): HabitEvent[] {
  return days.map((d) => event(d, overrides));
}
