// Strava account and cache operations shared by strava-oauth and strava-webhook (service role).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  expiresAt,
  normalizeActivity,
  syncWindow,
  type StravaActivity,
} from './connectors/strava.ts';
import { toRow } from './ingest.ts';
import {
  deauthorize,
  getActivity,
  listActivities,
  refreshTokens,
  type StravaApp,
} from './strava-api.ts';

export interface StravaAccount {
  source_id: string;
  owner_id: string;
  athlete_id: number;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  synced_from: string | null;
  synced_at: string | null;
}

const ACCOUNT_COLUMNS =
  'source_id, owner_id, athlete_id, access_token, refresh_token, expires_at, synced_from, synced_at';

export function stravaApp(): StravaApp {
  return {
    clientId: Deno.env.get('STRAVA_CLIENT_ID') ?? '',
    clientSecret: Deno.env.get('STRAVA_CLIENT_SECRET') ?? '',
  };
}

export async function accountByAthlete(db: SupabaseClient, athleteId: number) {
  const { data } = await db
    .from('strava_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('athlete_id', athleteId)
    .maybeSingle();
  return data as StravaAccount | null;
}

export async function accountsForOwner(db: SupabaseClient, ownerId: string) {
  const { data } = await db.from('strava_accounts').select(ACCOUNT_COLUMNS).eq('owner_id', ownerId);
  return (data ?? []) as StravaAccount[];
}

/** A usable access token, refreshing it (and storing the new pair) when it's about to expire. */
export async function accessToken(
  db: SupabaseClient,
  app: StravaApp,
  account: StravaAccount,
): Promise<string> {
  if (Date.parse(account.expires_at) - Date.now() > 60_000) return account.access_token;
  const t = await refreshTokens(app, account.refresh_token);
  const expires = new Date(t.expires_at * 1000).toISOString();
  await db
    .from('strava_accounts')
    .update({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: expires })
    .eq('source_id', account.source_id);
  account.access_token = t.access_token;
  account.refresh_token = t.refresh_token;
  account.expires_at = expires;
  return t.access_token;
}

async function store(db: SupabaseClient, account: StravaAccount, activities: StravaActivity[]) {
  if (!activities.length) return;
  const expires = expiresAt(new Date());
  const rows = activities.map((a) =>
    toRow(normalizeActivity(a), account.owner_id, account.source_id, expires),
  );
  const { error } = await db.from('events').upsert(rows, { onConflict: 'source_id,external_id' });
  if (error) throw new Error(`Saving activities failed: ${error.message}`);
}

/**
 * Refetch `from`…now from Strava unless the last fetch already covers it and is recent. Activities
 * gone from Strava (deleted, made unreadable) are removed from the cache for that window.
 */
export async function syncAccount(
  db: SupabaseClient,
  app: StravaApp,
  account: StravaAccount,
  from: string,
  f: typeof fetch = fetch,
): Promise<'fresh' | 'fetched'> {
  const window = syncWindow(from, account, new Date());
  if (!window) return 'fresh';
  const token = await accessToken(db, app, account);
  const activities = await listActivities(f, token, window.after);
  await store(db, account, activities);

  const keep = new Set(activities.map((a) => String(a.id)));
  const { data: cached } = await db
    .from('events')
    .select('id, external_id')
    .eq('source_id', account.source_id)
    .gte('local_date', window.from);
  const gone = (cached ?? []).filter((r) => !keep.has(r.external_id as string)).map((r) => r.id);
  if (gone.length) await db.from('events').delete().in('id', gone);

  await db
    .from('strava_accounts')
    .update({ synced_from: window.from, synced_at: new Date().toISOString() })
    .eq('source_id', account.source_id);
  return 'fetched';
}

/** Webhook: store the activity as Strava has it now, or drop it if Strava no longer returns it. */
export async function refreshActivity(
  db: SupabaseClient,
  app: StravaApp,
  account: StravaAccount,
  activityId: number,
  f: typeof fetch = fetch,
): Promise<'stored' | 'removed'> {
  const token = await accessToken(db, app, account);
  const activity = await getActivity(f, token, activityId);
  if (activity) {
    await store(db, account, [activity]);
    return 'stored';
  }
  await db
    .from('events')
    .delete()
    .eq('source_id', account.source_id)
    .eq('external_id', String(activityId));
  return 'removed';
}

/**
 * Disconnect: tell Strava (unless it told us), then delete the credentials and every cached
 * activity. The API Agreement requires deleting Strava data when access ends.
 */
export async function forgetAccount(
  db: SupabaseClient,
  account: StravaAccount,
  opts: { revokeAtStrava: boolean },
  f: typeof fetch = fetch,
): Promise<void> {
  if (opts.revokeAtStrava) await deauthorize(f, account.access_token);
  await db.from('events').delete().eq('source_id', account.source_id);
  await db.from('strava_accounts').delete().eq('source_id', account.source_id);
  const { data: source } = await db
    .from('sources')
    .select('config')
    .eq('id', account.source_id)
    .maybeSingle();
  await db
    .from('sources')
    .update({ config: { ...((source?.config as object) ?? {}), connected: false } })
    .eq('id', account.source_id);
}
