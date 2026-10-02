// Strava webhook (https://developers.strava.com/docs/webhooks/).
//
//   GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…  → { "hub.challenge": … }
//   POST { object_type, object_id, aspect_type, owner_id, updates } → 200 at once, then work
//
// Strava doesn't sign webhooks, so a POST is only ever a hint: the activity is refetched from
// Strava with our token, stored if Strava returns it and removed if not. A forged POST can at most
// make us refetch. Deauthorization deletes the account and every cached activity.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { parseWebhook, webhookChallenge } from '../_shared/connectors/strava.ts';
import {
  accountByAthlete,
  forgetAccount,
  refreshActivity,
  stravaApp,
} from '../_shared/strava-store.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

async function handle(body: unknown): Promise<void> {
  const action = parseWebhook(body);
  if (action.kind === 'ignore') return;
  const account = await accountByAthlete(db, action.athleteId);
  if (!account) return;
  if (action.kind === 'deauthorize') {
    await forgetAccount(db, account, { revokeAtStrava: false });
  } else {
    await refreshActivity(db, stravaApp(), account, action.activityId);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'GET') {
    const challenge = webhookChallenge(
      new URL(req.url).searchParams,
      Deno.env.get('STRAVA_VERIFY_TOKEN') ?? '',
    );
    return challenge === null
      ? new Response('Forbidden', { status: 403 })
      : Response.json({ 'hub.challenge': challenge });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const body = await req.json().catch(() => null);
  // Strava wants an answer within 2 seconds; the work happens after.
  EdgeRuntime.waitUntil(handle(body).catch((e) => console.error('strava webhook failed', e)));
  return new Response('ok');
});
