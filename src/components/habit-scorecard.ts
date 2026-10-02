import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { createDemoProvider } from '../data/demo-provider';
import type { DataProvider } from '../data/provider';
import { checkInEvent, checkInsOn, manualSourceOf } from '../connectors/manual';
import { connectorFor } from '../connectors/registry';
import './day-detail';
import { formatDate } from '../format';
import type { DateKey, DateRange, Habit, HabitEvent, Source } from '../model';
import {
  addDays,
  addMonths,
  eachDay,
  localDateKey,
  monthRange,
  startOfWeek,
  toLocalNoon,
  type Weekday,
} from '../scoring/dates';
import { buildScorecard } from '../scoring/scorecard';
import { countsFor, dedupe } from '../scoring/score';
import { base } from '../styles/base';
import { scoreRow } from './score-row';

export type Theme = 'auto' | 'light' | 'dark';
export type View = 'week' | 'month';

/** How far back events are loaded, so streaks can reach past the visible range. */
const HISTORY_DAYS = 365;

/**
 * The scorecard: a table of habits × days, with week/month views and prev/next navigation.
 *
 * Attributes: `view` (week | month), `weeks` (columns of weeks in week view), `week-start`
 * (0 = Sunday … 6; default 1 = Monday), `theme` (auto | light | dark), `heading`, and `share`
 * (read-only embeds, from Phase 4).
 *
 * Hand-ticked habits (Manual source) get a toggle button in each cell when the provider can edit.
 */
export class HabitScorecard extends LitElement {
  static override properties = {
    theme: { type: String, reflect: true },
    view: { type: String, reflect: true },
    weeks: { type: Number },
    weekStart: { type: Number, attribute: 'week-start' },
    heading: { type: String },
    share: { type: String },
    provider: { attribute: false },
    today: { attribute: false },
    anchor: { state: true },
    habits: { state: true },
    sources: { state: true },
    events: { state: true },
    status: { state: true },
    notice: { state: true },
    editing: { state: true },
  };

  declare theme: Theme;
  declare view: View;
  declare weeks: number;
  declare weekStart: number;
  declare heading: string | undefined;
  /** Share token for read-only embeds. Unused until Phase 4. */
  declare share: string | undefined;
  /** Where data comes from. Defaults to read-only demo data. */
  declare provider: DataProvider;
  /** Override "today" ('YYYY-MM-DD'), for tests. Defaults to the device's local day. */
  declare today: DateKey | undefined;

  /** A day inside the period on screen. Undefined = the period containing today. */
  declare private anchor: DateKey | undefined;
  declare private habits: Habit[];
  declare private sources: Source[];
  declare private events: HabitEvent[];
  declare private status: 'loading' | 'ready' | 'error';
  declare private notice: string;
  /** The day open for corrections, if any. */
  declare private editing: { habit: Habit; date: DateKey } | undefined;
  /** The cell that opened it, to take focus back on close. */
  private opener: HTMLElement | undefined;

  private loads = 0;
  /** Cells with a toggle in flight ("habitId:date"); taps on them are ignored. */
  private saving = new Set<string>();
  private onVisible = () => {
    // Back to the tab (or phone unlocked): pick up changes made on another device.
    if (document.visibilityState === 'visible' && this.status !== 'loading') void this.load();
  };

  constructor() {
    super();
    this.theme = 'auto';
    this.view = 'week';
    this.weeks = 1;
    this.weekStart = 1;
    this.provider = createDemoProvider({ readOnly: true });
    this.habits = [];
    this.sources = [];
    this.events = [];
    this.status = 'loading';
    this.notice = '';
  }

