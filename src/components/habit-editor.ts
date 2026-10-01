import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import type { DataProvider } from '../data/provider';
import type { Habit, Source } from '../model';
import { localDateKey } from '../scoring/dates';
import { base } from '../styles/base';
import {
  COLORS,
  NEW_MANUAL,
  displayUnit,
  draftFromHabit,
  eventTypesFor,
  habitFromDraft,
  isManualSource,
  newDraft,
  unitOf,
  validate,
  type Draft,
  type DraftErrors,
} from './habit-draft';

/** Lists habits (reorder, archive, restore) and edits one at a time. */
export class HabitEditor extends LitElement {
  static override properties = {
    provider: { attribute: false },
    habits: { state: true },
    sources: { state: true },
    draft: { state: true },
    errors: { state: true },
    status: { state: true },
    message: { state: true },
  };

  declare provider: DataProvider;
  declare private habits: Habit[];
  declare private sources: Source[];
  /** The habit being edited; undefined shows the list. */
  declare private draft: Draft | undefined;
  declare private errors: DraftErrors;
  declare private status: 'loading' | 'ready' | 'error' | 'saving';
  /** Last outcome, announced politely. */
  declare private message: string;

  /** Where focus goes after the next render. */
  private focusNext: string | undefined;

  constructor() {
    super();
    this.habits = [];
    this.sources = [];
    this.errors = {};
    this.status = 'loading';
    this.message = '';
  }

  protected override willUpdate(changed: PropertyValues) {
    if (changed.has('provider')) void this.load();
  }

  protected override updated() {
    // Wait out saves: their buttons are disabled and can't take focus.
    if (!this.focusNext || this.status === 'saving') return;
    this.renderRoot.querySelector<HTMLElement>(this.focusNext)?.focus();
    this.focusNext = undefined;
  }

  private async load() {
    try {
      const [habits, sources] = await Promise.all([
        this.provider.listHabits(),
        this.provider.listSources(),
      ]);
      this.habits = habits.toSorted((a, b) => a.sort - b.sort);
      this.sources = sources;
      this.status = 'ready';
    } catch {
      this.status = 'error';
    }
  }

  private get live() {
    return this.habits.filter((h) => !h.archivedAt);
  }

  private open(habit?: Habit) {
    const today = localDateKey(new Date());
    this.draft = habit
      ? draftFromHabit(habit, this.sources)
      : newDraft(crypto.randomUUID(), this.sources, today);
    this.errors = {};
    this.message = '';
    this.focusNext = '#name';
  }

  private close(message = '') {
    const id = this.draft?.id;
    this.draft = undefined;
    this.errors = {};
    this.message = message;
    this.focusNext = id && this.habits.some((h) => h.id === id) ? `[data-edit="${id}"]` : '#new';
  }

  private set<K extends keyof Draft>(key: K, value: Draft[K]) {
    if (!this.draft) return;
    const next = { ...this.draft, [key]: value };
    if (key === 'sourceId') {
      // A new source: pick its first event type, and a sensible way to aggregate it.
      const types = eventTypesFor(next.sourceId, this.sources);
      if (!types.some((t) => t.type === next.type)) next.type = types[0]?.type ?? '';
    }
    if (key === 'sourceId' || key === 'type') {
      next.aggregate = unitOf(next, this.sources) === 'count' ? 'count' : 'sum';
    }
    this.draft = next;
  }

  private async save(e: Event) {
    e.preventDefault();
    const draft = this.draft;
    if (!draft || this.status === 'saving') return;
    this.errors = validate(draft, this.sources);
    const first = Object.keys(this.errors)[0];
    if (first) {
      this.focusNext = `#${first}`;
      return;
    }

    this.status = 'saving';
    try {
      let { sourceId } = draft;
      let sources = this.sources;
      if (sourceId === NEW_MANUAL) {
        const manual = await this.provider.addSource({
          kind: 'manual',
          label: 'Manual',
          config: {},
        });
        sources = [...sources, manual];
        sourceId = manual.id;
      }
      const original = this.habits.find((h) => h.id === draft.id);
      const nextSort = Math.max(-1, ...this.habits.map((h) => h.sort)) + 1;
      await this.provider.saveHabit(
        habitFromDraft({ ...draft, sourceId }, sources, original, nextSort),
      );
      await this.load();
      this.close(`Saved ${draft.name.trim()}.`);
    } catch {
      this.status = 'ready';
      this.message = "Couldn't save. Try again.";
    }
  }

