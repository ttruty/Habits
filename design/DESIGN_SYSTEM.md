# Habit App — Design System

The UI spec for the habit app. Tokens live in `design/tokens.css`; this file says how to use them. When this file and the code disagree, this file wins — fix the code or update this file in the same change.

## 1. Principles

1. **One job per screen.** Today = check things off. Progress = see how it's going. Create = make a habit. Nothing else competes.
2. **Color means a habit.** Each habit owns one palette color, and that color shows up everywhere that habit appears (card, heatmap cell, progress bar). Neutral UI stays neutral.
3. **One accent per screen.** `--color-accent` is reserved for the single most important action (the + button, the selected day). Never use it for decoration.
4. **Big, obvious targets.** Every tappable element is ≥ 44×44 px. The check circle is the most important control in the app.
5. **Show progress, not pressure.** Streaks and percentages are encouraging and quiet. No red "failure" states for missed days — missed is just `--color-surface-2`.
6. **Light and dark are equals.** Every component is built with tokens so both themes work with zero extra code.

## 2. Tokens (summary)

| Group | Tokens | Notes |
|---|---|---|
| Neutrals | `--color-bg`, `--color-surface`, `--color-surface-2`, `--color-border`, `--color-border-strong` | bg → surface → surface-2 is the elevation order |
| Text | `--color-ink`, `--color-ink-2`, `--color-ink-3` | primary / secondary / caption; all ≥ 4.5:1 on surface |
| Chrome | `--color-nav`, `--color-nav-ink`, `--color-nav-active`, `--color-nav-active-ink` | floating tab bar |
| Actions | `--color-accent` / `--color-on-accent`, `--color-primary` / `--color-on-primary` | primary button is ink-filled; accent is the FAB |
| Status | `--color-success`, `--color-success-soft`, `--color-danger` | success = progress bars, streak chips |
| Habits | `--habit-{blue,violet,orange,coral,green,amber}` + `-on` | fill + text-on-fill pair |
| Type | `--text-display`, `--text-title`, `--text-body`, `--text-copy`, `--text-label`, `--text-caption`, `--text-micro`, `--text-stat`, `--text-stat-sm`, `--text-date` | use as `font: var(--text-body)`. `--text-body` (700) is for names and rows; `--text-copy` (500) for running text and inputs |
| Radius | `--radius-sm 10`, `-md 16`, `-lg 20`, `-xl 24`, `-pill` | |
| Space | `--space-1…10` (4 px grid), `--gutter 20` | |
| Motion | `--dur-fast/base/slow`, `--ease-out` | zeroed under reduced motion |

Font: **Plus Jakarta Sans** (500/600/700/800). Don't add a second typeface.

### Habit colors

A habit stores a color **key**, never a hex: `color: 'blue' | 'violet' | 'orange' | 'coral' | 'green' | 'amber'`. Render with `var(--habit-<key>)` and `var(--habit-<key>-on)`. This is what makes dark mode free.

## 3. Theming

- Theme is set by `data-theme="light" | "dark"` on `<html>`. No attribute = follow the OS.
- Store the user's choice as `'system' | 'light' | 'dark'` in settings. On `system`, remove the attribute.
- One `ThemeService` (or hook/store) owns this. Components never read the theme — they only use variables.
- Update the `<meta name="theme-color">` to `--color-bg` when the theme changes.
- Adding a new theme = a new `:root[data-theme="x"]` block that defines **every** color token. Nothing else changes.

## 4. Layout

- **Phone first.** Design width 390 px, side gutter `--gutter` (20 px).
- Screen structure: header (title + context) → scrolling content → floating tab bar.
- Content bottom padding ≥ `--tabbar-h` + 52 px so the last card clears the tab bar.
- Respect safe areas: `padding-top: max(var(--space-6), env(safe-area-inset-top))`, same for bottom.
- Vertical rhythm: 20 px between sections, 10 px between habit cards, 8 px between a label and its field.
- **Desktop/tablet (≥ 1024 px):** the dashboard layout — summary tiles across the top, check-in grid on the left, per-habit completion on the right, max content width 1232 px. Dark theme is the default look there but both must work.

## 5. Components

Each component lists anatomy → tokens → states. Build these once in `src/app/ui/` (or your shared components folder) and reuse them.

### HabitCard (the core component)
- **Anatomy:** icon tile (44 px, `--radius-md` minus 2, bg `--habit-icon-tile`) · name (`--text-body`) · meta line "Every day · 12-day streak" (`--text-caption`, 90% opacity) · check button (44 px circle).
- **Pending:** bg `--habit-<key>`, text/icon `--habit-<key>-on`, `--radius-lg`, padding 14 px. Check button = 2 px ring in the on-color, transparent fill.
- **Done:** moves to the *Done* section. bg `--color-surface`, 1 px `--color-border`, a 12×44 px pill of the habit color on the left, name in `--color-ink-2` with line-through, check button filled `--color-ink` with a check in `--color-bg`.
- **Interaction:** tapping the check toggles done; card animates into the other list over `--dur-slow`. Haptic tick on native. Undo via a 4 s toast.
- **A11y:** check is a real `<button>` with `aria-label="Mark done: Morning walk"` / `"Mark not done: …"`; also `aria-pressed`.

