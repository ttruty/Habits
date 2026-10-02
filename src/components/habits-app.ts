import { LitElement, css, html, nothing } from 'lit';
import { sourceAlerts, type SourceAlert } from '../data/alerts';
import type { Auth } from '../data/auth';
import type { DataProvider } from '../data/provider';
import type { DateKey } from '../model';
import type { AppData, Route, Toast } from './app-events';
import { addDays, localDateKey } from '../scoring/dates';
import { base } from '../styles/base';
import { tabBar, ui, type Tab } from '../ui/components';
import { icon } from '../ui/ui-icons';
import './habit-form';
import './habit-scorecard';
import './manage-habits';
import './more-page';
import './progress-page';
import './sign-in-form';
import './source-list';
import './today-page';

/** History loaded for streaks and the 5-week heatmap. */
const HISTORY_DAYS = 365;

const TABS: Tab[] = [
  { id: 'today', label: 'Today', icon: 'today' },
  { id: 'progress', label: 'Progress', icon: 'chart' },
  { id: 'form', label: 'New habit', icon: 'plus', fab: true },
  { id: 'sources', label: 'Sources', icon: 'sources' },
  { id: 'more', label: 'More', icon: 'more' },
];

const TITLES: Record<Route['name'], string> = {
  today: 'Today',
  grid: 'Scorecard',
  progress: 'Progress',
  form: 'Habit',
  manage: 'Manage habits',
  sources: 'Sources',
  more: 'More',
};

/**
 * The standalone app: sign-in, then Today / Progress / Sources / More with a floating tab bar
 * (design/DESIGN_SYSTEM.md §5 TabBar, §6 Screens). With no `auth` it runs on demo data.
 */
export class HabitsApp extends LitElement {
  static override properties = {
    provider: { attribute: false },
    auth: { attribute: false },
    linkError: { attribute: false },
    today: { attribute: false },
    email: { state: true },
    route: { state: true },
    data: { state: true },
    status: { state: true },
    alerts: { state: true },
    toast: { state: true },
    wide: { state: true },
  };

  declare provider: DataProvider | undefined;
  declare auth: Auth | undefined;
  /** From a failed magic-link redirect. */
  declare linkError: string;
  /** Override "today", for tests. */
  declare today: DateKey | undefined;
  declare private email: string | null | undefined;
  declare private route: Route;
  declare private data: AppData | undefined;
  declare private status: 'loading' | 'ready' | 'error';
  declare private alerts: SourceAlert[];
  declare private toast: Toast | undefined;
  /** ≥ 1024 px: Today shows the dashboard. */
  declare private wide: boolean;

  private unsubscribe?: () => void;
  /** `?oauth=<kind>:<outcome>` after a provider's consent page; handed to Sources once. */
  private oauthOutcome: string | undefined;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private loads = 0;
  private media = window.matchMedia?.('(min-width: 1024px)');
  private onMedia = () => (this.wide = !!this.media?.matches);
  private onVisible = () => {
    if (document.visibilityState === 'visible') void this.load();
  };

  constructor() {
    super();
    this.route = { name: 'today' };
    this.linkError = '';
    this.alerts = [];
    this.status = 'loading';
    this.wide = !!this.media?.matches;
    this.takeOAuthOutcome();
  }

  override connectedCallback() {
    super.connectedCallback();
    this.media?.addEventListener?.('change', this.onMedia);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.media?.removeEventListener?.('change', this.onMedia);
    document.removeEventListener('visibilitychange', this.onVisible);
    clearTimeout(this.toastTimer);
  }

  private get signedIn() {
    return !this.auth || !!this.email;
  }

  private get todayKey() {
    return this.today ?? localDateKey(new Date());
  }

  protected override willUpdate(changed: Map<string, unknown>) {
    if (changed.has('auth')) {
      this.unsubscribe?.();
      this.email = undefined;
      this.unsubscribe = this.auth?.onChange((email) => (this.email = email));
    }
  }

  protected override updated(changed: Map<string, unknown>) {
    if (['provider', 'email', 'auth'].some((k) => changed.has(k))) void this.load();
    if (changed.has('route')) {
      const title = TITLES[this.route.name];
      document.title = this.route.name === 'today' ? 'Habits' : `${title} · Habits`;
    }
  }

  /** (Re)load everything the pages show. */
  async load() {
    if (!this.provider || !this.signedIn) return;
    const id = ++this.loads;
    const today = this.todayKey;
    try {
      const [habits, sources, events, tokens] = await Promise.all([
        this.provider.listHabits(),
        this.provider.listSources(),
        this.provider.listEvents({ from: addDays(today, -HISTORY_DAYS), to: today }),
        this.provider.listIngestTokens(),
      ]);
      if (id !== this.loads) return;
      this.data = { habits, sources, events, tokens, today };
      this.alerts = sourceAlerts(sources, tokens, new Date());
      this.status = 'ready';
    } catch {
      if (id === this.loads) this.status = 'error';
    }
  }