  override connectedCallback() {
    super.connectedCallback();
    document.addEventListener('visibilitychange', this.onVisible);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  private get todayKey(): DateKey {
    return this.today ?? localDateKey(new Date());
  }

  private get weekStartsOn(): Weekday {
    const n = Math.trunc(this.weekStart);
    return (n >= 0 && n <= 6 ? n : 1) as Weekday;
  }

  private get range(): DateRange {
    const anchor = this.anchor ?? this.todayKey;
    if (this.view === 'month') return monthRange(anchor);
    const to = addDays(startOfWeek(anchor, this.weekStartsOn), 6);
    const weeks = Math.max(1, Math.trunc(this.weeks) || 1);
    return { from: addDays(to, 1 - 7 * weeks), to };
  }

  protected override willUpdate(changed: PropertyValues) {
    const keys = ['provider', 'view', 'weeks', 'weekStart', 'today', 'anchor'] as const;
    if (keys.some((k) => changed.has(k))) void this.load();
  }

  private async load() {
    const id = ++this.loads;
    const today = this.todayKey;
    const { from, to } = this.range;
    const historyFrom = addDays(today, -HISTORY_DAYS);
    try {
      const [habits, sources, events] = await Promise.all([
        this.provider.listHabits(),
        this.provider.listSources(),
        this.provider.listEvents({
          from: from < historyFrom ? from : historyFrom,
          to: to > today ? to : today,
        }),
      ]);
      if (id !== this.loads) return; // a newer load started
      this.habits = habits;
      this.sources = sources;
      this.events = events;
      this.status = 'ready';
    } catch {
      if (id === this.loads) this.status = 'error';
    }
  }

  protected override updated(changed: PropertyValues) {
    // In a scrolling month, start with today in view. Sets scrollLeft only, so the host page
    // never jumps.
    const keys = ['view', 'anchor', 'status'];
    if (this.view !== 'month' || !keys.some((k) => changed.has(k))) return;
    const scroll = this.renderRoot.querySelector<HTMLElement>('.scroll');
    const day = this.renderRoot.querySelector<HTMLElement>('thead th.today');
    if (scroll && day) scroll.scrollLeft = day.offsetLeft - scroll.clientWidth / 2;
  }

  /** Tick or untick a hand-ticked habit on `date`. Shows the change at once, then saves. */
  private async toggle(habit: Habit, source: Source, date: DateKey) {
    const key = `${habit.id}:${date}`;
    if (this.saving.has(key)) return;
    this.saving.add(key);
    this.notice = '';
    const existing = checkInsOn(habit, source, date, this.events);
    const added = checkInEvent(habit, source, date, this.todayKey, new Date());
    this.events = existing.length
      ? this.events.filter((e) => !existing.includes(e))
      : [...this.events, { ...added, id: `unsaved:${key}` }];
    try {
      if (existing.length) await Promise.all(existing.map((e) => this.provider.deleteEvent(e.id)));
      else await this.provider.putEvent(added);
    } catch {
      this.notice = "Couldn't save that. Try again.";
    } finally {
      this.saving.delete(key);
    }
    await this.load();
  }

  private openDay(habit: Habit, date: DateKey, opener: HTMLElement) {
    this.opener = opener;
    this.editing = { habit, date };
    void this.updateComplete.then(() =>
      this.renderRoot.querySelector<HTMLDialogElement>('#day-dialog')?.showModal(),
    );
  }

  private closeDay() {
    this.editing = undefined;
    this.opener?.focus();
    this.opener = undefined;
  }

  private renderDayDialog(dayLabel: (d: DateKey) => string) {
    const editing = this.editing;
    if (!editing) return nothing;
    const { habit, date } = editing;
    const events = dedupe(this.events).filter((e) => e.localDate === date && countsFor(habit, e));
    return html`<dialog
      id="day-dialog"
      aria-label="${habit.name}, ${dayLabel(date)}"
      @close=${this.closeDay}
    >
      <day-detail
        .habit=${habit}
        .date=${date}
        .dayLabel=${dayLabel(date)}
        .events=${events}
        .sources=${this.sources}
        .provider=${this.provider}
        .today=${this.todayKey}
        @change=${() => void this.load()}
      ></day-detail>
      <form method="dialog" class="dialog-actions">
        <button type="submit">Close</button>
      </form>
    </dialog>`;
  }

  private step(direction: -1 | 1) {
    const anchor = this.anchor ?? this.todayKey;
    this.anchor =
      this.view === 'month'
        ? addMonths(anchor, direction)
        : addDays(anchor, direction * 7 * Math.max(1, Math.trunc(this.weeks) || 1));
  }

  private setView(view: View) {
    this.view = view;
    this.anchor = undefined;
  }

  private rangeLabel({ from, to }: DateRange): string {
    if (this.view === 'month') return formatDate(from, { month: 'long', year: 'numeric' });
    return new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).formatRange(toLocalNoon(from), toLocalNoon(to));
  }

