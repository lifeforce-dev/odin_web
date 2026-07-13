import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

import { sqlRawPlugin } from './vite-plugin-sql-raw';

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

// Two projects, deliberately split (epic 01 Task 1): domain/, db/, and native/
// run in plain Node with zero Vue in the module graph, proving the logic
// layers never depend on the UI stack. Components/composables/stores/views/
// router get jsdom + the Vue plugin. Both projects need the same `@` alias -
// it's not inherited from vite.config.ts (vitest.config.ts fully replaces it
// when present, it doesn't merge).
export default defineConfig({
  test: {
    projects: [
      {
        // sqlRawPlugin: db/ tests apply the real generated migration bundle,
        // which imports .sql files (see vite-plugin-sql-raw.ts).
        plugins: [sqlRawPlugin()],
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'src/domain/**/*.test.ts',
            'src/db/**/*.test.ts',
            'src/native/**/*.test.ts',
            // Theme-contract validation reads css files from disk; no DOM
            // involved. npm run check:themes targets this same file.
            'src/styles/**/*.test.ts',
          ],
        },
      },
      {
        plugins: [vue()],
        resolve: { alias },
        test: {
          name: 'components',
          environment: 'jsdom',
          include: [
            'src/components/**/*.test.ts',
            'src/composables/**/*.test.ts',
            'src/stores/**/*.test.ts',
            'src/views/**/*.test.ts',
            'src/router/**/*.test.ts',
          ],
        },
      },
    ],
  },
});
