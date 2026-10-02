import { html } from 'lit';
import { formatValue } from '../format';
import type { Habit, Unit } from '../model';
import type { DayCell } from '../scoring/score';

// A template, not a custom element: an element between <tr> and <td> would break the table for
// screen readers. Same for score-row.

/** What the cell means, in words. Colour is never the only signal; the mark's shape differs too. */
export function cellStatus(habit: Habit, cell: DayCell, unit: Unit | undefined): string {
  const amount = formatValue(cell.value, unit, 'long');
  switch (cell.state) {
    case 'done':
      return habit.rule.aggregate === 'sum' ? `done, ${amount}` : 'done';
    case 'missed':
      if (habit.rule.atMost !== undefined && cell.value > habit.rule.atMost) {
        return `over the limit, ${amount}`;
      }
      return habit.rule.aggregate === 'sum' && cell.value > 0 ? `missed, ${amount}` : 'missed';
    case 'pending':
      return cell.value > 0 ? `not yet, ${amount} so far` : 'not yet';
    case 'future':
      return 'upcoming';
    case 'inactive':
      return 'not started';
    case 'metric':
      return cell.value > 0 ? amount : 'none';
  }
}

/** 0–4 intensity for metric cells, relative to the row's busiest day. */
function level(value: number, max: number): number {
  return value <= 0 || max <= 0 ? 0 : Math.max(1, Math.ceil((value / max) * 4));
}

export function dayCell(
  habit: Habit,
  cell: DayCell,
  opts: {
    unit?: Unit;
    dayLabel: string;
    isToday: boolean;
    max: number;
    showValue: boolean;
    /** Hand-ticked habits: makes the cell a toggle button. */
    onToggle?: () => void;
    /** Other habits the viewer may edit: makes the cell a button that opens the day. */
    onOpen?: (opener: HTMLElement) => void;
  },
) {
  const label = `${habit.name}, ${opts.dayLabel}: ${cellStatus(habit, cell, opts.unit)}`;
  const over =
    cell.state === 'missed' && habit.rule.atMost !== undefined && cell.value > habit.rule.atMost;
  const mark = over ? 'over' : cell.state;
  const metric = cell.state === 'metric';
  if (opts.onToggle && ['done', 'missed', 'pending'].includes(cell.state)) {
    return html`<td class="cell ${opts.isToday ? 'today' : ''}">
      <button
        type="button"
        class="tick"
        aria-pressed=${cell.done ? 'true' : 'false'}
        aria-label="${habit.name}, ${opts.dayLabel}"
        title=${label}
        @click=${opts.onToggle}
      >
        <span class="mark ${mark}" aria-hidden="true"></span>
      </button>
    </td>`;
  }
  // Minute habits show their minutes inside the square on done days (and on tracked-only days),
  // when there's room for a number (week view, not month).
  const minutes =
    opts.unit === 'seconds' &&
    opts.showValue &&
    cell.value > 0 &&
    (cell.state === 'done' || metric);
  const inside = over ? '✕' : minutes ? String(Math.max(1, Math.round(cell.value / 60))) : '';
  const content = html`<span
      class="mark ${mark} ${metric ? `level-${level(cell.value, opts.max)}` : ''} ${
        minutes ? 'minutes' : ''
      }"
      aria-hidden="true"
      >${inside}</span
    >${
      metric && opts.showValue && cell.value > 0 && !minutes
        ? html`<span class="value" aria-hidden="true">${formatValue(cell.value, opts.unit)}</span>`
        : ''
    }`;
  const onOpen = opts.onOpen;
  if (onOpen && ['done', 'missed', 'pending', 'metric'].includes(cell.state)) {
    return html`<td class="cell ${opts.isToday ? 'today' : ''}">
      <button
        type="button"
        class="tick open"
        aria-haspopup="dialog"
        aria-label=${label}
        title=${label}
        @click=${(e: Event) => onOpen(e.currentTarget as HTMLElement)}
      >
        ${content}
      </button>
    </td>`;
  }
  return html`<td class="cell ${opts.isToday ? 'today' : ''}" title=${label}>
    ${content}<span class="sr">${label}</span>
  </td>`;
}