  protected override render() {
    const today = this.todayKey;
    const range = this.range;
    const current = range.from <= today && today <= range.to;
    const unit = this.view === 'month' ? 'month' : 'week';
    const label = this.rangeLabel(range);

    return html`
      ${this.heading ? html`<h1>${this.heading}</h1>` : nothing}
      <div class="bar">
        <div class="nav">
          <button type="button" aria-label="Previous ${unit}" @click=${() => this.step(-1)}>
            <span aria-hidden="true">‹</span>
          </button>
          <p class="range" id="range" aria-live="polite">${label}</p>
          <button
            type="button"
            aria-label="Next ${unit}"
            ?disabled=${range.to >= today}
            @click=${() => this.step(1)}
          >
            <span aria-hidden="true">›</span>
          </button>
          <button type="button" ?disabled=${current} @click=${() => (this.anchor = undefined)}>
            Today
          </button>
        </div>
        <div class="toggle" role="group" aria-label="View">
          ${(['week', 'month'] as const).map(
            (v) =>
              html`<button
                type="button"
                aria-pressed=${this.view === v ? 'true' : 'false'}
                @click=${() => this.setView(v)}
              >
                ${v === 'week' ? 'Week' : 'Month'}
              </button>`,
          )}
        </div>
      </div>
      ${this.renderBody(range, today)}
    `;
  }

  private renderBody(range: DateRange, today: DateKey) {
    if (this.status === 'error')
      return html`<p class="status" role="alert">Couldn't load habits.</p>`;
    if (this.status === 'loading') return html`<p class="status" role="status">Loading…</p>`;
    if (!this.habits.some((h) => !h.archivedAt)) return html`<p class="status">No habits yet.</p>`;

    const rows = buildScorecard(this.habits, this.events, {
      view: range,
      today,
      weekStartsOn: this.weekStartsOn,
      historyFrom: addDays(today, -HISTORY_DAYS),
    });
    const month = this.view === 'month';
    const days = eachDay(range);
    const dayLabel = (d: DateKey) =>
      formatDate(d, { weekday: 'long', day: 'numeric', month: 'long' });
    const toggleFor = (habit: Habit) => {
      const source = this.provider.canEdit ? manualSourceOf(habit, this.sources) : undefined;
      return source && ((date: DateKey) => void this.toggle(habit, source, date));
    };
    // Every other habit opens a day for corrections (when the provider can write).
    const openFor = (habit: Habit) =>
      this.provider.canEdit && !manualSourceOf(habit, this.sources)
        ? (date: DateKey, opener: HTMLElement) => this.openDay(habit, date, opener)
        : undefined;

    return html`<div class="scroll">
        <table class=${month ? 'compact' : ''} aria-labelledby="range">
          <thead>
            <tr>
              <th scope="col" class="name"><span class="sr">Habit</span></th>
              ${days.map(
                (d) =>
                  html`<th
                    scope="col"
                    class="day ${d === today ? 'today' : ''}"
                    aria-current=${d === today ? 'date' : nothing}
                  >
                    ${
                      month
                        ? nothing
                        : html`<span class="dow" aria-hidden="true"
                            >${formatDate(d, { weekday: 'narrow' })}</span
                          >`
                    }<span class="dom" aria-hidden="true">${Number(d.slice(8))}</span
                    ><span class="sr">${dayLabel(d)}</span>
                  </th>`,
              )}
              <th scope="col" class="summary">${month ? 'Days' : 'Week'}</th>
              <th scope="col" class="summary">Streak</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) =>
              scoreRow(row, {
                today,
                dayLabel,
                summary: month ? 'days' : 'week',
                compact: month,
                toggle: toggleFor(row.habit),
                open: openFor(row.habit),
              }),
            )}
          </tbody>
        </table>
      </div>
      ${this.renderAttribution(rows.map((r) => r.habit))} ${this.renderDayDialog(dayLabel)}
      ${this.notice ? html`<p class="status error" role="alert">${this.notice}</p>` : nothing}`;
  }

