# plan.md — Habits Scorecard

Build plan for the app described in [`CLAUDE.md`](CLAUDE.md). Work one phase
per Claude Code session, in order. Each phase lists its goal, its tasks and
"done when" criteria. Tick the boxes as you go.

---

## Architecture at a glance

```
 DeckFit ─┐                                      ┌─► Habits PWA (timtruty.com/Habits/)
 MindDrive├─ habits-reporter.ts ─► POST /ingest ─┐│
 Yarnbeard┘   (opt-in, offline queue)            ││
                                                 ▼│
 Strava ───── webhook ─► strava-webhook ─►  Supabase Postgres ──► GET /share ─► <habit-scorecard> embed
 Windows PC: habits-steam.ps1 ─► POST /ingest ─► (events, habits)              on any site
 Tasker/MacroDroid/IFTTT ─► POST /ingest ─►
 Manual tap in the app ───────────────────►
```

- **Write path:** everything becomes a `HabitEvent` row with a unique
  `(source_id, external_id)`.
- **Read path:** the owner's app reads events and habits under RLS and scores
  them on the client. The embed calls `/share`, which scores on the server with
  the same `scoring/` module and returns only the grid.

### Why a backend at all

Every sibling app is client-only today, and each keeps its data in its own
browser storage, which no other origin can read. Yarnbeard's Drive
`appDataFolder` sync is readable only by its own OAuth client. Strava needs a
client secret and a public webhook URL. So a small, shared write target is
unavoidable, and Supabase is already in use for DeckFit.

_Considered and rejected:_ a shared JSON file in Google Drive. It needs no
server and works for the two Drive apps. It can't serve Strava or the webhook
sources, and it makes the read-only embed awkward.

---

## Phase 0: Foundation

**Goal:** an empty app that builds, tests and deploys.

- [x] Remove the previous app (Cogwork) and its deployment. Done by hand on
      2026-10-01: all Cogwork files and configs are gone from the folder, and
      its GitHub Pages deployment is removed, so `/Habits/` is free.
- [x] Reset the repo. The local `.git` still holds Cogwork's history, with no
      remote. Delete `.git` and `git init` fresh on `main`, then create a new
      GitHub repo and push. Don't build on the Cogwork history.
- [x] Vite + TypeScript + Lit scaffold, ESLint, Vitest, Playwright, and a new
      `.gitignore` and `.editorconfig`. Add a new `.prettierrc` matching the
      sibling apps (`printWidth: 100`, `singleQuote: true`).
- [x] Two entries: `index.html` (app) and `src/embed.ts` (library build →
      `dist/embed.js`), plus `embed.html` for the iframe.
- [x] `styles/tokens.css` with light and dark tokens.
- [x] GitHub Pages workflow, copied from `MindDrive/.github/workflows/deploy-pages.yml`
      with base path `/Habits/`. Add a bundle-size check for `embed.js`.

**Done when:** `npm run build` produces both entries, CI deploys a "hello"
page to `/Habits/`, and `npm test` runs.

## Phase 1: Scoring core and the scorecard on demo data

**Goal:** the whole UI works with no backend.

- [x] `scoring/dates.ts`: local-date helpers, ISO week start (Monday,
      configurable), DST-safe day maths (use the `Date.UTC` day-number approach
      from MindDrive `core/streak.ts`).
- [x] `scoring/score.ts`: `scoreHabit(habit, events, range)` → per-day
      `{ date, value, done }`, using the `count` and `sum` aggregates and the
      `where` filter.
- [x] `scoring/week.ts` and `streak.ts`: week progress `n / target`.
      - A **daily** habit (target 7) has a streak counted in days.
      - A **weekly-target** habit (for example 3×/week) has a streak counted in
        consecutive weeks that hit the target.
      - Today and the current week count as "still open", never as broken.
- [x] Unit tests: DST weekends, a habit created mid-week, duplicate events,
      `sum` thresholds, weekly streaks.
- [x] `DataProvider` interface and `demo-provider` (8 weeks of seeded events for
      the five example habits).