### WeekStrip
- 7 equal columns, 6 px gap, each a `<button>` 68 px tall, `--radius-md`.
- Default: `--color-surface` + border. Selected: `--color-accent` fill, `--color-on-accent` text, no border.
- Under the number, a 5 px dot in `--color-success` if all habits were done that day.
- Labels: day-of-week `--text-micro`, date 17 px/800.

### ProgressSummary
- Surface card: "Today's progress" + "2 of 5" (ink-2), then an 8 px pill track (`--color-surface-2`) with a `--color-success` fill.

### TabBar
- Floating: 16 px from screen edges and bottom (plus safe area), height `--tabbar-h`, `--radius-xl`, bg `--color-nav`.
- 5 slots: Today · Progress · **[+]** · Reminders · Profile. Icons 22 px, 2 px stroke, `--color-nav-ink`.
- Active tab: 48 px square, `--radius-md`, `--color-nav-active` bg with `--color-nav-active-ink` icon.
- Center **+**: `--fab-size` circle in `--color-accent`, raised 28 px above the bar, with a 6 px ring of `--color-bg` to cut it out.
- Each slot is a link/button with `aria-label`.

### HeroHabitCard (Progress screen)
- Habit color fill, `--radius-xl`, 20 px padding. Header row: icon tile · name (`--text-title`) + schedule · streak chip (`--habit-icon-tile` bg, pill).
- Week row: 7 × 28 px circles. Done = solid on-color with a check in the habit color. Not done = 2 px ring at 60% on-color.

### StatTile
- Surface card, `--radius-md`, 14 px padding: number (`--text-stat`, 22 px on phone) over label (`--text-caption`, `--color-ink-3`). Used in rows of 3.

### Heatmap (calendar grid)
- `grid-template-columns: repeat(7, 1fr)` (phone, 5 weeks) or `150px repeat(N days, 1fr)` (dashboard rows).
- Cell: square (`aspect-ratio: 1`), radius 8 px phone / 4 px dashboard. Done = habit color. Missed = `--color-surface-2`. Future = 1 px dashed `--color-ink-3` border, no fill.
- Always include a legend (Done / Missed / Upcoming). Each cell has a `title`/`aria-label` like "Sep 14: done".

### ProgressRing (dashboard)
- SVG, 72 px, 8 px stroke, track `--color-border`, value stroke in a habit/status color, rounded caps, starts at 12 o'clock. Value + label sit beside the ring, not inside.

### Buttons
| Variant | Fill | Text | Border | Height | Radius |
|---|---|---|---|---|---|
| Primary | `--color-primary` | `--color-on-primary` | — | 56 (full-width) / 48 | `--radius-md` (18 for full-width) |
| Secondary | `--color-surface` | `--color-ink` | `--color-border-strong` | 48 | `--radius-md` |
| Icon | `--color-surface` | `--color-ink` | `--color-border` | 44 × 44 | 14 px |
| FAB | `--color-accent` | `--color-on-accent` | — | 56 circle | pill |

Pressed: scale(0.97) over `--dur-fast`. Disabled: 40% opacity, no pointer events. Focus: 2 px outline in `--color-ink` with 2 px offset (never remove focus rings).

### Inputs
- 52 px tall, `--radius-md`, `--color-surface`, 1 px `--color-border-strong`, 16 px text (prevents iOS zoom). Label above in `--text-label`, always a real `<label for>`.

### ColorPicker (Create screen)
- 6 swatch circles in a 6-column grid. Selected: check icon in the `-on` color + double ring (`0 0 0 3px var(--color-bg), 0 0 0 5px <swatch>`). Each swatch is a `<button aria-pressed>` with the color name as `aria-label`.

### DayPicker
- 7 × 44 px buttons, `--radius-sm`+2. On: `--color-primary` fill. Off: surface + `--color-border-strong`. `aria-pressed` on each. Live label above it: "Every day" / "Weekdays" / "3 days a week".

### Switch
- 52 × 32 track, 26 px knob. On = `--color-success`, off = `--color-border-strong`. `<button role="switch" aria-checked>`.

## 6. Screens

| Screen | Contents (top → bottom) | Notes |
|---|---|---|
| **Today** | date caption, "Good morning" (display), calendar icon button · WeekStrip · ProgressSummary · "Up next" + Manage link · HabitCards · "Done" · done cards · TabBar | Empty state for Done: "Tap a circle to check off a habit." |
| **Progress** (per habit) | back · "Progress" · edit · HeroHabitCard · 3 StatTiles (current, best, rate) · 5-week Heatmap + legend | |
| **Create / Edit** | close · "New habit" · live preview HabitCard · Name input · ColorPicker · DayPicker · Reminder switch + time · full-width Primary "Save habit" | Preview updates live as fields change |
| **Dashboard** (≥1024 px) | month title + prev/next · 3 ProgressRings + Completed/Missed tile · habit × day grid · per-habit completion bars | Grid scrolls horizontally on narrow screens |

