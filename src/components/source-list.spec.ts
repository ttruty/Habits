import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoProvider } from '../data/demo-provider';
import type { DataProvider } from '../data/provider';
import './source-list';
import type { SourceList } from './source-list';

const now = new Date(2026, 9, 1, 12);

/** Demo data without the demo's own sources, so each test starts with nothing connected. */
function fresh(): DataProvider {
  const p = createDemoProvider({ now: () => now });
  const list = p.listSources;
  p.listSources = async () => (await list()).filter((s) => !s.id.startsWith('demo-'));
  return p;
}

async function mount(provider: DataProvider) {
  const el = document.createElement('source-list');
  el.provider = provider;
  el.now = () => now;
  document.body.append(el);
  await settle(el);
  return el;
}

async function settle(el: SourceList) {
  for (let i = 0; i < 4; i++) {
    await el.updateComplete;
    await new Promise((r) => setTimeout(r));
  }
}

const $ = <T extends HTMLElement = HTMLElement>(el: SourceList, sel: string) =>
  el.shadowRoot!.querySelector<T>(sel)!;
const text = (e: Element | null) => e?.textContent?.replace(/\s+/g, ' ').trim();
const button = (el: SourceList, label: string) =>
  [...el.shadowRoot!.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === label || text(b) === label,
  ) as HTMLButtonElement;

async function connect(el: SourceList, app: string) {
  button(el, 'Connect an app').click();
  await settle(el);
  button(el, app).click();
  await settle(el);
}

describe('<source-list>', () => {
  beforeEach(() => vi.stubGlobal('confirm', () => true));
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('connects an app: one-time token, URL, and suggested habits', async () => {
    const p = fresh();
    const el = await mount(p);
    expect(text($(el, '.muted'))).toBe('No apps connected yet.');

    await connect(el, 'DeckFit');
    expect(text($(el, '#issued-heading'))).toBe('Connect DeckFit');
    expect(el.shadowRoot!.activeElement?.id).toBe('issued-heading');
    expect($<HTMLInputElement>(el, '#url').value).toBe(p.ingestUrl);
    expect($<HTMLInputElement>(el, '#token').value).toMatch(/^hab_/);
    expect(text($(el, 'fieldset'))).toContain('Workout');

    button(el, 'Done').click();
    await settle(el);
    const source = (await p.listSources()).find((s) => s.kind === 'deckfit')!;
    const workout = (await p.listHabits()).find((h) => h.match.sourceIds?.includes(source.id))!;
    expect(workout).toMatchObject({
      name: 'Workout',
      match: { types: ['workout.completed'], where: { outcome: 'finished' } },
      startDate: '2026-10-01',
      sort: 5,
    });
    expect(text($(el, '.message'))).toBe('Added Workout.');
    expect(text($(el, '.list .detail'))).toBe('Waiting for its first report');
  });

  it('skips suggested habits that are unticked', async () => {
    const p = fresh();
    const el = await mount(p);
    await connect(el, 'MindDrive');
    const box = $<HTMLInputElement>(el, 'fieldset input');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    await settle(el);
    button(el, 'Done').click();
    await settle(el);
    expect((await p.listHabits()).some((h) => h.name === 'Meditate' && h.startDate)).toBe(false);
    expect(text($(el, '.message'))).toBe('MindDrive is connected.');
  });

  it('copies the URL and token', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const el = await mount(fresh());
    await connect(el, 'Yarnbeard');
    button(el, 'Copy').click();
    await settle(el);
    expect(writeText).toHaveBeenCalledWith('https://demo.invalid/functions/v1/ingest');
    expect(text($(el, '.message'))).toBe('Copied the URL.');
  });

  it('says when copying is blocked', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: async () => Promise.reject(new Error('no')) },
    });
    const el = await mount(fresh());
    await connect(el, 'Yarnbeard');
    [...el.shadowRoot!.querySelectorAll('button')].filter((b) => text(b) === 'Copy')[1].click();
    await settle(el);
    expect(text($(el, '.message'))).toContain("Couldn't copy");
  });

  it('shows when a source last reported', async () => {
    const p = fresh();
    const el = await mount(p);
    await connect(el, 'DeckFit');
    button(el, 'Done').click();
    await settle(el);
    const [token] = await p.listIngestTokens();
    p.listIngestTokens = async () => [
      { ...token, lastUsedAt: new Date(now.getTime() - 3 * 3600_000).toISOString() },
    ];
    el.provider = { ...p };
    await settle(el);
    expect(text($(el, '.list .detail'))).toBe('Last reported 3 hours ago');
  });

  it('issues a new token without offering habits again, and disconnects', async () => {
    const p = fresh();
    const el = await mount(p);
    await connect(el, 'DeckFit');
    const first = $<HTMLInputElement>(el, '#token').value;
    button(el, 'Done').click();
    await settle(el);

    button(el, 'New token for DeckFit').click();
    await settle(el);
    expect($<HTMLInputElement>(el, '#token').value).not.toBe(first);
    expect($(el, 'fieldset')).toBeNull();
    button(el, 'Done').click();
    await settle(el);

    button(el, 'Disconnect DeckFit').click();
    await settle(el);
    expect(text($(el, '.list .detail'))).toBe('Disconnected');
    expect(button(el, 'Disconnect DeckFit')).toBeUndefined();
  });

  it('does nothing when a confirmation is declined', async () => {
    const p = fresh();
    const el = await mount(p);
    await connect(el, 'DeckFit');
    button(el, 'Done').click();
    await settle(el);
    vi.stubGlobal('confirm', () => false);
    button(el, 'Disconnect DeckFit').click();
    await settle(el);
    expect(text($(el, '.list .detail'))).toBe('Waiting for its first report');
  });

  it('says when saving or loading fails', async () => {
    const p = fresh();
    p.addSource = async () => {
      throw new Error('offline');
    };
    const el = await mount(p);
    await connect(el, 'DeckFit');
    expect(text($(el, '.message'))).toBe("Couldn't save. Try again.");

    const broken = createDemoProvider();
    broken.listIngestTokens = async () => {
      throw new Error('offline');
    };
    const el2 = await mount(broken);
    expect(text($(el2, '[role=alert]'))).toBe("Couldn't load sources.");
  });
});
