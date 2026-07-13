import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';

import type * as schema from './schema';

// Every runtime path builds the SAME drizzle driver: sqlite-proxy over the
// Capacitor plugin on device (src/native/database.ts), sqlite-proxy over
// better-sqlite3 in Node tests (src/db/test-db.ts). One client type means
// db/ query functions are provably identical in both worlds.
export type DbClient = SqliteRemoteDatabase<typeof schema>;

// What db.transaction() hands its callback. Query functions accept the union
// so they compose into transactions without separate tx variants.
export type DbTransaction = Parameters<Parameters<DbClient['transaction']>[0]>[0];

export type DbHandle = DbClient | DbTransaction;
