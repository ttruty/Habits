import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { ensureManualSource } from '../connectors/manual';
import type { SourceAlert } from '../data/alerts';
import type { DataProvider, NewEvent } from '../data/provider';
import {
  allDoneDays,
  dayProgress,
  habitsOnDay,
  markDoneEvents,
  metaLine,
  type HabitDay,
} from '../data/today';
import { formatDate } from '../format';
import type { DateKey, Habit } from '../model';
import { addDays, addMonths, eachDay, monthRange, startOfWeek } from '../scoring/dates';
import { buildScorecard } from '../scoring/scorecard';
import { countsFor, dedupe } from '../scoring/score';
import { base } from '../styles/base';
import {
  habitCard,
  habitVars,
  progressRing,
  progressSummary,
  ui,
  weekStrip,
  type HabitCardModel,
} from '../ui/components';
import { icon } from '../ui/ui-icons';
import { changed, navigate, toast, type AppData } from './app-events';
import './day-detail';
import './habit-scorecard';

/** Today (phone), or the Dashboard at 1024 px and up (design/DESIGN_SYSTEM.md §6). */
export class TodayPage extends LitElement {
  static override properties = {
    provider: { attribute: false },
    data: { attribute: false },
    alerts: { attribute: false },
    demo: { attribute: false },
    wide: { attribute: false },
    now: { attribute: false },
    selected: { state: true },
    month: { state: true },
    open: { state: true },
    busy: { state: true },
  };

  declare provider: DataProvider;
  declare data: AppData;
  declare alerts: SourceAlert[];
  declare demo: boolean;
  declare wide: boolean;
  /** For tests. */
  declare now: () => Date;
  /** The day the cards show. */
  declare private selected: DateKey | undefined;
  /** Dashboard: a day in the month on screen. */
  declare private month: DateKey | undefined;
  /** The day open in the dialog (what was reported, corrections). */
  declare private open: { habit: Habit; date: DateKey } | undefined;
  declare private busy: boolean;
  private opener: HTMLElement | undefined;

  constructor() {
    super();
    this.alerts = [];
    this.demo = false;
    this.wide = false;
    this.now = () => new Date();
    this.busy = false;
  }

  protected override willUpdate(changed: PropertyValues) {
    if (changed.has('data') && this.selected && this.selected > this.data.today) {
      this.selected = undefined;
    }
  }

  private get day(): DateKey {
    return this.selected ?? this.data.today;
  }

  private greeting(): string {
    if (this.day !== this.data.today) return formatDate(this.day, { weekday: 'long' });
    const h = this.now().getHours();
    return h >= 5 && h < 12
      ? 'Good morning'
      : h >= 12 && h < 17
        ? 'Good afternoon'
        : 'Good evening';
  }

  private card(d: HabitDay): HabitCardModel {
    const name = d.habit.name;
    const label =
      d.check === 'details'
        ? `${name} is done: reported by a source. Show what was reported`
        : d.cell.done
          ? `Mark not done: ${name}`
          : `Mark done: ${name}`;
    return {
      id: d.habit.id,
      name,
      icon: d.habit.icon,
      color: d.habit.color,
      meta: metaLine(d),
      state: d.cell.done ? 'done' : 'pending',
      check: d.check,
      checkLabel: label,
    };
  }

  private async check(d: HabitDay, button: HTMLElement) {
    if (d.check === 'details') return this.openDay(d.habit, this.day, button);
    if (this.busy) return;
    this.busy = true;
    const name = d.habit.name;
    try {
      if (d.cell.done) {
        // What undo puts back: the same events, minus their ids.
        const removed: NewEvent[] = d.own.map((e) => {
          const { id, ...rest } = e;
          void id;
          return rest;
        });
        await Promise.all(d.own.map((e) => this.provider.deleteEvent(e.id)));
        toast(this, {
          message: `${name}: not done`,
          undo: () => this.provider.putEvents(removed),
        });
      } else {
        const manual = await ensureManualSource(this.provider, this.data.sources);
        const added = markDoneEvents(d, manual, this.day, this.data.today, this.now());
        await this.provider.putEvents(added);
        const keys = new Set(added.map((e) => `${e.sourceId}|${e.externalId}`));
        toast(this, {
          message: `${name}: done`,
          undo: async () => {
            const ids = this.data.events
              .filter((e) => keys.has(`${e.sourceId}|${e.externalId}`))
              .map((e) => e.id);
            await Promise.all(ids.map((id) => this.provider.deleteEvent(id)));
          },
        });
      }
      changed(this);
    } catch {
      toast(this, { message: "Couldn't save. Try again." });
    } finally {
      this.busy = false;
    }
  }

  private openDay(habit: Habit, date: DateKey, opener: HTMLElement) {
    this.opener = opener;
    this.open = { habit, date };
    void this.updateComplete.then(() =>
      this.renderRoot.querySelector<HTMLDialogElement>('#day-dialog')?.showModal(),
    );
  }

  private closeDay() {
    this.open = undefined;
    this.opener?.focus();
  }

