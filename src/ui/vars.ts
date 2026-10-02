import type { HabitColor } from '../model';

/** Colour variables for one habit, set on an element so its children can use --habit / --on. */
export const habitVars = (color: HabitColor | string) =>
  `--habit: var(--habit-${color}); --on: var(--habit-${color}-on);`;
