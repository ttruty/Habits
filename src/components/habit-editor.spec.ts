import { afterEach, describe, expect, it } from 'vitest';
import { createDemoProvider } from '../data/demo-provider';
import type { DataProvider } from '../data/provider';
import './habit-editor';
import type { HabitEditor } from './habit-editor';

async function mount(provider: DataProvider) {
  const el = document.createElement('habit-editor');
  el.provider = provider;
  document.body.append(el);
  await settle(el);
  return el;
}

async function settle(el: HabitEditor) {
  for (let i = 0; i < 4; i++) {
    await el.updateComplete;
    await new Promise((r) => setTimeout(r));
  }
}

const $ = <T extends Element = HTMLElement>(el: HabitEditor, sel: string) =>
  el.shadowRoot!.querySelector<T>(sel)!;
const $$ = (el: HabitEditor, sel: string) => [...el.shadowRoot!.querySelectorAll<HTMLElement>(sel)];
const text = (e: Element | null) => e?.textContent?.replace(/\s+/g, ' ').trim();
const button = (el: HabitEditor, label: string) =>
  $$(el, 'button').find(
    (b) => b.getAttribute('aria-label') === label || text(b) === label,
  ) as HTMLButtonElement;

function type(el: HabitEditor, sel: string, value: string) {
  const input = $<HTMLInputElement | HTMLSelectElement>(el, sel);
  input.value = value;
  input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input'));
}

async function submit(el: HabitEditor) {
  $<HTMLFormElement>(el, 'form').requestSubmit();
  await settle(el);
}

describe('<habit-editor>', () => {
  afterEach(() => document.body.replaceChildren());

  it('lists live habits in order', async () => {
    const el = await mount(createDemoProvider());
    expect($$(el, '.live .name').map(text)).toEqual([
      'Workout',
      'Meditate',
      'Listen 20m',
      'Run',
      'Read',
    ]);
    expect(text($$(el, '.detail')[3])).toBe('Strava · 3× a week');
  });

  it('creates a hand-ticked habit, making the Manual source on first use', async () => {
    const p = createDemoProvider();
    const el = await mount(p);
    button(el, 'New habit').click();
    await settle(el);
    expect(el.shadowRoot!.activeElement?.id).toBe('name');
    expect($<HTMLSelectElement>(el, '#source').value).toBe('__new-manual__');

    type(el, '#name', 'Stretch');
    type(el, '#icon', '🤸');
    await submit(el);

    const sources = await p.listSources();
    const manual = sources.find((s) => s.kind === 'manual')!;
    const read = (await p.listHabits()).find((h) => h.name === 'Stretch')!;
    expect(read.match).toEqual({
      sourceIds: [manual.id],
      types: ['check-in'],
      where: { habit_id: read.id },
    });
    expect(read.sort).toBe(5);
    expect(text($(el, '.message'))).toBe('Saved Stretch.');
    expect(el.shadowRoot!.activeElement?.getAttribute('data-edit')).toBe(read.id);

    // The next new habit reuses that source.
    button(el, 'New habit').click();
    await settle(el);
    expect($<HTMLSelectElement>(el, '#source').value).toBe(manual.id);
  });

  it('shows errors and focuses the first one', async () => {
    const el = await mount(createDemoProvider());
    button(el, 'New habit').click();
    await settle(el);
    await submit(el);
    expect(text($(el, '#name-error'))).toBe('Give the habit a name.');
    expect($(el, '#name').getAttribute('aria-invalid')).toBe('true');
    expect(el.shadowRoot!.activeElement?.id).toBe('name');
  });

  it('edits a goal in display units', async () => {
    const p = createDemoProvider();
    const el = await mount(p);
    button(el, 'Edit Listen 20m').click();
    await settle(el);
    expect($<HTMLInputElement>(el, '#amount').value).toBe('20');
    type(el, '#amount', '30');
    type(el, '#perWeek', '5');
    await submit(el);
    const listen = (await p.listHabits()).find((h) => h.id === 'demo-listen')!;
    expect(listen.rule).toEqual({ aggregate: 'sum', atLeast: 1800 });
    expect(listen.target.perWeek).toBe(5);
  });

  it('offers no amount for tracked metrics', async () => {
    const el = await mount(createDemoProvider());
    button(el, 'Edit Listen 20m').click();
    await settle(el);
    type(el, '#goal', 'track');
    await settle(el);
    expect($(el, '#amount')).toBeNull();
  });

  it('switches event type and aggregate with the source', async () => {
    const el = await mount(createDemoProvider());
    button(el, 'Edit Run').click();
    await settle(el);
    type(el, '#source', 'demo-yarnbeard');
    await settle(el);
    expect($<HTMLSelectElement>(el, '#type').value).toBe('listening.day');
    expect($<HTMLSelectElement>(el, '#aggregate').value).toBe('sum');
    type(el, '#type', 'book.finished');
    await settle(el);
    expect($(el, '#aggregate')).toBeNull(); // counts have nothing to add up
  });

  it('archives and restores', async () => {
    const p = createDemoProvider();
    const el = await mount(p);
    button(el, 'Edit Run').click();
    await settle(el);
    button(el, 'Archive').click();
    await settle(el);
    expect($$(el, '.live .name').map(text)).not.toContain('Run');
    expect(text($(el, 'summary'))).toBe('Archived (1)');
    expect(text($(el, '.message'))).toBe('Archived Run.');

    button(el, 'Restore Run').click();
    await settle(el);
    expect((await p.listHabits()).find((h) => h.id === 'demo-run')).not.toHaveProperty(
      'archivedAt',
    );
  });

  it('reorders, keeping focus on the moved row', async () => {
    const p = createDemoProvider();
    const el = await mount(p);
    expect(button(el, 'Move Workout up').disabled).toBe(true);
    button(el, 'Move Meditate up').click();
    await settle(el);
    expect($$(el, '.live .name').map(text).slice(0, 2)).toEqual(['Meditate', 'Workout']);
    // Meditate is first now, so its Up is disabled; focus moves to its Down.
    expect(el.shadowRoot!.activeElement?.getAttribute('data-move')).toBe('demo-meditate:down');

    button(el, 'Move Workout down').click();
    await settle(el);
    expect($$(el, '.live .name').map(text).slice(0, 3)).toEqual([
      'Meditate',
      'Listen 20m',
      'Workout',
    ]);
    expect(el.shadowRoot!.activeElement?.getAttribute('data-move')).toBe('demo-workout:down');
  });

  it('cancels back to the list', async () => {
    const el = await mount(createDemoProvider());
    button(el, 'New habit').click();
    await settle(el);
    button(el, 'Cancel').click();
    await settle(el);
    expect($(el, 'form')).toBeNull();
    expect(el.shadowRoot!.activeElement?.id).toBe('new');
  });

  it('says when saving fails', async () => {
    const p = createDemoProvider();
    p.saveHabit = async () => {
      throw new Error('offline');
    };
    const el = await mount(p);
    button(el, 'Edit Run').click();
    await settle(el);
    await submit(el);
    expect(text($(el, '.message'))).toBe("Couldn't save. Try again.");
    expect($(el, 'form')).not.toBeNull();
  });

  it('says when loading fails', async () => {
    const p = createDemoProvider();
    p.listHabits = async () => {
      throw new Error('offline');
    };
    const el = await mount(p);
    expect(text($(el, '[role=alert]'))).toBe("Couldn't load habits.");
  });
});
