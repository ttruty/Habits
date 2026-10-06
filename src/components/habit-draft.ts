import { manualMatch } from '../connectors/manual';
import { connectorFor } from '../connectors/registry';
import type { MetaFilter } from '../connectors/types';
import type { DateKey, Habit, HabitColor, Source, Unit } from '../model';

// The habit editor's form state, and the conversions between it and a Habit. Pure, so the
// rules (units, manual habits, keeping `where`) are tested without a DOM.

/** Stands in for the Manual source before one exists; it's created on save. */
export const NEW_MANUAL = '__new-manual__';

export { HABIT_COLORS as COLORS } from '../model';

export type Goal = 'atLeast' | 'atMost' | 'track';

export interface Draft {
  id: string;
  name: string;
  icon: string;
  color: HabitColor;
  sourceId: string;
  type: string;
  aggregate: 'count' | 'sum';
  goal: Goal;
  /** In display units (minutes, km…), as typed. */
  amount: string;
  perWeek: number;
  startDate: DateKey | '';
  /** Raw values of the event type's filter that count (e.g. Withings categories); [] = all. */
  filterValues: string[];
}

export type DraftErrors = Partial<Record<'name' | 'amount' | 'source', string>>;

/** Display unit for the amount field: seconds are entered as minutes, meters as km. */
export function displayUnit(unit: Unit | undefined): { label: string; factor: number } {
  switch (unit) {
    case 'seconds':
      return { label: 'minutes', factor: 60 };
    case 'meters':
      return { label: 'km', factor: 1000 };
    case 'pages':
      return { label: 'pages', factor: 1 };
    case 'percent':
      return { label: '%', factor: 1 };
    default:
      return { label: 'times', factor: 1 };
  }
}

export function isManualSource(sourceId: string, sources: readonly Source[]): boolean {
  return sourceId === NEW_MANUAL || sources.find((s) => s.id === sourceId)?.kind === 'manual';
}

export function eventTypesFor(sourceId: string, sources: readonly Source[]) {
  if (sourceId === NEW_MANUAL) return connectorFor('manual')!.eventTypes;
  const source = sources.find((s) => s.id === sourceId);
  return (source && connectorFor(source.kind)?.eventTypes) ?? [];
}

export function unitOf(draft: Pick<Draft, 'sourceId' | 'type'>, sources: readonly Source[]) {
  return eventTypesFor(draft.sourceId, sources).find((t) => t.type === draft.type)?.unit;
}

/** The event type's filter (which activities count), if its connector offers one. */
export function filterFor(
  draft: Pick<Draft, 'sourceId' | 'type'>,
  sources: readonly Source[],
): MetaFilter | undefined {
  return eventTypesFor(draft.sourceId, sources).find((t) => t.type === draft.type)?.filter;
}

/** Whether an option is chosen: any of its values is (older habits may hold just some). */
export const optionOn = (values: readonly string[], option: MetaFilter['options'][number]) =>
  option.values.some((v) => values.includes(v));

/** The chosen values with an option switched on or off. */
export function toggleOption(
  values: readonly string[],
  option: MetaFilter['options'][number],
): string[] {
  return optionOn(values, option)
    ? values.filter((v) => !option.values.includes(v))
    : [...values, ...option.values.filter((v) => !values.includes(v))];
}

/** The amount field's label and factor for this draft's event type. */
export function amountUnit(draft: Pick<Draft, 'sourceId' | 'type'>, sources: readonly Source[]) {
  const type = eventTypesFor(draft.sourceId, sources).find((t) => t.type === draft.type);
  const unit = displayUnit(type?.unit);
  return type?.amountLabel ? { ...unit, label: type.amountLabel } : unit;
}

/**
 * The goal field's unit: "times" when the habit counts events, whatever their unit (a count of
 * workouts isn't in minutes), otherwise the event type's amount unit.
 */
export function goalUnit(
  draft: Pick<Draft, 'sourceId' | 'type' | 'aggregate'>,
  sources: readonly Source[],
) {
  return draft.aggregate === 'count' ? displayUnit('count') : amountUnit(draft, sources);
}

/**
 * How a habit on this source and type adds up by default: as the connector's preset for the type
 * does (steps sum, workouts count), else count events of type count and total the rest.
 */
export function defaultAggregate(
  draft: Pick<Draft, 'sourceId' | 'type'>,
  sources: readonly Source[],
): Draft['aggregate'] {
  const source = sources.find((s) => s.id === draft.sourceId);
  const preset = source
    ? connectorFor(source.kind)?.presets.find((p) => p.match.types.includes(draft.type))
    : undefined;
  return preset?.rule.aggregate ?? (unitOf(draft, sources) === 'count' ? 'count' : 'sum');
}

