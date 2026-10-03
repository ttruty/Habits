import {
  APPLI_ACTIVITY,
  WITHINGS_SCOPE,
  normalizeSteps,
  normalizeWorkout,
  parseNotification,
  withings,
} from '../connectors/withings.ts';
import {
  WITHINGS_AUTHORIZE,
  getActivity,
  getWorkouts,
  requestToken,
  subscribe,
  unsubscribe,
  type WithingsTokenBody,
} from '../withings-api.ts';
import type { OAuthProvider, Tokens } from './types.ts';

function tokens(b: WithingsTokenBody): Tokens {
  return {
    accessToken: b.access_token,
    refreshToken: b.refresh_token,
    expiresAt: new Date(Date.now() + b.expires_in * 1000),
    userId: String(b.userid),
    scope: b.scope ?? '',
  };
}

export const withingsProvider: OAuthProvider = {
  connector: withings,
  displayName: 'Withings',

  authorizeUrl(app, redirectUri, state) {
    const u = new URL(WITHINGS_AUTHORIZE);
    u.search = new URLSearchParams({
      response_type: 'code',
      client_id: app.clientId,
      scope: WITHINGS_SCOPE,
      redirect_uri: redirectUri,
      state,
    }).toString();
    return u.href;
  },

  // Withings reports the granted scope in the token reply, not the callback: before the exchange
  // (no tokens yet) there's nothing to check.
  scopeGranted: (_callback, t) =>
    !t ||
    (t.scope ?? '')
      .split(',')
      .map((s) => s.trim())
      .includes(WITHINGS_SCOPE),

  exchangeCode: async (app, code, redirectUri) =>
    tokens(
      await requestToken(app.fetch, {
        client_id: app.clientId,
        client_secret: app.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    ),

  // Each refresh returns a new refresh token; the old one stops working (store.ts saves both).
  refresh: async (app, refreshToken) =>
    tokens(
      await requestToken(app.fetch, {
        client_id: app.clientId,
        client_secret: app.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    ),

  async fetchRange(app, token, from, to) {
    // One after the other: Withings asks partners to go easy on its API.
    const days = await getActivity(app.fetch, token, from, to);
    const workouts = await getWorkouts(app.fetch, token, from, to);
    return [
      ...normalizeSteps(days),
      ...workouts.map(normalizeWorkout).filter((e) => e.localDate >= from && e.localDate <= to),
    ];
  },

  subscribe: (app, token, webhookUrl) => subscribe(app.fetch, token, webhookUrl, APPLI_ACTIVITY),
  // Withings has no token revocation endpoint for apps; stopping notifications is what we can do.
  // The user can remove the app in their Withings account too.
  release: (app, token, webhookUrl) => unsubscribe(app.fetch, token, webhookUrl, APPLI_ACTIVITY),

  async webhook(req) {
    // Withings checks the callback URL with a HEAD request before subscribing.
    if (req.method !== 'POST') return { response: new Response(null, { status: 200 }), hints: [] };
    const form = new URLSearchParams(await req.text().catch(() => ''));
    const hint = parseNotification(form);
    return { response: new Response('ok'), hints: hint ? [hint] : [] };
  },
};
