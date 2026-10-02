import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import type { DataProvider } from '../data/provider';
import type { Habit } from '../model';
import { base } from '../styles/base';
import { frequencyLabel, habitVars, ui } from '../ui/components';
import { habitIcon } from '../ui/icons';
import { icon } from '../ui/ui-icons';
import { changed, navigate, toast, type AppData } from './app-events';

/** Order, edit, archive and restore habits. */
export class ManageHabits extends LitElement {
  static override properties = {
    provider: { attribute: false },
    data: { attribute: false },
    busy: { state: true },
  };

  declare provider: DataProvider;
  declare data: AppData;
  declare private busy: boolean;
  /** Focus to restore after the list re-renders. */
  private focusNext: string | undefined;

  constructor() {
    super();
    this.busy = false;
  }

  protected override updated(changed: PropertyValues) {
    // After a move, focus once the reordered data has arrived (rows are keyed, so it's the same row).
    if (!this.focusNext || !changed.has('data')) return;
    this.renderRoot.querySelector<HTMLElement>(this.focusNext)?.focus();
    this.focusNext = undefined;
  }

  private get live() {
    return this.data.habits.filter((h) => !h.archivedAt).toSorted((a, b) => a.sort - b.sort);
  }

  private async write(action: () => Promise<unknown>, done: string, undo?: () => Promise<void>) {
    this.busy = true;
    try {
      await action();
      changed(this);
      toast(this, { message: done, undo });
    } catch {
      toast(this, { message: "Couldn't save. Try again." });
    } finally {
      this.busy = false;
    }
  }

  private move(habit: Habit, by: -1 | 1) {
    const ids = this.live.map((h) => h.id);
    const i = ids.indexOf(habit.id);
    const to = i + by;
    [ids[i], ids[to]] = [ids[to], ids[i]];
    // Keep focus on the button just used, unless the row reached the end and it's now disabled.
    const atEnd = to === 0 || to === ids.length - 1;
    this.focusNext = `[data-move="${habit.id}:${by < 0 !== atEnd ? 'up' : 'down'}"]`;
    return this.write(() => this.provider.saveHabitOrder(ids), `Moved ${habit.name}.`);
  }

  private restore(habit: Habit) {
    const { archivedAt: _, ...rest } = habit;
    void _;
    return this.write(() => this.provider.saveHabit(rest), `Restored ${habit.name}.`);
  }

  protected override render() {
    const live = this.live;
    const archived = this.data.habits.filter((h) => h.archivedAt);
    return html`<section class="page">
      <header class="page-head">
        <button
          type="button"
          class="icon"
          aria-label="Back to Today"
          @click=${() => navigate(this, { name: 'today' })}
        >
          ${icon('chevron-left')}
        </button>
        <h1 class="title">Manage habits</h1>
        <button
          type="button"
          class="icon"
          aria-label="New habit"
          @click=${() => navigate(this, { name: 'form' })}
        >
          ${icon('plus')}
        </button>
      </header>
      ${
        live.length
          ? html`<ul class="stack list">
              ${repeat(
                live,
                (h) => h.id,
                (h, i) =>
                  html`<li class="row" style=${habitVars(h.color)}>
                    <span class="tile solid" aria-hidden="true">${habitIcon(h.icon)}</span>
                    <span class="text">
                      <span class="habit-name">${h.name}</span>
                      <span class="caption">${frequencyLabel(h.target.perWeek)}</span>
                    </span>
                    <span class="actions">
                      <button
                        type="button"
                        class="icon"
                        aria-label="Move ${h.name} up"
                        data-move="${h.id}:up"
                        ?disabled=${this.busy || i === 0}
                        @click=${() => this.move(h, -1)}
                      >
                        ${icon('arrow-up')}
                      </button>
                      <button
                        type="button"
                        class="icon"
                        aria-label="Move ${h.name} down"
                        data-move="${h.id}:down"
                        ?disabled=${this.busy || i === live.length - 1}
                        @click=${() => this.move(h, 1)}
                      >
                        ${icon('arrow-down')}
                      </button>
                      <button
                        type="button"
                        class="icon"
                        aria-label="Edit ${h.name}"
                        @click=${() => navigate(this, { name: 'form', habitId: h.id })}
                      >
                        ${icon('edit')}
                      </button>
                    </span>
                  </li>`,
              )}
            </ul>`
          : html`<p class="caption">No habits yet.</p>`
      }
      ${
        archived.length
          ? html`<section aria-labelledby="archived">
              <h2 id="archived" class="label section">Archived</h2>
              <ul class="stack list">
                ${archived.map(
                  (h) =>
                    html`<li class="row" style=${habitVars(h.color)}>
                      <span class="tile solid" aria-hidden="true">${habitIcon(h.icon)}</span>
                      <span class="text"><span class="habit-name">${h.name}</span></span>
                      <button
                        type="button"
                        ?disabled=${this.busy}
                        aria-label="Restore ${h.name}"
                        @click=${() => this.restore(h)}
                      >
                        ${icon('undo', 18)} Restore
                      </button>
                    </li>`,
                )}
              </ul>
            </section>`
          : nothing
      }
    </section>`;
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
      .row {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-3);
        border-radius: var(--radius-lg);
        border: 1px solid var(--color-border);
        background: var(--color-surface);
      }
      .tile.solid {
        background: var(--habit);
        color: var(--on);
      }
      .text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      .actions {
        display: flex;
        gap: var(--space-1);
      }
      .section {
        color: var(--color-ink-2);
        margin-bottom: 10px;
      }
    `,
  ];
}

if (!customElements.get('manage-habits')) customElements.define('manage-habits', ManageHabits);

declare global {
  interface HTMLElementTagNameMap {
    'manage-habits': ManageHabits;
  }
}
