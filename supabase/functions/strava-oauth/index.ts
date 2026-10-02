// Strava connection for the Habits app.
//
//   POST /strava-oauth/connect     { returnTo }   (owner's session)  → { url } to send the browser to
//   GET  /strava-oauth/callback    ?code&state&scope                 → back to returnTo?strava=<outcome>
//   POST /strava-oauth/sync        { from }       (owner's session)  → refetch from…today if stale
//   POST /strava-oauth/disconnect  { sourceId }   (owner's session)  → revoke and delete its data
//
// verify_jwt = false (supabase/config.toml): Strava's redirect to /callback carries no session, so
// the other routes check the owner's JWT themselves.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { STRAVA_SCOPE, hasScope, safeReturnTo, withOutcome } from '../_shared/connectors/strava.ts';
import { isDateKey, corsHeaders, bearer } from '../_shared/ingest.ts';
import {
  RateLimited,
  authorizeUrl,
  ensureSubscription,
  exchangeCode,
} from '../_shared/strava-api.ts';
import {
  accountsForOwner,
  forgetAccount,
  stravaApp,
  syncAccount,
  type StravaAccount,
} from '../_shared/strava-store.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const APP_ORIGINS = (
  Deno.env.get('HABITS_APP_ORIGINS') ??
  'https://timtruty.com,http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173'
)
  .split(',')
  .map((s) => s.trim());
const CALLBACK = `${SUPABASE_URL}/functions/v1/strava-oauth/callback`;
const WEBHOOK = `${SUPABASE_URL}/functions/v1/strava-webhook`;
/** History fetched straight after connecting. */
const BACKFILL_DAYS = 60;

const db = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
const background = (p: Promise<unknown>) =>
  EdgeRuntime.waitUntil(p.catch((e) => console.error('strava background task failed', e)));

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
  const route = new URL(req.url).pathname.split('/').filter(Boolean).pop();
  const cors = corsHeaders(req.headers.get('origin'), APP_ORIGINS);
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const app = stravaApp();

  if (route === 'callback' && req.method === 'GET') return callback(new URL(req.url).searchParams);
  if (req.method !== 'POST') return reply(405, { error: 'Not found' });

  // Owner routes: the caller's Supabase session.
  const jwt = bearer(req.headers.get('authorization'));
  const { data: auth } = jwt ? await db.auth.getUser(jwt) : { data: { user: null } };
  const owner = auth.user?.id;
  if (!owner) return reply(401, { error: 'Sign in first' });
  const body = await req.json().catch(() => ({}));

  if (route === 'connect') {
    if (!app.clientId || !app.clientSecret) {
      return reply(503, { error: "Strava isn't set up on the server yet" });
    }
    const returnTo = safeReturnTo(body.returnTo, APP_ORIGINS);
    if (!returnTo) return reply(400, { error: 'returnTo must be the Habits app' });

    const { data: existing } = await db
      .from('sources')
      .select('id')
      .eq('owner_id', owner)
      .eq('kind', 'strava')
      .limit(1)
      .maybeSingle();
    let sourceId = existing?.id as string | undefined;
    if (!sourceId) {
      const { data: created, error } = await db
        .from('sources')
        .insert({ owner_id: owner, kind: 'strava', label: 'Strava', config: { connected: false } })
        .select('id')
        .single();
      if (error) return reply(500, { error: 'Could not create the source' });
      sourceId = created.id;
    }
    const state = randomState();
    await db
      .from('oauth_states')
      .insert({ state, owner_id: owner, source_id: sourceId, return_to: returnTo });
    return reply(200, { url: authorizeUrl(app, CALLBACK, state, STRAVA_SCOPE), sourceId });
  }

  if (route === 'sync') {
    const from = isDateKey(body.from) ? body.from : daysAgo(BACKFILL_DAYS);
    const results: Record<string, string> = {};
    for (const account of await accountsForOwner(db, owner)) {
      try {
        results[account.source_id] = await syncAccount(db, app, account, from);
      } catch (e) {
        results[account.source_id] = e instanceof RateLimited ? 'rate-limited' : 'failed';
        if (!(e instanceof RateLimited)) console.error('strava sync failed', e);
      }
    }
    return reply(200, { results });
  }

  if (route === 'disconnect') {
    const account = (await accountsForOwner(db, owner)).find((a) => a.source_id === body.sourceId);
    if (!account) return reply(404, { error: 'Not connected' });
    await forgetAccount(db, account, { revokeAtStrava: true });
    return reply(200, { ok: true });
  }

  return reply(404, { error: 'Not found' });
});

async function callback(params: URLSearchParams): Promise<Response> {
  const app = stravaApp();
  const state = params.get('state') ?? '';
  const { data: pending } = await db
    .from('oauth_states')
    .delete()
    .eq('state', state)
    .gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString())
    .select('owner_id, source_id, return_to')
    .maybeSingle();
  if (!pending) return page('This link has expired. Go back to Habits and connect Strava again.');

  const back = (outcome: string) =>
    Response.redirect(withOutcome(pending.return_to as string, outcome), 303);
  if (params.get('error')) return back('denied');
  if (!hasScope(params.get('scope'))) return back('missing-scope');

  let tokens;
  try {
    tokens = await exchangeCode(app, params.get('code') ?? '');
  } catch (e) {
    console.error('strava code exchange failed', e);
    return back('failed');
  }
  const athleteId = tokens.athlete?.id;
  if (!athleteId) return back('failed');

  // One Habits source per Strava athlete: drop any other source's link to this athlete.
  const { data: others } = await db
    .from('strava_accounts')
    .select('source_id')
    .eq('athlete_id', athleteId)
    .neq('source_id', pending.source_id);
  for (const o of others ?? []) {
    await db.from('events').delete().eq('source_id', o.source_id);
    await db.from('strava_accounts').delete().eq('source_id', o.source_id);
  }

  const account: StravaAccount = {
    source_id: pending.source_id as string,
    owner_id: pending.owner_id as string,
    athlete_id: athleteId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: new Date(tokens.expires_at * 1000).toISOString(),
    synced_from: null,
    synced_at: null,
  };
  const { error } = await db
    .from('strava_accounts')
    .upsert({ ...account, scope: params.get('scope') ?? '' }, { onConflict: 'source_id' });
  if (error) {
    console.error('saving strava account failed', error);
    return back('failed');
  }
  await db
    .from('sources')
    .update({ config: { connected: true, athleteName: tokens.athlete?.firstname ?? null } })
    .eq('id', account.source_id);

  background(
    (async () => {
      await ensureSubscription(app, WEBHOOK, Deno.env.get('STRAVA_VERIFY_TOKEN') ?? '');
      await syncAccount(db, app, account, daysAgo(BACKFILL_DAYS));
    })(),
  );
  return back('connected');
}
