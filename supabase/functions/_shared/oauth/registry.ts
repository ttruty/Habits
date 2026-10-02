import { stravaProvider } from './strava.ts';
import type { OAuthApp, OAuthProvider } from './types.ts';
import { withingsProvider } from './withings.ts';

/** Every OAuth provider, by connector kind. One provider file + one line here per source. */
export const oauthProviders: Record<string, OAuthProvider> = {
  strava: stravaProvider,
  withings: withingsProvider,
};

/** The app's credentials for a provider, from function secrets <KIND>_CLIENT_ID / _SECRET. */
export function oauthApp(kind: string, f: typeof fetch = fetch): OAuthApp {
  const prefix = kind.toUpperCase();
  return {
    clientId: Deno.env.get(`${prefix}_CLIENT_ID`) ?? '',
    clientSecret: Deno.env.get(`${prefix}_CLIENT_SECRET`) ?? '',
    fetch: f,
  };
}
