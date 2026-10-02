// OAuth accounts and their events, for the oauth and oauth-webhook functions (service role).
// Deno-only (excluded from the browser tsconfig); exercised end to end, not by Vitest.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { toRow, type IngestEvent } from '../ingest.ts';
import { expiresAt, syncWindow } from './pure.ts';
import type { OAuthApp, OAuthProvider, Tokens, WebhookHint } from './types.ts';

export interface OAuthAccount {
  source_id: string;
  owner_id: string;
  kind: string;
  external_user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  synced_from: string | null;
  synced_at: string | null;
}

const COLUMNS =
  'source_id, owner_id, kind, external_user_id, access_token, refresh_token, expires_at, synced_from, synced_at';

const today = () => new Date().toISOString().slice(0, 10);

export async function accountsForOwner(db: SupabaseClient, ownerId: string) {
  const { data } = await db.from('oauth_accounts').select(COLUMNS).eq('owner_id', ownerId);
  return (data ?? []) as OAuthAccount[];
}

export async function accountByUser(db: SupabaseClient, kind: string, userId: string) {
  const { data } = await db
    .from('oauth_accounts')
    .select(COLUMNS)
    .eq('kind', kind)
    .eq('external_user_id', userId)
    .maybeSingle();
  return data as OAuthAccount | null;
}

/** Save tokens for a source, taking over any other source linked to the same provider user. */
export async function saveAccount(
  db: SupabaseClient,
  kind: string,
  sourceId: string,
  ownerId: string,
  t: Tokens,
): Promise<OAuthAccount> {
  const { data: others } = await db
    .from('oauth_accounts')
    .select('source_id')
    .eq('kind', kind)
    .eq('external_user_id', t.userId)
    .neq('source_id', sourceId);
  for (const o of others ?? []) {
    await db.from('events').delete().eq('source_id', o.source_id);
    await db.from('oauth_accounts').delete().eq('source_id', o.source_id);
  }
  const account: OAuthAccount = {
    source_id: sourceId,
    owner_id: ownerId,
    kind,
    external_user_id: t.userId,
    access_token: t.accessToken,
    refresh_token: t.refreshToken,
    expires_at: t.expiresAt.toISOString(),
    synced_from: null,
    synced_at: null,
  };
  const { error } = await db
    .from('oauth_accounts')
    .upsert({ ...account, scope: t.scope ?? '' }, { onConflict: 'source_id' });
  if (error) throw new Error(`Saving the account failed: ${error.message}`);
  await db
    .from('sources')
    .update({ config: { connected: true, athleteName: t.displayName ?? null } })
    .eq('id', sourceId);
  return account;
}

/** A usable access token, refreshing (and storing the new pair) when it's about to expire. */
export async function accessToken(
  db: SupabaseClient,
  provider: OAuthProvider,
  app: OAuthApp,
  account: OAuthAccount,
): Promise<string> {
  if (Date.parse(account.expires_at) - Date.now() > 60_000) return account.access_token;
  const t = await provider.refresh(app, account.refresh_token);
  account.access_token = t.accessToken;
  account.refresh_token = t.refreshToken;
  account.expires_at = t.expiresAt.toISOString();
  await db
    .from('oauth_accounts')
    .update({
      access_token: account.access_token,
      refresh_token: account.refresh_token,
      expires_at: account.expires_at,
    })
    .eq('source_id', account.source_id);
  return account.access_token;
}

async function store(
  db: SupabaseClient,
  provider: OAuthProvider,
  account: OAuthAccount,
  events: IngestEvent[],
) {
  if (!events.length) return;
  const days = provider.connector.cacheDays;
  const expires = days ? expiresAt(new Date(), days) : undefined;
  const rows = events.map((e) => toRow(e, account.owner_id, account.source_id, expires));
  const { error } = await db.from('events').upsert(rows, {
    onConflict: 'source_id,external_id',
    ignoreDuplicates: provider.connector.onConflict === 'ignore',
  });
  if (error) throw new Error(`Saving events failed: ${error.message}`);
}

/** Store what the provider has for from…to, and drop rows in that span it no longer has. */
async function reconcile(
  db: SupabaseClient,
  provider: OAuthProvider,
  account: OAuthAccount,
  events: IngestEvent[],
  from: string,
  to: string,
) {
  await store(db, provider, account, events);
  const keep = new Set(events.map((e) => e.externalId));
  const { data: cached } = await db
    .from('events')
    .select('id, external_id')
    .eq('source_id', account.source_id)
    .gte('local_date', from)
    .lte('local_date', to);
  const gone = (cached ?? []).filter((r) => !keep.has(r.external_id as string)).map((r) => r.id);
  if (gone.length) await db.from('events').delete().in('id', gone);
}

/** Refetch `from`…today unless the last fetch already covers it and is recent. */
export async function syncAccount(
  db: SupabaseClient,
  provider: OAuthProvider,
  app: OAuthApp,
  account: OAuthAccount,
  from: string,
): Promise<'fresh' | 'fetched'> {
  const start = syncWindow(from, account, new Date());
  if (!start) return 'fresh';
  const token = await accessToken(db, provider, app, account);
  const to = today();
  await reconcile(
    db,
    provider,
    account,
    await provider.fetchRange(app, token, start, to),
    start,
    to,
  );
  await db
    .from('oauth_accounts')
    .update({ synced_from: start, synced_at: new Date().toISOString() })
    .eq('source_id', account.source_id);
  return 'fetched';
}

/** Act on a webhook hint: refetch what it points at. Nothing in the hint is trusted as data. */
export async function applyHint(
  db: SupabaseClient,
  provider: OAuthProvider,
  app: OAuthApp,
  webhookUrl: string,
  hint: WebhookHint,
): Promise<void> {
  const account = await accountByUser(db, provider.connector.kind, hint.userId);
  if (!account) return;
  if (hint.kind === 'deauthorize') {
    await forgetAccount(db, provider, app, account, webhookUrl, { releaseAtProvider: false });
    return;
  }
  const token = await accessToken(db, provider, app, account);
  if (hint.kind === 'range') {
    const to = hint.to < today() ? hint.to : today();
    await reconcile(
      db,
      provider,
      account,
      await provider.fetchRange(app, token, hint.from, to),
      hint.from,
      to,
    );
    return;
  }
  const event = provider.fetchItem ? await provider.fetchItem(app, token, hint.itemId) : null;
  if (event) await store(db, provider, account, [event]);
  else {
    await db
      .from('events')
      .delete()
      .eq('source_id', account.source_id)
      .eq('external_id', hint.itemId);
  }
}

/**
 * Disconnect: release at the provider (unless it told us), then delete the tokens and every event
 * from the source. Strava's agreement requires deleting its data when access ends; Withings data
 * goes too, since nothing new can arrive.
 */
export async function forgetAccount(
  db: SupabaseClient,
  provider: OAuthProvider,
  app: OAuthApp,
  account: OAuthAccount,
  webhookUrl: string,
  opts: { releaseAtProvider: boolean },
): Promise<void> {
  if (opts.releaseAtProvider) {
    const token = await accessToken(db, provider, app, account).catch(() => account.access_token);
    await provider
      .release(app, token, webhookUrl)
      .catch((e) => console.error(`${account.kind}: release failed`, e));
  }
  await db.from('events').delete().eq('source_id', account.source_id);
  await db.from('oauth_accounts').delete().eq('source_id', account.source_id);
  await db
    .from('sources')
    .update({ config: { connected: false } })
    .eq('id', account.source_id);
}
