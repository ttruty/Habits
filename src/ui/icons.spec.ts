import { render } from 'lit';
import { expect, it } from 'vitest';
import { HABIT_ICON_KEYS, HABIT_ICON_LABELS, habitIcon } from './icons';
import { icon } from './ui-icons';

const svgOf = (t: unknown) => {
  const host = document.createElement('div');
  render(t, host);
  return host.querySelector('svg')!;
};

it('renders decorative line icons at the given size', () => {
  const svg = svgOf(icon('check', 18));
  expect(svg.getAttribute('aria-hidden')).toBe('true');
  expect(svg.getAttribute('stroke')).toBe('currentColor');
  expect(svg.getAttribute('stroke-width')).toBe('2');
  expect(svg.getAttribute('width')).toBe('18');
  expect(svg.querySelector('path')).not.toBeNull();
});

it('has a label for every habit icon, and falls back for unknown keys', () => {
  for (const k of HABIT_ICON_KEYS) expect(HABIT_ICON_LABELS[k]).toBeTruthy();
  expect(svgOf(habitIcon('nope')).innerHTML).toBe(svgOf(habitIcon('check-square')).innerHTML);
});
