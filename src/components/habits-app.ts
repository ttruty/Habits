import { LitElement, css, html, nothing } from 'lit';
import type { Auth } from '../data/auth';
import type { DataProvider } from '../data/provider';
import { base } from '../styles/base';
import './habit-editor';
import './habit-scorecard';
import './sign-in-form';
import './source-list';

type Page = 'scorecard' | 'habits' | 'sources';

/**
 * The standalone app: sign-in, then the scorecard or the habit list. Not part of the embed.
 * With no `auth` it runs on demo data, with no sign-in.
 */
export class HabitsApp extends LitElement {
  static override properties = {
    provider: { attribute: false },
    auth: { attribute: false },
    linkError: { attribute: false },
    email: { state: true },
    page: { state: true },
  };

  declare provider: DataProvider | undefined;
  declare auth: Auth | undefined;
  /** From a failed magic-link redirect. */
  declare linkError: string;
  /** Signed-in email; undefined while checking, null when signed out. */
  declare private email: string | null | undefined;
  declare private page: Page;

  private unsubscribe?: () => void;
  /** `?strava=<outcome>` after returning from Strava's consent page; handed to Sources once. */
  private oauthOutcome: string | undefined;

  constructor() {
    super();
    this.page = 'scorecard';
    this.takeOAuthOutcome();
    this.linkError = '';
  }

  protected override willUpdate(changed: Map<string, unknown>) {
    if (changed.has('auth')) {
      this.unsubscribe?.();
      this.email = undefined;
      this.unsubscribe = this.auth?.onChange((email) => (this.email = email));
    }
  }

  /** The OAuth outcome, once: going back to Sources later shouldn't repeat it. */
  private handOver() {
    const outcome = this.oauthOutcome;
    this.oauthOutcome = undefined;
    return outcome;
  }

  /** Open Sources after an OAuth round trip, and tidy the outcome out of the address bar. */
  private takeOAuthOutcome() {
    const params = new URLSearchParams(location.search);
    const outcome = params.get('strava');
    if (!outcome) return;
    this.page = 'sources';
    this.oauthOutcome = outcome;
    params.delete('strava');
    const query = params.toString();
    history.replaceState(
      null,
      '',
      `${location.pathname}${query ? `?${query}` : ''}${location.hash}`,
    );
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribe?.();
  }

  protected override render() {
    const signedIn = !this.auth || !!this.email;
    return html`
      <header>
        <h1>Habits</h1>
        ${
          signedIn && this.provider
            ? html`<nav aria-label="Pages">
                ${this.navButton('scorecard', 'Scorecard')} ${this.navButton('habits', 'Habits')}
                ${this.navButton('sources', 'Sources')}
                ${
                  this.auth
                    ? html`<button type="button" @click=${() => this.auth!.signOut()}>
                        Sign out
                      </button>`
                    : nothing
                }
              </nav>`
            : nothing
        }
      </header>
      ${!this.auth ? html`<p class="demo">Demo data. Changes stay in this browser.</p>` : nothing}
      ${this.renderPage(signedIn)}
    `;
  }

  private navButton(page: Page, label: string) {
    return html`<button
      type="button"
      aria-current=${this.page === page ? 'page' : nothing}
      @click=${() => (this.page = page)}
    >
      ${label}
    </button>`;
  }

  private renderPage(signedIn: boolean) {
    if (!this.provider || (this.auth && this.email === undefined)) {
      return html`<p role="status">Loading…</p>`;
    }
    if (!signedIn) {
      return html`<sign-in-form .auth=${this.auth!} .error=${this.linkError}></sign-in-form>`;
    }
    switch (this.page) {
      case 'habits':
        return html`<habit-editor .provider=${this.provider}></habit-editor>`;
      case 'sources':
        return html`<source-list
          .provider=${this.provider}
          .oauthOutcome=${this.handOver()}
        ></source-list>`;
      default:
        return html`<habit-scorecard .provider=${this.provider}></habit-scorecard>`;
    }
  }

  static override styles = [
    ...base,
    css`
      :host {
        max-width: 60rem;
        margin: 0 auto;
        padding: calc(var(--hs-space) * 2);
        min-height: 100vh;
        background: var(--hs-bg);
      }
      header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--hs-space);
        margin-bottom: calc(var(--hs-space) * 2);
      }
      h1 {
        font-size: 1.25rem;
        margin: 0;
      }
      nav {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--hs-space) / 2);
      }
      nav [aria-current='page'] {
        background: var(--hs-text);
        color: var(--hs-bg);
        border-color: var(--hs-text);
      }
      .demo {
        margin: 0 0 var(--hs-space);
        color: var(--hs-text-muted);
        font-size: 0.875rem;
      }
      habit-scorecard {
        padding: 0;
      }
    `,
  ];
}

if (!customElements.get('habits-app')) customElements.define('habits-app', HabitsApp);

declare global {
  interface HTMLElementTagNameMap {
    'habits-app': HabitsApp;
  }
}
