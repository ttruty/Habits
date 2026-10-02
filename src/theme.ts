// The only code that touches <html data-theme> (design/DESIGN_SYSTEM.md §3).

export type ThemeSetting = 'system' | 'light' | 'dark';

const KEY = 'habits.theme';

export function themeSetting(): ThemeSetting {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Apply a setting: 'system' removes the attribute so the OS decides. */
export function setTheme(setting: ThemeSetting): void {
  try {
    if (setting === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, setting);
  } catch {
    // Blocked storage: applies for this page only.
  }
  applyTheme(setting);
}

/** Apply a setting without saving it (the iframe embed's ?theme=). */
export function applyTheme(setting: ThemeSetting = themeSetting()): void {
  const root = document.documentElement;
  if (setting === 'system') delete root.dataset.theme;
  else root.dataset.theme = setting;
  syncThemeColor();
}

/** <meta name="theme-color"> follows --color-bg (browser chrome, installed app title bar). */
function syncThemeColor(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim();
  if (meta && bg) meta.content = bg;
}

/** Keep the theme colour right when the OS switches and the setting is 'system'. */
export function watchSystemTheme(): void {
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (themeSetting() === 'system') syncThemeColor();
  });
}