- [x] Components: `<habit-scorecard>` (a table with a week/month toggle and
      prev/next), `score-row`, `day-cell`. Light/dark, keyboard and
      screen-reader labels.

**Done when:** the dev server shows a correct, accessible grid of demo data,
and scoring has full test coverage.

## Phase 2: Supabase schema, auth and manual habits

**Goal:** real persistence, plus a habit you tick by hand.

- [x] Migrations: `sources`, `events` (unique `source_id, external_id`; index
      `(owner_id, local_date)`), `habits`, `ingest_tokens` (hashed),
      `share_tokens`. RLS lets only my account in (single user, no sign-up flow:
      disable public sign-ups in Supabase Auth).
- [x] Owner sign-in with Supabase Auth (magic link, or Google, which fits the
      other apps).
- [x] `supabase-provider` using the same interface as the demo provider.
- [x] Habit editor: name, icon, colour token, source + event type pickers
      (from the connector registry), rule, weekly target, archive, reorder.
- [x] `manual` connector: a check-in button per habit. Tapping a past cell
      toggles it (writes or deletes a `check-in` event for that date).

**Done when:** I can sign in, create "Read", tick today, and see it on a
second device.

## Phase 3: Ingest API and first-party reporters

**Goal:** DeckFit, MindDrive and Yarnbeard report completions automatically.

- [x] Edge Function `ingest`: `POST` a batch of up to 100 events with
      `Authorization: Bearer <ingest token>`. Validate the input, upsert on
      `(source_id, external_id)`, and return the counts of accepted and
      duplicate events. Configure CORS for the sibling apps' origins.
- [x] In the Habits app, "Connect an app" creates a Source and an ingest token
      for it, and shows the URL and token once to paste into the source app.
- [x] `clients/habits-reporter.ts`: dependency-free.
      `report(event)` → localStorage queue → flush on `online`, on visibility
      change and on a timer, with backoff. Exponential retry. Never blocks the
      host app.
- [x] Wire each sibling app, **in its own repo**, behind a settings toggle
      that is off by default, and update that app's privacy text:

  | App       | Hook point                                         | Event                                                                                                                                           |
  | --------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
  | DeckFit   | where a `Session` gets `endedAt`                   | `workout.completed`, value = duration in seconds, meta = game/deck name, `externalId` = session id                                              |
  | MindDrive | `PlaybackService` when `completed` flips to `true` | `meditation.completed`, value = `durationSec`, meta = `folderPath`, `externalId` = `driveId:<date>`                                             |
  | Yarnbeard | `StatsService` daily rollup (debounced)            | `listening.day`, value = that day's seconds, `externalId` = `yarnbeard:<date>` (upserts as the day grows); plus `book.finished` on `finishedAt` |

- [x] Connector descriptors and presets for all three ("Workout 4×/week",
      "Meditate daily", "Listen 20 min daily").

**Done when:** finishing a DeckFit game, a MindDrive session and 20 minutes
of Yarnbeard each fill today's cell, including after the event was queued
while offline.

> Yarnbeard note: `listening.day` is the one event that _updates_ (same
> `externalId`, larger value). `ingest` must upsert the value, not ignore the
> duplicate. Give each connector type a flag that chooses between update and
> ignore.

## Phase 4: Embed and sharing

> **Deferred** (2026-10-01): done after Phase 5 at the owner's request.

**Goal:** put the scorecard on another site.

- [ ] `share_tokens`: create and revoke them in Settings. Options: which
      habits, show names or just icons, weeks to show.
- [ ] Edge Function `share`: `GET ?token=` → computed grid JSON only. Cache it
      for about 5 minutes and set `Access-Control-Allow-Origin: *`.
- [ ] `<habit-scorecard share="…" weeks="1" theme="auto|light|dark">` reads
      `/share` when `share` is set. Shadow DOM. Host pages can theme it through
      `--hs-*` CSS custom properties.
- [ ] `embed.html?share=…` for hosts that only allow iframes, with
      auto-resize via `postMessage`.