  protected override render() {
    return this.wide ? this.renderDashboard() : this.renderToday();
  }

  private renderToday() {
    const { habits, sources, events, today } = this.data;
    const day = this.day;
    const days = habitsOnDay(habits, sources, events, day, today);
    const { done, total } = dayProgress(days);
    const weekDays = eachDay({ from: startOfWeek(day), to: addDays(startOfWeek(day), 6) });
    const allDone = allDoneDays(habits, sources, events, weekDays, today);
    const pending = days.filter((d) => !d.cell.done);
    const finished = days.filter((d) => d.cell.done);
    const longDay = (d: DateKey) =>
      formatDate(d, { weekday: 'long', month: 'long', day: 'numeric' });

    return html`<section class="page">
      <header class="page-head">
        <div>
          <p class="caption">${longDay(day)}</p>
          <h1 class="display">${this.greeting()}</h1>
        </div>
        <button
          type="button"
          class="icon"
          aria-label="Scorecard: every habit by day"
          @click=${() => navigate(this, { name: 'grid' })}
        >
          ${icon('calendar')}
        </button>
      </header>

      ${this.demo ? html`<p class="caption">Demo data. Changes stay in this browser.</p>` : nothing}
      ${this.alerts.length ? this.renderAlerts() : nothing}
      ${weekStrip(
        weekDays.map((d) => ({
          date: d,
          dow: formatDate(d, { weekday: 'narrow' }),
          dom: Number(d.slice(8)),
          label: `${longDay(d)}${allDone.has(d) ? ', all done' : ''}`,
          selected: d === day,
          allDone: allDone.has(d),
          disabled: d > today,
        })),
        (d) => (this.selected = d === today ? undefined : d),
      )}
      ${
        habits.some((h) => !h.archivedAt)
          ? html`${
                total
                  ? progressSummary(
                      day === today
                        ? "Today's progress"
                        : `${formatDate(day, { weekday: 'long' })}'s progress`,
                      done,
                      total,
                    )
                  : nothing
              }
              <section aria-labelledby="up-next">
                <div class="section-head">
                  <h2 id="up-next" class="label">Up next</h2>
                  <button
                    type="button"
                    class="link"
                    @click=${() => navigate(this, { name: 'manage' })}
                  >
                    Manage
                  </button>
                </div>
                ${
                  pending.length
                    ? html`<div class="stack">${pending.map((d) => this.renderCard(d))}</div>`
                    : html`<p class="caption">All done.</p>`
                }
              </section>
              <section aria-labelledby="done">
                <div class="section-head"><h2 id="done" class="label">Done</h2></div>
                ${
                  finished.length
                    ? html`<div class="stack">${finished.map((d) => this.renderCard(d))}</div>`
                    : html`<p class="caption">Tap a circle to check off a habit.</p>`
                }
              </section>`
          : html`<div class="card empty">
              <p>No habits yet.</p>
              <button
                type="button"
                class="primary"
                @click=${() => navigate(this, { name: 'form' })}
              >
                ${icon('plus')} New habit
              </button>
            </div>`
      }
      ${this.renderDialog()}
    </section>`;
  }

  private renderCard(d: HabitDay) {
    return html`<div class="enter">
      ${habitCard(this.card(d), {
        open: () => navigate(this, { name: 'progress', habitId: d.habit.id }),
        check: (button) => void this.check(d, button),
      })}
    </div>`;
  }

  private renderAlerts() {
    return html`<div class="card alerts" role="status">
      <ul>
        ${this.alerts.map((a) => html`<li>${icon('alert', 18)} ${a.message}</li>`)}
      </ul>
      <button type="button" @click=${() => navigate(this, { name: 'sources' })}>
        Open Sources
      </button>
    </div>`;
  }

  private renderDialog() {
    const open = this.open;
    if (!open) return nothing;
    const label = formatDate(open.date, { weekday: 'long', day: 'numeric', month: 'long' });
    const events = dedupe(this.data.events).filter(
      (e) => e.localDate === open.date && countsFor(open.habit, e),
    );
    return html`<dialog
      id="day-dialog"
      aria-label="${open.habit.name}, ${label}"
      @close=${this.closeDay}
    >
      <day-detail
        .habit=${open.habit}
        .date=${open.date}
        .dayLabel=${label}
        .events=${events}
        .sources=${this.data.sources}
        .provider=${this.provider}
        .today=${this.data.today}
        @change=${() => changed(this)}
      ></day-detail>
      <form method="dialog" class="dialog-actions"><button type="submit">Close</button></form>
    </dialog>`;
  }

  // ── Dashboard (≥ 1024 px) ──────────────────────────────────────────────────

