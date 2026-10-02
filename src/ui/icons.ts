import { html } from 'lit';
import { unsafeSVG } from 'lit/directives/unsafe-svg.js';
import {
  Activity,
  Apple,
  Bed,
  Bike,
  BookOpen,
  Brain,
  Code,
  Coffee,
  Droplet,
  Dumbbell,
  Flame,
  Footprints,
  Gamepad2,
  GraduationCap,
  Headphones,
  HeartPulse,
  Languages,
  Leaf,
  Moon,
  Music,
  PenLine,
  SquareCheck,
  Star,
  Sun,
  Waves,
  type IconNode,
} from 'lucide';

// Line icons (Lucide, ISC licence): 24 px viewBox, 2 px stroke, currentColor (DESIGN_SYSTEM.md §7).

/** The fixed set a habit picks from. A habit stores the key, never an emoji or an SVG. */
export const HABIT_ICONS = {
  walk: Footprints,
  run: Activity,
  dumbbell: Dumbbell,
  bike: Bike,
  swim: Waves,
  heart: HeartPulse,
  mind: Brain,
  listen: Headphones,
  book: BookOpen,
  music: Music,
  write: PenLine,
  drop: Droplet,
  moon: Moon,
  sleep: Bed,
  sun: Sun,
  apple: Apple,
  coffee: Coffee,
  game: Gamepad2,
  language: Languages,
  study: GraduationCap,
  code: Code,
  flame: Flame,
  leaf: Leaf,
  star: Star,
  'check-square': SquareCheck,
} satisfies Record<string, IconNode>;

export type HabitIcon = keyof typeof HABIT_ICONS;
export const HABIT_ICON_KEYS = Object.keys(HABIT_ICONS) as HabitIcon[];

/** Plain names for icon pickers' labels. */
export const HABIT_ICON_LABELS: Record<HabitIcon, string> = {
  walk: 'Walk',
  run: 'Run',
  dumbbell: 'Weights',
  bike: 'Bike',
  swim: 'Swim',
  heart: 'Heart',
  mind: 'Mind',
  listen: 'Listen',
  book: 'Book',
  music: 'Music',
  write: 'Write',
  drop: 'Water',
  moon: 'Moon',
  sleep: 'Sleep',
  sun: 'Sun',
  apple: 'Food',
  coffee: 'Coffee',
  game: 'Games',
  language: 'Language',
  study: 'Study',
  code: 'Code',
  flame: 'Flame',
  leaf: 'Leaf',
  star: 'Star',
  'check-square': 'Check',
};

function toSvg(node: IconNode, size: number): string {
  const children = node
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .map(([k, v]) => `${k}="${String(v)}"`)
        .join(' ');
      return `<${tag} ${a}/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${children}</svg>`;
}

const cache = new Map<string, string>();
export function render(key: string, node: IconNode, size: number) {
  const id = `${key}:${size}`;
  if (!cache.has(id)) cache.set(id, toSvg(node, size));
  return html`${unsafeSVG(cache.get(id))}`;
}

/** A habit's icon; unknown keys fall back to a check square. */
export const habitIcon = (key: string, size = 22) =>
  render(`habit:${key}`, HABIT_ICONS[key as HabitIcon] ?? HABIT_ICONS['check-square'], size);
