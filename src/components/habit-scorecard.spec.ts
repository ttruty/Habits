import { afterEach, describe, expect, it } from 'vitest';
import { createDemoProvider } from '../data/demo-provider';
import type { DataProvider } from '../data/provider';
import type { Habit, HabitEvent, Source } from '../model';
import { event, habit } from '../scoring/test-helpers';
import { manualMatch } from '../connectors/manual';
import { cellStatus } from './day-cell';
import { HabitScorecard } from './habit-scorecard';

const today = '2026-10-01'; // Thursday

function provider(
  habits: Habit[],
  events: HabitEvent[],
  sources: Source[] = [],
): DataProvider & { ranges: unknown[]; events: HabitEvent[] } {
  const ranges: unknown[] = [];
  let stored = [...events];
  return {
    ...createDemoProvider(),
    ranges,
    listSources: async () => sources,
    listHabits: async () => habits,
    listEvents: async (range) => {
      ranges.push(range);
      return stored.filter((e) => e.localDate >= range.from && e.localDate <= range.to);
    },
    putEvent: async (e) => {
      stored.push({ ...e, id: `saved-${stored.length}` });
    },
    deleteEvent: async (id) => {
      stored = stored.filter((e) => e.id !== id);
    },
    get events() {
      return stored;
    },
  };
}

async function mount(p: DataProvider, attrs: Record<string, string> = {}) {
  const card = document.createElement('habit-scorecard');
  for (const [k, v] of Object.entries(attrs)) card.setAttribute(k, v);
  card.today = today;
  card.provider = p;
  document.body.append(card);
  await settle(card);
  return card;
}

/** Wait for the load and the render that follows it. */
async function settle(card: HabitScorecard) {
  for (let i = 0; i < 3; i++) {
    await card.updateComplete;
    await new Promise((r) => setTimeout(r));
  }
}

const $ = (card: HabitScorecard, sel: string) => card.shadowRoot!.querySelector(sel);
const $$ = (card: HabitScorecard, sel: string) => [...card.shadowRoot!.querySelectorAll(sel)];
const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim();
const button = (card: HabitScorecard, name: RegExp) =>
  $$(card, 'button').find(
    (b) => name.test(b.getAttribute('aria-label') ?? '') || name.test(text(b) ?? ''),
  ) as HTMLButtonElement;

