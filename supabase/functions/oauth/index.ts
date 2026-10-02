// Connecting OAuth sources (Strava, Withings) for the Habits app.
//
//   POST /oauth/<kind>/connect     { returnTo }  (owner's session) → { url } to send the browser to
//   GET  /oauth/<kind>/callback    ?code&state…                    → returnTo?oauth=<kind>:<outcome>
//   POST /oauth/<kind>/sync        { from }      (owner's session) → refetch from…today if stale
//   POST /oauth/<kind>/disconnect  { sourceId }  (owner's session) → release and delete its data
//
// verify_jwt = false (supabase/config.toml): the provider's redirect to /callback carries no
// session, so the owner routes check the JWT themselves.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { bearer, corsHeaders, isDateKey } from '../_shared/ingest.ts';
import { safeReturnTo, withOutcome } from '../_shared/oauth/pure.ts';
import { oauthApp, oauthProviders } from '../_shared/oauth/registry.ts';
import {
  accountsForOwner,
  forgetAccount,
  saveAccount,
  syncAccount,
} from '../_shared/oauth/store.ts';
import type { OAuthProvider } from '../_shared/oauth/types.ts';
import { RateLimited } from '../_shared/strava-api.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const APP_ORIGINS = (
  Deno.env.get('HABITS_APP_ORIGINS') ??
  'https://timtruty.com,http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173'
)
  .split(',')
  .map((s) => s.trim());
/** History fetched straight after connecting. */
const BACKFILL_DAYS = 60;

export const callbackUrl = (kind: string) => `${SUPABASE_URL}/functions/v1/oauth/${kind}/callback`;
export const webhookUrl = (kind: string) => `${SUPABASE_URL}/functions/v1/oauth-webhook/${kind}`;

const db = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
const background = (label: string, p: Promise<unknown>) =>
  EdgeRuntime.waitUntil(p.catch((e) => console.error(`${label} failed`, e)));

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '');
}

function page(message: string, status = 400): Response {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Habits</title><p style="font:16px system-ui;margin:2rem">${message}</p>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

Deno.serve(async (req) => {
  // …/oauth/<kind>/<action>
  const [kind, action] = new URL(req.url).pathname.split('/').filter(Boolean).slice(-2);
  const provider = oauthProviders[kind];
  const cors = corsHeaders(req.headers.get('origin'), APP_ORIGINS);
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!provider) return reply(404, { error: 'Unknown source' });
  if (action === 'callback') {
    const params = new URL(req.url).searchParams;
    // Providers check that the redirect URL is reachable before accepting it (Withings' portal
    // sends a HEAD, or a GET with no parameters). Answer those with 200; only a real callback
    // carries state.
    if (req.method === 'HEAD') return new Response(null, { status: 200 });
    if (
      req.method === 'GET' &&
      !params.has('state') &&
      !params.has('code') &&
      !params.has('error')
    ) {
      return page('Habits receives sign-ins here. Connect from Habits → Sources.', 200);
    }
    if (req.method === 'GET') return callback(kind, provider, params);
  }
  if (req.method !== 'POST') return reply(405, { error: 'Not found' });

  // Owner routes: the caller's Supabase session.
  const jwt = bearer(req.headers.get('authorization'));
  const { data: auth } = jwt ? await db.auth.getUser(jwt) : { data: { user: null } };
  const owner = auth.user?.id;
  if (!owner) return reply(401, { error: 'Sign in first' });
  const body = await req.json().catch(() => ({}));
  const app = oauthApp(kind);
  const mine = async () => (await accountsForOwner(db, owner)).filter((a) => a.kind === kind);

  if (action === 'connect') {
    if (!app.clientId || !app.clientSecret) {
      return reply(503, { error: `${provider.displayName} isn't set up on the server yet` });
    }
    const returnTo = safeReturnTo(body.returnTo, APP_ORIGINS);
    if (!returnTo) return reply(400, { error: 'returnTo must be the Habits app' });

    const { data: existing } = await db
      .from('sources')
      .select('id')
      .eq('owner_id', owner)
      .eq('kind', kind)
      .limit(1)
      .maybeSingle();
    let sourceId = existing?.id as string | undefined;
    if (!sourceId) {
      const { data: created, error } = await db
        .from('sources')
        .insert({
          owner_id: owner,
          kind,
          label: provider.displayName,
          config: { connected: false },
        })
        .select('id')
        .single();
      if (error) return reply(500, { error: 'Could not create the source' });
      sourceId = created.id;
    }
    const state = randomState();
    await db
      .from('oauth_states')
      .insert({ state, owner_id: owner, source_id: sourceId, return_to: returnTo });
    return reply(200, { url: provider.authorizeUrl(app, callbackUrl(kind), state), sourceId });
  }

  if (action === 'sync') {
    const from = isDateKey(body.from) ? body.from : daysAgo(BACKFILL_DAYS);
    const results: Record<string, string> = {};
    for (const account of await mine()) {
      try {
        results[account.source_id] = await syncAccount(db, provider, app, account, from);
      } catch (e) {
        results[account.source_id] = e instanceof RateLimited ? 'rate-limited' : 'failed';
        if (!(e instanceof RateLimited)) console.error(`${kind} sync failed`, e);
      }
    }
    return reply(200, { results });
  }

  if (action === 'disconnect') {
    const account = (await mine()).find((a) => a.source_id === body.sourceId);
    if (!account) return reply(404, { error: 'Not connected' });
    await forgetAccount(db, provider, app, account, webhookUrl(kind), { releaseAtProvider: true });
    return reply(200, { ok: true });
  }

  return reply(404, { error: 'Not found' });
});

async function callback(kind: string, provider: OAuthProvider, params: URLSearchParams) {
  const app = oauthApp(kind);
  const { data: pending } = await db
    .from('oauth_states')
    .delete()
    .eq('state', params.get('state') ?? '')
    .gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString())
    .select('owner_id, source_id, return_to')
    .maybeSingle();
  if (!pending) {
    return page(
      `This link has expired. Go back to Habits and connect ${provider.displayName} again.`,
    );
  }
  const back = (outcome: string) =>
    Response.redirect(withOutcome(pending.return_to as string, kind, outcome), 303);
  if (params.get('error')) return back('denied');
  if (!provider.scopeGranted(params)) return back('missing-scope');

  let tokens;
  try {
    tokens = await provider.exchangeCode(app, params.get('code') ?? '', callbackUrl(kind));
  } catch (e) {
    console.error(`${kind} code exchange failed`, e);
    return back('failed');
  }
  if (!tokens.userId) return back('failed');
  if (!provider.scopeGranted(params, tokens)) return back('missing-scope');

  let account;
  try {
    account = await saveAccount(
      db,
      kind,
      pending.source_id as string,
      pending.owner_id as string,
      tokens,
    );
  } catch (e) {
    console.error(e);
    return back('failed');
  }
  background(
    `${kind} webhook subscription`,
    provider.subscribe(app, tokens.accessToken, webhookUrl(kind)),
  );
  background(`${kind} backfill`, syncAccount(db, provider, app, account, daysAgo(BACKFILL_DAYS)));
  return back('connected');
}
