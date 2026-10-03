import { LitElement, css, html } from 'lit';
import type { Auth } from '../data/auth';
import type { DataProvider } from '../data/provider';
import { base } from '../styles/base';
import { setTheme, themeSetting, type ThemeSetting } from '../theme';
import { ui } from '../ui/components';
import { icon, type UiIcon } from '../ui/ui-icons';
import { navigate, type AppData } from './app-events';
import './data-page';

const THEMES: { value: ThemeSetting; label: string; icon: UiIcon }[] = [
  { value: 'system', label: 'System', icon: 'monitor' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

const REPO = 'https://github.com/ttruty/Habits';

/** Appearance, habit management, export/import, and the account. */
export class MorePage extends LitElement {
  static override properties = {
    provider: { attribute: false },
    data: { attribute: false },
    auth: { attribute: false },
    theme: { state: true },
  };

  declare provider: DataProvider;
  declare data: AppData;
  declare auth: Auth | undefined;
  declare private theme: ThemeSetting;

  constructor() {
    super();
    this.theme = themeSetting();
  }

  private pick(value: ThemeSetting) {
    setTheme(value);
    this.theme = value;
  }

  protected override render() {
    const live = this.data.habits.filter((h) => !h.archivedAt).length;
    const archived = this.data.habits.length - live;
    return html`<section class="page">
      <h1 class="display">More</h1>

      <section class="card" aria-labelledby="appearance">
        <h2 id="appearance" class="label">Appearance</h2>
        <div class="segmented" role="group" aria-label="Theme">
          ${THEMES.map(
            (t) =>
              html`<button
                type="button"
                aria-pressed=${this.theme === t.value ? 'true' : 'false'}
                @click=${() => this.pick(t.value)}
              >
                ${icon(t.icon, 18)} ${t.label}
              </button>`,
          )}
        </div>
      </section>

      <section class="card" aria-labelledby="habits">
        <h2 id="habits" class="label">Habits</h2>
        <p class="caption">${live} active${archived ? `, ${archived} archived` : ''}.</p>
        <button type="button" @click=${() => navigate(this, { name: 'manage' })}>
          Manage habits
        </button>
      </section>

      <section class="card">
        <data-page .provider=${this.provider}></data-page>
      </section>

      <section class="card" aria-labelledby="account">
        <h2 id="account" class="label">Account</h2>
        ${
          this.auth
            ? html`<button type="button" @click=${() => this.auth!.signOut()}>
                ${icon('log-out', 18)} Sign out
              </button>`
            : html`<p class="caption">Demo data. Changes stay in this browser.</p>`
        }
      </section>

      <p class="caption version">
        Version ${__APP_VERSION__} ·
        ${
          __APP_COMMIT__
            ? html`<a href="${REPO}/commit/${__APP_COMMIT__}" target="_blank" rel="noopener"
                >${__APP_COMMIT__.slice(0, 7)}</a
              >`
            : 'dev'
        }
        · built ${__APP_BUILT__}
      </p>
    </section>`;
  }

  static override styles = [
    ...base,
    ui,
    css`
      .card {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--space-3);
      }
      .version {
        text-align: center;
      }
      .version a {
        display: inline-flex;
        align-items: center;
        min-height: var(--touch-min);
        color: var(--color-ink-2);
        font-family: var(--font-mono);
      }
      .segmented {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        width: 100%;
      }
      .segmented button {
        border-radius: 0;
        margin-left: -1px;
      }
      .segmented button:first-child {
        border-radius: var(--radius-md) 0 0 var(--radius-md);
        margin-left: 0;
      }
      .segmented button:last-child {
        border-radius: 0 var(--radius-md) var(--radius-md) 0;
      }
      .segmented [aria-pressed='true'],
      .segmented [aria-pressed='true']:hover {
        background: var(--color-primary);
        color: var(--color-on-primary);
        border-color: var(--color-primary);
        position: relative;
      }
    `,
  ];
}

if (!customElements.get('more-page')) customElements.define('more-page', MorePage);

declare global {
  interface HTMLElementTagNameMap {
    'more-page': MorePage;
  }
}
