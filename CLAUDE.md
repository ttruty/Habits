# CLAUDE.md — Habits Scorecard (working title)

Project context for Claude Code. Read this first, every session. The build plan,
with phases and acceptance criteria, is in [`plan.md`](plan.md). Keep both files
current: when a decision changes, update them in the same commit.

> **History note:** this folder once held an earlier, unrelated project
> (_Cogwork_, an Angular habit tracker). Its history was discarded and the repo
> restarted fresh on 2026-10-01. Nothing from it is reused.

---

## What this is

A **read-mostly scorecard**: one small page showing whether I kept up my habits,
built from completions that other apps report. It does not replace those apps.
It only collects their "I did the thing" events and shows them as a grid.

```
              M  T  W  T  F  S  S    week    streak
Workout       ●  ·  ●  ●  ·  ●  ·    4/4 ✓     2
Meditate      ●  ●  ●  ●  ●  ·  ·    5/7       0
Listen 20m    ●  ●  ·  ●  ●  ●  ●    6/7       4
Run (Strava)  ·  ●  ·  ·  ●  ·  ·    2/3       —
Read          ●  ●  ●  ·  ·  ●  ●    5/7       2
```

**Personal tool, one user (me), Android phone.** There are no accounts beyond my
own sign-in, no onboarding and no multi-user features. Phone automations target
Android (Tasker / MacroDroid), not iOS.

It ships two ways from one build:

1. **Standalone web app / PWA** on GitHub Pages (`https://timtruty.com/Habits/`).
2. **Embeddable widget** for other sites, as an `<iframe>` or a
   `<habit-scorecard>` custom element loaded from one script tag.

### Data sources

| Source                                        | Kind                      | What counts as a completion                                                                                |
| --------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **DeckFit** (`../CardWorkout/deckfit`)        | first-party push          | a game `Session` with `endedAt` set                                                                        |
| **MindDrive** (`../MindDrive`)                | first-party push          | a `PlaybackEntry` turning `completed: true` (also a session start, via `StreakService.recordSessionStart`) |
| **Yarnbeard** (`../gdrive-audio-book-player`) | first-party push          | daily listening seconds (`DayStat`); a book's `finishedAt` is a milestone                                  |
| **Strava**                                    | consumer, OAuth + webhook | an activity created, filtered by sport type                                                                |
| **Steam** (Windows PC only)                   | local agent push          | a play session per game, from a Windows script watching Steam's running-game registry value (see below)    |
| **Moon+ Reader**                              | consumer, no API          | Tasker/MacroDroid "app closed" webhook with the session length (spike: parse its cloud-sync files)         |
| **Anything else**                             | generic                   | manual tap, or a POST to the webhook from Tasker, MacroDroid or IFTTT                                      |