  private async archive(habit: Habit, archived: boolean) {
    const { archivedAt: _, ...rest } = habit;
    void _;
    await this.write(
      () =>
        this.provider.saveHabit(
          archived ? { ...rest, archivedAt: new Date().toISOString() } : rest,
        ),
      archived ? `Archived ${habit.name}.` : `Restored ${habit.name}.`,
    );
    if (this.draft) this.close(this.message);
  }

  private async move(habit: Habit, by: -1 | 1) {
    const ids = this.live.map((h) => h.id);
    const i = ids.indexOf(habit.id);
    const to = i + by;
    [ids[i], ids[to]] = [ids[to], ids[i]];
    // Keep focus on the button just used, unless the row reached the end and it's now disabled.
    const atEnd = to === 0 || to === ids.length - 1;
    const dir = by < 0 !== atEnd ? 'up' : 'down';
    this.focusNext = `[data-move="${habit.id}:${dir}"]`;
    await this.write(
      () => this.provider.saveHabitOrder(ids),
      `Moved ${habit.name} ${by < 0 ? 'up' : 'down'}.`,
    );
  }

  private async write(action: () => Promise<void>, done: string) {
    this.status = 'saving';
    try {
      await action();
      await this.load();
      this.message = done;
    } catch {
      this.status = 'ready';
      this.message = "Couldn't save. Try again.";
    }
  }

  protected override render() {
    if (this.status === 'loading') return html`<p role="status">Loading…</p>`;
    if (this.status === 'error')
      return html`<p class="error" role="alert">Couldn't load habits.</p>`;
    return html`
      ${this.draft ? this.renderForm(this.draft) : this.renderList()}
      <p class="message" role="status">${this.message}</p>
    `;
  }

  private describe(habit: Habit): string {
    const source = this.sources.find((s) => s.id === habit.match.sourceIds?.[0]);
    const from = source
      ? source.kind === 'manual'
        ? 'Ticked by hand'
        : source.label
      : 'No source';
    const n = habit.target.perWeek;
    return `${from} · ${n >= 7 ? 'daily' : `${n}× a week`}`;
  }

  private renderList() {
    const live = this.live;
    const archived = this.habits.filter((h) => h.archivedAt);
    const busy = this.status === 'saving';
    return html`
      <div class="head">
        <h2>Habits</h2>
        <button id="new" type="button" class="primary" @click=${() => this.open()}>
          New habit
        </button>
      </div>
      ${
        live.length
          ? html`<ul class="list live">
              ${live.map(
                (h, i) =>
                  html`<li>
                    <span class="icon" aria-hidden="true">${h.icon}</span>
                    <span class="what">
                      <span class="name">${h.name}</span>
                      <span class="detail">${this.describe(h)}</span>
                    </span>
                    <span class="actions">
                      <button
                        type="button"
                        aria-label="Move ${h.name} up"
                        data-move="${h.id}:up"
                        ?disabled=${busy || i === 0}
                        @click=${() => this.move(h, -1)}
                      >
                        <span aria-hidden="true">↑</span>
                      </button>
                      <button
                        type="button"
                        aria-label="Move ${h.name} down"
                        data-move="${h.id}:down"
                        ?disabled=${busy || i === live.length - 1}
                        @click=${() => this.move(h, 1)}
                      >
                        <span aria-hidden="true">↓</span>
                      </button>
                      <button
                        type="button"
                        data-edit=${h.id}
                        aria-label="Edit ${h.name}"
                        @click=${() => this.open(h)}
                      >
                        Edit
                      </button>
                    </span>
                  </li>`,
              )}
            </ul>`
          : html`<p class="muted">No habits yet.</p>`
      }
      ${
        archived.length
          ? html`<details>
              <summary>Archived (${archived.length})</summary>
              <ul class="list">
                ${archived.map(
                  (h) =>
                    html`<li>
                      <span class="icon" aria-hidden="true">${h.icon}</span>
                      <span class="what"><span class="name">${h.name}</span></span>
                      <span class="actions">
                        <button
                          type="button"
                          aria-label="Restore ${h.name}"
                          ?disabled=${busy}
                          @click=${() => this.archive(h, false)}
                        >
                          Restore
                        </button>
                      </span>
                    </li>`,
                )}
              </ul>
            </details>`
          : nothing
      }
    `;
  }