describe('<habit-scorecard>', () => {
  afterEach(() => document.body.replaceChildren());

  it('defaults to the auto theme and week view, reflected', async () => {
    const card = await mount(provider([], []));
    expect(card.getAttribute('theme')).toBe('auto');
    expect(card.getAttribute('view')).toBe('week');
  });

  it('renders a table with row and column headers', async () => {
    const card = await mount(provider([habit()], [event('2026-09-29')]));
    const table = $(card, 'table')!;
    expect(table.getAttribute('aria-labelledby')).toBe('range');
    const cols = $$(card, 'thead th[scope=col]');
    expect(cols).toHaveLength(1 + 7 + 2);
    expect(text(cols[2])).toMatch(/Tuesday.*29.*September|September.*29/);
    expect(text($(card, 'tbody th[scope=row]'))).toContain('Workout');
  });

  it('labels every cell in words', async () => {
    const card = await mount(provider([habit()], [event('2026-09-29')]));
    // A cell's words are hidden text, or its button's label when it opens the day.
    const labels = $$(card, 'tbody td.cell').map(
      (td) =>
        td.querySelector('button')?.getAttribute('aria-label') ?? text(td.querySelector('.sr')),
    );
    expect(labels[0]).toMatch(/^Workout, Monday.*: missed$/);
    expect(labels[1]).toMatch(/^Workout, Tuesday.*: done$/);
    expect(labels[3]).toMatch(/: not yet$/);
    expect(labels[4]).toMatch(/: upcoming$/);
  });

  it('marks today', async () => {
    const card = await mount(provider([habit()], []));
    const current = $$(card, 'thead th[aria-current=date]');
    expect(current).toHaveLength(1);
    expect(current[0].classList).toContain('today');
  });

  it('shows week progress and streak', async () => {
    const h = habit({ target: { perWeek: 3 } });
    const events = [
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
    ].map((d) => event(d));
    const card = await mount(provider([h], events));
    const [week, streak] = $$(card, 'tbody td.summary').map((td) => text(td.querySelector('.sr')));
    expect(week).toBe('3 of 3, target met');
    expect(streak).toBe('2 weeks');
  });

  it('shows a dash for metric habits with no streak', async () => {
    const h = habit({ match: { types: ['gaming.session'] }, rule: { aggregate: 'sum' } });
    const card = await mount(
      provider(
        [h],
        [event('2026-09-29', { type: 'gaming.session', value: 2700, unit: 'seconds' })],
      ),
    );
    const summaries = $$(card, 'tbody td.summary').map(text);
    expect(summaries[0]).toBe('45m');
    expect(summaries[1]).toContain('no streak');
    expect(text($$(card, 'tbody td.cell')[1])).toContain('45m');
  });

  it('loads a year of history for streaks', async () => {
    const p = provider([habit()], []);
    await mount(p);
    expect(p.ranges.at(-1)).toEqual({ from: '2025-10-01', to: '2026-10-04' });
  });

  it('steps back and forward a week, and returns to today', async () => {
    const card = await mount(provider([habit()], []));
    const range = () => text($(card, '#range'));
    const first = range();
    expect(button(card, /^Next week$/).disabled).toBe(true);
    expect(button(card, /^Today$/).disabled).toBe(true);

    button(card, /^Previous week$/).click();
    await settle(card);
    expect(range()).not.toBe(first);
    expect(text($(card, 'thead th.day'))).toMatch(/21/);
    expect(button(card, /^Next week$/).disabled).toBe(false);

    button(card, /^Next week$/).click();
    await settle(card);
    expect(range()).toBe(first);

    button(card, /^Previous week$/).click();
    await settle(card);
    button(card, /^Today$/).click();
    await settle(card);
    expect(range()).toBe(first);
  });

  it('switches to a month view', async () => {
    const card = await mount(provider([habit()], [event('2026-10-01')]));
    button(card, /^Month$/).click();
    await settle(card);
    expect(card.getAttribute('view')).toBe('month');
    expect(button(card, /^Month$/).getAttribute('aria-pressed')).toBe('true');
    expect($$(card, 'thead th.day')).toHaveLength(31);
    expect(text($$(card, 'thead th.summary')[0])).toBe('Days');
    expect(text($(card, 'tbody td.summary'))).toBe('1');

    button(card, /^Previous month$/).click();
    await settle(card);
    expect($$(card, 'thead th.day')).toHaveLength(30); // September
  });

  it('shows several weeks', async () => {
    const card = await mount(provider([habit()], []), { weeks: '2' });
    expect($$(card, 'thead th.day')).toHaveLength(14);
    expect(text($(card, 'thead th.day'))).toMatch(/21/);
  });

  it('starts weeks on the configured day', async () => {
    const card = await mount(provider([habit()], []), { 'week-start': '0' });
    expect(text($(card, 'thead th.day'))).toMatch(/27/);
  });

  it('says when there are no habits', async () => {
    const card = await mount(provider([habit({ archivedAt: '2026-01-01' })], []));
    expect(text($(card, '.status'))).toBe('No habits yet.');
  });

  it('says when loading fails', async () => {
    const failing: DataProvider = {
      ...provider([], []),
      listHabits: async () => {
        throw new Error('offline');
      },
    };
    const card = await mount(failing);
    expect(text($(card, '[role=alert]'))).toBe("Couldn't load habits.");
  });

  it('renders the heading only when asked', async () => {
    const card = await mount(provider([], []), { heading: 'Habits' });
    expect(text($(card, 'h1'))).toBe('Habits');
    const bare = await mount(provider([], []));
    expect($(bare, 'h1')).toBeNull();
  });
});