**Steam is tracked only on my Windows PC, by a small local agent.** There's no
cloud polling and no Steam Web API key. While Steam runs a game, it writes that
game's app id to the registry value `HKCU\Software\Valve\Steam\RunningAppID`
(it's `0` when nothing is running). A PowerShell script, started at logon by
Task Scheduler, checks that value every 30 seconds and turns each stretch of play
into a `gaming.session` event.

- **Accurate:** real start and end times, split at local midnight. It also works
  offline and doesn't depend on my profile's privacy settings.
- **Its limits:** only Steam games on this PC count, and a game left open in the
  background counts as play time.

Apps **report events**. The scorecard **decides completion**. A source never
says "habit done". It says "45 minutes listened on 2026-10-01", and the habit's
rule turns that into a filled cell or an empty one. Changing a goal from 20 to
30 minutes therefore re-scores history without any source app changing.

---

## Stack

| Layer   | Choice                                                            | Why                                                                                                                                  |
| ------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| UI      | **Lit 3** web components + TypeScript, built with **Vite**        | The widget _is_ a custom element, so the app and the embed are the same code. ~6 KB runtime. No framework is pushed onto host pages. |
| Styling | Plain CSS with custom properties, inside Shadow DOM               | Host pages can't break it, and it can't break host pages. Themes are token swaps.                                                    |
| Backend | **Supabase**: Postgres, Row Level Security, Edge Functions (Deno) | DeckFit already uses Supabase. Strava needs a server to hold its client secret and receive webhooks.                                 |
| Hosting | GitHub Pages (static), same workflow pattern as MindDrive         | Matches the other apps.                                                                                                              |
| Tests   | Vitest (unit, including scoring), Playwright (embed smoke test)   | Same tools as the sibling apps.                                                                                                      |

Deliberately **not** Angular. The sibling apps are Angular + Ionic, but this
front end is one grid, and it has to drop into arbitrary sites. Lit is the
lighter fit. Don't add a framework, a router library or a state library. The
app has about three views.

---

## Non-negotiable rules

1. **Local dates, not UTC.** Every event carries `local_date` (`YYYY-MM-DD` in
   the user's time zone at the moment it happened) as well as `occurred_at`
   (UTC). Scoring uses `local_date` only. Strava gives `start_date_local`, so use
   it. This is the #1 source of habit-tracker bugs.
2. **Events are idempotent.** Each has `(source_id, external_id)` unique. Sources
   may resend freely (offline queues, webhook retries, backfills), and duplicates
   are no-ops.
3. **Sources stay dumb, rules stay here.** Never put thresholds or "done"
   logic in a source app. Report facts (count, seconds, distance) and score in
   `src/scoring/`.
4. **Adding a source is one connector file plus one registry entry.** No UI or
   scoring change should be needed to add Goodreads, Duolingo or anything else.
   If it is, the abstraction is wrong. Fix the abstraction.
5. **Opt-in and private by default in the source apps.** DeckFit, MindDrive and
   Yarnbeard currently promise that nothing leaves the device (see Yarnbeard's
   `PRIVACY.md`). Reporting to Habits must stay **off until the user pastes an
   ingest URL and token in that app's settings**, and each app's privacy text
   must be updated in the same change.
6. **Secrets never reach the browser bundle.** The Strava client secret, the
   Supabase service-role key and ingest-token hashes live only in Edge Function
   secrets. The front end ships only the Supabase URL and anon key.
7. **The embed is read-only.** A widget renders from a _share token_ that can
   read one scorecard's computed grid and nothing else: no raw events, no notes,
   no titles unless the owner opts in.
8. **Respect connector terms.** Strava's API agreement requires attribution
   ("Powered by Strava") wherever Strava data shows, and forbids showing one
   athlete's data to others without consent. The widget shows only the owner's
   own data, so it is fine. Strava's API Policy §6.2 also caps caching its data
   at **7 days**: Strava events are a cache (`events.expires_at`, purged daily
   by `pg_cron`) and are refetched from Strava when a range is viewed. Never
   keep Strava data longer, and delete all of it when the athlete disconnects
   or deauthorizes.

---

## Core model

```ts
/** A place events come from. One row per connected account or app install. */
interface Source {
  id: string; // uuid
  kind: ConnectorKind; // 'deckfit' | 'minddrive' | 'yarnbeard' | 'strava' | 'webhook' | 'manual' | …
  label: string; // "DeckFit (phone)"
  config: Record<string, unknown>; // connector-specific, non-secret
  createdAt: string;
}

/** A fact reported by a source. Append-only. */
interface HabitEvent {
  id: string;
  sourceId: string;
  externalId: string; // idempotency key from the source (session id, activity id, …)
  type: string; // 'workout.completed' | 'meditation.completed' | 'listening.day' | 'activity.created' | 'check-in'
  occurredAt: string; // ISO UTC
  localDate: string; // 'YYYY-MM-DD', the user's local day
  value?: number; // seconds, reps, km, sessions… meaning set by `unit`
  unit?: 'count' | 'seconds' | 'meters' | 'pages' | 'percent';
  meta?: Record<string, unknown>; // title, sport_type, deck name… never required for scoring
}

/** What I'm trying to do. Turns events into daily done / not-done. */
interface Habit {
  id: string;
  name: string; // "Listen 20m"
  icon: string; // emoji or icon key
  color: string; // token name, not a hex value
  match: { sourceIds?: string[]; types: string[]; where?: Record<string, unknown> }; // e.g. where: { sport_type: ['Run','TrailRun'] }
  rule: { aggregate: 'count' | 'sum'; atLeast?: number; atMost?: number }; // per local day
  // atLeast = a goal ("listen ≥ 20 min"); atMost = a limit ("game ≤ 90 min").
  // Neither = a tracked metric: the cell shows the amount, with no done/missed state.
  target: { perWeek: number }; // 7 = daily; 3 = three times a week
  startDate?: string;         // first local day it counts; earlier days are never "missed", and that week's target is prorated
  archivedAt?: string;
  sort: number;
}
```

`scoreHabit(habit, events, range) → DayCell[]` and the week/streak roll-ups are
**pure functions in `src/scoring/`** with full unit tests. The database stores
events. It does not store scores.

### Connector contract

```ts
interface Connector {
  kind: ConnectorKind;
  displayName: string;
  /** How events arrive: pushed by the app, pulled or received server-side, or entered by hand. */
  mode: 'push' | 'oauth' | 'webhook' | 'manual';
  /** Event types this connector can emit, with a default unit. Used by the habit editor. */
  eventTypes: { type: string; unit?: HabitEvent['unit']; label: string }[];
  /** Suggested habits shown when the source is first connected. */
  presets: Omit<Habit, 'id' | 'sort'>[];
  /** Server side only (Edge Function): turn a provider payload into events. */
  normalize?(payload: unknown, source: Source): HabitEvent[];
}
```

Client-side descriptors live in `src/connectors/<kind>.ts`. Server-side
connectors (allowed types, `onConflict`, later `normalize` and OAuth) live in
`supabase/functions/_shared/connectors/<kind>.ts`. Both are registered in one
`registry.ts` on each side.

### OAuth sources: Strava, Withings (as built)

Adding an OAuth source = a provider in `supabase/functions/_shared/oauth/<kind>.ts`
(implementing `OAuthProvider` in `oauth/types.ts`), a line in `oauth/registry.ts`,
pure helpers in `_shared/connectors/<kind>.ts`, and a client descriptor with
`mode: 'oauth'` and `syncPath: 'oauth/<kind>/sync'`. No new tables or functions.

- Tokens live in `oauth_accounts` (`kind`, `external_user_id`; RLS on, no
  policies, no grants to browser roles): only Edge Functions read them. OAuth
  state is in `oauth_states`. Credentials are function secrets
  `<KIND>_CLIENT_ID` / `<KIND>_CLIENT_SECRET`.
- `oauth` function: `POST /oauth/<kind>/connect` (owner JWT) → consent URL;
  `GET /oauth/<kind>/callback` → exchange, scope check, webhook subscription,
  60-day backfill, redirect to the app with `?oauth=<kind>:connected|denied|missing-scope|failed`;
  `POST /oauth/<kind>/sync { from }` refetches `from`…today unless fetched in
  the last 6 hours (and reconciles: rows the provider no longer has are
  deleted); `POST /oauth/<kind>/disconnect` releases at the provider and
  deletes the tokens and every event from the source.
- `oauth-webhook/<kind>`: the provider answers its own checks (Strava's
  `hub.challenge` with `STRAVA_VERIFY_TOKEN`; Withings' HEAD). Neither signs
  webhooks, so a POST is only a hint to refetch (one activity, or a span of
  days) with our token; a forged POST can at most cause a refetch.
- The client's `supabase-provider.listEvents` calls each connected OAuth
  source's `syncPath` before reading, and reads the cache even if that fails.
- **Strava:** `activity:read_all`; `activity.created`, value = moving time
  (s), meta = `{ sport_type, distance }`, `localDate` from `start_date_local`.
  API Policy §6.2: cached ≤ 7 days (`cacheDays: 7` → `events.expires_at`, daily
  `pg_cron` purge). "Powered by Strava" under the grid (`Connector.attribution`).
- **Withings:** scope `user.activity`; notifications appli 16 (activity: steps
  and workouts). `workout.completed` (`externalId workout:<id>`, value =
  end − start − pauses in seconds, meta = `{ category, distance?, steps? }`,
  `localDate` = the workout's `date`) and `steps.day` (`steps:<date>`, value =
  steps, updated as the day grows). Token requests use `client_secret` (no
  signature needed); refresh tokens rotate on every refresh. No retention cap
  is set: Withings' API terms couldn't be read automatically (403), so the
  owner should check them; if they cap retention, set `cacheDays` on the
  server connector.

---

## Project structure (target)

```
Habits/
  CLAUDE.md  plan.md
  index.html                 # standalone app shell
  embed.html                 # iframe entry: ?share=<token>&weeks=1&theme=auto
  src/
    main.ts                  # app bootstrap
    embed.ts                 # registers <habit-scorecard>; the single script for host pages
    model.ts                 # the Core model types above
    format.ts                # values ("1h 5m") and dates for display
    components/              # habits-app (app shell), habit-scorecard (element, also the embed), habit-editor, sign-in-form; score-row, day-cell (templates, see below); habit-draft.ts (pure editor logic)
    scoring/                 # pure: score.ts, streak.ts, week.ts, dates.ts, scorecard.ts (+ .spec.ts)
    connectors/              # client descriptors + registry.ts
    data/                    # DataProvider interface; supabase-provider.ts, demo-provider.ts
    styles/tokens.css        # light/dark tokens (habit colours, --hs-on-habit, level tints)
  supabase/
    migrations/              # sources, events, habits, ingest_tokens, share_tokens, RLS
    functions/
      ingest/                # POST /ingest: token-auth batch event intake (first-party + generic webhook)
      strava-oauth/          # connect + token exchange + refresh
      strava-webhook/        # subscription validation + activity events
      share/                 # GET computed grid for a share token (what the embed reads)
  clients/
    habits-reporter.ts       # drop-in for sibling apps: queue → flush to /ingest (master copy; apps keep copies)
    windows-steam/           # habits-steam.ps1 + install.ps1 (Task Scheduler at logon)
  public/                    # manifest, icons
  .github/workflows/deploy-pages.yml
```

**As built (Phase 1):**

- `score-row` and `day-cell` are Lit *template functions*, not custom elements.
  An element between `<tbody>` and `<td>` breaks native table semantics, and
  the accessibility rule needs a real `<table>`. Only `<habit-scorecard>` is an element.
- `scoreHabit(habit, events, range, today)` takes `today` explicitly; nothing in
  `scoring/` reads the clock. Cells are `{ date, value, state, done }`, with
  `state` one of `done | missed | pending | future | inactive | metric`.
- `buildScorecard()` in `scoring/scorecard.ts` is the one call the UI (and later
  `/share`) makes. It dedupes by `(sourceId, externalId)`, last copy wins.
- Vitest runs with `TZ=America/Chicago` so DST is real in tests. CI enforces
  100% coverage on `src/scoring/`.

`DataProvider` has two implementations. `demo-provider` generates eight weeks
of fake data, seeded per date, so the UI, the embed and the tests run without Supabase.
`supabase-provider` is the real one. Build all UI against the interface.

**As built (Phase 2):**

- `DataProvider` covers writes too (`addSource`, `saveHabit`, `saveHabitOrder`,
  `putEvent` as an upsert on `(sourceId, externalId)`, `deleteEvent`) plus
  `canEdit`. Read-only providers throw `ReadOnlyError`. `<habit-scorecard>`
  defaults to a **read-only** demo provider, so the embed can never write; the
  app passes a writable one.
- Demo mode: `npm run dev`, or any build without `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY`, or `?demo` in the URL. Demo writes persist in
  localStorage (`habits.demo.v1`). Supabase code loads only in live mode.
- **Manual habits:** one `manual` Source serves every hand-ticked habit.
  A habit's match is `{ sourceIds: [manual], types: ['check-in'], where:
  { habit_id } }`, and a check-in's `externalId` is `<habitId>:<date>`.
  The source is created the first time a hand-ticked habit is saved. There is
  no separate check-in button: each past/today cell of a hand-ticked habit is
  a toggle button (`aria-pressed`). Ticks show at once, then save.
- Sign-in is an email magic link with sign-ups disabled (`supabase/config.toml`),
  so only the owner's account (created once in the dashboard) can sign in.
  Every table has `owner_id default auth.uid()` and an owner-only RLS policy;
  `anon` has no grants. Token hashes can be inserted but never read back.
- **Corrections (any habit):** when a source missed something, the owner taps
  a day (not hand-ticked habits, which toggle) to open a dialog listing what
  was reported and what they added. An added entry is a `manual.entry` event
  from the Manual source with `meta.habit_id`; scoring counts it for that
  habit whatever the habit's match says (`countsFor` in `scoring/score.ts`).
  Count habits: "Mark as done" (one entry = one). Amount habits: an amount in
  the habit's unit (minutes, km, steps), added to what was reported. Entries
  only add; they never hide reported data. Entries are the owner's own data,
  so Strava's 7-day cache limit doesn't apply to them.
- The scorecard reloads when the tab becomes visible again, so a tick on one
  device shows on another without a manual refresh.
- PostgREST returns at most 1000 rows per request; `listEvents` pages.

---

## Commands

```bash
npm run dev            # Vite dev server, demo provider by default
npm run dev:live       # against Supabase: keys from .env.live.local (see .env.example)
npm run db:push        # apply supabase/migrations to the linked project
npm test               # Vitest
npm run e2e            # Playwright: app + embed-in-a-foreign-page smoke test
npm run build          # typecheck, then app + embed bundle into dist/
npm run size           # fail if dist/embed.js is over 25 KB gzipped
npm run lint
npm run check          # everything CI runs (lint, format, tests + coverage, build, size): run before every push
supabase functions serve
supabase db reset      # apply migrations + seed
```

---

## Conventions for Claude

- One phase per session, in the order given in `plan.md`. Tick the phase's
  checklist, and add an "as built" note here when the code differs from the plan.
- Work on sibling apps (adding the reporter) happens **in that app's repo**,
  follows that app's own `CLAUDE.md`, and is committed there, not here.
- Match the sibling apps' tone in copy: plain and short. No gamification,
  confetti or guilt messages. It's a scorecard, not a coach.
- Accessibility: the grid is a real `<table>` with row and column headers. Cells
  have text labels ("Workout, Tuesday: done"), and colour is never the only signal.
- Keep the embed bundle **under 25 KB gzipped**, and check it in CI.
- Prefer deleting an abstraction to adding a second one.
- Don't run Prettier on Markdown (`*.md` is in `.prettierignore`); it flattens
  the nested checklists in `plan.md`.

---

## Open decisions

Each has a recommendation. Change it here if you decide otherwise.

- **Backend: decided.** A new Supabase project, separate from DeckFit's.
- **Sign-in: decided.** Email magic link (no Google OAuth client needed).
- **Single user: decided.** One owner, with RLS that only lets my account in.
  Don't build sharing between users, invites or account management.
- **Steam as goal, limit or metric?** _Recommended: start as a metric_ (a minutes
  heatmap). Add a limit once I know my baseline.
- **Name:** "Habits" is a placeholder.