/** A blank draft for a new habit: hand-ticked, daily, starting today. */
export function newDraft(id: string, sources: readonly Source[], today: DateKey): Draft {
  const manual = sources.find((s) => s.kind === 'manual');
  return {
    id,
    name: '',
    icon: 'check-square',
    color: 'green',
    sourceId: manual?.id ?? NEW_MANUAL,
    type: 'check-in',
    aggregate: 'count',
    goal: 'atLeast',
    amount: '1',
    perWeek: 7,
    startDate: today,
    filterValues: [],
  };
}

export function draftFromHabit(habit: Habit, sources: readonly Source[]): Draft {
  const { rule } = habit;
  const goal: Goal =
    rule.atLeast !== undefined ? 'atLeast' : rule.atMost !== undefined ? 'atMost' : 'track';
  const raw = rule.atLeast ?? rule.atMost;
  const sourceId = habit.match.sourceIds?.[0] ?? '';
  const type = habit.match.types[0] ?? '';
  const { factor } = goalUnit({ sourceId, type, aggregate: rule.aggregate }, sources);
  const key = filterFor({ sourceId, type }, sources)?.key;
  const chosen = key === undefined ? undefined : habit.match.where?.[key];
  return {
    id: habit.id,
    name: habit.name,
    icon: habit.icon,
    color: habit.color,
    sourceId,
    type,
    aggregate: rule.aggregate,
    goal,
    amount: raw === undefined ? '' : String(Math.round((raw / factor) * 100) / 100),
    perWeek: habit.target.perWeek,
    startDate: habit.startDate ?? '',
    filterValues: (Array.isArray(chosen) ? chosen : chosen === undefined ? [] : [chosen]).map(
      String,
    ),
  };
}

export function validate(draft: Draft, sources: readonly Source[]): DraftErrors {
  const errors: DraftErrors = {};
  if (!draft.name.trim()) errors.name = 'Give the habit a name.';
  if (!draft.sourceId) errors.source = 'Choose where completions come from.';
  if (!isManualSource(draft.sourceId, sources) && draft.goal !== 'track') {
    const n = Number(draft.amount);
    if (draft.amount.trim() === '' || !Number.isFinite(n) || n < 0) {
      errors.amount = 'Enter an amount of 0 or more.';
    }
  }
  return errors;
}

/**
 * The habit a draft describes. `sourceId` must be a real source by now (create the Manual source
 * first). Keeps the original's other `where` filters while its source and type are unchanged, and its
 * sort and archive state.
 */
export function habitFromDraft(
  draft: Draft,
  sources: readonly Source[],
  original: Habit | undefined,
  nextSort: number,
): Habit {
  const base = {
    id: draft.id,
    name: draft.name.trim(),
    icon: draft.icon.trim(),
    color: draft.color,
    target: { perWeek: Math.min(7, Math.max(1, Math.round(draft.perWeek))) },
    ...(draft.startDate ? { startDate: draft.startDate } : {}),
    ...(original?.archivedAt ? { archivedAt: original.archivedAt } : {}),
    sort: original?.sort ?? nextSort,
  };

  if (isManualSource(draft.sourceId, sources)) {
    return {
      ...base,
      match: manualMatch(draft.id, draft.sourceId),
      rule: { aggregate: 'count', atLeast: 1 },
    };
  }

  const same =
    original?.match.sourceIds?.[0] === draft.sourceId && original.match.types[0] === draft.type;
  // Keep the original's other `where` keys; the filter's key is what the editor chose (none = all).
  const filter = filterFor(draft, sources);
  const kept = Object.entries((same && original.match.where) || {}).filter(
    ([k]) => k !== filter?.key,
  );
  // Only values the filter offers: a draft carried over from another source can't leak in.
  const offered = new Set(filter?.options.flatMap((o) => o.values));
  const values = draft.filterValues.filter((v) => offered.has(v));
  const chosen = filter && values.length ? [[filter.key, values]] : [];
  const entries = [...kept, ...chosen];
  const where = entries.length ? Object.fromEntries(entries) : undefined;
  const { factor } = goalUnit(draft, sources);
  const amount = Number(draft.amount) * factor;
  return {
    ...base,
    match: { sourceIds: [draft.sourceId], types: [draft.type], ...(where ? { where } : {}) },
    rule: {
      aggregate: draft.aggregate,
      ...(draft.goal === 'atLeast' ? { atLeast: amount } : {}),
      ...(draft.goal === 'atMost' ? { atMost: amount } : {}),
    },
  };
}
