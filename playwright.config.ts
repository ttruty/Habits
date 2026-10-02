import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  use: {
    baseURL: 'http://localhost:4173/Habits/',
    // No transitions, so axe never samples a colour half-way through a fade.
    contextOptions: { reducedMotion: 'reduce' },
  },
  // Phone-first (design/DESIGN_SYSTEM.md §4); tests that need the dashboard set a wide viewport.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/Habits/',
    reuseExistingServer: !process.env.CI,
  },
});