- [ ] A copy-paste snippet generator in Settings (script-tag and iframe tabs).
- [ ] Playwright: load the embed inside a foreign test page with hostile CSS
      and check that it renders and stays unstyled by the host.

**Done when:** the widget shows live data on a test page on another origin,
and revoking the token blanks it.

## Phase 5: Strava

**Goal:** the first consumer connector, using OAuth and webhooks.

- [ ] Register a Strava API app. Store `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`
      and `STRAVA_VERIFY_TOKEN` as function secrets.
- [x] `strava-oauth`: redirect → code exchange → store refresh token
      server-side (on the Source, encrypted or in a server-only table) →
      refresh on expiry. Scope `activity:read` (`activity:read_all` only if
      private activities should count).
- [x] `strava-webhook`: answer the `hub.challenge` validation. On
      `object_type=activity, aspect_type=create|update|delete`, fetch the
      activity and normalize it to `activity.created` with `meta.sport_type`,
      value = `moving_time`, and `localDate` from `start_date_local`. On a
      delete, remove the event.
- [x] Backfill the last 60 days on connect. Respect the rate limits (200 per
      15 min, 2,000 per day).
- [x] Presets: "Run 3×/week" (`where: { sport_type: ['Run','TrailRun','VirtualRun'] }`)
      and "Ride", "Any activity".
- [x] Show "Powered by Strava" attribution on Strava-backed rows.

**Done when:** logging a run on Strava fills the cell within a minute, and
deleting the run clears it.

## Phase 5b: Steam on my Windows PC

**Goal:** see how much time I spend gaming each day, per game, on my Windows PC.
This needs nothing from Steam's servers.

- [ ] **Check first (10 min, on the PC):** while a game runs, confirm that
      `HKCU\Software\Valve\Steam\RunningAppID` holds its app id and goes back
      to `0` when the game quits. Confirm where the game's name can be read:
      `HKCU\Software\Valve\Steam\Apps\<appid>\Name`, or else the `"name"` in
      `<library>\steamapps\appmanifest_<appid>.acf`. Library folders are listed
      in `<SteamPath>\steamapps\libraryfolders.vdf`. Note the results in the
      Notes log.
- [ ] In the Habits app, create a Source of kind `steam-windows`. That gives it
      its own ingest token, revocable on its own.
- [ ] `clients/windows-steam/habits-steam.ps1` (PowerShell 5.1, no installs):
      - Read `RunningAppID` every 30 s.
      - **A game starts** when the value goes from 0 to an id. Record the start
        time and the game's name.
      - **The game ends** when the value goes back to 0 or changes to another id.
        Write a `gaming.session` event:
        - `externalId = steam:<appid>:<startUnix>`
        - value = seconds played
        - `localDate` = the start day
        - `meta = { appid, name, device: $env:COMPUTERNAME }`
      - **Midnight:** a session crossing local midnight becomes two events, one
        per day.
      - **Sleep:** if two checks are more than 5 minutes apart (the PC slept or
        hibernated), close the session at the last check that saw the game
        running.
      - **Live progress:** while a game is still open, send a progress event
        every 15 minutes with the same `externalId`, as an update-type event,
        so today's row moves during long sessions.
      - **Delivery:** queue events in `%LOCALAPPDATA%\Habits\queue.jsonl`, and
        POST them to `/ingest` with `Invoke-RestMethod`. Keep queued events when
        offline and retry with backoff.
      - **Config:** read the ingest URL and token from
        `%LOCALAPPDATA%\Habits\config.json`, with the token protected by DPAPI
        (`ConvertFrom-SecureString`). Don't keep them in the script.
- [ ] `install.ps1`:
      - Ask for the URL and token, and write the config.
      - Register a Task Scheduler task "at logon, hidden window", which restarts
        on failure.
      - Provide `-Uninstall`.
- [ ] Presets: "Gaming" as a minutes **metric** (no done/missed), plus an
      optional limit preset "Gaming ≤ 90 min/day" (`atMost`).
