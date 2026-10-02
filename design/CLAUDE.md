# UI & Theming — rules for Claude Code

> Paste this section into the project's CLAUDE.md (or keep as-is if the project has none).
> Full spec: `design/DESIGN_SYSTEM.md` · Tokens: `design/tokens.css`

## Source of truth
- `design/tokens.css` defines every color, font, radius, space and duration. Import it once at the app root (global styles).
- `design/DESIGN_SYSTEM.md` defines components, screens and rules. **Read it before any UI work.**
- If a design need isn't covered, add the token/rule to those files first, then use it. Never the other way round.

## Hard rules
1. **No raw hex, px font sizes, or ad-hoc radii in components.** Use `var(--color-*)`, `var(--habit-*)`, `font: var(--text-*)`, `var(--radius-*)`, `var(--space-*)`.
2. **Habits store a color key, not a color.** Model: `color: 'blue' | 'violet' | 'orange' | 'coral' | 'green' | 'amber'`. Render with `var(--habit-${key})` / `var(--habit-${key}-on)`.
3. **Theme lives on `<html data-theme>`.** Only `ThemeService` touches it. Setting: `'system' | 'light' | 'dark'`; `system` removes the attribute. Components never branch on theme.
4. **One accent per screen** (`--color-accent` = the + FAB or selected day). Primary buttons are ink-filled (`--color-primary`).
5. **Touch targets ≥ 44 px.** Interactive elements are native `<button>`/`<a>`/`<input>`; icon-only ones get `aria-label`; toggles get `aria-pressed`/`aria-checked`.
6. **Font is Plus Jakarta Sans only.** Icons are Lucide-style line icons (2 px stroke, `currentColor`). No emoji in UI.
7. **Simplicity first:** no gradients, glows, card shadows, or extra decoration. If unsure, remove it.

## Component inventory (build once, reuse)
In this project: shared templates in `src/ui/components.ts`, screens in `src/components/`.
`HabitCard` · `WeekStrip` · `ProgressSummary` · `TabBar` · `HeroHabitCard` · `StatTile` · `Heatmap` · `ProgressRing` · `Button` (primary/secondary/icon/fab) · `TextField` · `ColorPicker` · `DayPicker` · `Switch`.
Check this list before creating a new component; extend an existing one if it's close.

## Screens
- **Today** — week strip, progress summary, "Up next" habit cards, "Done" list, floating tab bar.
- **Progress** — hero card for one habit, 3 stat tiles, 5-week heatmap.
- **Create/Edit** — live preview card, name, color, repeat days, reminder, Save.
- **Dashboard** (≥1024 px) — rings, habit × day grid, per-habit completion bars.
Specs for each are in DESIGN_SYSTEM.md §6.

## Workflow for UI tasks
1. Read `DESIGN_SYSTEM.md` sections for the components involved.
2. Reuse/extend components from the inventory; keep styles in the component, tokens only.
3. Verify both themes (`data-theme="light"` and `"dark"`) and a 390 px wide viewport.
4. Run the a11y checklist (DESIGN_SYSTEM.md §8).
5. If you added a token or component, update DESIGN_SYSTEM.md in the same change.

## Quick grep checks before finishing
- `grep -rnE "#[0-9A-Fa-f]{3,8}\b" src --include=*.{scss,css,html,ts,tsx}` → should only hit `tokens.css`.
- `grep -rn "data-theme" src` → should only hit the ThemeService.
