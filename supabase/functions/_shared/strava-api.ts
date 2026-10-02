// Strava HTTP API. `fetch` is injectable for tests.

import type { StravaActivity } from './connectors/strava.ts';

const API = 'https://www.strava.com/api/v3';
const OAUTH = 'https://www.strava.com/oauth';

export interface StravaApp {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
}

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  /** Epoch seconds. */
  expires_at: number;
  athlete?: { id: number; firstname?: string; lastname?: string };
}

/** Strava said 429: the app's 15-minute or daily limit is used up. */
export class RateLimited extends Error {
  constructor() {
    super('Strava rate limit reached');
  }
}

export class StravaError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call(f: typeof fetch, url: string, init?: RequestInit): Promise<Response> {
  const res = await f(url, init);
  if (res.status === 429) throw new RateLimited();
  return res;
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new StravaError(res.status, `${what} failed: ${res.status}`);
  return (await res.json()) as T;
}

function form(fields: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  };
}

export function authorizeUrl(app: StravaApp, redirectUri: string, state: string, scope: string) {
  const u = new URL(`${OAUTH}/authorize`);
  u.search = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope,
    state,
  }).toString();
  return u.href;
}

export async function exchangeCode(app: StravaApp, code: string): Promise<TokenSet> {
  const f = app.fetch ?? fetch;
  const res = await call(
    f,
    `${OAUTH}/token`,
    form({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  );
  return json<TokenSet>(res, 'Token exchange');
}

export async function refreshTokens(app: StravaApp, refreshToken: string): Promise<TokenSet> {
  const f = app.fetch ?? fetch;
  const res = await call(
    f,
    `${OAUTH}/token`,
    form({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  );
  return json<TokenSet>(res, 'Token refresh');
}

export async function deauthorize(f: typeof fetch, accessToken: string): Promise<void> {
  // Best effort: the athlete may have revoked access already.
  await call(f, `${OAUTH}/deauthorize`, form({ access_token: accessToken })).catch(() => undefined);
}

const auth = (token: string): RequestInit => ({ headers: { Authorization: `Bearer ${token}` } });

/** All activities that started after `after` (epoch seconds), oldest pages first. */
export async function listActivities(
  f: typeof fetch,
  token: string,
  after: number,
): Promise<StravaActivity[]> {
  const out: StravaActivity[] = [];
  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    const url = `${API}/athlete/activities?after=${after}&per_page=${perPage}&page=${page}`;
    const batch = await json<StravaActivity[]>(await call(f, url, auth(token)), 'Activity list');
    out.push(...batch);
    if (batch.length < perPage) break;
  }
  return out;
}

/** One activity, or null if Strava doesn't return it (deleted, or no longer visible to us). */
export async function getActivity(
  f: typeof fetch,
  token: string,
  id: number,
): Promise<StravaActivity | null> {
  const res = await call(f, `${API}/activities/${id}`, auth(token));
  if (res.status === 404 || res.status === 403) return null;
  return json<StravaActivity>(res, 'Activity');
}

/** Make sure this app has a webhook subscription pointing at `callbackUrl`. */
export async function ensureSubscription(
  app: StravaApp,
  callbackUrl: string,
  verifyToken: string,
): Promise<'exists' | 'created'> {
  const f = app.fetch ?? fetch;
  const q = new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret });
  const existing = await json<{ id: number; callback_url: string }[]>(
    await call(f, `${API}/push_subscriptions?${q}`),
    'Subscription list',
  );
  if (existing.some((s) => s.callback_url === callbackUrl)) return 'exists';
  // Strava allows one subscription per app: replace one that points elsewhere.
  for (const s of existing) {
    await call(f, `${API}/push_subscriptions/${s.id}?${q}`, { method: 'DELETE' });
  }
  await json(
    await call(
      f,
      `${API}/push_subscriptions`,
      form({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        callback_url: callbackUrl,
        verify_token: verifyToken,
      }),
    ),
    'Subscription',
  );
  return 'created';
}
