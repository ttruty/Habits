import { LitElement, css, html, nothing } from 'lit';
import type { Auth } from '../data/auth';
import { sourceAlerts, type SourceAlert } from '../data/alerts';
import type { DataProvider } from '../data/provider';
import { base } from '../styles/base';
import './data-page';
import './habit-editor';
import './habit-scorecard';
import './sign-in-form';
import './source-list';

type Page = 'scorecard' | 'habits' | 'sources' | 'data';

const PAGES: { page: Page; label: string }[] = [
  { page: 'scorecard', label: 'Scorecard' },
  { page: 'habits', label: 'Habits' },
  { page: 'sources', label: 'Sources' },
  { page: 'data', label: 'Data' },
];

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
    alerts: { state: true },
  };

  declare provider: DataProvider | undefined;
  declare auth: Auth | undefined;
  /** From a failed magic-link redirect. */
  declare linkError: string;
  /** Signed-in email; undefined while checking, null when signed out. */
  declare private email: string | null | undefined;
  declare private page: Page;
  /** Sources needing attention, shown above the scorecard. */
  declare private alerts: SourceAlert[];

  private unsubscribe?: () => void;
  /** `?oauth=<kind>:<outcome>` after a provider's consent page; handed to Sources once. */
  private oauthOutcome: string | undefined;

  constructor() {
    super();
    this.page = 'scorecard';
    this.alerts = [];
    this.takeOAuthOutcome();
    this.linkError = '';
  }

  protected override updated(changed: Map<string, unknown>) {
    if (changed.has('page')) {
      const label = PAGES.find((p) => p.page === this.page)?.label;
      document.title = this.page === 'scorecard' ? 'Habits' : `${label} · Habits`;
    }
    if (['provider', 'email', 'page'].some((k) => changed.has(k)) && this.page === 'scorecard') {
      void this.loadAlerts();
    }
  }

  private async loadAlerts() {
    const signedIn = !this.auth || !!this.email;
    if (!this.provider || !signedIn) return;
    try {
      const [sources, tokens] = await Promise.all([
        this.provider.listSources(),
        this.provider.listIngestTokens(),
      ]);
      this.alerts = sourceAlerts(sources, tokens, new Date());
    } catch {
      this.alerts = [];
    }
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
    const outcome = params.get('oauth');
    if (!outcome) return;
    this.page = 'sources';
    this.oauthOutcome = outcome;
    params.delete('oauth');
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
        <div class="title-row">
          <h1>Habits</h1>
          ${
            signedIn && this.auth
              ? html`<div class="account">
                  <button type="button" @click=${() => this.auth!.signOut()}>Sign out</button>
                </div>`
              : nothing
          }
        </div>
        ${
          signedIn && this.provider
            ? html`<nav aria-label="Pages" class="pages">
                ${PAGES.map(({ page, label }) => this.navButton(page, label))}
              </nav>`
            : nothing
        }
      </header>
      ${!this.auth ? html`<p class="demo">Demo data. Changes stay in this browser.</p>` : nothing}
      ${signedIn && this.page === 'scorecard' && this.alerts.length ? this.renderAlerts() : nothing}
      ${this.renderPage(signedIn)}
    `;
  }

  private renderAlerts() {
    return html`<div class="alerts" role="status">
      <ul>
        ${this.alerts.map((a) => html`<li><span aria-hidden="true">⚠</span> ${a.message}</li>`)}
      </ul>
      <button type="button" @click=${() => (this.page = 'sources')}>Open Sources</button>
    </div>`;
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
      case 'data':
        return html`<data-page .provider=${this.provider}></data-page>`;
      case 'sources':
        return html`<source-list
          .provider=${this.provider}
          .oauthOutcome=${this.handOver()}
        ></source-list>`;
      default:
        return html`<h2 class="sr">Scorecard</h2>
          <habit-scorecard .provider=${this.provider}></habit-scorecard>`;
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
      /* Pages as one segmented control; full width on a phone. */
      .pages {
        display: flex;
      }
      .pages button {
        border-radius: 0;
        margin-left: -1px;
        padding: 0 0.875rem;
      }
      .pages button:first-child {
        border-radius: var(--hs-radius) 0 0 var(--hs-radius);
        margin-left: 0;
      }
      .pages button:last-child {
        border-radius: 0 var(--hs-radius) var(--hs-radius) 0;
      }
      .pages [aria-current='page'] {
        background: var(--hs-text);
        color: var(--hs-bg);
        border-color: var(--hs-text);
        position: relative;
      }
      .account {
        display: flex;
        gap: var(--hs-space);
      }
      @media (max-width: 34rem) {
        header {
          flex-direction: column;
          align-items: stretch;
        }
        .pages button {
          flex: 1;
          padding: 0 0.5rem;
        }
        .title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
      }
      .alerts {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--hs-space);
        padding: var(--hs-space) calc(var(--hs-space) * 1.5);
        margin-bottom: calc(var(--hs-space) * 1.5);
        border: 1px solid var(--hs-over);
        border-radius: var(--hs-radius);
        background: var(--hs-surface);
      }
      .alerts ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .alerts li span {
        color: var(--hs-over);
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
