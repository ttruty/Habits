import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { connectorFor } from '../connectors/registry';
import { ensureManualSource } from '../connectors/manual';
import { eventsToCsv, parseImportCsv, type ParsedImport } from '../data/csv';
import type { DataProvider, NewEvent } from '../data/provider';
import type { Habit, Source, Unit } from '../model';
import { localDateKey, toLocalNoon } from '../scoring/dates';
import { MANUAL_ENTRY } from '../scoring/score';
import { base } from '../styles/base';
import { amountUnit } from './habit-draft';

/** From the first event ever recorded to today, for an export. */
const ALL_TIME_FROM = '1970-01-01';

/** Export everything; import a CSV to backfill one habit. */
export class DataPage extends LitElement {
  static override properties = {
    provider: { attribute: false },
    now: { attribute: false },
    download: { attribute: false },
    habits: { state: true },
    sources: { state: true },
    habitId: { state: true },
    parsed: { state: true },
    fileName: { state: true },
    busy: { state: true },
    message: { state: true },
  };

  declare provider: DataProvider;
  /** For tests. */
  declare now: () => Date;
  /** Saves a file; replaced in tests. */
  declare download: (name: string, type: string, text: string) => void;
  declare private habits: Habit[];
  declare private sources: Source[];
  declare private habitId: string;
  declare private parsed: ParsedImport | undefined;
  declare private fileName: string;
  declare private busy: boolean;
  declare private message: string;

  constructor() {
    super();
    this.now = () => new Date();
    this.download = saveFile;
    this.habits = [];
    this.sources = [];
    this.habitId = '';
    this.fileName = '';
    this.busy = false;
    this.message = '';
  }

  protected override willUpdate(changed: PropertyValues) {
    if (changed.has('provider')) void this.load();
  }

  private async load() {
    const [habits, sources] = await Promise.all([
      this.provider.listHabits(),
      this.provider.listSources(),
    ]);
    this.habits = habits.filter((h) => !h.archivedAt).toSorted((a, b) => a.sort - b.sort);
    this.sources = sources;
    this.habitId ||= this.habits[0]?.id ?? '';
  }

  private get habit() {
    return this.habits.find((h) => h.id === this.habitId);
  }

  /** The habit's amount unit (minutes, km, steps) and the stored unit it converts to. */
  private unitFor(habit: Habit): { label: string; factor: number; unit?: Unit } {
    const sourceId = habit.match.sourceIds?.[0] ?? '';
    const type = habit.match.types[0] ?? '';
    const source = this.sources.find((s) => s.id === sourceId);
    const unit = source && connectorFor(source.kind)?.eventTypes.find((t) => t.type === type)?.unit;
    return { ...amountUnit({ sourceId, type }, this.sources), unit };
  }

  private async exportAs(format: 'json' | 'csv') {
    this.busy = true;
    this.message = '';
    try {
      const today = localDateKey(this.now());
      const [habits, sources, events] = await Promise.all([
        this.provider.listHabits(),
        this.provider.listSources(),
        this.provider.listEvents({ from: ALL_TIME_FROM, to: today }),
      ]);
      const name = `habits-${today}.${format}`;
      if (format === 'json') {
        const body = { exportedAt: this.now().toISOString(), sources, habits, events };
        this.download(name, 'application/json', JSON.stringify(body, null, 2));
      } else {
        this.download(name, 'text/csv', eventsToCsv(events, sources));
      }
      this.message = `Exported ${events.length} events.`;
    } catch {
      this.message = "Couldn't export. Try again.";
    } finally {
      this.busy = false;
    }
  }

