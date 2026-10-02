import { HABIT_COLORS, type Habit, type HabitColor } from '../model';
import { HABIT_ICONS } from '../ui/icons';

// Habits saved before the design system used other colour names and emoji icons. Reading through
// this keeps them working; the 20261004 migration rewrites stored rows the same way.

const LEGACY_COLORS: Record<string, HabitColor> = { purple: 'violet', red: 'coral', teal: 'green' };

const LEGACY_ICONS: Record<string, string> = {
  '🏋️': 'dumbbell',
  '🏋': 'dumbbell',
  '💪': 'dumbbell',
  '🧘': 'mind',
  '🎧': 'listen',
  '🏃': 'run',
  '👟': 'walk',
  '🚶': 'walk',
  '🦵': 'walk',
  '🦶': 'walk',
  '📖': 'book',
  '📚': 'book',
  '🚴': 'bike',
  '🔥': 'flame',
  '🏊': 'swim',
  '🎮': 'game',
  '💧': 'drop',
  '😴': 'sleep',
  '✍️': 'write',
  '🎵': 'music',
};

export function normalizeColor(color: string): HabitColor {
  if ((HABIT_COLORS as readonly string[]).includes(color)) return color as HabitColor;
  return LEGACY_COLORS[color] ?? 'blue';
}

export function normalizeIcon(icon: string): string {
  if (icon in HABIT_ICONS) return icon;
  return LEGACY_ICONS[icon.trim()] ?? 'check-square';
}

export function normalizeHabit(h: Habit): Habit {
  const color = normalizeColor(h.color);
  const icon = normalizeIcon(h.icon);
  return color === h.color && icon === h.icon ? h : { ...h, color, icon };
}
