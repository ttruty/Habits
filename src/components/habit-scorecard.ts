import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { createDemoProvider } from '../data/demo-provider';
import type { DataProvider } from '../data/provider';
import { checkInEvent, checkInsOn, manualSourceOf } from '../connectors/manual';
import { connectorFor } from '../connectors/registry';
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
import { buildScorecard, type ScoreRow } from '../scoring/scorecard';
import { heatLevel, heatSummary } from '../scoring/heatmap';
import { cellStatus } from './day-cell';
import { formatValue } from '../format';
import { countsFor, dedupe } from '../scoring/score';
import { base } from '../styles/base';
import { ownTokens } from '../styles/tokens';
import { habitVars } from '../ui/vars';
import { habitIcon } from '../ui/icons';
import { scoreRow } from './score-row';

export type Theme = 'auto' | 'light' | 'dark';
export type View = 'week' | 'month' | 'heatmap';

/** The heatmap view's span. */
const HEAT_WEEKS = 12;
const VIEWS: { view: View; label: string; unit: string }[] = [
  { view: 'week', label: 'Week', unit: 'week' },
  { view: 'month', label: 'Month', unit: 'month' },
  { view: 'heatmap', label: '12 weeks', unit: '12 weeks' },
];

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
    anchor: { attribute: false },
    toolbar: { attribute: false },
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
  declare anchor: DateKey | undefined;
  /** False hides the date and view controls (the Dashboard drives the month itself). */
  declare toolbar: boolean;
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
    this.toolbar = true;
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
    // On someone else's page there are no design tokens around us: bring our own.
    const has = getComputedStyle(this).getPropertyValue('--color-bg').trim() !== '';
    if (!has || this.hasAttribute('own-tokens')) this.setAttribute('own-tokens', '');
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
    const weeks = this.view === 'heatmap' ? HEAT_WEEKS : Math.max(1, Math.trunc(this.weeks) || 1);
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

  private async openDay(habit: Habit, date: DateKey, opener: HTMLElement) {
    // Loaded on first use: the read-only embed never opens it, so it stays out of embed.js.
    await import('./day-detail');
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
    const weeks = this.view === 'heatmap' ? HEAT_WEEKS : Math.max(1, Math.trunc(this.weeks) || 1);
    this.anchor =
      this.view === 'month' ? addMonths(anchor, direction) : addDays(anchor, direction * 7 * weeks);
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
    const unit = VIEWS.find((v) => v.view === this.view)?.unit ?? 'week';
    const label = this.rangeLabel(range);

    return html`
      ${this.heading ? html`<h1>${this.heading}</h1>` : nothing}
      <div class="bar" ?hidden=${!this.toolbar}>
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
          ${VIEWS.map(
            ({ view, label }) =>
              html`<button
                type="button"
                aria-pressed=${this.view === view ? 'true' : 'false'}
                @click=${() => this.setView(view)}
              >
                ${label}
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
    if (this.view === 'heatmap') return this.renderHeatmap(rows, dayLabel);
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

  /** One small grid per habit: weeks across, weekdays down, shaded by how the day went. */
  private renderHeatmap(rows: ScoreRow[], dayLabel: (d: DateKey) => string) {
    const weekdays = eachDay({ from: rows[0].cells[0].date, to: rows[0].cells[6].date }).map((d) =>
      formatDate(d, { weekday: 'narrow' }),
    );
    return html`<div class="heatmaps">
        ${rows.map((row) => {
          const { habit, cells, unit } = row;
          const max = Math.max(0, ...cells.map((c) => c.value));
          const s = heatSummary(cells);
          const metric = habit.rule.atLeast === undefined && habit.rule.atMost === undefined;
          const pct = s.days ? Math.round((s.done / s.days) * 100) : 0;
          const stats = metric
            ? `${formatValue(s.total, unit)} in total, ${formatValue(
                s.days ? Math.round(s.total / s.days) : 0,
                unit,
              )} a day`
            : `${s.done} of ${s.days} days · ${pct}%${s.bestRun > 1 ? ` · best run ${s.bestRun}` : ''}`;
          const spoken = metric
            ? `${habit.name}, last 12 weeks: ${formatValue(s.total, unit, 'long')} in total.`
            : `${habit.name}, last 12 weeks: done ${s.done} of ${s.days} days, ${pct}%. Best run ${s.bestRun} ${s.bestRun === 1 ? 'day' : 'days'}.`;
          return html`<section class="heat" style=${habitVars(habit.color)}>
            <h2>
              <span class="icon" aria-hidden="true">${habitIcon(habit.icon, 18)}</span>${habit.name}
            </h2>
            <div class="heat-grid" role="img" aria-label=${spoken}>
              ${weekdays.map(
                (w, i) =>
                  html`<span class="heat-day" aria-hidden="true">${i % 2 === 0 ? w : ''}</span>`,
              )}
              ${cells.map((c) => {
                const level = heatLevel(habit, c, max);
                return html`<span
                  class="heat-cell l-${level}"
                  title="${dayLabel(c.date)}: ${cellStatus(habit, c, unit)}"
                ></span>`;
              })}
            </div>
            <p class="heat-stats" aria-hidden="true">${stats}</p>
          </section>`;
        })}
      </div>
      ${this.renderAttribution(rows.map((r) => r.habit))}`;
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
    ownTokens,
    ...base,
    css`
      :host {
        container-type: inline-size;
        background: var(--color-surface);
        padding: var(--space-4);
        border-radius: var(--radius-lg);
      }
      h1 {
        font: var(--text-title);
        margin: 0 0 var(--space-3);
      }

      /* Toolbar (hidden when the Dashboard drives the month) */
      .bar[hidden] {
        display: none;
      }
      .bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
        margin-bottom: var(--space-3);
      }
      .nav,
      .toggle {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--space-1);
      }
      .range {
        margin: 0 var(--space-1);
        font: var(--text-label);
        min-width: 0;
        text-align: center;
      }
      .toggle {
        gap: 0;
      }
      .toggle button:first-child {
        border-radius: var(--radius-md) 0 0 var(--radius-md);
      }
      .toggle button:last-child {
        border-radius: 0 var(--radius-md) var(--radius-md) 0;
        border-left: 0;
      }
      .toggle button[aria-pressed='true'],
      .toggle button[aria-pressed='true']:hover {
        background: var(--color-primary);
        color: var(--color-on-primary);
        border-color: var(--color-primary);
      }
      .status {
        margin: var(--space-2) 0;
        color: var(--color-ink-3);
      }

      /* Grid */
      .scroll {
        overflow-x: auto;
        /* Contains the absolutely positioned .sr labels, which would otherwise widen the page. */
        position: relative;
      }
      /* Natural width: on a wide screen the Week and Streak columns don't stretch apart. On a
         phone it fills the width anyway. */
      table {
        border-collapse: collapse;
        width: auto;
        min-width: min(100%, 30rem);
      }
      th,
      td {
        padding: 0;
        text-align: center;
        vertical-align: middle;
        font-weight: normal;
      }
      thead th {
        color: var(--color-ink-3);
        font: var(--text-caption);
        padding-bottom: var(--space-1);
      }
      th.name {
        position: sticky;
        left: 0;
        z-index: 1;
        background: var(--color-surface);
        text-align: left;
        padding-right: var(--space-1);
        overflow-wrap: break-word;
        hyphens: auto;
        font: var(--text-label);
        color: var(--color-ink);
      }
      tbody th.name {
        padding-block: var(--space-2);
      }
      tbody tr + tr > * {
        border-top: 1px solid var(--color-border);
      }
      .icon {
        display: inline-flex;
        vertical-align: -3px;
        margin-right: var(--space-2);
        color: var(--habit);
      }
      .day .dow,
      .day .dom {
        display: block;
      }
      .day.today {
        color: var(--color-ink);
        font-weight: 800;
      }
      .today {
        background: var(--color-surface-2);
      }
      .cell {
        width: 2.25rem;
        min-width: 1.75rem;
        height: 2.5rem;
      }
      .summary {
        font: var(--text-label);
        padding-inline: var(--space-1);
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .summary .met {
        color: var(--color-success);
      }
      .summary .unit {
        color: var(--color-ink-3);
        font: var(--text-micro);
        margin-left: 1px;
      }

      /* 12-week heatmaps */
      .heatmaps {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
        gap: var(--space-4) var(--space-6);
      }
      .heat h2 {
        font: var(--text-label);
        margin: 0 0 var(--space-1);
      }
      /* Weekday labels, then 12 week columns, filling the card's width. */
      .heat-grid {
        display: grid;
        grid-template-columns: auto repeat(12, 1fr);
        grid-template-rows: repeat(7, auto);
        grid-auto-flow: column;
        gap: 3px;
        max-width: 24rem;
      }
      .heat-day {
        font: var(--text-micro);
        color: var(--color-ink-3);
        align-self: center;
        padding-right: 2px;
      }
      .heat-cell {
        aspect-ratio: 1;
        border-radius: 2px;
        background: var(--color-surface-2);
        box-shadow: inset 0 0 0 1px var(--color-border);
      }
      .heat-cell.l-1 {
        background: color-mix(in srgb, var(--habit) 25%, var(--color-surface));
        box-shadow: none;
      }
      .heat-cell.l-2 {
        background: color-mix(in srgb, var(--habit) 45%, var(--color-surface));
        box-shadow: none;
      }
      .heat-cell.l-3 {
        background: color-mix(in srgb, var(--habit) 75%, var(--color-surface));
        box-shadow: none;
      }
      .heat-cell.l-4 {
        background: var(--habit);
        box-shadow: none;
      }
      /* Over a limit: outlined, not red (no red failure states, DESIGN_SYSTEM.md §1). */
      .heat-cell.l-over {
        background: var(--color-surface-2);
        box-shadow: inset 0 0 0 2px var(--color-ink-3);
      }
      .heat-cell.l-inactive,
      .heat-cell.l-future {
        background: transparent;
        box-shadow: inset 0 0 0 1px var(--color-border);
        opacity: 0.4;
      }
      .heat-stats {
        margin: var(--space-1) 0 0;
        font: var(--text-caption);
        color: var(--color-ink-3);
      }

      dialog {
        width: min(28rem, calc(100vw - 2 * var(--gutter)));
        border: 1px solid var(--color-border);
        border-radius: var(--radius-xl);
        background: var(--color-surface);
        color: var(--color-ink);
        padding: var(--space-5);
      }
      dialog::backdrop {
        background: color-mix(in srgb, var(--color-ink) 40%, transparent);
      }
      .dialog-actions {
        display: flex;
        justify-content: flex-end;
        margin-top: var(--space-2);
      }
      .tick.open .value {
        display: block;
      }

      .attribution {
        margin: var(--space-2) 0 0;
        font: var(--text-caption);
        color: var(--color-ink-3);
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
        flex-direction: column;
        align-items: center;
        justify-content: center;
      }
      .tick:hover .mark.missed,
      .tick:hover .mark.pending {
        outline: 1px solid var(--color-ink-3);
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
        background: var(--habit);
      }
      .mark.missed {
        width: 0.3rem;
        height: 0.3rem;
        border-radius: 50%;
        background: var(--color-ink-3);
      }
      .mark.pending {
        width: 0.875rem;
        height: 0.875rem;
        border-radius: 50%;
        border: 2px solid var(--color-ink-3);
      }
      .mark.inactive {
        width: 0.5rem;
        height: 2px;
        background: var(--color-border);
      }
      .mark.over {
        color: var(--color-ink-2);
        font: var(--text-label);
        line-height: 1;
      }
      .mark.metric {
        width: 0.875rem;
        height: 0.875rem;
        border-radius: 3px;
        background: var(--habit);
      }
      .mark.level-0 {
        background: transparent;
        border: 1px solid var(--color-border);
      }
      /* Tints, not opacity, so a number inside stays readable. */
      .mark.level-1 {
        background: color-mix(in srgb, var(--habit) 25%, var(--color-surface));
      }
      .mark.level-2 {
        background: color-mix(in srgb, var(--habit) 45%, var(--color-surface));
      }
      /* The strongest tint is the solid fill: 25% and 45% tints take ink text at AA in both
         themes, and the solid fill takes its -on colour (contrast worked out for every habit). */
      .mark.level-3 {
        background: var(--habit);
      }

      /* Minutes inside the square (minute habits, week view). */
      .mark.minutes {
        width: auto;
        min-width: 1.375rem;
        height: 1.375rem;
        padding: 0 0.2rem;
        border-radius: 5px;
        font: var(--text-micro);
        font-variant-numeric: tabular-nums;
        color: var(--color-ink);
      }
      .mark.done.minutes,
      .mark.level-3.minutes,
      .mark.level-4.minutes {
        color: var(--on);
      }
      .value {
        display: block;
        font: var(--text-micro);
        color: var(--color-ink-3);
        font-variant-numeric: tabular-nums;
      }

      /* Narrow (a phone, or a small embed): tighter week columns so names keep whole words. */
      @container (max-width: 26rem) {
        .cell {
          width: 1.5rem;
          min-width: 1.5rem;
        }
        .summary {
          padding-inline: 2px;
          font: var(--text-caption);
          font-weight: 700;
        }
        thead th.summary {
          font: var(--text-micro);
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
