import {
  STRAVA_SCOPE,
  hasScope,
  normalizeActivity,
  parseWebhook,
  strava,
  webhookChallenge,
} from '../connectors/strava.ts';
import {
  authorizeUrl,
  deauthorize,
  ensureSubscription,
  exchangeCode,
  getActivity,
  listActivities,
  refreshTokens,
  type TokenSet,
} from '../strava-api.ts';
import type { OAuthApp, OAuthProvider, Tokens } from './types.ts';

const verifyToken = () => Deno.env.get('STRAVA_VERIFY_TOKEN') ?? '';

function tokens(t: TokenSet, fallbackUserId = ''): Tokens {
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: new Date(t.expires_at * 1000),
    userId: t.athlete?.id ? String(t.athlete.id) : fallbackUserId,
    displayName: t.athlete?.firstname ?? null,
  };
}

const strava_app = (app: OAuthApp) => ({
  clientId: app.clientId,
  clientSecret: app.clientSecret,
  fetch: app.fetch,
});

export const stravaProvider: OAuthProvider = {
  connector: strava,
  displayName: 'Strava',

  authorizeUrl: (app, redirectUri, state) =>
    authorizeUrl(strava_app(app), redirectUri, state, STRAVA_SCOPE),
  scopeGranted: (callback) => hasScope(callback.get('scope')),
  exchangeCode: async (app, code) => tokens(await exchangeCode(strava_app(app), code)),
  refresh: async (app, refreshToken) => tokens(await refreshTokens(strava_app(app), refreshToken)),

  async fetchRange(app, token, from, to) {
    // Strava filters by UTC; local days can start up to 14 hours earlier, so start a day early.
    const after = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000) - 86_400;
    const activities = await listActivities(app.fetch, token, after);
    return activities
      .map(normalizeActivity)
      .filter((e) => e.localDate >= from && e.localDate <= to);
  },

  async fetchItem(app, token, itemId) {
    const activity = await getActivity(app.fetch, token, Number(itemId));
    return activity ? normalizeActivity(activity) : null;
  },

  // One subscription per Strava app (not per athlete).
  subscribe: async (app, _token, webhookUrl) => {
    await ensureSubscription(strava_app(app), webhookUrl, verifyToken());
  },
  release: (app, token) => deauthorize(app.fetch, token),

  async webhook(req) {
    if (req.method === 'GET') {
      const challenge = webhookChallenge(new URL(req.url).searchParams, verifyToken());
      return {
        response:
          challenge === null
            ? new Response('Forbidden', { status: 403 })
            : Response.json({ 'hub.challenge': challenge }),
        hints: [],
      };
    }
    const hint = parseWebhook(await req.json().catch(() => null));
    return { response: new Response('ok'), hints: hint ? [hint] : [] };
  },
};
