import {
  Archive,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ChartColumn,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Ellipsis,
  ListChecks,
  LogOut,
  Monitor,
  Moon,
  Pencil,
  Plug,
  Plus,
  RotateCcw,
  Sun,
  Trash2,
  TriangleAlert,
  Upload,
  X,
  type IconNode,
} from 'lucide';
import { render } from './icons';

// Icons for the app's own controls; habit icons are in ./icons. Kept apart so the embed, which
// only shows habit icons, doesn't carry these.

/** Icons for the app's own controls. */
export const UI_ICONS = {
  archive: Archive,
  'arrow-down': ArrowDown,
  'arrow-up': ArrowUp,
  calendar: CalendarDays,
  chart: ChartColumn,
  check: Check,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  close: X,
  download: Download,
  edit: Pencil,
  more: Ellipsis,
  today: ListChecks,
  sources: Plug,
  monitor: Monitor,
  moon: Moon,
  sun: Sun,
  plus: Plus,
  undo: RotateCcw,
  trash: Trash2,
  upload: Upload,
  alert: TriangleAlert,
  'log-out': LogOut,
} satisfies Record<string, IconNode>;

export type UiIcon = keyof typeof UI_ICONS;

/** A UI icon. Decorative (aria-hidden): label its button instead. */
export const icon = (key: UiIcon, size = 20) => render(`ui:${key}`, UI_ICONS[key], size);
