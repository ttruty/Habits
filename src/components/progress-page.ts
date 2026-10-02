import { LitElement, css, html, nothing } from 'lit';
import type { DataProvider } from '../data/provider';
import { kindOf } from '../data/today';
import { formatDate, formatValue } from '../format';
import type { DateKey, Habit } from '../model';
import { addDays, eachDay, startOfWeek } from '../scoring/dates';
import { heatLevel, heatSummary } from '../scoring/heatmap';
import { buildScorecard, type ScoreRow } from '../scoring/scorecard';
import { countsFor, dedupe } from '../scoring/score';
import { base } from '../styles/base';
import { frequencyLabel, habitVars, heatmap, statTile, ui, type HeatCell } from '../ui/components';
import { habitIcon } from '../ui/icons';
import { icon } from '../ui/ui-icons';
import { cellStatus } from './day-cell';
import { changed, navigate, type AppData } from './app-events';
import './day-detail';

/** Five weeks in the heatmap, ending with this week. */
const WEEKS = 5;

/** Progress: every habit at a glance, or one habit in detail (design/DESIGN_SYSTEM.md §6). */
export class ProgressPage extends LitElement {
  static override properties = {
    provider: { attribute: false },
    data: { attribute: false },
    habitId: { attribute: false },
    open: { state: true },
  };

  declare provider: DataProvider;
  declare data: AppData;
  /** Which habit; undefined shows the list. */
  declare habitId: string | undefined;
  declare private open: DateKey | undefined;
  private opener: HTMLElement | undefined;

  private rows(view: { from: DateKey; to: DateKey }): ScoreRow[] {
    return buildScorecard(this.data.habits, this.data.events, { view, today: this.data.today });
  }

  protected override render() {
    const habit = this.data.habits.find((h) => h.id === this.habitId && !h.archivedAt);
    return habit ? this.renderDetail(habit) : this.renderList();
  }

  private renderList() {
    const { today } = this.data;
    const from = addDays(today, -29);
    const rows = this.rows({ from, to: today });
    return html`<section class="page">
      <h1 class="display">Progress</h1>
      ${
        rows.length
          ? html`<ul class="stack list">
              ${rows.map((row) => {
                const s = heatSummary(row.cells);
                const metric = kindOf(row.habit) === 'metric';
                const line = metric
                  ? `${formatValue(s.total, row.unit)} in the last 30 days`
                  : `${s.done} of ${s.days} days in the last 30`;
                const f = s.days ? s.done / s.days : 0;
                return html`<li style=${habitVars(row.habit.color)}>
                  <button
                    type="button"
                    class="row-card"
                    @click=${() => navigate(this, { name: 'progress', habitId: row.habit.id })}
                  >
                    <span class="tile solid" aria-hidden="true">${habitIcon(row.habit.icon)}</span>
                    <span class="row-text">
                      <span class="habit-name">${row.habit.name}</span>
                      <span class="caption">${line}</span>
                      ${
                        metric
                          ? nothing
                          : html`<span class="track" aria-hidden="true"
                              ><span class="fill habit" style="width:${Math.round(f * 100)}%"></span
                            ></span>`
                      }
                    </span>
                    ${icon('chevron-right')}
                  </button>
                </li>`;
              })}
            </ul>`
          : html`<p class="caption">No habits yet.</p>`
      }
    </section>`;
  }

