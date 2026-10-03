import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Pages serves the app at https://timtruty.com/Habits/. PAGES_BASE overrides it (e.g. "/" for a
// custom domain at the root). The dev server runs at "/".
const base = process.env.PAGES_BASE ?? '/Habits/';

// What the More page shows as the version: package.json's version and the commit it was built from
// (GITHUB_SHA in CI, else the local HEAD).
const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8'));
function commit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? base : '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commit()),
    __APP_BUILT__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  build: {
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, 'index.html'),
        embed: resolve(import.meta.dirname, 'embed.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.ts', 'supabase/functions/**/*.spec.ts', 'clients/**/*.spec.ts'],
    // A zone with DST, so date code is tested against real clock changes.
    env: { TZ: 'America/Chicago' },
    setupFiles: ['src/test-setup.ts'],
    // Process CSS so `?inline` imports (design/tokens.css) hold the real text in tests.
    css: { include: [/\.css/] },
    coverage: {
      include: [
        'src/scoring/**',
        'src/data/**',
        'src/format.ts',
        'clients/**',
        'supabase/functions/_shared/**',
      ],
      exclude: ['**/*.spec.ts', '**/test-helpers.ts'],
      thresholds: { 'src/scoring/**': { 100: true } },
    },
  },
}));