  private async readFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    this.message = '';
    if (!file) {
      this.parsed = undefined;
      return;
    }
    this.fileName = file.name;
    this.parsed = parseImportCsv(await file.text());
  }

  private async import(e: Event) {
    e.preventDefault();
    const habit = this.habit;
    const parsed = this.parsed;
    if (!habit || !parsed?.rows.length || this.busy) return;
    this.busy = true;
    try {
      const manual = await ensureManualSource(this.provider, this.sources);
      const { factor, unit } = this.unitFor(habit);
      const counts = habit.rule.aggregate === 'count';
      const events: NewEvent[] = parsed.rows.map((row) => ({
        sourceId: manual.id,
        // One per habit and day: importing the same file again replaces, never doubles.
        externalId: `import:${habit.id}:${row.date}`,
        type: MANUAL_ENTRY,
        occurredAt: toLocalNoon(row.date).toISOString(),
        localDate: row.date,
        // No amount: exactly enough to count as done (the goal; 0 for a limit or a metric).
        value: counts
          ? 1
          : row.amount === undefined
            ? (habit.rule.atLeast ?? 0)
            : Math.round(row.amount * factor),
        ...(counts ? { unit: 'count' as const } : unit ? { unit } : {}),
        meta: { habit_id: habit.id, imported: true },
      }));
      await this.provider.putEvents(events);
      this.message = `Imported ${events.length} ${events.length === 1 ? 'day' : 'days'} into ${habit.name}.`;
      this.parsed = undefined;
      this.fileName = '';
      const input = this.renderRoot.querySelector<HTMLInputElement>('#file');
      if (input) input.value = '';
      await this.load();
    } catch {
      this.message = "Couldn't import. Try again.";
    } finally {
      this.busy = false;
    }
  }

  protected override render() {
    const habit = this.habit;
    const unit = habit && this.unitFor(habit);
    const counts = habit?.rule.aggregate === 'count';
    const parsed = this.parsed;
    return html`
      <h2>Data</h2>

      <section aria-labelledby="export-heading">
        <h3 id="export-heading">Export</h3>
        <p class="muted">Everything Habits has stored: sources, habits and every event.</p>
        <div class="row">
          <button type="button" ?disabled=${this.busy} @click=${() => this.exportAs('json')}>
            Download JSON
          </button>
          <button type="button" ?disabled=${this.busy} @click=${() => this.exportAs('csv')}>
            Download events as CSV
          </button>
        </div>
      </section>

      <section aria-labelledby="import-heading">
        <h3 id="import-heading">Import a backfill</h3>
        <p class="muted">
          A CSV with one row per day: <code>date,amount</code>, dates like 2026-09-30.
          ${
            counts
              ? 'For this habit the amount is ignored: each day listed counts as done.'
              : unit
                ? html`The amount is in ${unit.label}; leave it out to count the day as done.`
                : nothing
          }
          Importing the same day again replaces it.
        </p>
        ${
          this.habits.length
            ? html`<form @submit=${this.import}>
                <div class="field">
                  <label for="habit">Into habit</label>
                  <select
                    id="habit"
                    @change=${(e: Event) => (this.habitId = (e.target as HTMLSelectElement).value)}
                  >
                    ${this.habits.map(
                      (h) =>
                        html`<option value=${h.id} ?selected=${h.id === this.habitId}>
                          ${h.icon} ${h.name}
                        </option>`,
                    )}
                  </select>
                </div>
                <div class="field">
                  <label for="file">CSV file</label>
                  <input
                    id="file"
                    type="file"
                    accept=".csv,text/csv,text/plain"
                    @change=${this.readFile}
                  />
                </div>
                ${parsed ? this.renderPreview(parsed) : nothing}
                <button
                  type="submit"
                  class="primary"
                  ?disabled=${this.busy || !parsed?.rows.length}
                >
                  Import
                </button>
              </form>`
            : html`<p class="muted">Add a habit first.</p>`
        }
      </section>

      <p class="message" role="status">${this.message}</p>
    `;
  }

  private renderPreview({ rows, errors }: ParsedImport) {
    return html`<div class="preview">
      ${
        rows.length
          ? html`<p>
              ${rows.length} ${rows.length === 1 ? 'day' : 'days'}, ${rows[0].date} to
              ${rows.at(-1)!.date}.
            </p>`
          : html`<p>No days found in ${this.fileName}.</p>`
      }
      ${
        errors.length
          ? html`<div role="alert">
              <p>${errors.length} ${errors.length === 1 ? 'line was' : 'lines were'} skipped:</p>
              <ul>
                ${errors.slice(0, 5).map((e) => html`<li>Line ${e.line}: ${e.message}</li>`)}
              </ul>
              ${errors.length > 5 ? html`<p>…and ${errors.length - 5} more.</p>` : nothing}
            </div>`
          : nothing
      }
    </div>`;
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
        margin: var(--space-4) 0 var(--space-1);
      }
      section {
        max-width: 36rem;
      }
      .muted {
        color: var(--color-ink-3);
        margin: 0 0 var(--space-2);
      }
      code {
        font-family: var(--font-mono);
        font: var(--text-caption);
        font-family: var(--font-mono);
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
        margin-bottom: var(--space-3);
      }
      label {
        font: var(--text-label);
      }
      input[type='file'] {
        padding: 0.5rem;
        min-height: auto;
      }
      .preview {
        margin-bottom: var(--space-2);
      }
      .preview p {
        margin: 0 0 var(--space-1);
      }
      .preview ul {
        margin: 0;
        padding-left: 1.25rem;
        color: var(--color-danger);
      }
      .message {
        min-height: 1.4em;
        color: var(--color-ink-3);
      }
    `,
  ];
}

/** Hand `text` to the browser as a file download. */
function saveFile(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

if (!customElements.get('data-page')) customElements.define('data-page', DataPage);

declare global {
  interface HTMLElementTagNameMap {
    'data-page': DataPage;
  }
}