  private renderDetail(habit: Habit) {
    const { today } = this.data;
    const thisWeek = startOfWeek(today);
    const heatFrom = addDays(thisWeek, -7 * (WEEKS - 1));
    const heatTo = addDays(thisWeek, 6);
    const [row] = this.rows({ from: heatFrom, to: heatTo }).filter((r) => r.habit.id === habit.id);
    const [year] = this.rows({ from: addDays(today, -364), to: today }).filter(
      (r) => r.habit.id === habit.id,
    );
    const kind = kindOf(habit);
    const week = row.cells.filter((c) => c.date >= thisWeek);
    const last30 = year.cells.slice(-30);
    const s30 = heatSummary(last30);
    const sYear = heatSummary(year.cells);
    const streak = row.streak;
    const streakText = streak
      ? `${streak.count} ${streak.unit === 'days' ? (streak.count === 1 ? 'day' : 'days') : streak.count === 1 ? 'week' : 'weeks'}`
      : '—';
    const max = Math.max(0, ...row.cells.map((c) => c.value));
    const cells: HeatCell[] = row.cells.map((c) => {
      const level = heatLevel(habit, c, max);
      const kindClass =
        level === 4
          ? 'done'
          : level === 'future' || level === 'inactive' || level === 'over'
            ? level
            : level === 0
              ? 'missed'
              : `tint-${level}`;
      return {
        date: c.date,
        kind: kindClass,
        label: `${formatDate(c.date, { month: 'short', day: 'numeric' })}: ${cellStatus(habit, c, row.unit)}`,
      };
    });
    const weekdays = eachDay({ from: thisWeek, to: addDays(thisWeek, 6) }).map((d) =>
      formatDate(d, { weekday: 'narrow' }),
    );
    const canEdit = this.provider.canEdit;

    return html`<section class="page" style=${habitVars(habit.color)}>
      <header class="page-head">
        <button
          type="button"
          class="icon"
          aria-label="Back to all habits"
          @click=${() => navigate(this, { name: 'progress' })}
        >
          ${icon('chevron-left')}
        </button>
        <h1 class="title">Progress</h1>
        <button
          type="button"
          class="icon"
          aria-label="Edit ${habit.name}"
          ?disabled=${!canEdit}
          @click=${() => navigate(this, { name: 'form', habitId: habit.id })}
        >
          ${icon('edit')}
        </button>
      </header>

      <section class="hero" aria-label=${habit.name}>
        <div class="hero-head">
          <span class="tile" aria-hidden="true">${habitIcon(habit.icon)}</span>
          <span class="hero-text">
            <span class="title">${habit.name}</span>
            <span class="hero-meta">${frequencyLabel(habit.target.perWeek)}</span>
          </span>
          ${
            streak && streak.count > 0
              ? html`<span class="chip streak"
                  >${habitIcon('flame', 16)}${streak.count}-${streak.unit === 'days' ? 'day' : 'week'}
                  streak</span
                >`
              : nothing
          }
        </div>
        <ol class="week" aria-label="This week">
          ${week.map(
            (c) =>
              html`<li class="circle ${c.done ? 'on' : ''} ${c.state === 'future' ? 'later' : ''}">
                ${c.done ? icon('check', 16) : nothing}
                <span class="sr"
                  >${formatDate(c.date, { weekday: 'long' })}:
                  ${cellStatus(habit, c, row.unit)}</span
                >
              </li>`,
          )}
        </ol>
      </section>

      <div class="tiles">
        ${
          kind === 'metric'
            ? html`${statTile(
                formatValue(
                  week.reduce((n, c) => n + c.value, 0),
                  row.unit,
                ),
                'This week',
              )}
              ${statTile(formatValue(s30.days ? Math.round(s30.total / s30.days) : 0, row.unit), 'Daily average')}
              ${statTile(formatValue(Math.max(0, ...last30.map((c) => c.value)), row.unit), 'Best day')}`
            : html`${statTile(streakText, 'Current streak')}
              ${statTile(`${sYear.bestRun} ${sYear.bestRun === 1 ? 'day' : 'days'}`, 'Best run')}
              ${statTile(s30.days ? `${Math.round((s30.done / s30.days) * 100)}%` : '—', 'Last 30 days')}`
        }
      </div>

      <section aria-labelledby="weeks">
        <h2 id="weeks" class="label section">Last ${WEEKS} weeks</h2>
        ${heatmap(weekdays, cells, canEdit ? (date, el) => this.openDay(date, el) : undefined)}
      </section>
      ${this.renderDialog(habit)}
    </section>`;
  }

  private openDay(date: DateKey, opener: HTMLElement) {
    this.opener = opener;
    this.open = date;
    void this.updateComplete.then(() =>
      this.renderRoot.querySelector<HTMLDialogElement>('#day-dialog')?.showModal(),
    );
  }

  private renderDialog(habit: Habit) {
    const date = this.open;
    if (!date) return nothing;
    const label = formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' });
    const events = dedupe(this.data.events).filter(
      (e) => e.localDate === date && countsFor(habit, e),
    );
    return html`<dialog
      id="day-dialog"
      aria-label="${habit.name}, ${label}"
      @close=${() => {
        this.open = undefined;
        this.opener?.focus();
      }}
    >
      <day-detail
        .habit=${habit}
        .date=${date}
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

  static override styles = [
    ...base,
    ui,
    css`
      .list {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .row-card {
        width: 100%;
        justify-content: flex-start;
        gap: var(--space-3);
        min-height: var(--habit-card-min-h);
        padding: 14px;
        border-radius: var(--radius-lg);
        border: 1px solid var(--color-border);
        background: var(--color-surface);
        text-align: left;
        font: inherit;
      }
      .row-card > svg {
        color: var(--color-ink-3);
        flex: none;
      }
      .tile.solid {
        background: var(--habit);
        color: var(--on);
      }
      .row-text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
      }
      .fill.habit {
        background: var(--habit);
      }

      .hero {
        display: flex;
        flex-direction: column;
        gap: var(--space-5);
        padding: var(--space-5);
        border-radius: var(--radius-xl);
        background: var(--habit);
        color: var(--on);
      }
      .hero-head {
        display: flex;
        align-items: center;
        gap: var(--space-3);
      }
      .hero-text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      .hero-meta {
        font: var(--text-caption);
      }
      /* Inverted (habit colour on its -on colour): the spec's translucent tile behind -on text
         is 3.7:1 on blue, under AA. This pair passes for every habit colour. */
      .streak {
        background: var(--on);
        color: var(--habit);
      }
      .week {
        display: flex;
        justify-content: space-between;
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .circle {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: var(--radius-pill);
        border: 2px solid color-mix(in srgb, var(--on) 60%, transparent);
      }
      .circle.on {
        background: var(--on);
        border-color: var(--on);
        color: var(--habit);
      }
      .circle.later {
        border-style: dashed;
      }
      .tiles {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }
      .section {
        margin-bottom: 10px;
        color: var(--color-ink-2);
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
    `,
  ];
}

if (!customElements.get('progress-page')) customElements.define('progress-page', ProgressPage);

declare global {
  interface HTMLElementTagNameMap {
    'progress-page': ProgressPage;
  }
}
