import { css, unsafeCSS } from 'lit';
import tokens from './tokens.css?inline';

/** Tokens plus the basics every component shares: host box, .sr, buttons and form fields. */
export const base = [
  unsafeCSS(tokens),
  css`
    :host {
      display: block;
      font-family: var(--hs-font);
      font-size: var(--hs-font-size);
      line-height: 1.4;
      color: var(--hs-text);
      box-sizing: border-box;
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
    button,
    input,
    select {
      font: inherit;
      color: var(--hs-text);
    }
    button {
      background: var(--hs-surface);
      border: 1px solid var(--hs-border);
      border-radius: var(--hs-radius);
      min-height: 2.5rem;
      min-width: 2.5rem;
      padding: 0 0.75rem;
      cursor: pointer;
    }
    button.primary {
      background: var(--hs-text);
      color: var(--hs-bg);
      border-color: var(--hs-text);
    }
    button:disabled {
      color: var(--hs-text-muted);
      opacity: 0.6;
      cursor: default;
    }
    input,
    select {
      background: var(--hs-bg);
      border: 1px solid var(--hs-border);
      border-radius: var(--hs-radius);
      min-height: 2.5rem;
      padding: 0 0.625rem;
    }
    :focus-visible {
      outline: 2px solid var(--hs-focus);
      outline-offset: 2px;
    }
    .error {
      color: var(--hs-over);
    }
  `,
];
