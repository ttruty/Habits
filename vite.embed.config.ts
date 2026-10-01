import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The single script host pages load: <script type="module" src=".../Habits/embed.js">.
// Lit is bundled in, so host pages need nothing else. Runs after the app build, into the same dist/.
export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/embed.ts'),
      formats: ['es'],
      fileName: () => 'embed.js',
    },
  },
});
