import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Pages serves the app at https://timtruty.com/Habits/. PAGES_BASE overrides it (e.g. "/" for a
// custom domain at the root). The dev server runs at "/".
const base = process.env.PAGES_BASE ?? '/Habits/';

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? base : '/',
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
    include: ['src/**/*.spec.ts'],
    // A zone with DST, so date code is tested against real clock changes.
    env: { TZ: 'America/Chicago' },
    coverage: {
      include: ['src/scoring/**', 'src/data/**', 'src/format.ts'],
      exclude: ['**/*.spec.ts', '**/test-helpers.ts'],
      thresholds: { 'src/scoring/**': { 100: true } },
    },
  },
}));