  private renderDashboard() {
    const { habits, events, today } = this.data;
    const anchor = this.month ?? today;
    const month = monthRange(anchor);
    const to = month.to < today ? month.to : today;
    const rows = buildScorecard(habits, events, {
      view: { from: month.from, to: month.to },
      today,
    });
    const goals = rows.filter((r) => r.habit.rule.atLeast !== undefined);
    const counted = (r: (typeof rows)[number]) =>
      r.cells.filter((c) => c.date <= to && c.state !== 'inactive' && c.state !== 'future');
    const doneDays = goals.reduce((n, r) => n + counted(r).filter((c) => c.done).length, 0);
    const possible = goals.reduce((n, r) => n + counted(r).length, 0);
    const missed = goals.reduce(
      (n, r) => n + counted(r).filter((c) => !c.done && c.state !== 'pending').length,
      0,
    );
    const todayDays = habitsOnDay(habits, this.data.sources, events, today, today);
    const t = dayProgress(todayDays);
    const weekFrom = startOfWeek(today);
    const week = buildScorecard(habits, events, {
      view: { from: weekFrom, to: addDays(weekFrom, 6) },
      today,
    }).filter((r) => r.habit.rule.atLeast !== undefined);
    const weekMet = week.reduce((n, r) => n + Math.min(r.week.done, r.week.target), 0);
    const weekTarget = week.reduce((n, r) => n + r.week.target, 0);
    const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
    const title = formatDate(month.from, { month: 'long', year: 'numeric' });
    const thisMonth = month.from <= today && today <= month.to;

    return html`<section class="page dashboard">
      <header class="page-head">
        <h1 class="display" id="month" aria-live="polite">${title}</h1>
        <div class="row">
          <button
            type="button"
            class="icon"
            aria-label="Previous month"
            @click=${() => (this.month = addMonths(anchor, -1))}
          >
            ${icon('chevron-left')}
          </button>
          <button
            type="button"
            class="icon"
            aria-label="Next month"
            ?disabled=${thisMonth}
            @click=${() => (this.month = addMonths(anchor, 1))}
          >
            ${icon('chevron-right')}
          </button>
        </div>
      </header>
      ${this.demo ? html`<p class="caption">Demo data. Changes stay in this browser.</p>` : nothing}
      ${this.alerts.length ? this.renderAlerts() : nothing}
      <div class="rings">
        <div class="card">
          ${progressRing(t.total ? t.done / t.total : 0, 'var(--color-success)', `${t.done}/${t.total}`, 'Today')}
        </div>
        <div class="card">
          ${progressRing(weekTarget ? weekMet / weekTarget : 0, 'var(--habit-blue)', pct(weekMet, weekTarget), 'This week')}
        </div>
        <div class="card">
          ${progressRing(possible ? doneDays / possible : 0, 'var(--habit-violet)', pct(doneDays, possible), 'This month')}
        </div>
        <div class="card counts">
          <div><span class="stat">${doneDays}</span><span class="caption">Completed</span></div>
          <div><span class="stat">${missed}</span><span class="caption">Missed</span></div>
        </div>
      </div>
      <div class="columns">
        <section class="card grid-card" aria-label="Every habit by day">
          <habit-scorecard
            view="month"
            .provider=${this.provider}
            .anchor=${anchor}
            .toolbar=${false}
            .today=${today}
          ></habit-scorecard>
        </section>
        <section class="card" aria-labelledby="by-habit">
          <h2 id="by-habit" class="label">This month by habit</h2>
          <ul class="bars">
            ${goals.map((r) => {
              const c = counted(r);
              const d = c.filter((x) => x.done).length;
              const f = c.length ? d / c.length : 0;
              return html`<li style=${habitVars(r.habit.color)}>
                <span class="bar-name">${r.habit.name}</span>
                <span class="caption">${d} of ${c.length} days</span>
                <span class="track" aria-hidden="true"
                  ><span class="fill habit" style="width:${Math.round(f * 100)}%"></span
                ></span>
              </li>`;
            })}
          </ul>
        </section>
      </div>
      ${this.renderDialog()}
    </section>`;
  }

  static override styles = [
    ...base,
    ui,
    css`
      .alerts {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        border-color: var(--color-danger);
      }
      .alerts ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
      }
      .alerts li {
        display: flex;
        align-items: center;
        gap: var(--space-2);
      }
      .alerts li svg {
        color: var(--color-danger);
        flex: none;
      }
      .empty {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--space-3);
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
        margin-top: var(--space-3);
      }
      .row {
        display: flex;
        gap: var(--space-2);
      }
      .rings {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: var(--space-4);
      }
      .counts {
        display: flex;
        justify-content: space-around;
        align-items: center;
      }
      .counts div {
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .columns {
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(16rem, 1fr);
        gap: var(--space-4);
        align-items: start;
      }
      .grid-card {
        overflow: auto;
      }
      .grid-card habit-scorecard {
        padding: 0;
        background: transparent;
      }
      .bars {
        list-style: none;
        margin: var(--space-3) 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }
      .bars li {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: var(--space-1) var(--space-2);
      }
      .bar-name {
        font: var(--text-label);
      }
      .bars .track {
        grid-column: 1 / -1;
      }
      .fill.habit {
        background: var(--habit);
      }
    `,
  ];
}

if (!customElements.get('today-page')) customElements.define('today-page', TodayPage);

declare global {
  interface HTMLElementTagNameMap {
    'today-page': TodayPage;
  }
}
