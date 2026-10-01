import { describe, expect, it } from 'vitest';
import { formatDate, formatValue } from './format';

describe('formatValue', () => {
  it('formats seconds as minutes and hours', () => {
    expect(formatValue(1200, 'seconds')).toBe('20m');
    expect(formatValue(3600, 'seconds')).toBe('1h');
    expect(formatValue(3900, 'seconds')).toBe('1h 5m');
    expect(formatValue(60, 'seconds', 'long')).toBe('1 minute');
    expect(formatValue(1200, 'seconds', 'long')).toBe('20 minutes');
    expect(formatValue(7200, 'seconds', 'long')).toBe('2 hours');
    expect(formatValue(3660, 'seconds', 'long')).toBe('1 hour 1 minute');
  });

  it('formats other units', () => {
    expect(formatValue(5234, 'meters')).toBe('5.2 km');
    expect(formatValue(5234, 'meters', 'long')).toBe('5.2 kilometres');
    expect(formatValue(12, 'pages')).toBe('12 p');
    expect(formatValue(1, 'pages', 'long')).toBe('1 page');
    expect(formatValue(40, 'percent')).toBe('40%');
    expect(formatValue(3, 'count')).toBe('3');
    expect(formatValue(3, undefined)).toBe('3');
  });
});

it('formats a date key as that local day', () => {
  expect(formatDate('2026-03-08', { year: 'numeric', month: '2-digit', day: '2-digit' })).toMatch(
    /03.08.2026|2026.03.08|08.03.2026/,
  );
});
