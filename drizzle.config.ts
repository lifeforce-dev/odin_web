import { defineConfig } from 'drizzle-kit';

// driver: 'expo' makes `drizzle-kit generate` emit src/db/migrations/migrations.js,
// a bundle with every migration's SQL inlined as strings. That is the only output
// format usable on device: the app applies migrations at startup through the
// Capacitor SQLite plugin (src/native/database.ts) and has no filesystem access
// to read .sql files the way drizzle's server-side migrators do.
export default defineConfig({
  dialect: 'sqlite',
  driver: 'expo',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
});
