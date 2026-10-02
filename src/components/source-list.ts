import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { connectorFor, connectors } from '../connectors/registry';
import type { Connector } from '../connectors/types';
import { sourceAlerts } from '../data/alerts';
import type { DataProvider, IngestToken } from '../data/provider';
import type { Habit, Source } from '../model';
import { localDateKey } from '../scoring/dates';
import { base } from '../styles/base';

/**
 * A source just connected: for apps, the token (shown once) and URL; for OAuth sources, no token.
 * Either way, the suggested habits.
 */
interface Issued {
  source: Source;
  token?: string;
  /** Preset indexes still ticked; only offered for a newly connected source. */
  presets: Set<number> | null;
}

/** What came back from an OAuth round trip (?strava=…), in plain words. */
const OAUTH_MESSAGES: Record<string, (name: string) => string> = {
  denied: (name) => `${name} wasn't connected.`,
  'missing-scope': (name) =>
    `${name} was connected without permission to read your activity. Connect again and allow everything it asks for.`,
  failed: (name) => `Couldn't connect ${name}. Try again.`,
};

/** OAuth sources keep `connected` (and maybe a name) in their non-secret config. */
const oauthState = (s: Source) => s.config as { connected?: boolean; athleteName?: string | null };

/**
 * Sources that report on their own. "Connect an app" issues an ingest token for first-party apps,
 * or starts OAuth for Strava.
 */
export class SourceList extends LitElement {
  static override properties = {
    provider: { attribute: false },
    now: { attribute: false },
    navigate: { attribute: false },
    oauthOutcome: { attribute: false },
    sources: { state: true },
    tokens: { state: true },
    status: { state: true },
    picking: { state: true },
    issued: { state: true },
    message: { state: true },
  };

  declare provider: DataProvider;
  /** For tests. */
  declare now: () => Date;
  /** Sends the browser to a provider's sign-in page. Replaced in tests. */
  declare navigate: (url: string) => void;
  /** `<kind>:<outcome>` after returning from a provider's consent page (?oauth=…), if any. */
  declare oauthOutcome: string | undefined;
  declare private sources: Source[];
  declare private tokens: IngestToken[];
  declare private status: 'loading' | 'ready' | 'error' | 'saving';
  declare private picking: boolean;
  declare private issued: Issued | undefined;
  declare private message: string;

  private focusNext: string | undefined;

  constructor() {
    super();
    this.now = () => new Date();
    this.navigate = (url) => location.assign(url);
    this.sources = [];
    this.tokens = [];
    this.status = 'loading';
    this.picking = false;
    this.message = '';
  }

  protected override willUpdate(changed: PropertyValues) {
    if (changed.has('provider')) void this.load();
  }

  protected override updated() {
    if (!this.focusNext || this.status === 'saving') return;
    this.renderRoot.querySelector<HTMLElement>(this.focusNext)?.focus();
    this.focusNext = undefined;
  }

  private async load() {
    try {
      const [sources, tokens] = await Promise.all([
        this.provider.listSources(),
        this.provider.listIngestTokens(),
      ]);
      this.sources = sources;
      this.tokens = tokens;
      this.status = 'ready';
      this.showOAuthOutcome();
    } catch {
      this.status = 'error';
    }
  }

  /** Once, after loading: say how the OAuth round trip went, and offer habits if it worked. */
  private showOAuthOutcome() {
    const [kind, outcome] = (this.oauthOutcome ?? '').split(':');
    this.oauthOutcome = undefined;
    const connector = connectorFor(kind as Source['kind']);
    if (!connector || !outcome) return;
    const source = this.sources.find((s) => s.kind === connector.kind);
    if (outcome === 'connected' && source) {
      this.issued = { source, presets: new Set(connector.presets.map((_, i) => i)) };
      this.focusNext = '#issued-heading';
    } else {
      this.message = (OAUTH_MESSAGES[outcome] ?? OAUTH_MESSAGES.failed)(connector.displayName);
    }
  }

