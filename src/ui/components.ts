import { css, html, nothing, svg, type TemplateResult } from 'lit';
import { HABIT_COLORS, type HabitColor } from '../model';
import { HABIT_ICON_KEYS, HABIT_ICON_LABELS, habitIcon } from './icons';
import { icon, type UiIcon } from './ui-icons';

// The component inventory (design/DESIGN_SYSTEM.md §5) as Lit templates. Pages include `ui` in
// their styles and call these; nothing here keeps state.

import { habitVars } from './vars';

export { habitVars };

// ── HabitCard ────────────────────────────────────────────────────────────────

export interface HabitCardModel {
  id: string;
  name: string;
  icon: string;
  color: HabitColor;
  /** "Every day · 12-day streak". */
  meta: string;
  state: 'pending' | 'done';
  /** toggle: the check marks done / not done; details: it opens what was reported; none: no check. */
  check: 'toggle' | 'details' | 'none';
  checkLabel: string;
}

export function habitCard(
  m: HabitCardModel,
  on: { open: () => void; check: (button: HTMLElement) => void },
): TemplateResult {
  const done = m.state === 'done';
  return html`<article class="habit-card ${m.state}" style=${habitVars(m.color)}>
    ${done ? html`<span class="pill" aria-hidden="true"></span>` : nothing}
    <button
      type="button"
      class="habit-main"
      @click=${on.open}
      aria-label="${m.name}: ${m.meta}. Open progress"
    >
      ${done ? nothing : html`<span class="tile" aria-hidden="true">${habitIcon(m.icon)}</span>`}
      <span class="habit-text" aria-hidden="true">
        <span class="habit-name">${m.name}</span>
        <span class="habit-meta">${m.meta}</span>
      </span>
    </button>
    ${
      m.check === 'none'
        ? nothing
        : html`<button
            type="button"
            class="check"
            aria-label=${m.checkLabel}
            aria-pressed=${m.check === 'toggle' ? (done ? 'true' : 'false') : nothing}
            @click=${(e: Event) => on.check(e.currentTarget as HTMLElement)}
          >
            ${done ? icon('check', 18) : nothing}
          </button>`
    }
  </article>`;
}

// ── WeekStrip ────────────────────────────────────────────────────────────────

export interface StripDay {
  date: string;
  dow: string;
  dom: number;
  label: string;
  selected: boolean;
  allDone: boolean;
  disabled: boolean;
}

export function weekStrip(days: StripDay[], select: (date: string) => void) {
  return html`<div class="week-strip" role="group" aria-label="Day">
    ${days.map(
      (d) =>
        html`<button
          type="button"
          class="day"
          aria-pressed=${d.selected ? 'true' : 'false'}
          aria-label=${d.label}
          ?disabled=${d.disabled}
          @click=${() => select(d.date)}
        >
          <span class="dow" aria-hidden="true">${d.dow}</span>
          <span class="dom" aria-hidden="true">${d.dom}</span>
          <span class="dot ${d.allDone ? 'on' : ''}" aria-hidden="true"></span>
        </button>`,
    )}
  </div>`;
}

// ── ProgressSummary, StatTile, ProgressRing ─────────────────────────────────

export function progressSummary(label: string, done: number, total: number) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return html`<section class="card summary" aria-label="${label}: ${done} of ${total}">
    <div class="summary-row" aria-hidden="true">
      <span class="label">${label}</span>
      <span class="muted">${done} of ${total}</span>
    </div>
    <div class="track" aria-hidden="true"><span class="fill" style="width: ${pct}%"></span></div>
  </section>`;
}

export const statTile = (value: string, label: string) =>
  html`<div class="stat-tile">
    <span class="stat">${value}</span>
    <span class="caption">${label}</span>
  </div>`;

/** 72 px ring; `color` is a CSS colour (a token var). Value and label sit beside it. */
export function progressRing(fraction: number, color: string, value: string, label: string) {
  const r = 32;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction));
  return html`<div class="ring" role="img" aria-label="${label}: ${value}">
    ${svg`<svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true">
      <circle cx="36" cy="36" r=${r} fill="none" stroke="var(--color-border)" stroke-width="8" />
      <circle cx="36" cy="36" r=${r} fill="none" stroke=${color} stroke-width="8"
        stroke-linecap="round" stroke-dasharray="${c * f} ${c}" transform="rotate(-90 36 36)" />
    </svg>`}
    <span class="ring-text" aria-hidden="true">
      <span class="stat">${value}</span>
      <span class="caption">${label}</span>
    </span>
  </div>`;
}

// ── Heatmap ──────────────────────────────────────────────────────────────────