  private renderForm(d: Draft) {
    const original = this.habits.find((h) => h.id === d.id);
    const manual = isManualSource(d.sourceId, this.sources);
    const types = eventTypesFor(d.sourceId, this.sources);
    const unit = displayUnit(unitOf(d, this.sources));
    const hasManual = this.sources.some((s) => s.kind === 'manual');
    const err = (key: keyof DraftErrors) =>
      this.errors[key]
        ? html`<span class="error" id="${key}-error">${this.errors[key]}</span>`
        : nothing;
    const describedBy = (key: keyof DraftErrors) => (this.errors[key] ? `${key}-error` : nothing);
    const value = (e: Event) => (e.target as HTMLInputElement).value;

    return html`<form @submit=${this.save} novalidate>
      <h2>${original ? `Edit ${original.name}` : 'New habit'}</h2>

      <div class="field">
        <label for="name">Name</label>
        <input
          id="name"
          .value=${d.name}
          maxlength="80"
          autocomplete="off"
          aria-invalid=${this.errors.name ? 'true' : 'false'}
          aria-describedby=${describedBy('name')}
          @input=${(e: Event) => this.set('name', value(e))}
        />
        ${err('name')}
      </div>

      <div class="field">
        <label for="icon">Icon <span class="muted">(an emoji)</span></label>
        <input
          id="icon"
          class="short"
          .value=${d.icon}
          maxlength="8"
          autocomplete="off"
          @input=${(e: Event) => this.set('icon', value(e))}
        />
      </div>

      <fieldset class="field">
        <legend>Colour</legend>
        <div class="swatches">
          ${COLORS.map(
            (c) =>
              html`<label class="swatch" style="--c: var(--hs-color-${c})">
                <input
                  type="radio"
                  name="color"
                  value=${c}
                  .checked=${d.color === c}
                  @change=${() => this.set('color', c)}
                />
                <span class="dot" aria-hidden="true"></span>${c}
              </label>`,
          )}
        </div>
      </fieldset>

      <div class="field">
        <label for="source">Completions come from</label>
        <select
          id="source"
          aria-invalid=${this.errors.source ? 'true' : 'false'}
          aria-describedby=${describedBy('source')}
          @change=${(e: Event) => this.set('sourceId', value(e))}
        >
          ${d.sourceId ? nothing : html`<option value="" selected>Choose…</option>`}
          ${hasManual ? nothing : html`<option value=${NEW_MANUAL} ?selected=${d.sourceId === NEW_MANUAL}>Ticked by hand</option>`}
          ${this.sources.map(
            (s) =>
              html`<option value=${s.id} ?selected=${d.sourceId === s.id}>
                ${s.kind === 'manual' ? 'Ticked by hand' : s.label}
              </option>`,
          )}
        </select>
        ${err('source')}
      </div>

      ${
        manual
          ? html`<p class="muted">Tap a day in the scorecard to tick it.</p>`
          : html`
              ${
                types.length > 1
                  ? html`<div class="field">
                      <label for="type">Event</label>
                      <select id="type" @change=${(e: Event) => this.set('type', value(e))}>
                        ${types.map((t) => html`<option value=${t.type} ?selected=${d.type === t.type}>${t.label}</option>`)}
                      </select>
                    </div>`
                  : nothing
              }
              <div class="field">
                <label for="goal">Each day</label>
                <div class="row">
                  <select
                    id="goal"
                    @change=${(e: Event) => this.set('goal', value(e) as Draft['goal'])}
                  >
                    <option value="atLeast" ?selected=${d.goal === 'atLeast'}>At least</option>
                    <option value="atMost" ?selected=${d.goal === 'atMost'}>At most</option>
                    <option value="track" ?selected=${d.goal === 'track'}>Just track it</option>
                  </select>
                  ${
                    d.goal === 'track'
                      ? nothing
                      : html`<input
                            id="amount"
                            class="short"
                            type="number"
                            inputmode="decimal"
                            min="0"
                            step="any"
                            .value=${d.amount}
                            aria-label="Amount, in ${unit.label}"
                            aria-invalid=${this.errors.amount ? 'true' : 'false'}
                            aria-describedby=${describedBy('amount')}
                            @input=${(e: Event) => this.set('amount', value(e))}
                          /><span aria-hidden="true">${unit.label}</span>`
                  }
                </div>
                ${err('amount')}
              </div>
              ${
                unitOf(d, this.sources) === 'count'
                  ? nothing
                  : html`<div class="field">
                      <label for="aggregate">Counting</label>
                      <select
                        id="aggregate"
                        @change=${(e: Event) => this.set('aggregate', value(e) as Draft['aggregate'])}
                      >
                        <option value="sum" ?selected=${d.aggregate === 'sum'}>
                          The day's total
                        </option>
                        <option value="count" ?selected=${d.aggregate === 'count'}>
                          How many times
                        </option>
                      </select>
                    </div>`
              }
            `
      }

      <div class="field">
        <label for="perWeek">How often</label>
        <select id="perWeek" @change=${(e: Event) => this.set('perWeek', Number(value(e)))}>
          ${[7, 6, 5, 4, 3, 2, 1].map(
            (n) =>
              html`<option value=${n} ?selected=${d.perWeek === n}>
                ${n === 7 ? 'Every day' : `${n} days a week`}
              </option>`,
          )}
        </select>
      </div>

      <div class="field">
        <label for="startDate">Counts from</label>
        <input
          id="startDate"
          type="date"
          class="short"
          .value=${d.startDate}
          @input=${(e: Event) => this.set('startDate', value(e))}
        />
      </div>

      <div class="buttons">
        <button type="submit" class="primary" ?disabled=${this.status === 'saving'}>Save</button>
        <button type="button" @click=${() => this.close()}>Cancel</button>
        ${
          original && !original.archivedAt
            ? html`<button type="button" class="end" @click=${() => this.archive(original, true)}>
                Archive
              </button>`
            : nothing
        }
      </div>
    </form>`;
  }

