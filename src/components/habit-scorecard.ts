import { LitElement, css, html, unsafeCSS } from 'lit';
import tokens from '../styles/tokens.css?inline';

export type Theme = 'auto' | 'light' | 'dark';

/** The scorecard. Phase 0 placeholder: renders a heading only. */
export class HabitScorecard extends LitElement {
  static override properties = {
    theme: { type: String, reflect: true },
    weeks: { type: Number },
    share: { type: String },
  };

  static override styles = [
    unsafeCSS(tokens),
    css`
      :host {
        display: block;
        font-family: var(--hs-font);
        font-size: var(--hs-font-size);
        color: var(--hs-text);
        background: var(--hs-bg);
        padding: calc(var(--hs-space) * 2);
        border-radius: var(--hs-radius);
      }
      h1 {
        font-size: 1.125rem;
        margin: 0 0 var(--hs-space);
      }
      p {
        margin: 0;
        color: var(--hs-text-muted);
      }
    `,
  ];

  declare theme: Theme;
  declare weeks: number;
  /** Share token for read-only embeds. Unused until Phase 3. */
  declare share: string | undefined;

  constructor() {
    super();
    this.theme = 'auto';
    this.weeks = 1;
  }

  protected override render() {
    return html`
      <h1>Habits</h1>
      <p>Nothing to show yet.</p>
    `;
  }
}

if (!customElements.get('habit-scorecard')) {
  customElements.define('habit-scorecard', HabitScorecard);
}

declare global {
  interface HTMLElementTagNameMap {
    'habit-scorecard': HabitScorecard;
  }
}