  /** Credit required by a source's terms ("Powered by Strava") when its data is on screen. */
  private renderAttribution(habits: Habit[]) {
    const credits = new Map<string, string>();
    for (const habit of habits) {
      for (const id of habit.match.sourceIds ?? []) {
        const source = this.sources.find((s) => s.id === id);
        const credit = source && connectorFor(source.kind)?.attribution;
        if (credit && (source.config as { connected?: boolean }).connected) {
          credits.set(credit.text, credit.href);
        }
      }
    }
    if (!credits.size) return nothing;
    return html`<p class="attribution">
      ${[...credits].map(
        ([text, href]) => html`<a href=${href} target="_blank" rel="noopener">${text}</a> `,
      )}
    </p>`;
  }

  static override styles = [
    ...base,
    css`
      :host {
        container-type: inline-size;
        background: var(--hs-bg);
        padding: calc(var(--hs-space) * 2);
        border-radius: var(--hs-radius);
      }
      h1 {
        font-size: 1.25rem;
        margin: 0 0 calc(var(--hs-space) * 1.5);
      }

      /* Toolbar */
      .bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--hs-space);
        margin-bottom: calc(var(--hs-space) * 1.5);
      }
      .nav,
      .toggle {
        display: flex;
        align-items: center;
        gap: calc(var(--hs-space) / 2);
      }
      .range {
        margin: 0 calc(var(--hs-space) / 2);
        font-weight: 600;
        min-width: 9.5rem;
        text-align: center;
      }
      .toggle {
        gap: 0;
      }
      .toggle button:first-child {
        border-radius: var(--hs-radius) 0 0 var(--hs-radius);
      }
      .toggle button:last-child {
        border-radius: 0 var(--hs-radius) var(--hs-radius) 0;
        border-left: 0;
      }
      .toggle button[aria-pressed='true'] {
        background: var(--hs-text);
        color: var(--hs-bg);
        border-color: var(--hs-text);
      }
      .status {
        margin: var(--hs-space) 0;
        color: var(--hs-text-muted);
      }

      /* Grid */
      .scroll {
        overflow-x: auto;
        /* Contains the absolutely positioned .sr labels, which would otherwise widen the page. */
        position: relative;
      }
      table {
        border-collapse: collapse;
        width: 100%;
      }
      th,
      td {
        padding: 0;
        text-align: center;
        vertical-align: middle;
        font-weight: normal;
      }
      thead th {
        color: var(--hs-text-muted);
        font-size: 0.8125rem;
        padding-bottom: calc(var(--hs-space) / 2);
      }
      th.name {
        position: sticky;
        left: 0;
        z-index: 1;
        background: var(--hs-bg);
        text-align: left;
        padding-right: calc(var(--hs-space) / 2);
        overflow-wrap: break-word;
        hyphens: auto;
        font-weight: 500;
        color: var(--hs-text);
      }
      tbody th.name {
        padding-block: calc(var(--hs-space) * 0.75);
      }
      tbody tr + tr > * {
        border-top: 1px solid var(--hs-border);
      }
      .icon {
        margin-right: 0.3em;
      }
      .day .dow,
      .day .dom {
        display: block;
      }
      .day.today {
        color: var(--hs-text);
        font-weight: 600;
      }
      .today {
        background: var(--hs-surface);
      }
      .cell {
        width: 2.25rem;
        min-width: 1.75rem;
        height: 2.5rem;
      }
      .summary {
        padding-inline: calc(var(--hs-space) / 2);
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .summary .met {
        color: var(--hs-done);
      }
      .summary .unit {
        color: var(--hs-text-muted);
        font-size: 0.8em;
        margin-left: 1px;
      }

      dialog {
        width: min(28rem, calc(100vw - 2rem));
        border: 1px solid var(--hs-border);
        border-radius: var(--hs-radius);
        background: var(--hs-bg);
        color: var(--hs-text);
        padding: calc(var(--hs-space) * 2);
      }
      dialog::backdrop {
        background: rgb(0 0 0 / 0.4);
      }
      .dialog-actions {
        display: flex;
        justify-content: flex-end;
        margin-top: var(--hs-space);
      }
      .tick.open .value {
        display: block;
      }

      .attribution {
        margin: var(--hs-space) 0 0;
        font-size: 0.75rem;
        color: var(--hs-text-muted);
      }
      .attribution a {
        color: inherit;
      }

      /* Hand-ticked cells: the whole cell is the button. */
      .tick {
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 2.25rem;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .tick:hover .mark.missed,
      .tick:hover .mark.pending {
        outline: 1px solid var(--hs-text-muted);
        outline-offset: 4px;
        border-radius: 50%;
      }

      /* Marks: shape and colour both carry the state. */
      .mark {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        vertical-align: middle;
      }
      .mark.done {
        width: 0.875rem;
        height: 0.875rem;
        border-radius: 50%;
        background: var(--hs-habit);
      }
      .mark.missed {
        width: 0.3rem;
        height: 0.3rem;
        border-radius: 50%;
        background: var(--hs-text-muted);
      }
      .mark.pending {
        width: 0.875rem;
        height: 0.875rem;
        border-radius: 50%;
        border: 2px solid var(--hs-text-muted);
      }
      .mark.inactive {
        width: 0.5rem;
        height: 2px;
        background: var(--hs-border);
      }
      .mark.over {
        color: var(--hs-over);
        font-weight: 700;
        line-height: 1;
      }
      .mark.metric {
        width: 0.875rem;
        height: 0.875rem;
        border-radius: 3px;
        background: var(--hs-habit);
      }
      .mark.level-0 {
        background: transparent;
        border: 1px solid var(--hs-border);
      }
      .mark.level-1 {
        opacity: 0.3;
      }
      .mark.level-2 {
        opacity: 0.5;
      }
      .mark.level-3 {
        opacity: 0.75;
      }
      .value {
        display: block;
        font-size: 0.6875rem;
        color: var(--hs-text-muted);
        font-variant-numeric: tabular-nums;
      }

      /* Narrow (a phone, or a small embed): tighter week columns so names keep whole words. */
      @container (max-width: 26rem) {
        .cell {
          width: 1.5rem;
          min-width: 1.5rem;
        }
        .summary {
          padding-inline: 0.125rem;
          font-size: 0.875rem;
        }
        thead th.summary {
          font-size: 0.75rem;
        }
      }

      /* Month: ~31 narrow columns, scrolls sideways on a phone. */
      .compact th.name {
        min-width: 7rem;
      }
      .compact .cell {
        width: 1.25rem;
        min-width: 1.25rem;
        height: 2.25rem;
      }
      .compact .mark.done,
      .compact .mark.pending,
      .compact .mark.metric {
        width: 0.625rem;
        height: 0.625rem;
      }
    `,
  ];
}

if (!customElements.get('habit-scorecard')) {
  customElements.define('habit-scorecard', HabitScorecard);
}

declare global {
  interface HTMLElementTagNameMap {
    'habit-scorecard': HabitScorecard;
  }
}
