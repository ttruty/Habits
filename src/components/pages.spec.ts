import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { manualMatch } from '../connectors/manual';
import { createDemoProvider } from '../data/demo-provider';
import type { DataProvider } from '../data/provider';
import type { Habit } from '../model';
import { addDays } from '../scoring/dates';
import type { AppData, Route, Toast } from './app-events';
import './habit-form';
import './manage-habits';
import './more-page';
import './progress-page';
import './today-page';

const now = new Date(2026, 9, 1, 9); // Thu 1 Oct 2026, morning
const today = '2026-10-01';

async function appData(p: DataProvider): Promise<AppData> {
  const [habits, sources, events, tokens] = await Promise.all([
    p.listHabits(),
    p.listSources(),
    p.listEvents({ from: addDays(today, -365), to: today }),
    p.listIngestTokens(),
  ]);
  return { habits, sources, events, tokens, today };
}

/** Mount a page with the app's events recorded, reloading `data` on `changed` like the shell. */
async function mount<T extends HTMLElement & { updateComplete: Promise<boolean> }>(
  tag: string,
  p: DataProvider,
  props: Record<string, unknown> = {},
) {
  const el = document.createElement(tag) as T & { data: AppData; provider: DataProvider };
  const log = { routes: [] as Route[], toasts: [] as Toast[], changes: 0 };
  el.addEventListener('navigate', (e) => log.routes.push((e as CustomEvent<Route>).detail));
  el.addEventListener('toast', (e) => log.toasts.push((e as CustomEvent<Toast>).detail));
  el.addEventListener('changed', async () => {
    log.changes++;
    el.data = await appData(p);
  });
  Object.assign(el, { provider: p, data: await appData(p), now: () => now, ...props });
  document.body.append(el);
  await settle(el);
  return { el, log };
}

async function settle(el: { updateComplete: Promise<boolean> }) {
  for (let i = 0; i < 5; i++) {
    await el.updateComplete;
    await new Promise((r) => setTimeout(r));
  }
}

const $ = (el: HTMLElement, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel);
const $$ = (el: HTMLElement, sel: string) => [...el.shadowRoot!.querySelectorAll<HTMLElement>(sel)];
const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim();
const byLabel = (el: HTMLElement, label: string | RegExp) =>
  $$(el, 'button').find((b) => {
    const name = b.getAttribute('aria-label') ?? text(b) ?? '';
    return typeof label === 'string' ? name === label : label.test(name);
  }) as HTMLButtonElement;

/** A demo provider where "Read" is ticked by hand, so Today has a toggle to test. */
async function withHandTicked() {
  const p = createDemoProvider({ now: () => now });
  const manual = await p.addSource({ kind: 'manual', label: 'Manual', config: {} });
  const read = (await p.listHabits()).find((h) => h.id === 'demo-read')!;
  await p.saveHabit({
    ...read,
    match: manualMatch(read.id, manual.id),
    rule: { aggregate: 'count', atLeast: 1 },
  });
  return p;
}