  private go(route: Route) {
    this.route = route;
    window.scrollTo?.({ top: 0 });
  }

  private showToast(toast: Toast) {
    clearTimeout(this.toastTimer);
    this.toast = toast;
    this.toastTimer = setTimeout(() => (this.toast = undefined), 4000);
  }

  private async undo() {
    const undo = this.toast?.undo;
    this.toast = undefined;
    clearTimeout(this.toastTimer);
    if (undo) {
      await undo();
      await this.load();
    }
  }

  /** Open Sources after an OAuth round trip, and tidy the outcome out of the address bar. */
  private takeOAuthOutcome() {
    const params = new URLSearchParams(location.search);
    const outcome = params.get('oauth');
    if (!outcome) return;
    this.route = { name: 'sources' };
    this.oauthOutcome = outcome;
    params.delete('oauth');
    const query = params.toString();
    history.replaceState(
      null,
      '',
      `${location.pathname}${query ? `?${query}` : ''}${location.hash}`,
    );
  }

  /** The OAuth outcome, once: going back to Sources later shouldn't repeat it. */
  private handOver() {
    const outcome = this.oauthOutcome;
    this.oauthOutcome = undefined;
    return outcome;
  }

  protected override render() {
    if (!this.provider || (this.auth && this.email === undefined)) {
      return html`<p class="page" role="status">Loading…</p>`;
    }
    if (!this.signedIn) {
      return html`<sign-in-form .auth=${this.auth!} .error=${this.linkError}></sign-in-form>`;
    }
    const tab =
      this.route.name === 'grid'
        ? 'today'
        : this.route.name === 'manage'
          ? 'more'
          : this.route.name;
    return html`
      <div
        @navigate=${(e: CustomEvent<Route>) => this.go(e.detail)}
        @changed=${() => void this.load()}
        @toast=${(e: CustomEvent<Toast>) => this.showToast(e.detail)}
      >
        ${this.renderRoute()}
      </div>
      ${
        this.route.name === 'form'
          ? nothing
          : tabBar(TABS, tab, (id) =>
              this.go(id === 'form' ? { name: 'form' } : ({ name: id } as Route)),
            )
      }
      ${
        this.toast
          ? html`<div class="toast" role="status">
              <span>${this.toast.message}</span>
              ${
                this.toast.undo
                  ? html`<button type="button" @click=${() => this.undo()}>Undo</button>`
                  : nothing
              }
            </div>`
          : nothing
      }
    `;
  }

  private renderRoute() {
    const r = this.route;
    if (r.name === 'sources') {
      return html`<section class="page">
        <source-list .provider=${this.provider} .oauthOutcome=${this.handOver()}></source-list>
      </section>`;
    }
    if (r.name === 'grid') {
      return html`<section class="page">
        <div class="page-head">
          <button
            type="button"
            class="icon"
            aria-label="Back to Today"
            @click=${() => this.go({ name: 'today' })}
          >
            ${icon('chevron-left')}
          </button>
        </div>
        <h1 class="title">Scorecard</h1>
        <habit-scorecard .provider=${this.provider}></habit-scorecard>
      </section>`;
    }
    if (this.status === 'error') {
      return html`<section class="page"><p role="alert">Couldn't load your habits.</p></section>`;
    }
    if (!this.data) return html`<p class="page" role="status">Loading…</p>`;
    const common = { provider: this.provider!, data: this.data };
    switch (r.name) {
      case 'progress':
        return html`<progress-page
          .provider=${common.provider}
          .data=${common.data}
          .habitId=${r.habitId}
        ></progress-page>`;
      case 'form':
        return html`<habit-form
          .provider=${common.provider}
          .data=${common.data}
          .habitId=${r.habitId}
        ></habit-form>`;
      case 'manage':
        return html`<manage-habits
          .provider=${common.provider}
          .data=${common.data}
        ></manage-habits>`;
      case 'more':
        return html`<more-page
          .provider=${common.provider}
          .data=${common.data}
          .auth=${this.auth}
        ></more-page>`;
      default:
        return html`<today-page
          .provider=${common.provider}
          .data=${common.data}
          .alerts=${this.alerts}
          .demo=${!this.auth}
          .wide=${this.wide}
        ></today-page>`;
    }
  }

  static override styles = [
    ...base,
    ui,
    css`
      :host {
        min-height: 100vh;
        background: var(--color-bg);
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
