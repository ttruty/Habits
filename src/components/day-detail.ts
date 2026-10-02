import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { connectorFor } from '../connectors/registry';
import { ensureManualSource, entryEvent } from '../connectors/manual';
import type { DataProvider } from '../data/provider';
import { formatValue } from '../format';
import type { DateKey, Habit, HabitEvent, Source, Unit } from '../model';
import { isEntryFor, matches } from '../scoring/score';
import { base } from '../styles/base';
import { amountUnit } from './habit-draft';

/**
 * One habit's day, for corrections: what the sources reported, what you added, and a form to add
 * a missed entry. Lives in the scorecard's dialog; fires `change` after every add or remove.
 */
export class DayDetail extends LitElement {
  static override properties = {
    habit: { attribute: false },
    date: { attribute: false },
    dayLabel: { attribute: false },
    events: { attribute: false },
    sources: { attribute: false },
    provider: { attribute: false },
    today: { attribute: false },
    amount: { state: true },
    busy: { state: true },
    message: { state: true },
  };

  declare habit: Habit;
  declare date: DateKey;
  /** "Tuesday 30 September". */
  declare dayLabel: string;
  /** Events on `date` that count for `habit` (reported and added). */
  declare events: HabitEvent[];
  declare sources: Source[];
  declare provider: DataProvider;
  declare today: DateKey;
  declare private amount: string;
  declare private busy: boolean;
  declare private message: string;

  constructor() {
    super();
    this.events = [];
    this.sources = [];
    this.amount = '';
    this.busy = false;
    this.message = '';
  }

  /** The habit and day last shown: a reload hands over new objects for the same day. */
  private shown = '';

  protected override willUpdate(changed: PropertyValues) {
    const key = `${this.habit?.id}|${this.date}`;
    if ((changed.has('habit') || changed.has('date')) && key !== this.shown) {
      this.shown = key;
      this.amount = '';
      this.message = '';
    }
  }

  /** The habit's amount unit, from its source's event type (minutes, km, steps…). */
  private get unit(): { label: string; factor: number; unit?: Unit } {
    const sourceId = this.habit.match.sourceIds?.[0] ?? '';
    const type = this.habit.match.types[0] ?? '';
    const source = this.sources.find((s) => s.id === sourceId);
    const unit = source && connectorFor(source.kind)?.eventTypes.find((t) => t.type === type)?.unit;
    return { ...amountUnit({ sourceId, type }, this.sources), unit };
  }

  private get counts() {
    return this.habit.rule.aggregate === 'count';
  }

  private describe(e: HabitEvent): string {
    const source = this.sources.find((s) => s.id === e.sourceId)?.label ?? 'A source';
    const kind = (e.meta?.sport_type ?? e.meta?.category) as string | undefined;
    const amount = e.value !== undefined && !this.counts ? formatValue(e.value, e.unit) : '';
    return [source, kind, amount].filter(Boolean).join(' · ');
  }

  private async add(e: Event) {
    e.preventDefault();
    if (this.busy) return;
    let value = 1;
    if (!this.counts) {
      const n = Number(this.amount);
      if (this.amount.trim() === '' || !Number.isFinite(n) || n <= 0) {
        this.message = 'Enter an amount above 0.';
        return;
      }
      value = Math.round(n * this.unit.factor);
    }
    await this.write(async () => {
      const manual = await ensureManualSource(this.provider, this.sources);
      await this.provider.putEvent(
        entryEvent(
          this.habit,
          manual,
          this.date,
          { value, unit: this.unit.unit },
          this.today,
          new Date(),
        ),
      );
    }, 'Added.');
    this.amount = '';
  }

  private removeEntry(entry: HabitEvent) {
    return this.write(() => this.provider.deleteEvent(entry.id), 'Removed.');
  }

  private async write(action: () => Promise<void>, done: string) {
    this.busy = true;
    try {
      await action();
      this.message = done;
      this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    } catch {
      this.message = "Couldn't save. Try again.";
    } finally {
      this.busy = false;
    }
  }

  protected override render() {
    if (!this.habit) return nothing;
    const reported = this.events.filter(
      (e) => !isEntryFor(this.habit, e) && matches(this.habit.match, e),
    );
    const added = this.events.filter((e) => isEntryFor(this.habit, e));
    const unit = this.unit;
    return html`
      <h2 id="day-heading">${this.habit.name} · ${this.dayLabel}</h2>

      <h3>Reported</h3>
      ${
        reported.length
          ? html`<ul>
              ${reported.map((e) => html`<li>${this.describe(e)}</li>`)}
            </ul>`
          : html`<p class="muted">Nothing reported.</p>`
      }

      <h3>Added by you</h3>
      ${
        added.length
          ? html`<ul>
              ${added.map(
                (e) =>
                  html`<li>
                    <span>${this.counts ? 'Done' : formatValue(e.value ?? 0, e.unit)}</span>
                    <button
                      type="button"
                      aria-label="Remove ${this.counts ? 'this entry' : formatValue(e.value ?? 0, e.unit, 'long')}"
                      ?disabled=${this.busy}
                      @click=${() => this.removeEntry(e)}
                    >
                      Remove
                    </button>
                  </li>`,
              )}
            </ul>`
          : html`<p class="muted">Nothing yet.</p>`
      }

      <form @submit=${this.add}>
        ${
          this.counts
            ? html`<button type="submit" class="primary" ?disabled=${this.busy}>
                Mark as done
              </button>`
            : html`<label for="amount">Add a missed amount</label>
                <div class="row">
                  <input
                    id="amount"
                    type="number"
                    inputmode="decimal"
                    min="0"
                    step="any"
                    .value=${this.amount}
                    aria-describedby="amount-unit"
                    @input=${(e: Event) => (this.amount = (e.target as HTMLInputElement).value)}
                  />
                  <span id="amount-unit">${unit.label}</span>
                  <button type="submit" class="primary" ?disabled=${this.busy}>Add</button>
                </div>`
        }
      </form>
      <p class="message" role="status">${this.message}</p>
    `;
  }

  static override styles = [
    ...base,
    css`
      h2 {
        font: var(--text-title);
        margin: 0 0 var(--space-2);
      }
      h3 {
        font: var(--text-label);
        margin: var(--space-3) 0 var(--space-1);
        color: var(--color-ink-3);
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
        min-height: 2.5rem;
      }
      .muted {
        color: var(--color-ink-3);
        margin: 0;
      }
      form {
        margin-top: var(--space-4);
      }
      label {
        display: block;
        font: var(--text-label);
        margin-bottom: var(--space-1);
      }
      .row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
      }
      input {
        width: 7rem;
      }
      .message {
        min-height: 1.4em;
        color: var(--color-ink-3);
        margin: var(--space-2) 0 0;
      }
    `,
  ];
}

if (!customElements.get('day-detail')) customElements.define('day-detail', DayDetail);

declare global {
  interface HTMLElementTagNameMap {
    'day-detail': DayDetail;
  }
}
