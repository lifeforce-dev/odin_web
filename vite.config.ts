import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

import { sqlRawPlugin } from './vite-plugin-sql-raw';

export default defineConfig({
  plugins: [vue(), sqlRawPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
