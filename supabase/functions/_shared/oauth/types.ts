// What an OAuth provider (Strava, Withings) supplies. Adding one = a provider file + a registry
// line here, plus a client connector descriptor.

import type { ServerConnector } from '../connectors/types.ts';
import type { IngestEvent } from '../ingest.ts';

/** The app's credentials with the provider: function secrets <KIND>_CLIENT_ID / _CLIENT_SECRET. */
export interface OAuthApp {
  clientId: string;
  clientSecret: string;
  fetch: typeof fetch;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  /** The provider's id for the user. */
  userId: string;
  displayName?: string | null;
  scope?: string;
}

/**
 * What a webhook asks for. Webhooks are never trusted for data: they only say what to refetch.
 * - item: refetch one record (a Strava activity); gone at the provider = removed here.
 * - range: refetch these local days (Withings sends a time span).
 * - deauthorize: the user revoked access at the provider.
 */
export type WebhookHint =
  | { kind: 'item'; userId: string; itemId: string }
  | { kind: 'range'; userId: string; from: string; to: string }
  | { kind: 'deauthorize'; userId: string };

export interface OAuthProvider {
  connector: ServerConnector;
  displayName: string;
  authorizeUrl(app: OAuthApp, redirectUri: string, state: string): string;
  /**
   * Whether every permission we need was granted. Called twice: before the code exchange with the
   * callback only (return true if the provider only says so in the token reply), then with tokens.
   */
  scopeGranted(callback: URLSearchParams, tokens?: Tokens): boolean;
  exchangeCode(app: OAuthApp, code: string, redirectUri: string): Promise<Tokens>;
  refresh(app: OAuthApp, refreshToken: string): Promise<Tokens>;
  /** Every event whose local day is in from…to. */
  fetchRange(app: OAuthApp, token: string, from: string, to: string): Promise<IngestEvent[]>;
  /** One record by id, or null if the provider no longer returns it (item hints). */
  fetchItem?(app: OAuthApp, token: string, itemId: string): Promise<IngestEvent | null>;
  /** Make sure webhooks for this user (or app) reach `webhookUrl`. */
  subscribe(app: OAuthApp, token: string, webhookUrl: string): Promise<void>;
  /** On disconnect: stop webhooks and revoke access where the provider allows it. */
  release(app: OAuthApp, token: string, webhookUrl: string): Promise<void>;
  /** Answer a webhook request: the HTTP response, and what to refetch afterwards. */
  webhook(req: Request): Promise<{ response: Response; hints: WebhookHint[] }>;
}
