-- Habits: sources, events, habits, ingest and share tokens.
--
-- Single user. Every row carries owner_id, and RLS lets a signed-in user touch only their own
-- rows. Sign-ups are disabled (config.toml), so the owner is the only account there is.
-- The database stores events, never scores: scoring happens in src/scoring.

-- Sources: one row per connected account or app install.
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null,
  label text not null,
  config jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index sources_owner on public.sources (owner_id);

-- Events: facts reported by a source. A source may resend freely; (source_id, external_id) makes
-- that a no-op.
create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  source_id uuid not null references public.sources on delete cascade,
  external_id text not null,
  type text not null,
  occurred_at timestamptz not null,
  -- The user's local day when it happened. Scoring uses this only.
  local_date date not null,
  value double precision,
  unit text check (unit in ('count', 'seconds', 'meters', 'pages', 'percent')),
  meta jsonb,
  created_at timestamptz not null default now(),
  unique (source_id, external_id)
);
create index events_owner_local_date on public.events (owner_id, local_date);

-- Habits: what I'm trying to do. match / rule / target are the JSON shapes in src/model.ts.
create table public.habits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (length(name) between 1 and 80),
  icon text not null default '',
  color text not null,
  match jsonb not null,
  rule jsonb not null,
  target jsonb not null,
  start_date date,
  archived_at timestamptz,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create index habits_owner on public.habits (owner_id);

-- Ingest tokens: one per source, revocable on its own. Only the SHA-256 hash is stored; the token
-- is shown once when created. The browser can write a hash but never read one back.
create table public.ingest_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  source_id uuid not null references public.sources on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index ingest_tokens_source on public.ingest_tokens (source_id);

-- Share tokens: read one scorecard's computed grid (the embed). Hash only, as above.
create table public.share_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  token_hash text not null unique,
  label text not null default '',
  options jsonb not null default '{}',
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index share_tokens_owner on public.share_tokens (owner_id);

-- Row Level Security --------------------------------------------------------------------------

alter table public.sources enable row level security;
alter table public.events enable row level security;
alter table public.habits enable row level security;
alter table public.ingest_tokens enable row level security;
alter table public.share_tokens enable row level security;

-- Nothing is readable or writable without signing in. Edge Functions use the service role,
-- which bypasses RLS.
revoke all on public.sources, public.events, public.habits, public.ingest_tokens,
  public.share_tokens from anon;

create policy "own sources" on public.sources for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "own habits" on public.habits for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- An event must also point at one of my own sources.
create policy "own events" on public.events for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.sources s
      where s.id = source_id and s.owner_id = (select auth.uid())
    )
  );

create policy "own ingest tokens" on public.ingest_tokens for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.sources s
      where s.id = source_id and s.owner_id = (select auth.uid())
    )
  );

create policy "own share tokens" on public.share_tokens for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Token hashes: insert yes, read or change no.
revoke select, update on public.ingest_tokens, public.share_tokens from authenticated;
grant select (id, owner_id, source_id, created_at, last_used_at, revoked_at)
  on public.ingest_tokens to authenticated;
grant update (revoked_at) on public.ingest_tokens to authenticated;
grant select (id, owner_id, label, options, created_at, revoked_at)
  on public.share_tokens to authenticated;
grant update (label, options, revoked_at) on public.share_tokens to authenticated;
