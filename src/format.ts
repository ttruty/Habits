import type { DateKey, Unit } from './model';
import { toLocalNoon } from './scoring/dates';

/** A value in its unit: "1h 5m" (short) or "1 hour 5 minutes" (long, for screen readers). */
export function formatValue(
  value: number,
  unit: Unit | undefined,
  style: 'short' | 'long' = 'short',
): string {
  const long = style === 'long';
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  switch (unit) {
    case 'seconds': {
      const minutes = Math.round(value / 60);
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      if (long) {
        if (!h) return plural(m, 'minute');
        return m ? `${plural(h, 'hour')} ${plural(m, 'minute')}` : plural(h, 'hour');
      }
      if (!h) return `${m}m`;
      return m ? `${h}h ${m}m` : `${h}h`;
    }
    case 'meters': {
      const km = Math.round(value / 100) / 10;
      return long ? `${km} kilometres` : `${km} km`;
    }
    case 'pages':
      return long ? plural(value, 'page') : `${value} p`;
    case 'percent':
      return `${value}%`;
    default:
      return String(value);
  }
}

export function formatDate(key: DateKey, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, options).format(toLocalNoon(key));
}
