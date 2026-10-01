import { manualMatch } from '../connectors/manual';
import { connectorFor } from '../connectors/registry';
import type { DateKey, Habit, Source, Unit } from '../model';

// The habit editor's form state, and the conversions between it and a Habit. Pure, so the
// rules (units, manual habits, keeping `where`) are tested without a DOM.

/** Stands in for the Manual source before one exists; it's created on save. */
export const NEW_MANUAL = '__new-manual__';

export const COLORS = ['green', 'blue', 'purple', 'orange', 'red', 'teal'] as const;

export type Goal = 'atLeast' | 'atMost' | 'track';

export interface Draft {
  id: string;
  name: string;
  icon: string;
  color: string;
  sourceId: string;
  type: string;
  aggregate: 'count' | 'sum';
  goal: Goal;
  /** In display units (minutes, km…), as typed. */
  amount: string;
  perWeek: number;
  startDate: DateKey | '';
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

/** A blank draft for a new habit: hand-ticked, daily, starting today. */
export function newDraft(id: string, sources: readonly Source[], today: DateKey): Draft {
  const manual = sources.find((s) => s.kind === 'manual');
  return {
    id,
    name: '',
    icon: '',
    color: 'green',
    sourceId: manual?.id ?? NEW_MANUAL,
    type: 'check-in',
    aggregate: 'count',
    goal: 'atLeast',
    amount: '1',
    perWeek: 7,
    startDate: today,
  };
}

export function draftFromHabit(habit: Habit, sources: readonly Source[]): Draft {
  const { rule } = habit;
  const goal: Goal =
    rule.atLeast !== undefined ? 'atLeast' : rule.atMost !== undefined ? 'atMost' : 'track';
  const raw = rule.atLeast ?? rule.atMost;
  const sourceId = habit.match.sourceIds?.[0] ?? '';
  const type = habit.match.types[0] ?? '';
  const { factor } = displayUnit(unitOf({ sourceId, type }, sources));
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
 * first). Keeps the original's `where` filter while its source and type are unchanged, and its
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
  const where = same ? original.match.where : undefined;
  const { factor } = displayUnit(unitOf(draft, sources));
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