  static override styles = [
    ...base,
    css`
      h2 {
        font-size: 1.125rem;
        margin: 0;
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--hs-space);
      }
      .muted,
      .detail {
        color: var(--hs-text-muted);
      }
      .list {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .list li {
        display: flex;
        align-items: center;
        gap: var(--hs-space);
        padding: var(--hs-space) 0;
        border-top: 1px solid var(--hs-border);
      }
      .icon {
        width: 1.5em;
        text-align: center;
      }
      .what {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      .name {
        font-weight: 500;
      }
      .detail {
        font-size: 0.8125rem;
      }
      .actions {
        display: flex;
        gap: calc(var(--hs-space) / 2);
      }
      details {
        margin-top: calc(var(--hs-space) * 2);
      }
      summary {
        cursor: pointer;
        color: var(--hs-text-muted);
        min-height: 2.5rem;
        display: flex;
        align-items: center;
      }
      form h2 {
        margin-bottom: calc(var(--hs-space) * 2);
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: calc(var(--hs-space) / 2);
        margin: 0 0 calc(var(--hs-space) * 2);
        padding: 0;
        border: 0;
        max-width: 28rem;
      }
      label,
      legend {
        font-weight: 500;
        padding: 0;
      }
      .row {
        display: flex;
        align-items: center;
        gap: var(--hs-space);
      }
      .short {
        width: 9rem;
      }
      .swatches {
        display: flex;
        flex-wrap: wrap;
        gap: var(--hs-space);
      }
      .swatch {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-weight: normal;
        min-height: 2.5rem;
        padding: 0 0.625rem 0 0.25rem;
        border: 1px solid var(--hs-border);
        border-radius: var(--hs-radius);
        cursor: pointer;
      }
      .swatch:has(input:checked) {
        border-color: var(--hs-text);
      }
      .swatch:has(input:focus-visible) {
        outline: 2px solid var(--hs-focus);
        outline-offset: 2px;
      }
      .swatch input {
        margin: 0;
        min-height: 0;
      }
      .dot {
        width: 1rem;
        height: 1rem;
        border-radius: 50%;
        background: var(--c);
      }
      .buttons {
        display: flex;
        gap: var(--hs-space);
      }
      .buttons .end {
        margin-left: auto;
      }
      .message {
        min-height: 1.4em;
        color: var(--hs-text-muted);
      }
      .error {
        font-size: 0.875rem;
      }
    `,
  ];
}

if (!customElements.get('habit-editor')) customElements.define('habit-editor', HabitEditor);

declare global {
  interface HTMLElementTagNameMap {
    'habit-editor': HabitEditor;
  }
}