  /** Sources that report on their own (everything but hand-ticking). */
  private get connected() {
    return this.sources.filter((s) => {
      const mode = connectorFor(s.kind)?.mode;
      return mode === 'push' || mode === 'oauth';
    });
  }

  private isOAuth(source: Source) {
    return connectorFor(source.kind)?.mode === 'oauth';
  }

  /** Off to the provider's consent page; it sends the browser back here with ?<kind>=outcome. */
  private async startOAuth(connector: Connector) {
    this.picking = false;
    const returnTo = `${location.origin}${location.pathname}`;
    const url = await this.busy(() => this.provider.connectOAuth(connector.kind, returnTo));
    if (url) this.navigate(url);
    else this.message = `Couldn't start connecting ${connector.displayName}. Try again later.`;
  }

  private async busy<T>(action: () => Promise<T>): Promise<T | undefined> {
    this.status = 'saving';
    try {
      const result = await action();
      await this.load();
      return result;
    } catch {
      this.status = 'ready';
      this.message = "Couldn't save. Try again.";
      return undefined;
    }
  }

  private async connect(connector: Connector) {
    if (connector.mode === 'oauth') return this.startOAuth(connector);
    this.picking = false;
    const issued = await this.busy(async () => {
      const source = await this.provider.addSource({
        kind: connector.kind,
        label: connector.displayName,
        config: {},
      });
      const token = await this.provider.issueIngestToken(source.id);
      return { source, token, presets: new Set(connector.presets.map((_, i) => i)) };
    });
    if (issued) {
      this.issued = issued;
      this.message = '';
      this.focusNext = '#issued-heading';
    }
  }

  private async reissue(source: Source) {
    const ok = confirm(
      `Make a new token for ${source.label}? The old one stops working, so paste the new one into the app.`,
    );
    if (!ok) return;
    const token = await this.busy(() => this.provider.issueIngestToken(source.id));
    if (token) {
      this.issued = { source, token, presets: null };
      this.message = '';
      this.focusNext = '#issued-heading';
    }
  }

  private async disconnect(source: Source) {
    const oauth = this.isOAuth(source);
    const question = oauth
      ? `Disconnect ${source.label}? Its activities are removed from Habits, as its terms require.`
      : `Disconnect ${source.label}? It stops reporting. Its past events stay.`;
    if (!confirm(question)) return;
    const done = await this.busy(() =>
      oauth ? this.provider.disconnectOAuth(source) : this.provider.revokeIngestTokens(source.id),
    );
    if (done !== undefined) this.message = `Disconnected ${source.label}.`;
  }

  private async finish() {
    const issued = this.issued;
    if (!issued) return;
    const connector = connectorFor(issued.source.kind);
    const chosen = connector?.presets.filter((_, i) => issued.presets?.has(i)) ?? [];
    const saved = await this.busy(async () => {
      const habits = await this.provider.listHabits();
      let sort = Math.max(-1, ...habits.map((h) => h.sort)) + 1;
      for (const preset of chosen) {
        const habit: Habit = {
          ...structuredClone(preset),
          id: crypto.randomUUID(),
          match: { ...preset.match, sourceIds: [issued.source.id] },
          startDate: localDateKey(this.now()),
          sort: sort++,
        };
        await this.provider.saveHabit(habit);
      }
      return true;
    });
    if (!saved) return;
    this.message = chosen.length
      ? `Added ${chosen.map((p) => p.name).join(', ')}.`
      : `${issued.source.label} is connected.`;
    this.issued = undefined;
    this.focusNext = '#connect';
  }

