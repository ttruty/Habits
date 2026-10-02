import { describe, expect, it } from 'vitest';
import { heatLevel, heatSummary } from './heatmap';
import type { DayCell } from './score';
import { habit } from './test-helpers';

const cell = (state: DayCell['state'], value = 0): DayCell => ({
  date: '2026-10-01',
  value,
  state,
  done: state === 'done',
});

describe('heatLevel', () => {
  const goal = habit({ rule: { aggregate: 'sum', atLeast: 1200 } });

  it('is full when done, and shows how close a short day came', () => {
    expect(heatLevel(goal, cell('done', 1500), 0)).toBe(4);
    expect(heatLevel(goal, cell('missed', 0), 0)).toBe(0);
    expect(heatLevel(goal, cell('missed', 100), 0)).toBe(1);
    expect(heatLevel(goal, cell('missed', 700), 0)).toBe(2);
    expect(heatLevel(goal, cell('pending', 1199), 0)).toBe(3);
  });

  it('shades metric days against the busiest day', () => {
    const metric = habit({ rule: { aggregate: 'sum' } });
    expect(heatLevel(metric, cell('metric', 0), 3600)).toBe(0);
    expect(heatLevel(metric, cell('metric', 900), 3600)).toBe(1);
    expect(heatLevel(metric, cell('metric', 3600), 3600)).toBe(4);
    expect(heatLevel(metric, cell('metric', 5), 0)).toBe(0);
  });

  it('marks days over a limit, and days with no shading', () => {
    const limit = habit({ rule: { aggregate: 'sum', atMost: 600 } });
    expect(heatLevel(limit, cell('missed', 900), 0)).toBe('over');
    expect(heatLevel(limit, cell('pending', 300), 0)).toBe(0);
    expect(heatLevel(goal, cell('future'), 0)).toBe('future');
    expect(heatLevel(goal, cell('inactive'), 0)).toBe('inactive');
  });
});

it('summarises days done, the total and the best run', () => {
  const cells = [
    cell('inactive'),
    cell('done', 2),
    cell('done', 3),
    cell('missed', 1),
    cell('done', 4),
    cell('pending'),
    cell('future'),
  ];
  expect(heatSummary(cells)).toEqual({ days: 5, done: 3, total: 10, bestRun: 2 });
});
