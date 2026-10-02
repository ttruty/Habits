import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoProvider } from '../data/demo-provider';
import type { DataProvider } from '../data/provider';
import './data-page';
import type { DataPage } from './data-page';

const now = new Date(2026, 9, 1, 12);

async function mount(provider: DataProvider) {
  const el = document.createElement('data-page');
  el.provider = provider;
  el.now = () => now;
  const files: { name: string; type: string; text: string }[] = [];
  el.download = (name, type, text) => files.push({ name, type, text });
  document.body.append(el);
  await settle(el);
  return { el, files };
}

async function settle(el: DataPage) {
  for (let i = 0; i < 4; i++) {
    await el.updateComplete;
    await new Promise((r) => setTimeout(r));
  }
}

const $ = <T extends HTMLElement = HTMLElement>(el: DataPage, sel: string) =>
  el.shadowRoot!.querySelector<T>(sel)!;
const text = (e: Element | null) => e?.textContent?.replace(/\s+/g, ' ').trim();
const button = (el: DataPage, name: string) =>
  [...el.shadowRoot!.querySelectorAll('button')].find((b) => text(b) === name)!;

async function choose(el: DataPage, habitId: string, csv: string) {
  const select = $<HTMLSelectElement>(el, '#habit');
  select.value = habitId;
  select.dispatchEvent(new Event('change'));
  const input = $<HTMLInputElement>(el, '#file');
  Object.defineProperty(input, 'files', {
    value: [new File([csv], 'backfill.csv')],
    configurable: true,
  });
  input.dispatchEvent(new Event('change'));
  await settle(el);
}

describe('<data-page>', () => {
  afterEach(() => document.body.replaceChildren());

  it('exports everything as JSON and events as CSV', async () => {
    const { el, files } = await mount(createDemoProvider({ now: () => now }));
    button(el, 'Download JSON').click();
    await settle(el);
    button(el, 'Download events as CSV').click();
    await settle(el);
    expect(files.map((f) => f.name)).toEqual(['habits-2026-10-01.json', 'habits-2026-10-01.csv']);
    const json = JSON.parse(files[0].text);
    expect(json.habits).toHaveLength(5);
    expect(json.events.length).toBeGreaterThan(100);
    expect(files[1].text.split('\n')[0]).toBe(
      'local_date,type,value,unit,source,occurred_at,external_id,meta',
    );
    expect(text($(el, '.message'))).toMatch(/^Exported \d+ events\.$/);
  });

  it('imports a backfill in the habit’s unit, idempotently', async () => {
    const p = createDemoProvider({ now: () => now });
    const { el } = await mount(p);
    await choose(el, 'demo-listen', 'date,minutes\n2025-01-01,25\n2025-01-02\nnope,1\n');
    expect(text($(el, '.preview'))).toContain('2 days, 2025-01-01 to 2025-01-02.');
    expect(text($(el, '[role=alert]'))).toContain('Line 4');
    $<HTMLFormElement>(el, 'form').requestSubmit();
    await settle(el);
    expect(text($(el, '.message'))).toBe('Imported 2 days into Listen 20m.');

    const imported = async () =>
      (await p.listEvents({ from: '2025-01-01', to: '2025-01-02' })).filter(
        (e) => e.meta?.imported,
      );
    expect((await imported()).map((e) => [e.localDate, e.value, e.unit, e.type])).toEqual([
      ['2025-01-01', 1500, 'seconds', 'manual.entry'],
      // No amount: the goal (20 min), so the day counts as done.
      ['2025-01-02', 1200, 'seconds', 'manual.entry'],
    ]);

    await choose(el, 'demo-listen', '2025-01-01,30\n');
    $<HTMLFormElement>(el, 'form').requestSubmit();
    await settle(el);
    expect((await imported()).map((e) => e.value)).toEqual([1800, 1200]);
  });

  it('counts each day once for count habits, whatever the amount', async () => {
    const p = createDemoProvider({ now: () => now });
    const { el } = await mount(p);
    await choose(el, 'demo-workout', '2025-02-01,7\n');
    expect(text($(el, 'section:last-of-type .muted'))).toContain('amount is ignored');
    $<HTMLFormElement>(el, 'form').requestSubmit();
    await settle(el);
    const [e] = (await p.listEvents({ from: '2025-02-01', to: '2025-02-01' })).filter(
      (x) => x.meta?.imported,
    );
    expect(e).toMatchObject({ value: 1, unit: 'count', meta: { habit_id: 'demo-workout' } });
  });

  it('says when a file has no days, and when saving fails', async () => {
    const p = createDemoProvider({ now: () => now });
    const { el } = await mount(p);
    await choose(el, 'demo-run', 'date\n');
    expect(text($(el, '.preview'))).toBe('No days found in backfill.csv.');
    expect(button(el, 'Import').disabled).toBe(true);

    p.putEvents = vi.fn(async () => {
      throw new Error('offline');
    });
    await choose(el, 'demo-run', '2025-03-01\n');
    $<HTMLFormElement>(el, 'form').requestSubmit();
    await settle(el);
    expect(text($(el, '.message'))).toBe("Couldn't import. Try again.");
  });

  it('says when exporting fails', async () => {
    const p = createDemoProvider({ now: () => now });
    p.listEvents = async () => {
      throw new Error('offline');
    };
    const { el } = await mount(p);
    button(el, 'Download JSON').click();
    await settle(el);
    expect(text($(el, '.message'))).toBe("Couldn't export. Try again.");
  });
});