## 7. Icons

- Line icons, 24 px viewBox, 2 px stroke, round caps/joins, `stroke="currentColor"`, no fill. (Lucide matches this exactly.)
- Sizes: 22 px in tab bar & habit tiles, 20 px in icon buttons, 14–18 px inside checks.
- Each habit picks an icon key (`walk`, `book`, `drop`, `moon`, `check-square`, `star`…) from a fixed map — never free-form.
- No emoji in the UI.

## 8. Accessibility checklist

- [ ] Text ≥ 4.5:1 (large ≥ 3:1). All token pairs above already pass — don't invent new pairs.
- [ ] Never rely on color alone: done cards also get line-through + the filled check; heatmap has a legend and labels.
- [ ] Every interactive thing is a native `<button>`, `<a>`, or `<input>`; icon-only controls have `aria-label`.
- [ ] Toggles expose `aria-pressed` / `aria-checked`.
- [ ] Focus visible in both themes.
- [ ] Respect `prefers-reduced-motion` (tokens already zero the durations).
- [ ] Supports Dynamic Type / browser zoom to 200% without clipping (use rem or allow wrapping).

## 9. Don'ts

- No hard-coded hex values in components. If a color is missing, add a token here first.
- No gradients, glows, glassmorphism, or drop shadows on cards (the FAB cut-out ring is the only "shadow").
- No more than one accent-colored element per screen.
- Don't color neutral UI with habit colors.
- No new font sizes outside the type scale; no new radii outside the radius scale.

## 10. Habits app: as built

How the Habits scorecard applies this spec. Where it departs, the reason is given; the accessibility
checklist (§8) wins over a visual detail.

**Code.** Tokens are loaded once by the app (`src/main.ts`) and inherited through shadow roots.
Shared components are Lit templates in `src/ui/components.ts` (HabitCard, WeekStrip,
ProgressSummary, StatTile, ProgressRing, Heatmap, TabBar, ColorPicker, IconPicker,
FrequencyPicker, ChoiceChips), with their CSS in the exported `ui` style. Buttons and inputs are in
`src/styles/base.ts`. Screens are in `src/components/`. Only `src/theme.ts` touches
`<html data-theme>`.

**Additions (tokens).** `--text-copy` (500, 16 px) for running text and inputs, since `--text-body`
is 700 for names; `--text-date` (17 px/800) and `--text-stat-sm` (22 px) for the sizes §5 names
for the WeekStrip date and the phone StatTile.

**Font.** Plus Jakarta Sans is self-hosted (`public/fonts`, OFL), not loaded from Google Fonts, so
the installed app works offline and sends no request to a font CDN.

**Embed.** `<habit-scorecard>` on someone else's page has no tokens around it. It sets
`own-tokens` on itself, and a scoped copy of `tokens.css` applies (`src/styles/tokens.ts`), with
its `theme` attribute (`auto | light | dark`) in place of `data-theme`.

**Departures, with reasons.**
- HabitCard meta line and the hero's schedule: full opacity, not 90%. At 90% the meta fails AA
  on the green and orange fills (4.3:1).
- Hero streak chip: inverted (habit colour on its `-on` colour). The `--habit-icon-tile` chip
  behind `-on` text is 3.7:1 on blue.
- Heatmap: besides done / missed / upcoming, a day short of a goal and a tracked metric are
  tinted (`color-mix` of the habit colour, 30/55/80%), and a day over a limit is outlined in
  `--color-ink-3` rather than red (§1: no red failure states). Days before a habit started are
  outlined. Past cells are buttons that open the day for corrections.
- Minutes inside grid squares: the 25% and 45% tints take `--color-ink` text (AA in both themes
  for every habit colour); stronger days use the solid fill with its `-on` text.
- DayPicker becomes **FrequencyPicker**: the model is "days a week" (1–7), not chosen weekdays.
  Same look (7 × 44 px buttons, `aria-pressed`), with the live label above.
- **ChoiceChips** (new): several-of choices as 44 px pill buttons, `aria-pressed`, a check icon
  and ink fill when on (not colour alone). Used for "Activities that count" in the habit editor.
- **IconPicker** (new): the habit icon keys as a grid of 44 px buttons, `aria-pressed`, the
  selected one filled with the habit colour.
- No Reminders: the app has none. The tab bar is Today · Progress · [+] · Sources · More.
- Today's check circle: on a goal habit it marks done (a check-in for a hand-ticked habit, or an
  entry for exactly the missing amount) and undoes your own entries. When a source already did
  it, the check is filled and opens what was reported. Limits and tracked metrics have no check.
  Undo is a 4 s toast.
- Dashboard (≥ 1024 px): Today, This week and This month rings, a Completed / Missed tile, the
  habit × day grid (month view), and this month's completion per habit.

