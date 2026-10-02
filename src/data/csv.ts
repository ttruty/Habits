import type { DateKey, HabitEvent, Source } from '../model';

/** One field, quoted when it holds a comma, quote or line break. */
function field(value: unknown): string {
  const s = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export const EXPORT_COLUMNS = [
  'local_date',
  'type',
  'value',
  'unit',
  'source',
  'occurred_at',
  'external_id',
  'meta',
] as const;

/** Every event as CSV, oldest first, with the source's label (not its id). */
export function eventsToCsv(events: readonly HabitEvent[], sources: readonly Source[]): string {
  const label = new Map(sources.map((s) => [s.id, s.label]));
  const rows = [...events]
    .sort(
      (a, b) => a.localDate.localeCompare(b.localDate) || a.occurredAt.localeCompare(b.occurredAt),
    )
    .map((e) =>
      [
        e.localDate,
        e.type,
        e.value,
        e.unit,
        label.get(e.sourceId) ?? e.sourceId,
        e.occurredAt,
        e.externalId,
        e.meta ? JSON.stringify(e.meta) : '',
      ]
        .map(field)
        .join(','),
    );
  return [EXPORT_COLUMNS.join(','), ...rows].join('\n') + '\n';
}

/**
 * Split one CSV line, honouring quotes. The separator is a tab or semicolon if the line has one
 * (spreadsheets that use decimal commas write `2026-09-01;1,5`), else a comma.
 */
function splitLine(line: string): string[] {
  const sep = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function isDate(s: string): s is DateKey {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export interface ImportRow {
  date: DateKey;
  /** In the habit's display unit (minutes, km, steps…). Absent = the day counts as done. */
  amount?: number;
}

export interface ParsedImport {
  rows: ImportRow[];
  errors: { line: number; message: string }[];
}

/**
 * A backfill CSV: one row per day, `date[,amount]`, dates as YYYY-MM-DD. A header row and blank
 * lines are skipped; commas, semicolons or tabs separate, and a decimal comma works after a
 * semicolon or tab. A date given twice keeps the last row.
 */
export function parseImportCsv(text: string): ParsedImport {
  const byDate = new Map<DateKey, ImportRow>();
  const errors: ParsedImport['errors'] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim()) return;
    const [date, amount] = splitLine(raw);
    if (i === 0 && !isDate(date)) return; // a header
    if (!isDate(date)) {
      errors.push({ line, message: `“${date}” isn't a date like 2026-09-30.` });
      return;
    }
    if (amount === undefined || amount === '') {
      byDate.set(date, { date });
      return;
    }
    const n = Number(amount.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) {
      errors.push({ line, message: `“${amount}” isn't an amount of 0 or more.` });
      return;
    }
    byDate.set(date, { date, amount: n });
  });
  const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { rows, errors };
}
