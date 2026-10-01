import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues } from 'lit';
import { createDemoProvider } from '../data/demo-provider';
import type { DataProvider } from '../data/provider';
import { formatDate } from '../format';
import type { DateKey, DateRange, Habit, HabitEvent } from '../model';
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
import tokens from '../styles/tokens.css?inline';
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
 * (read-only embeds, from Phase 3).
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
    events: { state: true },
    status: { state: true },
  };

  declare theme: Theme;
  declare view: View;
  declare weeks: number;
  declare weekStart: number;
  declare heading: string | undefined;
  /** Share token for read-only embeds. Unused until Phase 3. */
  declare share: string | undefined;
  /** Where data comes from. Defaults to demo data. */
  declare provider: DataProvider;
  /** Override "today" ('YYYY-MM-DD'), for tests. Defaults to the device's local day. */
  declare today: DateKey | undefined;

  /** A day inside the period on screen. Undefined = the period containing today. */
  declare private anchor: DateKey | undefined;
  declare private habits: Habit[];
  declare private events: HabitEvent[];
  declare private status: 'loading' | 'ready' | 'error';

  private loads = 0;

  constructor() {
    super();
    this.theme = 'auto';
    this.view = 'week';
    this.weeks = 1;
    this.weekStart = 1;
    this.provider = createDemoProvider();
    this.habits = [];
    this.events = [];
    this.status = 'loading';
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
      const [habits, events] = await Promise.all([
        this.provider.listHabits(),
        this.provider.listEvents({
          from: from < historyFrom ? from : historyFrom,
          to: to > today ? to : today,
        }),
      ]);
      if (id !== this.loads) return; // a newer load started
      this.habits = habits;
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
            scoreRow(row, { today, dayLabel, summary: month ? 'days' : 'week', compact: month }),
          )}
        </tbody>
      </table>
    </div>`;
  }

  static override styles = [
    unsafeCSS(tokens),
    css`
      :host {
        display: block;
        font-family: var(--hs-font);
        font-size: var(--hs-font-size);
        line-height: 1.4;
        color: var(--hs-text);
        background: var(--hs-bg);
        padding: calc(var(--hs-space) * 2);
        border-radius: var(--hs-radius);
        box-sizing: border-box;
      }
      .sr {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
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
      button {
        font: inherit;
        color: var(--hs-text);
        background: var(--hs-surface);
        border: 1px solid var(--hs-border);
        border-radius: var(--hs-radius);
        min-height: 2.5rem;
        min-width: 2.5rem;
        padding: 0 0.75rem;
        cursor: pointer;
      }
      button:disabled {
        color: var(--hs-text-muted);
        opacity: 0.6;
        cursor: default;
      }
      button:focus-visible {
        outline: 2px solid var(--hs-focus);
        outline-offset: 2px;
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
        overflow-wrap: anywhere;
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
