import type { Habit } from '../model';
import type { DayCell } from './score';

/** How a day shows in a heatmap: 0–4 shading, or a state that has no shading. */
export type HeatLevel = 0 | 1 | 2 | 3 | 4 | 'over' | 'inactive' | 'future';

/**
 * Done days are full (4). A goal day that fell short shows how close it came (1–3); a metric day
 * is shaded against the habit's busiest day in view (`max`). Going over a limit is 'over'.
 */
export function heatLevel(habit: Habit, cell: DayCell, max: number): HeatLevel {
  if (cell.state === 'future') return 'future';
  if (cell.state === 'inactive') return 'inactive';
  if (cell.state === 'done') return 4;
  const { atLeast, atMost } = habit.rule;
  if (atMost !== undefined && cell.value > atMost) return 'over';
  if (cell.value <= 0) return 0;
  if (cell.state === 'metric') return max > 0 ? scale(cell.value / max, 4) : 0;
  if (atLeast !== undefined && atLeast > 0) return scale(cell.value / atLeast, 3);
  return 0;
}

function scale(fraction: number, top: 3 | 4): 1 | 2 | 3 | 4 {
  return Math.min(top, Math.max(1, Math.ceil(fraction * top))) as 1 | 2 | 3 | 4;
}

export interface HeatSummary {
  /** Days that count: neither before the habit started nor still to come. */
  days: number;
  done: number;
  total: number;
  /** Longest run of consecutive done days in the cells. */
  bestRun: number;
}

export function heatSummary(cells: readonly DayCell[]): HeatSummary {
  let days = 0;
  let done = 0;
  let total = 0;
  let run = 0;
  let bestRun = 0;
  for (const c of cells) {
    if (c.state === 'future' || c.state === 'inactive') continue;
    days++;
    total += c.value;
    run = c.done ? run + 1 : 0;
    if (c.done) done++;
    bestRun = Math.max(bestRun, run);
  }
  return { days, done, total, bestRun };
}