describe('hand-ticked habits', () => {
  afterEach(() => document.body.replaceChildren());

  const manual: Source = {
    id: 'm',
    kind: 'manual',
    label: 'Manual',
    config: {},
    createdAt: '2026-01-01T00:00:00Z',
  };
  const read = habit({ id: 'read', name: 'Read', match: manualMatch('read', 'm') });
  const ticks = (card: HabitScorecard) => $$(card, 'tbody button.tick') as HTMLButtonElement[];

  it('makes past and today cells toggle buttons, but not future ones', async () => {
    const card = await mount(provider([read], [], [manual]));
    const buttons = ticks(card);
    expect(buttons).toHaveLength(4); // Mon–Thu
    expect(buttons[3].getAttribute('aria-label')).toMatch(/^Read, Thursday/);
    expect(buttons.every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('ticks and unticks a day', async () => {
    const p = provider([read], [], [manual]);
    const card = await mount(p);
    ticks(card)[3].click();
    // Shown at once, before the save finishes.
    await card.updateComplete;
    expect(ticks(card)[3].getAttribute('aria-pressed')).toBe('true');
    await settle(card);
    expect(p.events).toHaveLength(1);
    expect(p.events[0]).toMatchObject({
      sourceId: 'm',
      externalId: 'read:2026-10-01',
      type: 'check-in',
      localDate: today,
      meta: { habit_id: 'read' },
    });

    ticks(card)[3].click();
    await settle(card);
    expect(p.events).toHaveLength(0);
    expect(ticks(card)[3].getAttribute('aria-pressed')).toBe('false');
  });

  it('ticks a past day with a timestamp on that day', async () => {
    const p = provider([read], [], [manual]);
    const card = await mount(p);
    ticks(card)[0].click();
    await settle(card);
    expect(p.events[0].localDate).toBe('2026-09-28');
    expect(new Date(p.events[0].occurredAt).getDate()).toBe(28);
  });

  it('says so when a save fails, and shows the stored state again', async () => {
    const p = provider([read], [], [manual]);
    p.putEvent = async () => {
      throw new Error('offline');
    };
    const card = await mount(p);
    ticks(card)[3].click();
    await settle(card);
    expect(text($(card, '[role=alert]'))).toBe("Couldn't save that. Try again.");
    expect(ticks(card)[3].getAttribute('aria-pressed')).toBe('false');
  });

  it('has no buttons when the provider is read-only', async () => {
    const p = { ...provider([read], [], [manual]), canEdit: false };
    const card = await mount(p);
    expect(ticks(card)).toHaveLength(0);
  });

  it('reloads when the page becomes visible again', async () => {
    const p = provider([read], [], [manual]);
    const card = await mount(p);
    const before = p.ranges.length;
    document.dispatchEvent(new Event('visibilitychange'));
    await settle(card);
    expect(p.ranges.length).toBe(before + 1);
  });
});

describe('correcting a day', () => {
  afterEach(() => document.body.replaceChildren());

  const run = habit({
    id: 'run',
    name: 'Run',
    match: { sourceIds: ['st'], types: ['activity.created'], where: { sport_type: ['Run'] } },
  });
  const listen = habit({
    id: 'listen',
    name: 'Listen',
    match: { sourceIds: ['yb'], types: ['listening.day'] },
    rule: { aggregate: 'sum', atLeast: 1200 },
  });
  const sources: Source[] = [
    { id: 'st', kind: 'strava', label: 'Strava', config: { connected: true }, createdAt: 'T' },
    { id: 'yb', kind: 'yarnbeard', label: 'Yarnbeard', config: {}, createdAt: 'T' },
  ];
  const opens = (card: HabitScorecard) => $$(card, 'tbody button.open') as HTMLButtonElement[];
  const detail = (card: HabitScorecard) =>
    $(card, 'day-detail') as HTMLElement & { updateComplete: Promise<void> };
  const inDetail = (card: HabitScorecard, sel: string) =>
    detail(card).shadowRoot!.querySelector(sel);

  it('opens a missed day and marks it done', async () => {
    const p = provider([run], [], sources);
    const card = await mount(p);
    const [monday] = opens(card);
    expect(monday.getAttribute('aria-haspopup')).toBe('dialog');
    expect(monday.getAttribute('aria-label')).toMatch(/^Run, Monday.*: missed$/);
    monday.click();
    await settle(card);
    await detail(card).updateComplete;
    expect(($(card, '#day-dialog') as HTMLDialogElement).open).toBe(true);
    expect(text(inDetail(card, 'h2'))).toMatch(/^Run · Monday/);
    expect(text(inDetail(card, 'p.muted'))).toBe('Nothing reported.');

    (inDetail(card, 'button.primary') as HTMLButtonElement).click();
    await settle(card);
    await settle(card);
    expect(p.events).toHaveLength(1);
    expect(p.events[0]).toMatchObject({
      type: 'manual.entry',
      localDate: '2026-09-28',
      value: 1,
      meta: { habit_id: 'run' },
    });
    expect(opens(card)[0].getAttribute('aria-label')).toMatch(/: done$/);
  });

  it('adds a missed amount in the habit’s unit, and removes it again', async () => {
    const reported = event('2026-09-29', {
      sourceId: 'yb',
      type: 'listening.day',
      value: 600,
      unit: 'seconds',
    });
    const p = provider([listen], [reported], sources);
    const card = await mount(p);
    opens(card)[1].click();
    await settle(card);
    await detail(card).updateComplete;
    expect(text(inDetail(card, 'li'))).toBe('Yarnbeard · 10m');
    expect(text(inDetail(card, '#amount-unit'))).toBe('minutes');

    const input = inDetail(card, '#amount') as HTMLInputElement;
    input.value = '15';
    input.dispatchEvent(new Event('input'));
    (inDetail(card, 'form') as HTMLFormElement).requestSubmit();
    await settle(card);
    await settle(card);
    const added = p.events.find((e) => e.type === 'manual.entry')!;
    expect(added).toMatchObject({ value: 900, unit: 'seconds' });
    expect(opens(card)[1].getAttribute('aria-label')).toMatch(/: done, 25 minutes$/);

    await detail(card).updateComplete;
    (inDetail(card, 'button[aria-label^="Remove"]') as HTMLButtonElement).click();
    await settle(card);
    await settle(card);
    expect(p.events.some((e) => e.type === 'manual.entry')).toBe(false);
  });

  it('refuses an empty or zero amount', async () => {
    const card = await mount(provider([listen], [], sources));
    opens(card)[0].click();
    await settle(card);
    await detail(card).updateComplete;
    (inDetail(card, 'form') as HTMLFormElement).requestSubmit();
    await detail(card).updateComplete;
    expect(text(inDetail(card, '.message'))).toBe('Enter an amount above 0.');
  });

  it('returns focus to the cell when the dialog closes', async () => {
    const card = await mount(provider([run], [], sources));
    const monday = opens(card)[0];
    monday.click();
    await settle(card);
    ($(card, '#day-dialog') as HTMLDialogElement).close();
    await settle(card);
    expect($(card, '#day-dialog')).toBeNull();
    expect(card.shadowRoot!.activeElement).toBe(opens(card)[0]);
  });

  it('opens nothing on a read-only scorecard or for future days', async () => {
    const readOnly = await mount({ ...provider([run], [], sources), canEdit: false });
    expect(opens(readOnly)).toHaveLength(0);
    const card = await mount(provider([run], [], sources));
    expect(opens(card)).toHaveLength(4); // Mon–Thu; Fri–Sun are upcoming
  });
});

describe('attribution', () => {
  afterEach(() => document.body.replaceChildren());

  const strava = (connected: boolean): Source => ({
    id: 'st',
    kind: 'strava',
    label: 'Strava',
    config: { connected },
    createdAt: 'T',
  });
  const run = habit({
    id: 'run',
    name: 'Run',
    match: { sourceIds: ['st'], types: ['activity.created'] },
  });

  it('credits Strava when a connected Strava source is on screen', async () => {
    const card = await mount(provider([run], [], [strava(true)]));
    const link = $(card, '.attribution a') as HTMLAnchorElement;
    expect(text(link)).toBe('Powered by Strava');
    expect(link.href).toBe('https://www.strava.com/');
  });

  it('shows no credit without Strava data', async () => {
    expect($(await mount(provider([run], [], [strava(false)])), '.attribution')).toBeNull();
    expect($(await mount(provider([habit()], [], [])), '.attribution')).toBeNull();
  });
});

describe('cellStatus', () => {
  const sum = habit({ rule: { aggregate: 'sum', atLeast: 1200 } });
  const limit = habit({ rule: { aggregate: 'sum', atMost: 600 } });
  const cell = (state: string, value = 0) =>
    ({ date: today, value, state, done: state === 'done' }) as never;

  it('describes each state', () => {
    expect(cellStatus(habit(), cell('done', 1), 'count')).toBe('done');
    expect(cellStatus(sum, cell('done', 1500), 'seconds')).toBe('done, 25 minutes');
    expect(cellStatus(sum, cell('missed', 600), 'seconds')).toBe('missed, 10 minutes');
    expect(cellStatus(sum, cell('missed', 0), 'seconds')).toBe('missed');
    expect(cellStatus(limit, cell('missed', 900), 'seconds')).toBe('over the limit, 15 minutes');
    expect(cellStatus(sum, cell('pending', 300), 'seconds')).toBe('not yet, 5 minutes so far');
    expect(cellStatus(sum, cell('pending', 0), 'seconds')).toBe('not yet');
    expect(cellStatus(sum, cell('future'), 'seconds')).toBe('upcoming');
    expect(cellStatus(sum, cell('inactive'), 'seconds')).toBe('not started');
    expect(cellStatus(sum, cell('metric', 120), 'seconds')).toBe('2 minutes');
    expect(cellStatus(sum, cell('metric', 0), 'seconds')).toBe('none');
  });
});
