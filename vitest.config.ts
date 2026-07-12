import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

// Two projects, deliberately split (epic 01 Task 1): domain/ and db/ run in
// plain Node with zero Vue in the module graph, proving the logic layers never
// depend on the UI stack. Component/composable/store tests get jsdom + the Vue
// plugin.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/domain/**/*.test.ts', 'src/db/**/*.test.ts'],
        },
      },
      {
        plugins: [vue()],
        resolve: {
          alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
          },
        },
        test: {
          name: 'components',
          environment: 'jsdom',
          include: [
            'src/components/**/*.test.ts',
            'src/composables/**/*.test.ts',
            'src/stores/**/*.test.ts',
          ],
        },
      },
    ],
  },
});
