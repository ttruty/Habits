import { describe, expect, it } from 'vitest';
import type { HabitEvent, Source } from '../model';
import { eventsToCsv, parseImportCsv } from './csv';

describe('eventsToCsv', () => {
  const sources: Source[] = [
    { id: 's1', kind: 'strava', label: 'Strava', config: {}, createdAt: 'T' },
  ];
  const e = (over: Partial<HabitEvent>): HabitEvent => ({
    id: 'x',
    sourceId: 's1',
    externalId: '1',
    type: 'activity.created',
    occurredAt: '2026-10-01T12:00:00.000Z',
    localDate: '2026-10-01',
    ...over,
  });

  it('writes a header and one row per event, oldest first, quoting where needed', () => {
    const csv = eventsToCsv(
      [
        e({
          externalId: '2',
          localDate: '2026-10-02',
          value: 600,
          unit: 'seconds',
          meta: { sport_type: 'Run', note: 'a "b", c' },
        }),
        e({ sourceId: 'gone' }),
      ],
      sources,
    );
    expect(csv.split('\n')).toEqual([
      'local_date,type,value,unit,source,occurred_at,external_id,meta',
      '2026-10-01,activity.created,,,gone,2026-10-01T12:00:00.000Z,1,',
      '2026-10-02,activity.created,600,seconds,Strava,2026-10-01T12:00:00.000Z,2,"{""sport_type"":""Run"",""note"":""a \\""b\\"", c""}"',
      '',
    ]);
  });
});

describe('parseImportCsv', () => {
  it('reads dates with optional amounts, skipping a header and blank lines', () => {
    expect(parseImportCsv('date,minutes\n2026-09-01,25\n\n2026-09-02\n2026-08-31;1,5\n')).toEqual({
      rows: [
        { date: '2026-08-31', amount: 1.5 },
        { date: '2026-09-01', amount: 25 },
        { date: '2026-09-02' },
      ],
      errors: [],
    });
  });

  it('keeps the last row for a repeated date, and handles quotes and tabs', () => {
    expect(parseImportCsv('2026-09-01,10\r\n"2026-09-01"\t"20"').rows).toEqual([
      { date: '2026-09-01', amount: 20 },
    ]);
  });

  it('reports bad dates and amounts by line', () => {
    expect(
      parseImportCsv('2026-09-01\n2026-02-30\nyesterday\n2026-09-03,-1\n2026-09-04,lots').errors,
    ).toEqual([
      { line: 2, message: "“2026-02-30” isn't a date like 2026-09-30." },
      { line: 3, message: "“yesterday” isn't a date like 2026-09-30." },
      { line: 4, message: "“-1” isn't an amount of 0 or more." },
      { line: 5, message: "“lots” isn't an amount of 0 or more." },
    ]);
  });

  it('reads quoted fields with doubled quotes', () => {
    expect(parseImportCsv('"2026-09-01","3"').rows).toEqual([{ date: '2026-09-01', amount: 3 }]);
  });
});
