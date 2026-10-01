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
   own data, so it is fine.

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
`normalize` and OAuth live in `supabase/functions/connectors/<kind>.ts`. Both are
registered in one `registry.ts` on each side.

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
    components/              # habit-scorecard (element); score-row, day-cell (templates, see below); habit-editor, source-list, check-in-button
    scoring/                 # pure: score.ts, streak.ts, week.ts, dates.ts, scorecard.ts (+ .spec.ts)
    connectors/              # client descriptors + registry.ts
    data/                    # DataProvider interface; supabase-provider.ts, demo-provider.ts
    styles/tokens.css        # light/dark tokens
  supabase/
    migrations/              # sources, events, habits, ingest_tokens, share_tokens, RLS
    functions/
      ingest/                # POST /ingest: token-auth batch event intake (first-party + generic webhook)
      strava-oauth/          # connect + token exchange + refresh
      strava-webhook/        # subscription validation + activity events
      share/                 # GET computed grid for a share token (what the embed reads)
  clients/
    habits-reporter.ts       # ~60-line drop-in for sibling apps: queue → flush to /ingest
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

---

## Commands

```bash
npm run dev            # Vite dev server, demo provider by default
npm run dev:live       # against local Supabase (supabase start), from Phase 2
npm test               # Vitest
npm run e2e            # Playwright: app + embed-in-a-foreign-page smoke test
npm run build          # typecheck, then app + embed bundle into dist/
npm run size           # fail if dist/embed.js is over 25 KB gzipped
npm run lint
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

- **Backend:** reuse the DeckFit Supabase project, or make a new one?
  _Recommended: a new project_, so the habit data and DeckFit's realtime rooms
  don't share keys or quotas.
- **Single user: decided.** One owner, with RLS that only lets my account in.
  Don't build sharing between users, invites or account management.
- **Steam as goal, limit or metric?** _Recommended: start as a metric_ (a minutes
  heatmap). Add a limit once I know my baseline.
- **Name:** "Habits" is a placeholder.