- [ ] Scoring: support `atMost` and metric-only habits. (Scoring and basic
      display done early, in Phase 1. Still to do: per-game tooltip, heatmap rows.)
      - A limit cell counts as "done" when the day is over and the total
        stayed under the limit.
      - Show the minutes in the cell or a tooltip, and the per-game breakdown
        from `meta.name` on hover.
      - Draw gaming rows as a heatmap rather than dots.

**Done when:** about 30 minutes of a Steam game shows about 30 minutes, with
the game's name, on today's Gaming row. It must still work if the PC was offline
or asleep partway through.

> Later, if wanted: the same agent can watch a list of process names (e.g.
> non-Steam games, or apps like Blender) with no other changes. It would use a
> `process.session` event type.

## Phase 6: Generic webhook, Android automations and Moon+ Reader

**Goal:** cover consumer apps that have no API.

- [ ] A `webhook` connector is a Source of kind `webhook` with its own ingest
      token. It accepts a simplified body
      `{ "type": "check-in", "value"?: n, "date"?: "YYYY-MM-DD", "id"?: "…" }`.
      When the body has no `id`, the server derives one
      (`<type>:<date>`), so a twice-fired automation counts once.
- [ ] Recipes page in the app (Android only), with copy-paste setups for:
      - **Tasker:** a profile on Application → Moon+ Reader.
        - On entry, store `%TIMES` in a variable.
        - On exit, HTTP Post `{"type":"reading.session","value":<%TIMES - start>}`
          to `/ingest`.
        - Only post sessions of at least 2 minutes, to drop quick peeks.
      - **MacroDroid:** the same thing with "Application launched/closed"
        triggers. It's simpler and free.
      - **IFTTT:** a webhook action for services it already integrates.
- [ ] **Moon+ Reader:** ship it as a webhook preset ("Read" via a Tasker or
      MacroDroid app-closed trigger) or as a manual habit.
- [ ] **Spike (time-boxed, 1 session):** Moon+ Pro syncs reading positions to
      Google Drive or Dropbox as small `.po` files. Check whether reading them
      from Drive (`drive.readonly`, server- or client-side) yields reliable
      "read today" signals or page progress. Write the findings in the Notes
      log below. Only build a connector if the result is reliable.

**Done when:** a Moon+ Reader session on Android fills "Read" with no manual
step, through Tasker or MacroDroid.

## Phase 7: Polish

- [ ] PWA: manifest, icons, service worker for the app shell (not for `/share`
      or `/ingest`).
- [ ] Month view and a 12-week heatmap per habit (reuse the MindDrive heatmap
      levels idea).
- [ ] Export all events to CSV or JSON. Import from CSV, for backfilling old
      habits by hand.