  private async copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.message = `Copied the ${what}.`;
    } catch {
      this.message = `Couldn't copy. Select the ${what} and copy it by hand.`;
    }
  }

  private describe(source: Source): string {
    const alert = sourceAlerts([source], this.tokens, this.now())[0];
    if (alert?.kind === 'reconnect') return 'Needs reconnecting: access was revoked or expired.';
    if (alert) return alert.message;
    if (this.isOAuth(source)) {
      const { connected, athleteName } = oauthState(source);
      if (!connected) return 'Disconnected';
      return athleteName ? `Connected as ${athleteName}` : 'Connected';
    }
    const mine = this.tokens.filter((t) => t.sourceId === source.id);
    const live = mine.find((t) => !t.revokedAt);
    if (!live) return 'Disconnected';
    const last = mine
      .map((t) => t.lastUsedAt)
      .filter((t): t is string => !!t)
      .sort()
      .at(-1);
    return last ? `Last reported ${this.ago(last)}` : 'Waiting for its first report';
  }

  private ago(iso: string): string {
    const minutes = Math.round((Date.parse(iso) - this.now().getTime()) / 60_000);
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
    return rtf.format(Math.round(hours / 24), 'day');
  }

  protected override render() {
    if (this.status === 'loading') return html`<p role="status">Loading…</p>`;
    if (this.status === 'error') {
      return html`<p class="error" role="alert">Couldn't load sources.</p>`;
    }
    return html`
      ${this.issued ? this.renderIssued(this.issued) : this.renderList()}
      <p class="message" role="status">${this.message}</p>
    `;
  }

  private renderList() {
    const busy = this.status === 'saving';
    const connectable = connectors.filter(
      (c) => c.mode === 'push' || (c.mode === 'oauth' && this.provider.oauth),
    );
    return html`
      <div class="head">
        <h2>Sources</h2>
        <button
          id="connect"
          type="button"
          class="primary"
          aria-expanded=${this.picking ? 'true' : 'false'}
          ?disabled=${busy}
          @click=${() => (this.picking = !this.picking)}
        >
          Connect an app
        </button>
      </div>
      ${
        this.picking
          ? html`<ul class="picker" aria-label="Apps">
              ${connectable.map(
                (c) =>
                  html`<li>
                    <button type="button" ?disabled=${busy} @click=${() => this.connect(c)}>
                      ${c.displayName}
                    </button>
                  </li>`,
              )}
            </ul>`
          : nothing
      }
      ${
        this.connected.length
          ? html`<ul class="list">
              ${this.connected.map(
                (s) =>
                  html`<li>
                    <span class="what">
                      <span class="name">${s.label}</span>
                      <span
                        class="detail ${sourceAlerts([s], this.tokens, this.now()).length ? 'warn' : ''}"
                        >${this.describe(s)}</span
                      >
                    </span>
                    <span class="actions">
                      ${this.isOAuth(s) ? this.renderOAuthActions(s, busy) : this.renderAppActions(s, busy)}
                    </span>
                  </li>`,
              )}
            </ul>`
          : html`<p class="muted">No apps connected yet.</p>`
      }
    `;
  }

  private renderOAuthActions(s: Source, busy: boolean) {
    const connector = connectorFor(s.kind)!;
    if (oauthState(s).connected) {
      return html`<button
        type="button"
        aria-label="Disconnect ${s.label}"
        ?disabled=${busy}
        @click=${() => this.disconnect(s)}
      >
        Disconnect
      </button>`;
    }
    return html`<button
      type="button"
      aria-label="Reconnect ${s.label}"
      ?disabled=${busy || !this.provider.oauth}
      @click=${() => this.startOAuth(connector)}
    >
      Reconnect
    </button>`;
  }

  private renderAppActions(s: Source, busy: boolean) {
    return html`<button
        type="button"
        aria-label="New token for ${s.label}"
        ?disabled=${busy}
        @click=${() => this.reissue(s)}
      >
        New token
      </button>
      ${
        this.tokens.some((t) => t.sourceId === s.id && !t.revokedAt)
          ? html`<button
              type="button"
              aria-label="Disconnect ${s.label}"
              ?disabled=${busy}
              @click=${() => this.disconnect(s)}
            >
              Disconnect
            </button>`
          : nothing
      }`;
  }

  private renderToken(source: Source, token: string) {
    return html`<h2 id="issued-heading" tabindex="-1">Connect ${source.label}</h2>
      <p>
        In ${source.label}, open Settings, turn on reporting to Habits, and paste these two values.
        <strong>The token is shown only this once.</strong>
      </p>
      <div class="field">
        <label for="url">Ingest URL</label>
        <div class="row">
          <input id="url" readonly .value=${this.provider.ingestUrl} />
          <button type="button" @click=${() => this.copy(this.provider.ingestUrl, 'URL')}>
            Copy
          </button>
        </div>
      </div>
      <div class="field">
        <label for="token">Token</label>
        <div class="row">
          <input id="token" readonly .value=${token} />
          <button type="button" @click=${() => this.copy(token, 'token')}>Copy</button>
        </div>
      </div> `;
  }

  private renderOAuthDone(source: Source) {
    return html`<h2 id="issued-heading" tabindex="-1">${source.label} is connected</h2>
      <p>
        Your last 60 days are on their way. New activity arrives as soon as ${source.label} has it.
      </p>`;
  }

  private renderIssued(issued: Issued) {
    const connector = connectorFor(issued.source.kind);
    const busy = this.status === 'saving';
    return html`<section aria-labelledby="issued-heading">
      ${issued.token ? this.renderToken(issued.source, issued.token) : this.renderOAuthDone(issued.source)}
      ${
        issued.presets && connector?.presets.length
          ? html`<fieldset class="field">
              <legend>Suggested habits</legend>
              ${connector.presets.map(
                (p, i) =>
                  html`<label class="check">
                    <input
                      type="checkbox"
                      .checked=${issued.presets!.has(i)}
                      @change=${(e: Event) => {
                        const next = new Set(issued.presets);
                        if ((e.target as HTMLInputElement).checked) next.add(i);
                        else next.delete(i);
                        this.issued = { ...issued, presets: next };
                      }}
                    />
                    <span aria-hidden="true">${p.icon}</span> ${p.name}
                  </label>`,
              )}
            </fieldset>`
          : nothing
      }
      <button type="button" class="primary" ?disabled=${busy} @click=${this.finish}>Done</button>
    </section>`;
  }

  static override styles = [
    ...base,
    css`
      h2 {
        font-size: 1.125rem;
        margin: 0;
      }
      section h2 {
        margin-bottom: var(--hs-space);
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--hs-space);
      }
      .muted,
      .detail {
        color: var(--hs-text-muted);
      }
      .picker {
        list-style: none;
        display: flex;
        flex-wrap: wrap;
        gap: var(--hs-space);
        margin: 0 0 var(--hs-space);
        padding: 0;
      }
      .list {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .list li {
        display: flex;
        align-items: center;
        gap: var(--hs-space);
        padding: var(--hs-space) 0;
        border-top: 1px solid var(--hs-border);
      }
      .what {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }
      .name {
        font-weight: 500;
      }
      .detail {
        font-size: 0.8125rem;
      }
      .detail.warn {
        color: var(--hs-over);
        font-weight: 500;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--hs-space) / 2);
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: calc(var(--hs-space) / 2);
        margin: 0 0 calc(var(--hs-space) * 2);
        padding: 0;
        border: 0;
        max-width: 36rem;
      }
      label,
      legend {
        font-weight: 500;
        padding: 0;
      }
      .row {
        display: flex;
        gap: var(--hs-space);
      }
      .row input {
        flex: 1;
        min-width: 0;
        font-family: ui-monospace, monospace;
        font-size: 0.875rem;
      }
      .check {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-weight: normal;
        min-height: 2.5rem;
      }
      .check input {
        min-height: 0;
        margin: 0;
      }
      .message {
        min-height: 1.4em;
        color: var(--hs-text-muted);
      }
    `,
  ];
}

if (!customElements.get('source-list')) customElements.define('source-list', SourceList);

declare global {
  interface HTMLElementTagNameMap {
    'source-list': SourceList;
  }
}