export interface HeatCell {
  date: string;
  /** done | missed | future | inactive | tint-1..3 (a metric or a partial day) | over (a limit). */
  kind: string;
  label: string;
}

/** Calendar grid, 7 columns. Cells open a day when `open` is given (past and today only). */
export function heatmap(
  weekdays: string[],
  cells: HeatCell[],
  open?: (date: string, el: HTMLElement) => void,
) {
  return html`<div class="heatmap">
      ${weekdays.map((w) => html`<span class="hm-dow" aria-hidden="true">${w}</span>`)}
      ${cells.map((c) => {
        const clickable = open && c.kind !== 'future';
        return clickable
          ? html`<button
              type="button"
              class="hm-cell ${c.kind}"
              aria-label=${c.label}
              title=${c.label}
              @click=${(e: Event) => open(c.date, e.currentTarget as HTMLElement)}
            >
              ${c.kind === 'done' ? icon('check', 14) : nothing}
            </button>`
          : html`<span class="hm-cell ${c.kind}" role="img" aria-label=${c.label} title=${c.label}>
              ${c.kind === 'done' ? icon('check', 14) : nothing}
            </span>`;
      })}
    </div>
    <ul class="legend" aria-label="Legend">
      <li><span class="hm-cell done" aria-hidden="true"></span>Done</li>
      <li><span class="hm-cell missed" aria-hidden="true"></span>Missed</li>
      <li><span class="hm-cell future" aria-hidden="true"></span>Upcoming</li>
    </ul>`;
}

// ── TabBar ───────────────────────────────────────────────────────────────────

export interface Tab {
  id: string;
  label: string;
  icon: UiIcon;
  fab?: boolean;
}

export function tabBar(tabs: Tab[], active: string, go: (id: string) => void) {
  return html`<nav class="tab-bar" aria-label="Main">
    ${tabs.map((t) =>
      t.fab
        ? html`<button type="button" class="fab" aria-label=${t.label} @click=${() => go(t.id)}>
            ${icon(t.icon, 24)}
          </button>`
        : html`<button
            type="button"
            class="tab"
            aria-label=${t.label}
            aria-current=${active === t.id ? 'page' : nothing}
            @click=${() => go(t.id)}
          >
            ${icon(t.icon, 22)}
          </button>`,
    )}
  </nav>`;
}

// ── Pickers ──────────────────────────────────────────────────────────────────

export function colorPicker(value: HabitColor, pick: (c: HabitColor) => void) {
  return html`<div class="swatches" role="group" aria-label="Colour">
    ${HABIT_COLORS.map(
      (c) =>
        html`<button
          type="button"
          class="swatch"
          style=${habitVars(c)}
          aria-label=${c}
          aria-pressed=${value === c ? 'true' : 'false'}
          @click=${() => pick(c)}
        >
          ${value === c ? icon('check', 18) : nothing}
        </button>`,
    )}
  </div>`;
}

export function iconPicker(value: string, color: HabitColor, pick: (k: string) => void) {
  return html`<div class="icons" role="group" aria-label="Icon">
    ${HABIT_ICON_KEYS.map(
      (k) =>
        html`<button
          type="button"
          class="icon-choice"
          style=${habitVars(color)}
          aria-label=${HABIT_ICON_LABELS[k]}
          aria-pressed=${value === k ? 'true' : 'false'}
          @click=${() => pick(k)}
        >
          ${habitIcon(k, 20)}
        </button>`,
    )}
  </div>`;
}

/** "How often": 1–7 days a week, styled like the DayPicker (§5). */
export function frequencyPicker(value: number, pick: (n: number) => void) {
  return html`<div class="days" role="group" aria-label="Days a week">
    ${[1, 2, 3, 4, 5, 6, 7].map(
      (n) =>
        html`<button
          type="button"
          class="day-choice"
          aria-label="${n} ${n === 1 ? 'day' : 'days'} a week"
          aria-pressed=${value === n ? 'true' : 'false'}
          @click=${() => pick(n)}
        >
          ${n}
        </button>`,
    )}
  </div>`;
}

/** Several-of choices as pill toggles, e.g. which activities count. */
export function choiceChips<T>(
  label: string,
  options: readonly T[],
  name: (o: T) => string,
  on: (o: T) => boolean,
  toggle: (o: T) => void,
) {
  return html`<div class="choices" role="group" aria-label=${label}>
    ${options.map(
      (o) =>
        html`<button
          type="button"
          class="choice"
          aria-pressed=${on(o) ? 'true' : 'false'}
          @click=${() => toggle(o)}
        >
          ${on(o) ? icon('check', 16) : nothing} ${name(o)}
        </button>`,
    )}
  </div>`;
}

