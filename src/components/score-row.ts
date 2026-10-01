import { html } from 'lit';
import { formatValue } from '../format';
import type { DateKey } from '../model';
import type { ScoreRow } from '../scoring/scorecard';
import { isMetric } from '../scoring/score';
import { dayCell } from './day-cell';

export type Summary = 'week' | 'days';

export function scoreRow(
  row: ScoreRow,
  opts: { today: DateKey; dayLabel: (d: DateKey) => string; summary: Summary; compact: boolean },
) {
  const { habit, cells, unit } = row;
  const metric = isMetric(habit);
  const max = Math.max(0, ...cells.map((c) => c.value));
  return html`<tr style="--hs-habit: var(--hs-color-${habit.color}, var(--hs-done))">
    <th scope="row" class="name">
      <span class="icon" aria-hidden="true">${habit.icon}</span>${habit.name}
    </th>
    ${cells.map((cell) =>
      dayCell(habit, cell, {
        unit,
        max,
        dayLabel: opts.dayLabel(cell.date),
        isToday: cell.date === opts.today,
        showValue: !opts.compact,
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
