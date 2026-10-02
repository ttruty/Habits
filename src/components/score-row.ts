import { html } from 'lit';
import { formatValue } from '../format';
import type { DateKey } from '../model';
import type { ScoreRow } from '../scoring/scorecard';
import { isMetric } from '../scoring/score';
import { habitVars } from '../ui/vars';
import { habitIcon } from '../ui/icons';
import { dayCell } from './day-cell';

export type Summary = 'week' | 'days';

export function scoreRow(
  row: ScoreRow,
  opts: {
    today: DateKey;
    dayLabel: (d: DateKey) => string;
    summary: Summary;
    compact: boolean;
    /** Set for hand-ticked habits the viewer may edit. */
    toggle?: (date: DateKey) => void;
    /** Set for other habits the viewer may edit: opens the day for corrections. */
    open?: (date: DateKey, opener: HTMLElement) => void;
  },
) {
  const { habit, cells, unit } = row;
  const metric = isMetric(habit);
  const max = Math.max(0, ...cells.map((c) => c.value));
  return html`<tr style=${habitVars(habit.color)}>
    <th scope="row" class="name">
      <span class="icon" aria-hidden="true">${habitIcon(habit.icon, 18)}</span>${habit.name}
    </th>
    ${cells.map((cell) =>
      dayCell(habit, cell, {
        unit,
        max,
        dayLabel: opts.dayLabel(cell.date),
        isToday: cell.date === opts.today,
        showValue: !opts.compact,
        onToggle: opts.toggle && (() => opts.toggle!(cell.date)),
        onOpen: opts.open && ((opener) => opts.open!(cell.date, opener)),
      }),
    )}
    <td class="summary">
      ${opts.summary === 'week' ? weekSummary(row, metric) : daysSummary(row, metric)}
    </td>
    <td class="summary">${streakSummary(row)}</td>
  </tr>`;
}

function weekSummary({ week, unit }: ScoreRow, metric: boolean) {
  if (metric) return formatValue(week.total, unit);
  if (week.target === 0)
    return html`<span aria-hidden="true">—</span><span class="sr">not started</span>`;
  return html`<span aria-hidden="true"
      >${week.done}/${week.target}${week.met ? html` <span class="met">✓</span>` : ''}</span
    ><span class="sr">${week.done} of ${week.target}${week.met ? ', target met' : ''}</span>`;
}

function daysSummary({ cells, unit }: ScoreRow, metric: boolean) {
  if (metric)
    return formatValue(
      cells.reduce((sum, c) => sum + c.value, 0),
      unit,
    );
  return String(cells.filter((c) => c.done).length);
}

function streakSummary({ streak }: ScoreRow) {
  if (!streak) return html`<span aria-hidden="true">—</span><span class="sr">no streak</span>`;
  const words = `${streak.count} ${streak.count === 1 ? streak.unit.slice(0, -1) : streak.unit}`;
  return html`<span aria-hidden="true"
      >${streak.count}${streak.unit === 'weeks' ? html`<span class="unit">w</span>` : ''}</span
    ><span class="sr">${words}</span>`;
}