export const frequencyLabel = (n: number) =>
  n >= 7 ? 'Every day' : n === 1 ? '1 day a week' : `${n} days a week`;

// ── Styles for all of the above ─────────────────────────────────────────────

export const ui = css`
  /* HabitCard */
  .habit-card {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--habit-card-min-h);
    padding: 14px;
    border-radius: var(--radius-lg);
    background: var(--habit);
    color: var(--on);
  }
  .habit-card.done {
    background: var(--color-surface);
    color: var(--color-ink);
    border: 1px solid var(--color-border);
    padding-left: calc(14px + 12px + var(--space-3));
  }
  .habit-card .pill {
    position: absolute;
    left: 14px;
    top: 50%;
    width: 12px;
    height: 44px;
    margin-top: -22px;
    border-radius: var(--radius-pill);
    background: var(--habit);
  }
  .habit-main {
    flex: 1;
    min-width: 0;
    justify-content: flex-start;
    gap: var(--space-3);
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    font: inherit;
  }
  .habit-main:hover:not(:disabled) {
    background: transparent;
  }
  .tile {
    flex: none;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: calc(var(--radius-md) - 2px);
    background: var(--habit-icon-tile);
  }
  .habit-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .habit-name {
    font: var(--text-body);
    overflow-wrap: anywhere;
  }
  .done .habit-name {
    color: var(--color-ink-2);
    text-decoration: line-through;
  }
  /* Full opacity: the spec's 90% fails AA on the green and orange fills (§8 wins). */
  .habit-meta {
    font: var(--text-caption);
  }
  .done .habit-meta {
    color: var(--color-ink-3);
    opacity: 1;
  }
  .check {
    flex: none;
    width: var(--touch-min);
    height: var(--touch-min);
    min-height: var(--touch-min);
    padding: 0;
    border-radius: var(--radius-pill);
    border: 2px solid var(--on);
    background: transparent;
    color: var(--on);
    transition: background-color var(--dur-base) var(--ease-out);
  }
  .check:hover:not(:disabled) {
    background: var(--habit-icon-tile);
  }
  .done .check {
    border-color: var(--color-ink);
    background: var(--color-ink);
    color: var(--color-bg);
  }
  .done .check:hover:not(:disabled) {
    background: var(--color-ink);
  }
  .habit-card:focus-within .check:focus-visible,
  .habit-main:focus-visible {
    outline-color: currentColor;
  }

  /* WeekStrip */
  .week-strip {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 6px;
  }
  .week-strip .day {
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    height: 68px;
    padding: 0;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
  }
  .week-strip .day[aria-pressed='true'] {
    background: var(--color-accent);
    color: var(--color-on-accent);
    border-color: transparent;
  }
  .dow {
    font: var(--text-micro);
    text-transform: uppercase;
  }
  .dom {
    font: var(--text-date);
  }
  .dot {
    width: 5px;
    height: 5px;
    border-radius: var(--radius-pill);
  }
  .dot.on {
    background: var(--color-success);
  }
  [aria-pressed='true'] .dot.on {
    background: var(--color-on-accent);
  }

  /* ProgressSummary */
  .summary-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: var(--space-3);
  }
  .track {
    height: 8px;
    border-radius: var(--radius-pill);
    background: var(--color-surface-2);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: var(--radius-pill);
    background: var(--color-success);
    transition: width var(--dur-base) var(--ease-out);
  }

  /* StatTile */
  .stat-tile {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: 14px;
    border-radius: var(--radius-md);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    min-width: 0;
  }
  .stat {
    font: var(--text-stat);
    letter-spacing: var(--tracking-tight);
  }
  .stat-tile .stat {
    font: var(--text-stat-sm);
  }

  /* ProgressRing */
  .ring {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .ring-text {
    display: flex;
    flex-direction: column;
  }

  /* Heatmap */
  .heatmap {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 6px;
  }
  .hm-dow {
    font: var(--text-micro);
    color: var(--color-ink-3);
    text-align: center;
    text-transform: uppercase;
  }
  .hm-cell {
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    min-width: 0;
    min-height: 0;
    padding: 0;
    border-radius: 8px;
    border: 0;
    background: var(--color-surface-2);
    color: var(--on);
  }
  button.hm-cell {
    min-height: 0;
  }
  button.hm-cell:hover:not(:disabled) {
    background: var(--color-border-strong);
  }
  .hm-cell.done,
  button.hm-cell.done:hover:not(:disabled) {
    background: var(--habit);
  }
  .hm-cell.tint-1 {
    background: color-mix(in srgb, var(--habit) 30%, var(--color-surface-2));
  }
  .hm-cell.tint-2 {
    background: color-mix(in srgb, var(--habit) 55%, var(--color-surface-2));
  }
  .hm-cell.tint-3 {
    background: color-mix(in srgb, var(--habit) 80%, var(--color-surface-2));
  }
  .hm-cell.over {
    background: var(--color-surface-2);
    box-shadow: inset 0 0 0 2px var(--color-ink-3);
  }
  .hm-cell.future {
    background: transparent;
    border: 1px dashed var(--color-ink-3);
  }
  .hm-cell.inactive {
    background: transparent;
    border: 1px solid var(--color-border);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    list-style: none;
    margin: var(--space-3) 0 0;
    padding: 0;
    font: var(--text-caption);
    color: var(--color-ink-2);
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .legend .hm-cell {
    width: 14px;
    border-radius: 4px;
  }

  /* TabBar */
  .tab-bar {
    position: fixed;
    left: 50%;
    bottom: max(var(--space-4), env(safe-area-inset-bottom));
    transform: translateX(-50%);
    width: min(480px, calc(100% - 2 * var(--space-4)));
    height: var(--tabbar-h);
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    align-items: center;
    justify-items: center;
    border-radius: var(--radius-xl);
    background: var(--color-nav);
    z-index: 10;
  }
  .tab {
    width: 48px;
    height: 48px;
    min-height: 48px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-nav-ink);
  }
  .tab:hover:not(:disabled) {
    background: transparent;
    color: var(--color-nav-active);
  }
  .tab[aria-current='page'],
  .tab[aria-current='page']:hover {
    background: var(--color-nav-active);
    color: var(--color-nav-active-ink);
  }
  .tab:focus-visible,
  .fab:focus-visible {
    outline-color: var(--color-nav-active);
  }
  .fab {
    width: var(--fab-size);
    height: var(--fab-size);
    padding: 0;
    margin-top: -28px;
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--color-accent);
    color: var(--color-on-accent);
    box-shadow: 0 0 0 6px var(--color-bg);
  }
  .fab:hover:not(:disabled) {
    background: var(--color-accent);
  }

  /* Pickers */
  .swatches {
    display: grid;
    grid-template-columns: repeat(6, var(--touch-min));
    justify-content: space-between;
    gap: var(--space-2);
  }
  .swatch {
    width: var(--touch-min);
    height: var(--touch-min);
    min-height: var(--touch-min);
    padding: 0;
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--habit);
    color: var(--on);
  }
  .swatch:hover:not(:disabled) {
    background: var(--habit);
  }
  .swatch[aria-pressed='true'] {
    box-shadow:
      0 0 0 3px var(--color-bg),
      0 0 0 5px var(--habit);
  }
  .icons {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--touch-min), 1fr));
    gap: var(--space-2);
  }
  .icon-choice {
    min-width: 0;
    padding: 0;
    height: var(--touch-min);
    min-height: var(--touch-min);
    border-color: var(--color-border);
    border-radius: calc(var(--radius-sm) + 2px);
  }
  .icon-choice[aria-pressed='true'],
  .icon-choice[aria-pressed='true']:hover {
    background: var(--habit);
    color: var(--on);
    border-color: transparent;
  }
  .days {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: var(--space-2);
  }
  .day-choice {
    min-width: 0;
    padding: 0;
    height: var(--touch-min);
    min-height: var(--touch-min);
    border-radius: calc(var(--radius-sm) + 2px);
  }
  .day-choice[aria-pressed='true'],
  .day-choice[aria-pressed='true']:hover {
    background: var(--color-primary);
    color: var(--color-on-primary);
    border-color: transparent;
  }

  .choices {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .choice {
    min-height: var(--touch-min);
    padding: 0 var(--space-4);
    border-radius: var(--radius-pill);
  }
  .choice[aria-pressed='true'],
  .choice[aria-pressed='true']:hover {
    background: var(--color-primary);
    color: var(--color-on-primary);
    border-color: transparent;
  }

  /* Page furniture */
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: max(var(--space-6), env(safe-area-inset-top)) var(--gutter)
      calc(var(--tabbar-h) + 52px + env(safe-area-inset-bottom));
    max-width: 1232px;
    margin: 0 auto;
  }
  .page-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-pill);
    font: var(--text-label);
  }
  .toast {
    position: fixed;
    left: 50%;
    bottom: calc(var(--tabbar-h) + var(--space-8) + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    max-width: calc(100% - 2 * var(--gutter));
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--color-primary);
    color: var(--color-on-primary);
    z-index: 11;
  }
  .toast button {
    min-height: var(--touch-min);
    border: 0;
    background: transparent;
    color: inherit;
  }
  .toast button:hover:not(:disabled) {
    background: transparent;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  .enter {
    animation: rise var(--dur-slow) var(--ease-out);
  }
`;
