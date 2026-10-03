import { LitElement, css, html, nothing } from 'lit';
import type { Auth } from '../data/auth';
import { base } from '../styles/base';

/** Email magic-link sign-in. Only the owner's address works; sign-ups are off. */
export class SignInForm extends LitElement {
  static override properties = {
    auth: { attribute: false },
    error: { type: String },
    note: { attribute: false },
    state: { state: true },
  };

  declare auth: Auth;
  /** Shown above the form, e.g. an expired link. */
  declare error: string;
  /** Context shown above the form, e.g. what happened on an OAuth return. */
  declare note: string;
  declare private state: 'idle' | 'sending' | 'sent' | 'failed';

  constructor() {
    super();
    this.error = '';
    this.note = '';
    this.state = 'idle';
  }

  private async send(e: Event) {
    e.preventDefault();
    const email = new FormData(e.target as HTMLFormElement).get('email')?.toString().trim();
    if (!email || this.state === 'sending') return;
    this.state = 'sending';
    try {
      await this.auth.sendLink(email);
      this.state = 'sent';
    } catch {
      this.state = 'failed';
    }
  }

  protected override render() {
    if (this.state === 'sent') {
      return html`<p role="status">Check your email for a sign-in link.</p>`;
    }
    const failed = this.state === 'failed';
    return html`<form @submit=${this.send}>
      ${this.note ? html`<p class="note" role="status">${this.note}</p>` : nothing}
      ${this.error && !failed ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
      <label for="email">Email</label>
      <div class="row">
        <input
          id="email"
          name="email"
          type="email"
          autocomplete="email"
          required
          aria-invalid=${failed ? 'true' : 'false'}
          aria-describedby=${failed ? 'failed' : nothing}
        />
        <button type="submit" class="primary" ?disabled=${this.state === 'sending'}>
          Email me a link
        </button>
      </div>
      ${
        failed
          ? html`<p class="error" id="failed" role="alert">
              Couldn't send a link to that address. Check it and try again.
            </p>`
          : nothing
      }
    </form>`;
  }

  static override styles = [
    ...base,
    css`
      .note {
        margin-bottom: var(--space-4);
        padding: var(--space-3) var(--space-4);
        border-radius: var(--radius-md);
        background: var(--color-success-soft);
        color: var(--color-ink);
      }
      label {
        display: block;
        font: var(--text-label);
        margin-bottom: var(--space-1);
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
      }
      input {
        flex: 1 1 14rem;
      }
    `,
  ];
}

if (!customElements.get('sign-in-form')) customElements.define('sign-in-form', SignInForm);

declare global {
  interface HTMLElementTagNameMap {
    'sign-in-form': SignInForm;
  }
}