describe('<today-page>', () => {
  afterEach(() => document.body.replaceChildren());

  it('greets, shows the week, the progress and the cards in two lists', async () => {
    const { el } = await mount('today-page', createDemoProvider({ now: () => now }));
    expect(text($(el, 'h1'))).toBe('Good morning');
    expect($$(el, '.week-strip .day')).toHaveLength(7);
    const selected = $(el, '.week-strip [aria-pressed=true]')!;
    expect(selected.getAttribute('aria-label')).toMatch(/^Thursday, October 1/);
    expect(byLabel(el, /Saturday, October 3/).disabled).toBe(true);
    expect($(el, '.summary')?.getAttribute('aria-label')).toMatch(/^Today's progress: \d of \d$/);
    const names = $$(el, '.habit-name').map(text);
    expect(names).toEqual(
      expect.arrayContaining(['Workout', 'Meditate', 'Listen 20m', 'Run', 'Read']),
    );
  });

  it('marks a hand-ticked habit done, then undoes it', async () => {
    const p = await withHandTicked();
    const { el, log } = await mount('today-page', p);
    const check = byLabel(el, 'Mark done: Read');
    expect(check.getAttribute('aria-pressed')).toBe('false');
    check.click();
    await settle(el);
    expect(log.toasts.at(-1)?.message).toBe('Read: done');
    expect(byLabel(el, 'Mark not done: Read').getAttribute('aria-pressed')).toBe('true');
    // The card moved to Done.
    expect(text($(el, '[aria-labelledby=done] .habit-name'))).toBe('Read');

    await log.toasts.at(-1)!.undo!();
    (el as unknown as { data: AppData }).data = await appData(p);
    await settle(el);
    expect(byLabel(el, 'Mark done: Read')).toBeDefined();
  });

  /** A habit on a fresh source (no demo events), with whatever that source reported today. */
  async function practice(reported: number[]) {
    const p = createDemoProvider({ now: () => now });
    const src = await p.addSource({ kind: 'webhook', label: 'Piano app', config: {} });
    await p.saveHabit({
      id: 'practice',
      name: 'Practice',
      icon: 'music',
      color: 'amber',
      match: { sourceIds: [src.id], types: ['check-in'] },
      rule: { aggregate: 'sum', atLeast: 1800 },
      target: { perWeek: 7 },
      sort: 9,
    });
    for (const [i, value] of reported.entries()) {
      await p.putEvent({
        sourceId: src.id,
        externalId: `r${i}`,
        type: 'check-in',
        occurredAt: now.toISOString(),
        localDate: today,
        value,
        unit: 'seconds',
      });
    }
    return p;
  }

  it('marks an amount habit done with exactly the missing amount', async () => {
    const p = await practice([600]);
    const { el } = await mount('today-page', p);
    expect(
      text(
        $$(el, '.habit-card')
          .find((c) => /Practice/.test(c.textContent ?? ''))
          ?.querySelector('.habit-meta'),
      ),
    ).toBe('Every day · 10m of 30m');
    byLabel(el, 'Mark done: Practice').click();
    await settle(el);
    const entry = (await p.listEvents({ from: today, to: today })).find(
      (e) => e.type === 'manual.entry',
    );
    expect(entry).toMatchObject({ value: 1200, meta: { habit_id: 'practice' } });
    expect(byLabel(el, 'Mark not done: Practice')).toBeDefined();
  });

  it('opens the report when a source already did it', async () => {
    const { el } = await mount('today-page', await practice([1800]));
    const check = byLabel(el, 'Practice is done: reported by a source. Show what was reported');
    expect(check.hasAttribute('aria-pressed')).toBe(false);
    check.click();
    await settle(el);
    expect(($(el, '#day-dialog') as HTMLDialogElement).open).toBe(true);
    expect(text($(el, 'day-detail')?.shadowRoot?.querySelector('li'))).toBe('Piano app · 30m');
  });

  it('shows another day when one is picked', async () => {
    const { el } = await mount('today-page', createDemoProvider({ now: () => now }));
    byLabel(el, /^Monday, September 28/).click();
    await settle(el);
    expect(text($(el, 'h1'))).toBe('Monday');
    expect($(el, '.summary')?.getAttribute('aria-label')).toMatch(/^Monday's progress/);
  });

  it('opens progress from a card, the grid from the calendar, and Manage', async () => {
    const { el, log } = await mount('today-page', createDemoProvider({ now: () => now }));
    byLabel(el, /^Workout: .*Open progress$/).click();
    byLabel(el, 'Scorecard: every habit by day').click();
    byLabel(el, 'Manage').click();
    expect(log.routes).toEqual([
      { name: 'progress', habitId: 'demo-workout' },
      { name: 'grid' },
      { name: 'manage' },
    ]);
  });

  it('offers to make a habit when there are none', async () => {
    const p = createDemoProvider({ now: () => now });
    p.listHabits = async () => [];
    const { el, log } = await mount('today-page', p);
    byLabel(el, /New habit/).click();
    expect(log.routes).toEqual([{ name: 'form' }]);
  });

  it('shows source alerts with a way to Sources', async () => {
    const { el, log } = await mount('today-page', createDemoProvider({ now: () => now }), {
      alerts: [{ sourceId: 's', kind: 'stale', message: 'DeckFit last reported 9 days ago.' }],
    });
    expect(text($(el, '.alerts'))).toContain('DeckFit last reported 9 days ago.');
    byLabel(el, 'Open Sources').click();
    expect(log.routes).toEqual([{ name: 'sources' }]);
  });

  it('becomes the dashboard on wide screens', async () => {
    const { el } = await mount('today-page', createDemoProvider({ now: () => now }), {
      wide: true,
    });
    expect(text($(el, 'h1'))).toBe('October 2026');
    expect($$(el, '.ring')).toHaveLength(3);
    expect($(el, 'habit-scorecard')).not.toBeNull();
    expect($$(el, '.bars li').length).toBeGreaterThan(0);
    byLabel(el, 'Previous month').click();
    await settle(el);
    expect(text($(el, 'h1'))).toBe('September 2026');
  });
});

describe('<progress-page>', () => {
  afterEach(() => document.body.replaceChildren());

  it('lists every habit and opens one', async () => {
    const { el, log } = await mount('progress-page', createDemoProvider({ now: () => now }));
    expect($$(el, '.row-card')).toHaveLength(5);
    $$(el, '.row-card')[0].click();
    expect(log.routes).toEqual([{ name: 'progress', habitId: 'demo-workout' }]);
  });

  it('shows the hero, stats and a 5-week heatmap with a legend', async () => {
    const { el, log } = await mount('progress-page', createDemoProvider({ now: () => now }), {
      habitId: 'demo-meditate',
    });
    expect(text($(el, '.hero .title'))).toBe('Meditate');
    expect($$(el, '.week .circle')).toHaveLength(7);
    expect($$(el, '.stat-tile').map((t) => text(t.querySelector('.caption')))).toEqual([
      'Current streak',
      'Best run',
      'Last 30 days',
    ]);
    expect($$(el, '.hm-cell:not(.legend .hm-cell)').length).toBeGreaterThanOrEqual(35);
    expect($$(el, '.legend li').map(text)).toEqual(['Done', 'Missed', 'Upcoming']);
    byLabel(el, 'Edit Meditate').click();
    byLabel(el, 'Back to all habits').click();
    expect(log.routes).toEqual([{ name: 'form', habitId: 'demo-meditate' }, { name: 'progress' }]);
  });

  it('opens a day from the heatmap to correct it', async () => {
    const { el } = await mount('progress-page', createDemoProvider({ now: () => now }), {
      habitId: 'demo-run',
    });
    const cell = $$(el, 'button.hm-cell')[0];
    expect(cell.getAttribute('aria-label')).toMatch(/^[A-Z][a-z]{2} \d+: /);
    cell.click();
    await settle(el);
    expect(($(el, '#day-dialog') as HTMLDialogElement).open).toBe(true);
    expect($(el, 'day-detail')).not.toBeNull();
  });
});

describe('<habit-form>', () => {
  afterEach(() => document.body.replaceChildren());

  it('creates a hand-ticked habit with a colour and an icon', async () => {
    const p = createDemoProvider({ now: () => now });
    const { el, log } = await mount('habit-form', p);
    expect(el.shadowRoot!.activeElement?.id).toBe('name');
    const name = $(el, '#name') as HTMLInputElement;
    name.value = 'Stretch';
    name.dispatchEvent(new Event('input'));
    byLabel(el, 'coral').click();
    byLabel(el, 'Leaf').click();
    byLabel(el, '3 days a week').click();
    await settle(el);
    expect(text($(el, '.preview .habit-name'))).toBe('Stretch');
    expect(text($(el, 'legend .caption'))).toBe('3 days a week');
    ($(el, 'form') as HTMLFormElement).requestSubmit();
    await settle(el);
    const saved = (await p.listHabits()).find((h) => h.name === 'Stretch')!;
    expect(saved).toMatchObject({ color: 'coral', icon: 'leaf', target: { perWeek: 3 } });
    expect(saved.match.types).toEqual(['check-in']);
    expect(log.toasts.at(-1)?.message).toBe('Saved Stretch.');
    expect(log.routes.at(-1)).toEqual({ name: 'progress', habitId: saved.id });
  });

  it('says what is missing and focuses it', async () => {
    const { el } = await mount('habit-form', createDemoProvider({ now: () => now }));
    ($(el, 'form') as HTMLFormElement).requestSubmit();
    await settle(el);
    expect(text($(el, '#name-error'))).toBe('Give the habit a name.');
    expect(el.shadowRoot!.activeElement?.id).toBe('name');
  });

  it('edits a goal in minutes and archives with undo', async () => {
    const p = createDemoProvider({ now: () => now });
    const { el, log } = await mount('habit-form', p, { habitId: 'demo-listen' });
    expect(text($(el, 'h1'))).toBe('Edit habit');
    expect(($(el, '#amount') as HTMLInputElement).value).toBe('20');
    const amount = $(el, '#amount') as HTMLInputElement;
    amount.value = '30';
    amount.dispatchEvent(new Event('input'));
    ($(el, 'form') as HTMLFormElement).requestSubmit();
    await settle(el);
    expect((await p.listHabits()).find((h) => h.id === 'demo-listen')?.rule.atLeast).toBe(1800);

    byLabel(el, /Archive/).click();
    await settle(el);
    expect((await p.listHabits()).find((h) => h.id === 'demo-listen')?.archivedAt).toBeTruthy();
    await log.toasts.at(-1)!.undo!();
    expect((await p.listHabits()).find((h) => h.id === 'demo-listen')?.archivedAt).toBeUndefined();
  });

  it('picks which activities count', async () => {
    const p = createDemoProvider({ now: () => now });
    const { el } = await mount('habit-form', p, { habitId: 'demo-run' });
    const group = el.shadowRoot!.querySelector(
      '[role="group"][aria-label="Activities that count"]',
    )!;
    const chip = (name: string) =>
      [...group.querySelectorAll('button')].find((b) => text(b) === name)!;
    expect(chip('Run').getAttribute('aria-pressed')).toBe('true');
    expect(chip('Walk').getAttribute('aria-pressed')).toBe('false');
    chip('Run').click();
    await settle(el);
    chip('Hike').click();
    await settle(el);
    ($(el, 'form') as HTMLFormElement).requestSubmit();
    await settle(el);
    const saved = (await p.listHabits()).find((h) => h.id === 'demo-run')!;
    expect(saved.match.where).toEqual({ sport_type: ['Hike'] });
  });

  it('closes back to where it came from', async () => {
    const { el, log } = await mount('habit-form', createDemoProvider({ now: () => now }), {
      habitId: 'demo-run',
    });
    byLabel(el, 'Close').click();
    expect(log.routes).toEqual([{ name: 'progress', habitId: 'demo-run' }]);
  });
});

describe('<manage-habits>', () => {
  afterEach(() => document.body.replaceChildren());

  it('reorders, keeping focus on the moved habit', async () => {
    const p = createDemoProvider({ now: () => now });
    const { el } = await mount('manage-habits', p);
    expect(byLabel(el, 'Move Workout up').disabled).toBe(true);
    byLabel(el, 'Move Meditate up').click();
    await settle(el);
    expect($$(el, '.habit-name').slice(0, 2).map(text)).toEqual(['Meditate', 'Workout']);
    expect(el.shadowRoot!.activeElement?.getAttribute('data-move')).toBe('demo-meditate:down');
  });

  it('restores an archived habit', async () => {
    const p = createDemoProvider({ now: () => now });
    const run = (await p.listHabits()).find((h) => h.id === 'demo-run')!;
    await p.saveHabit({ ...run, archivedAt: '2026-09-01T00:00:00Z' } as Habit);
    const { el } = await mount('manage-habits', p);
    expect(text($(el, '#archived'))).toBe('Archived');
    byLabel(el, 'Restore Run').click();
    await settle(el);
    expect((await p.listHabits()).find((h) => h.id === 'demo-run')?.archivedAt).toBeUndefined();
  });
});

describe('<more-page>', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    document.body.replaceChildren();
    delete document.documentElement.dataset.theme;
  });

  it('switches the theme on <html> and remembers it', async () => {
    const { el } = await mount('more-page', createDemoProvider({ now: () => now }));
    expect(byLabel(el, /System/).getAttribute('aria-pressed')).toBe('true');
    byLabel(el, /Dark/).click();
    await settle(el);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('habits.theme')).toBe('dark');
    byLabel(el, /System/).click();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('links to Manage and shows the demo note without an account', async () => {
    const { el, log } = await mount('more-page', createDemoProvider({ now: () => now }));
    byLabel(el, 'Manage habits').click();
    expect(log.routes).toEqual([{ name: 'manage' }]);
    expect(text($(el, '#account + p'))).toContain('Demo data');
    expect($(el, 'data-page')).not.toBeNull();
  });

  it('shows the version and links to the commit it was built from', async () => {
    const { el } = await mount('more-page', createDemoProvider({ now: () => now }));
    const version = $(el, '.version')!;
    expect(text(version)).toMatch(
      /^Version \d+\.\d+\.\d+ · ([0-9a-f]{7}|dev) · built \d{4}-\d{2}-\d{2}$/,
    );
    const link = version.querySelector('a');
    if (link)
      expect(link.href).toMatch(/^https:\/\/github\.com\/ttruty\/Habits\/commit\/[0-9a-f]{40}$/);
  });

  it('signs out', async () => {
    const signOut = vi.fn(async () => {});
    const auth = { onChange: () => () => {}, sendLink: async () => {}, signOut };
    const { el } = await mount('more-page', createDemoProvider({ now: () => now }), { auth });
    byLabel(el, /Sign out/).click();
    expect(signOut).toHaveBeenCalled();
  });
});
