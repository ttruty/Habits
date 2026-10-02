import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import type { DataProvider } from '../data/provider';
import { localDateKey } from '../scoring/dates';
import { base } from '../styles/base';
import {
  colorPicker,
  frequencyLabel,
  frequencyPicker,
  habitCard,
  iconPicker,
  ui,
} from '../ui/components';
import { icon } from '../ui/ui-icons';
import { changed, navigate, toast, type AppData } from './app-events';
import {
  NEW_MANUAL,
  amountUnit,
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

/** Create / Edit (design/DESIGN_SYSTEM.md §6): a live preview card above the fields. */
export class HabitForm extends LitElement {
  static override properties = {
    provider: { attribute: false },
    data: { attribute: false },
    habitId: { attribute: false },
    draft: { state: true },
    errors: { state: true },
    saving: { state: true },
    message: { state: true },
  };

  declare provider: DataProvider;
  declare data: AppData;
  /** Edit this habit; undefined creates one. */
  declare habitId: string | undefined;
  declare private draft: Draft;
  declare private errors: DraftErrors;
  declare private saving: boolean;
  declare private message: string;
  private focusNext: string | undefined;

  constructor() {
    super();
    this.errors = {};
    this.saving = false;
    this.message = '';
  }

  private get original() {
    return this.data.habits.find((h) => h.id === this.habitId);
  }

  protected override willUpdate(changed: PropertyValues) {
    if (changed.has('habitId') || (changed.has('data') && !this.draft)) {
      const original = this.original;
      this.draft = original
        ? draftFromHabit(original, this.data.sources)
        : newDraft(crypto.randomUUID(), this.data.sources, localDateKey(new Date()));
      this.errors = {};
      this.focusNext = '#name';
    }
  }

  protected override updated() {
    if (!this.focusNext) return;
    this.renderRoot.querySelector<HTMLElement>(this.focusNext)?.focus();
    this.focusNext = undefined;
  }

  private set<K extends keyof Draft>(key: K, value: Draft[K]) {
    const next = { ...this.draft, [key]: value };
    if (key === 'sourceId') {
      const types = eventTypesFor(next.sourceId, this.data.sources);
      if (!types.some((t) => t.type === next.type)) next.type = types[0]?.type ?? '';
    }
    if (key === 'sourceId' || key === 'type') {
      next.aggregate = unitOf(next, this.data.sources) === 'count' ? 'count' : 'sum';
    }
    this.draft = next;
  }

  private back() {
    navigate(this, this.habitId ? { name: 'progress', habitId: this.habitId } : { name: 'today' });
  }

  private async save(e: Event) {
    e.preventDefault();
    if (this.saving) return;
    const { sources, habits } = this.data;
    this.errors = validate(this.draft, sources);
    const first = Object.keys(this.errors)[0];
    if (first) {
      this.focusNext = `#${first}`;
      return;
    }
    this.saving = true;
    try {
      let { sourceId } = this.draft;
      let all = sources;
      if (sourceId === NEW_MANUAL) {
        const manual = await this.provider.addSource({
          kind: 'manual',
          label: 'Manual',
          config: {},
        });
        all = [...sources, manual];
        sourceId = manual.id;
      }
      const nextSort = Math.max(-1, ...habits.map((h) => h.sort)) + 1;
      const habit = habitFromDraft({ ...this.draft, sourceId }, all, this.original, nextSort);
      await this.provider.saveHabit(habit);
      changed(this);
      toast(this, { message: `Saved ${habit.name}.` });
      navigate(this, { name: 'progress', habitId: habit.id });
    } catch {
      this.message = "Couldn't save. Try again.";
    } finally {
      this.saving = false;
    }
  }

  private async archive() {
    const original = this.original;
    if (!original) return;
    try {
      await this.provider.saveHabit({ ...original, archivedAt: new Date().toISOString() });
      changed(this);
      toast(this, {
        message: `Archived ${original.name}.`,
        undo: () => this.provider.saveHabit(original),
      });
      navigate(this, { name: 'today' });
    } catch {
      this.message = "Couldn't archive. Try again.";
    }
  }

  protected override render() {
    if (!this.draft) return nothing;
    const d = this.draft;
    const { sources } = this.data;
    const manual = isManualSource(d.sourceId, sources);
    const types = eventTypesFor(d.sourceId, sources);
    const unit = amountUnit(d, sources);
    const hasManual = sources.some((s) => s.kind === 'manual');
    const value = (e: Event) => (e.target as HTMLInputElement).value;
    const err = (k: keyof DraftErrors) =>
      this.errors[k] ? html`<span class="error" id="${k}-error">${this.errors[k]}</span>` : nothing;
    const described = (k: keyof DraftErrors) => (this.errors[k] ? `${k}-error` : nothing);
    const editing = !!this.original;

    return html`<form class="page sheet" @submit=${this.save} novalidate>
      <header class="page-head">
        <button type="button" class="icon" aria-label="Close" @click=${this.back}>
          ${icon('close')}
        </button>
        <h1 class="title">${editing ? 'Edit habit' : 'New habit'}</h1>
        <span class="spacer"></span>
      </header>

      <div class="preview" aria-hidden="true" inert>
        ${habitCard(
          {
            id: d.id,
            name: d.name.trim() || 'Your habit',
            icon: d.icon,
            color: d.color,
            meta: frequencyLabel(d.perWeek),
            state: 'pending',
            check: manual || d.goal === 'atLeast' ? 'toggle' : 'none',
            checkLabel: '',
          },
          { open: () => {}, check: () => {} },
        )}
      </div>

      <div class="field">
        <label for="name">Name</label>
        <input
          id="name"
          .value=${d.name}
          maxlength="80"
          autocomplete="off"
          aria-invalid=${this.errors.name ? 'true' : 'false'}
          aria-describedby=${described('name')}
          @input=${(e: Event) => this.set('name', value(e))}
        />
        ${err('name')}
      </div>

      <fieldset class="field">
        <legend>Colour</legend>
        ${colorPicker(d.color, (c) => this.set('color', c))}
      </fieldset>

      <fieldset class="field">
        <legend>Icon</legend>
        ${iconPicker(d.icon, d.color, (k) => this.set('icon', k))}
      </fieldset>

      <div class="field">
        <label for="source">Completions come from</label>
        <select
          id="source"
          aria-invalid=${this.errors.source ? 'true' : 'false'}
          aria-describedby=${described('source')}
          @change=${(e: Event) => this.set('sourceId', value(e))}
        >
          ${d.sourceId ? nothing : html`<option value="" selected>Choose…</option>`}
          ${
            hasManual
              ? nothing
              : html`<option value=${NEW_MANUAL} ?selected=${d.sourceId === NEW_MANUAL}>
                  Ticked by hand
                </option>`
          }
          ${sources.map(
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
          ? html`<p class="caption">Tick it off on Today.</p>`
          : html`${
                types.length > 1
                  ? html`<div class="field">
                      <label for="type">Event</label>
                      <select id="type" @change=${(e: Event) => this.set('type', value(e))}>
                        ${types.map(
                          (t) =>
                            html`<option value=${t.type} ?selected=${d.type === t.type}>
                              ${t.label}
                            </option>`,
                        )}
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
                            type="number"
                            inputmode="decimal"
                            min="0"
                            step="any"
                            .value=${d.amount}
                            aria-label="Amount, in ${unit.label}"
                            aria-invalid=${this.errors.amount ? 'true' : 'false'}
                            aria-describedby=${described('amount')}
                            @input=${(e: Event) => this.set('amount', value(e))}
                          /><span class="unit" aria-hidden="true">${unit.label}</span>`
                  }
                </div>
                ${err('amount')}
              </div>
              ${
                unitOf(d, sources) === 'count'
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
              }`
      }

      <fieldset class="field">
        <legend>
          How often <span class="caption" aria-live="polite">${frequencyLabel(d.perWeek)}</span>
        </legend>
        ${frequencyPicker(d.perWeek, (n) => this.set('perWeek', n))}
      </fieldset>

      <div class="field">
        <label for="startDate">Counts from</label>
        <input
          id="startDate"
          type="date"
          .value=${d.startDate}
          @input=${(e: Event) => this.set('startDate', value(e))}
        />
      </div>

      ${this.message ? html`<p class="error" role="alert">${this.message}</p>` : nothing}
      <button type="submit" class="primary block" ?disabled=${this.saving}>Save habit</button>
      ${
        editing && !this.original!.archivedAt
          ? html`<button type="button" class="block" @click=${this.archive}>
              ${icon('archive')} Archive
            </button>`
          : nothing
      }
    </form>`;
  }

  static override styles = [
    ...base,
    ui,
    css`
      .sheet {
        max-width: 36rem;
        padding-bottom: max(var(--space-10), env(safe-area-inset-bottom));
      }
      .spacer {
        width: var(--touch-min);
      }
      .preview {
        pointer-events: none;
      }
      legend {
        display: flex;
        justify-content: space-between;
        width: 100%;
        margin-bottom: var(--space-2);
      }
      .row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
      }
      .row select {
        flex: 1;
      }
      .row input {
        width: 7rem;
      }
      .unit {
        color: var(--color-ink-2);
      }
    `,
  ];
}

if (!customElements.get('habit-form')) customElements.define('habit-form', HabitForm);

declare global {
  interface HTMLElementTagNameMap {
    'habit-form': HabitForm;
  }
}
