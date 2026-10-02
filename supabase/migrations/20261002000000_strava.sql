-- Strava (Phase 5). Strava's API Policy §6.2 allows caching Strava data for at most 7 days, so
-- Strava events are a cache: each row gets expires_at, a daily job deletes expired rows, and the
-- app refetches a range from Strava when it's viewed (strava-oauth/sync).

-- Events from sources with a retention limit expire; everyone else's rows keep expires_at null.
alter table public.events add column expires_at timestamptz;
create index events_expires_at on public.events (expires_at) where expires_at is not null;

-- Strava credentials: server-only. RLS is on with no policies, and the browser roles have no
-- grants, so only Edge Functions (service role) can read or write them.
create table public.strava_accounts (
  source_id uuid primary key references public.sources on delete cascade,
  owner_id uuid not null references auth.users on delete cascade,
  athlete_id bigint not null unique,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text not null,
  -- The window last fetched from Strava, and when: a view inside it within a few hours is a no-op.
  synced_from date,
  synced_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.strava_accounts enable row level security;
revoke all on public.strava_accounts from anon, authenticated;

-- OAuth state for the connect round trip (10-minute life). Server-only, like the above.
create table public.oauth_states (
  state text primary key,
  owner_id uuid not null references auth.users on delete cascade,
  source_id uuid not null references public.sources on delete cascade,
  return_to text not null,
  created_at timestamptz not null default now()
);
alter table public.oauth_states enable row level security;
revoke all on public.oauth_states from anon, authenticated;

-- Daily purge of expired cache rows and stale OAuth states.
create extension if not exists pg_cron;
select cron.schedule(
  'purge-expired-events',
  '17 3 * * *',
  $$
    delete from public.events where expires_at < now();
    delete from public.oauth_states where created_at < now() - interval '1 day';
  $$
);