- [ ] Error states: source not reporting for N days ("DeckFit last reported
      9 days ago"), expired Strava token, ingest token revoked.
- [ ] Accessibility and reduced-motion pass. Embed size check is green.

---

## Future connectors (backlog)

Ranked by how easy they are. Each is "one connector file plus a registry
entry" (see CLAUDE.md, rule 4).

| Service                       | Route                        | Notes                                                        |
| ----------------------------- | ---------------------------- | ------------------------------------------------------------ |
| GitHub                        | OAuth / PAT poll             | contributions per day; easy                                  |
| Todoist                       | OAuth + webhooks             | completed tasks with a label                                 |
| Oura / Fitbit                 | OAuth + webhooks             | sleep, steps; official APIs (Withings: built, see Notes log)  |
| Duolingo                      | none official                | use the webhook recipe                                       |
| Goodreads / StoryGraph        | API closed                   | webhook or manual                                            |
| Kindle (Android app)          | none                         | same Tasker/MacroDroid app-session recipe as Moon+           |
| Health Connect (Android)      | on-device only               | Tasker plugin → webhook (steps, sleep, workouts)             |
| Any Android app's screen time | Digital Wellbeing has no API | Tasker app-session recipe (generic version of the Moon+ one) |
| PlayStation / Xbox            | no reliable personal API     | manual; revisit later                                        |
| Garmin                        | partner program only         | sync Garmin → Strava, then use the Strava connector          |

---

## Notes log

Append findings, surprises and as-built changes here, newest first.

- _2026-10-02_: CI failed on the last two pushes (CORS and callback fixes)
  and went unnoticed: a new test tripped ESLint's `no-unexpected-multiline`
  after Prettier wrapped it, and only the tests had been run locally. The
  functions were deployed directly, so they worked, but the site didn't
  redeploy. Fixed, and added `npm run check` (exactly what CI runs).
- _2026-10-02_: **Corrections** added at the owner's request: tap a day on any
  habit to add a missed entry (or an amount) when an API missed the activity.
  Stored as `manual.entry` events tied to the habit by `meta.habit_id`, which
  scoring always counts for that habit. Additive only; each entry can be
  removed. Native `<dialog>` (focus returns to the cell; axe-clean). jsdom has
  no `showModal`, so `src/test-setup.ts` stands in for unit tests.

- _2026-10-02_: Withings' portal rejected the callback URL ("Fail to connect
  to callback url … http status [405]"): it checks reachability with a HEAD,
  and `oauth/<kind>/callback` only accepted GET. The callback now answers HEAD,
  and a GET with no `state`/`code`/`error`, with 200; real callbacks are
  unchanged. (The notification URL `oauth-webhook/withings` already answered
  HEAD with 200.)

- _2026-10-02_: Bug: connecting Withings failed with a CORS error. The shared
  `corsHeaders()` allowed only `authorization, content-type`, but supabase-js
  `functions.invoke` also sends `apikey` and `x-client-info`, so every
  browser call to `oauth/*` (connect, sync, disconnect) was blocked. The sync
  refresh had been failing silently, since it's best-effort. Fixed in
  `ALLOWED_HEADERS` (+ `x-region`, `x-retry-count`), with a unit test, and
  verified with a real cross-origin request from `timtruty.com`. Unit tests
  had mocked `invoke`, so no test ever ran a browser preflight.

- _2026-10-01_: **Withings** added (workouts and daily steps), outside the
  phase plan at the owner's request.
  - Adding it exposed that Phase 5's Strava code wasn't generic (its own table
    and functions). Per rule 4, generalised before adding Withings:
    `strava_accounts` → `oauth_accounts` (it was empty), `strava-oauth` /
    `strava-webhook` → `oauth/<kind>/…` / `oauth-webhook/<kind>`, and an
    `OAuthProvider` interface with Strava and Withings implementations. The old
    functions were deleted. Nothing had been connected yet, so nothing moved.
  - Withings facts were checked against its docs and two client libraries
    (aiowithings, python_withings_api): token requests need only
    `client_secret`; notification appli 16 covers steps *and* workouts (one
    summary said 46, which is "user profile change"); callbacks get a HEAD
    check first; workout categories are numbered (mapped to names like `run`).
  - Withings' API terms page returns 403 to scripts, so retention limits are
    unverified; Withings data is stored normally for now.
  - Presets: Steps (≥ 8,000 a day, daily) and Workout (Withings) 3×/week. The
    editor labels the steps amount "steps" (`eventTypes[].amountLabel`).

- _2026-10-01_: Phase 5 (Strava) built before Phase 4, at the owner's request.
  - **Strava's API Policy §6.2 caps caching Strava data at 7 days.** No
    exception for an athlete's own data was found (only an unofficial community
    answer). Decided: Strava events are a cache. Each row has `expires_at`
    (7 days), a daily `pg_cron` job deletes expired rows, and the app asks
    `strava-oauth/sync` to refetch a range from Strava when it's viewed (no-op
    if fetched in the last 6 hours). A year of history is 1–3 API calls.
  - Scope is `activity:read_all`: private activities count (owner's choice).
  - Value is **moving time in seconds** (not distance); distance is in meta.
    Presets: Run 3×/week, Ride 2×/week, Any activity 5×/week, all counts.
  - Webhooks aren't signed by Strava, so every webhook is treated as "refetch
    this activity"; a forged one can only cause a refetch.
  - Server connectors gained `ingest` (only push apps accept ingest tokens) and
    `cacheDays`.
  - Attribution is plain-text "Powered by Strava" under the grid, which the
    brand guidelines allow; the official logo can replace it later.
  - Deployed and smoke-tested without Strava credentials. Waiting on the
    owner to register the Strava API app and set its secrets.

- _2026-10-01_: Phase 3 built. As-built differences from the plan:
  - `/ingest` is deployed (`verify_jwt = false`; the ingest token is the
    credential). Body `{ events: [...] }`, ≤ 100. Bad events are rejected one
    by one (`rejected: [{ index, error }]`) and the rest stored, so one broken
    event can't jam an app's queue. Reply: `{ accepted, updated, duplicates,
    rejected }`. 401 = unknown or revoked token.
  - Server connectors live in `supabase/functions/_shared/connectors/` (not
    `functions/connectors/`): one file each with the allowed event `types` and
    `onConflict: 'ignore' | 'update'`. Only Yarnbeard updates. First-party apps
    send the event shape directly, so there's no `normalize` yet; Strava
    (Phase 4) is the first that needs one.
  - CORS allowlist: `https://timtruty.com` (all three apps are served there)
    and their localhost dev ports; override with the `INGEST_ALLOWED_ORIGINS`
    function secret.
  - Verified end to end on the hosted project with a temporary source (since
    deleted): accept, per-event reject, Yarnbeard's day total updating in
    place (600 → 1500), owner and `last_used_at` set, token dead after delete.
  - `habits-reporter.ts` is ~200 lines, not ~60: pluggable queue storage
    (DeckFit forbids localStorage), one send at a time, a replacement queued
    mid-send survives, 4xx other than 401/403/408/429 drops the batch for good.
    Each app keeps a **copy**; this file is the master.
  - Sibling apps (each committed in its own repo; pushed separately):
    - DeckFit (`CLAUDE.md` §16): settings and queue in Dexie `meta`. Every
      ended session is reported, abandoned ones with `outcome: 'abandoned'`;
      the Workout preset counts `finished` only.
    - MindDrive (`CLAUDE.md` §17): reports when `completed` flips to true;
      `externalId = <driveId>:<date>`.
    - Yarnbeard: day totals at most every 5 min (and when hidden), plus a bare
      `book.finished`. **No titles, authors, file names or Drive ids**: its
      privacy policy backs Google OAuth verification (Limited Use), so it
      sends only numbers it computes. `PRIVACY.md` gained section 4.
  - Preset names: "Workout" (4×/week), "Meditate" (daily), "Listen 20 min"
    (daily, ≥ 1200 s).

- _2026-10-01_: Phase 2 built. As-built differences from the plan:
  - Sign-in is an email magic link (decided over Google: no OAuth client to
    set up). Sign-ups are off in `supabase/config.toml`; the owner's user is
    created once in the dashboard.
  - No separate check-in button: a hand-ticked habit's cells are toggle buttons,
    today's included. See CLAUDE.md for the manual-habit match shape.
  - Event-type-only descriptors for DeckFit, MindDrive, Yarnbeard, Strava and
    Webhook were added now, so the editor can describe the demo's sources.
    Their presets still come with Phases 3, 4 and 6.
  - `source-list` isn't built: nothing needs it until "Connect an app" in
    Phase 3.
  - The habit editor reorders with Up/Down buttons (keyboard-friendly) rather
    than drag and drop.
  - Not tested against a local Supabase stack (Docker wasn't running).
    Checked on the hosted project (`mcqwdwrblaqezlvlynyn`, ca-central-1)
    instead: signed-out reads and writes on all five tables get `permission
    denied`; sign-up and magic links for unknown emails are refused; RLS is on
    everywhere; `token_hash` isn't readable by signed-in users.
  - `supabase/config.toml` keeps the hosted project's own values for MFA
    (TOTP on), email OTP length (8) and resend interval (1 min). `supabase
    init` defaults would otherwise switch them on `config push`. Always run
    `config push` without `--yes` first and read the diff.
  - Trap: `[auth.email] enable_signup` turns the **email provider** on or off.
    Setting it to `false` broke magic links ("Email logins are disabled", 422).
    It must stay `true`; `[auth] enable_signup = false` is what blocks sign-ups.
  - Supabase's built-in email sender allows only a few emails an hour. Fine for
    one user; set up custom SMTP if links stop arriving.

- _2026-10-01_: Phase 1 built. As-built differences from the plan:
  - `Habit.startDate` (optional) added for "a habit created mid-week": days
    before it are `inactive`, never missed, and that week's target drops to
    `min(perWeek, active days)`. Streaks stop at it.
  - `atMost` limits and metric-only rows are scored already (it's a few lines
    in `cellState`). Limit days are `pending` until the day is over; going over
    is `missed` at once. Metric cells show a 0–4 intensity square.
  - `score-row` / `day-cell` are template functions, not elements (table
    semantics; see CLAUDE.md).
  - Demo events aren't stored in localStorage. Each day's events come from a
    seed of the date, so they're stable across reloads and never go stale.
    localStorage is left for Phase 2's demo check-ins.
  - Streaks look back one year (`HISTORY_DAYS`); the scorecard loads that much.
  - Month view is a 28–31-column day grid. On a phone it scrolls inside the
    table (name column sticky) and opens with today in view; it fits on
    desktop. Phase 7 can rethink it.
  - Summary column: week view shows `done/target` for the last week shown (✓
    when met); month view shows done days. Streaks show weeks with a `w`.
  - Playwright now runs axe (light + dark, week + month) and checks the page
    doesn't scroll sideways at 360px.
  - Embed: 13.2 KB gzipped, including the demo provider.
  - Not done: "Powered by Strava" attribution. The demo's Strava data is fake;
    the real attribution belongs with the Strava connector in Phase 4.

- _2026-10-01_: Phase 0 built. As-built differences from the plan:
  - Repo reset: old `.git` deleted (no backup), fresh `main`, pushed to
    `github.com/ttruty/Habits` (public).
  - TypeScript is 6.0, not 7: `typescript-eslint` 8 doesn't accept 7 yet.
  - The embed builds in a second Vite pass (`vite.embed.config.ts`, library
    mode) into the same `dist/`. `embed.html` loads `src/embed-frame.ts`, which
    copies `share`, `weeks` and `theme` from the query string onto the element.
  - `PAGES_BASE` (default `/Habits/`) sets the base. `vite preview` uses it too,
    so the Playwright smoke tests run against the real `/Habits/` paths,
    including a foreign host page with hostile global CSS.
  - CI runs lint, unit tests, build and the embed size check on every push and
    PR; it deploys from `main` only. Playwright isn't in CI yet.
  - Prettier skips `*.md`. Running it over Markdown flattened the nested
    checklist bullets in this file once, and they had to be restored by hand.
  - Embed bundle at this point: 7.0 KB gzipped (Lit + placeholder element).

- _2026-10-01_: Previous app (Cogwork) and its deployment removed by hand.
  The folder now holds only `CLAUDE.md` and `plan.md`, plus the old `.git`,
  which Phase 0 replaces.

- _2026-10-01_: Scope narrowed to personal use, one user, on Android. iOS
  recipes dropped. Steam added as Phase 5b: a local PowerShell agent on my
  Windows PC watches `RunningAppID` (Steam is only tracked there, so no Web API
  is needed). Habit rules gained `atMost`
  limits and metric-only rows.
- _2026-10-01_: Plan written. Existing apps checked: DeckFit (Dexie + Supabase
  realtime), MindDrive (IndexedDB `idb`, `StreakEntry`/`PlaybackEntry.completed`),
  Yarnbeard (localStorage stats, `DayStat`, Drive `appDataFolder` sync). None
  exposes data across origins, which confirmed the need for a shared ingest
  endpoint.
