-- One table for every OAuth source (Strava, Withings, …) instead of one per provider.
-- strava_accounts was created empty in the previous migration and never used, so it's dropped.

drop table public.strava_accounts;

create table public.oauth_accounts (
  source_id uuid primary key references public.sources on delete cascade,
  owner_id uuid not null references auth.users on delete cascade,
  -- The connector kind ('strava', 'withings').
  kind text not null,
  -- The provider's id for the user (Strava athlete id, Withings userid), as text.
  external_user_id text not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text not null default '',
  -- The window last fetched from the provider, and when: a view inside it soon after is a no-op.
  synced_from date,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (kind, external_user_id)
);

-- Server-only: RLS on, no policies, no grants to browser roles.
alter table public.oauth_accounts enable row level security;
revoke all on public.oauth_accounts from anon, authenticated;
