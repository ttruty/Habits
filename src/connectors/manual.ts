import type { DataProvider } from '../data/provider';
import type { DateKey, Habit, HabitEvent, HabitMatch, Source, Unit } from '../model';
import { MANUAL_ENTRY } from '../scoring/score';
import { toLocalNoon } from '../scoring/dates';
import type { Connector } from './types';

// Ticked by hand in the scorecard. Each habit gets its own check-ins, told apart by
// meta.habit_id, so one Manual source serves every hand-ticked habit.

export const CHECK_IN = 'check-in';

export const manual: Connector = {
  kind: 'manual',
  displayName: 'Manual (tick by hand)',
  mode: 'manual',
  eventTypes: [{ type: CHECK_IN, unit: 'count', label: 'Check-in' }],
  presets: [],
};

export function manualMatch(habitId: string, sourceId: string): HabitMatch {
  return { sourceIds: [sourceId], types: [CHECK_IN], where: { habit_id: habitId } };
}

/** The Manual source a habit is ticked through, if it is a hand-ticked habit. */
export function manualSourceOf(habit: Habit, sources: readonly Source[]): Source | undefined {
  if (!habit.match.types.includes(CHECK_IN)) return undefined;
  return sources.find((s) => s.kind === 'manual' && habit.match.sourceIds?.includes(s.id));
}

/** The check-in that ticks `habit` on `date`. Its external id makes re-ticking idempotent. */
export function checkInEvent(
  habit: Habit,
  source: Source,
  date: DateKey,
  today: DateKey,
  now: Date,
): Omit<HabitEvent, 'id'> {
  return {
    sourceId: source.id,
    externalId: `${habit.id}:${date}`,
    type: CHECK_IN,
    occurredAt: (date === today ? now : toLocalNoon(date)).toISOString(),
    localDate: date,
    value: 1,
    unit: 'count',
    meta: { habit_id: habit.id },
  };
}

/** The check-ins that tick `habit` on `date`, from its Manual source. */
export function checkInsOn(
  habit: Habit,
  source: Source,
  date: DateKey,
  events: readonly HabitEvent[],
): HabitEvent[] {
  return events.filter(
    (e) =>
      e.sourceId === source.id &&
      e.type === CHECK_IN &&
      e.localDate === date &&
      e.meta?.habit_id === habit.id,
  );
}

/** The Manual source, creating it the first time it's needed. */
export async function ensureManualSource(
  provider: DataProvider,
  sources: readonly Source[],
): Promise<Source> {
  return (
    sources.find((s) => s.kind === 'manual') ??
    (await provider.addSource({ kind: 'manual', label: 'Manual', config: {} }))
  );
}

/**
 * A correction for any habit's day: counts for `habit` whatever its match says (see
 * scoring/score.ts). Each entry is its own event, so several can be added and removed one by one.
 */
export function entryEvent(
  habit: Habit,
  source: Source,
  date: DateKey,
  amount: { value: number; unit?: Unit },
  today: DateKey,
  now: Date,
): Omit<HabitEvent, 'id'> {
  return {
    sourceId: source.id,
    externalId: `entry:${habit.id}:${date}:${crypto.randomUUID()}`,
    type: MANUAL_ENTRY,
    occurredAt: (date === today ? now : toLocalNoon(date)).toISOString(),
    localDate: date,
    value: amount.value,
    ...(amount.unit ? { unit: amount.unit } : {}),
    meta: { habit_id: habit.id },
  };
}
