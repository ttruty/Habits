import { css } from 'lit';

/**
 * What every component shares: type, buttons, inputs, focus. Design tokens only
 * (design/tokens.css, design/DESIGN_SYSTEM.md §5): no hex, no ad-hoc sizes or radii.
 */
export const base = [
  css`
    :host {
      display: block;
      font: var(--text-copy);
      color: var(--color-ink);
      box-sizing: border-box;
      -webkit-font-smoothing: antialiased;
    }
    *,
    *::before,
    *::after {
      box-sizing: inherit;
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
    h1,
    h2,
    h3,
    p {
      margin: 0;
    }
    .display {
      font: var(--text-display);
      letter-spacing: var(--tracking-tight);
    }
    .title {
      font: var(--text-title);
    }
    .label {
      font: var(--text-label);
    }
    .caption {
      font: var(--text-caption);
      color: var(--color-ink-3);
    }
    .muted {
      color: var(--color-ink-2);
    }

    /* Buttons (§5 Buttons). Secondary is the default. */
    button,
    input,
    select {
      font: inherit;
      color: inherit;
    }
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      min-height: 48px;
      min-width: var(--touch-min);
      padding: 0 var(--space-4);
      border-radius: var(--radius-md);
      border: 1px solid var(--color-border-strong);
      background: var(--color-surface);
      color: var(--color-ink);
      font: var(--text-label);
      cursor: pointer;
      transition:
        transform var(--dur-fast) var(--ease-out),
        background-color var(--dur-fast) var(--ease-out);
    }
    button:hover:not(:disabled) {
      background: var(--color-surface-2);
    }
    button:active:not(:disabled) {
      transform: scale(0.97);
    }
    button.primary {
      background: var(--color-primary);
      color: var(--color-on-primary);
      border-color: transparent;
    }
    button.primary:hover:not(:disabled) {
      background: var(--color-primary);
    }
    button.block {
      width: 100%;
      min-height: 56px;
      border-radius: calc(var(--radius-md) + 2px);
    }
    button.icon {
      width: var(--touch-min);
      height: var(--touch-min);
      min-height: var(--touch-min);
      padding: 0;
      border-color: var(--color-border);
      border-radius: calc(var(--radius-sm) + 4px);
    }
    /* A text link that is still a 44 px target. */
    button.link {
      min-height: var(--touch-min);
      padding: 0 var(--space-2);
      border: 0;
      background: transparent;
      color: var(--color-ink-2);
    }
    button.link:hover:not(:disabled) {
      background: transparent;
      color: var(--color-ink);
    }
    button:disabled,
    button[aria-disabled='true'] {
      opacity: 0.4;
      pointer-events: none;
    }
    :focus-visible {
      outline: 2px solid var(--color-ink);
      outline-offset: 2px;
    }

    /* Inputs (§5 Inputs): 52 px, 16 px text so iOS doesn't zoom. */
    input,
    select {
      min-height: 52px;
      width: 100%;
      padding: 0 var(--space-4);
      border-radius: var(--radius-md);
      border: 1px solid var(--color-border-strong);
      background: var(--color-surface);
      font: var(--text-copy);
    }
    input[type='file'] {
      padding: var(--space-3) var(--space-4);
    }
    label,
    legend {
      font: var(--text-label);
      color: var(--color-ink);
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      margin: 0;
      padding: 0;
      border: 0;
      min-width: 0;
    }
    .error {
      color: var(--color-danger);
      font: var(--text-caption);
    }
    .card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: var(--space-4);
    }
  `,
];
