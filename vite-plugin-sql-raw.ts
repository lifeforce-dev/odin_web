import { readFileSync } from 'node:fs';

import type { Plugin } from 'vite';

// drizzle-kit's expo-driver migrations.js imports each migration's .sql file
// as a module (a Metro bundler convention). This teaches Vite and Vitest the
// same trick: a .sql import resolves to its file content as the default
// export. Shared by vite.config.ts and vitest.config.ts, which do not
// inherit from each other.
export function sqlRawPlugin(): Plugin {
  return {
    name: 'odin:sql-raw',
    load(id) {
      if (!id.endsWith('.sql')) {
        return null;
      }
      return `export default ${JSON.stringify(readFileSync(id, 'utf8'))};`;
    },
  };
}
