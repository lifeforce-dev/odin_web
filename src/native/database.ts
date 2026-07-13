import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { AsyncRemoteCallback } from 'drizzle-orm/sqlite-proxy';

import type { DbClient } from '@/db/client';
import { applyMigrations } from '@/db/migrate';
import type { MigrationExecutor } from '@/db/migrate';
import migrationBundle from '@/db/migrations/migrations';
import { toPositionalRows } from '@/db/proxy-rows';
import { isRowReturningWrite, rowReturningWriteError } from '@/db/proxy-statements';
import * as schema from '@/db/schema';

import { isNative } from './platform';

const DB_NAME = 'odin';

export class NativeOnlyError extends Error {
  constructor(feature: string) {
    super(`${feature} requires the installed app; it is not available in browser dev mode`);
    this.name = 'NativeOnlyError';
  }
}

let sqliteConnection: SQLiteConnection | null = null;
let connection: SQLiteDBConnection | null = null;
let client: DbClient | null = null;

// Builds the one live Drizzle client over the plugin and brings the schema
// up to date. main.ts awaits this before mounting: migrations must complete
// before the first screen queries.
export async function initDatabase(): Promise<void> {
  if (!isNative) {
    throw new NativeOnlyError('the on-device database');
  }
  if (client) {
    // The plugin's connection registry is stateful and double-opening
    // throws; hot reload re-runs startup, so init is idempotent by design.
    return;
  }

  sqliteConnection = new SQLiteConnection(CapacitorSQLite);
  connection = await obtainConnection(sqliteConnection);
  await connection.open();

  const applied = await applyMigrations(migrationBundle, pluginExecutor(connection));
  client = drizzle(drizzleCallback(connection), { schema });
  // Visible in logcat / Xcode console: the device smoke signal that startup
  // migration ran.
  console.info(`[odin-db] ready, migrations applied this start: ${applied}`);
}

export function getDb(): DbClient {
  if (!client) {
    throw new Error(
      'database not initialized: initDatabase() must complete before the first query',
    );
  }
  return client;
}

export async function closeDatabase(): Promise<void> {
  if (!sqliteConnection) {
    return;
  }
  await sqliteConnection.closeConnection(DB_NAME, false);
  sqliteConnection = null;
  connection = null;
  client = null;
}

// Hot reload (and relaunch after a crash) can leave the native side holding
// a connection this JS context does not know about. The consistency check
// plus retrieveConnection is the plugin README's recovery pattern for that.
async function obtainConnection(sqlite: SQLiteConnection): Promise<SQLiteDBConnection> {
  const consistent = (await sqlite.checkConnectionsConsistency()).result ?? false;
  const existing = (await sqlite.isConnection(DB_NAME, false)).result ?? false;
  if (consistent && existing) {
    return sqlite.retrieveConnection(DB_NAME, false);
  }
  return sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
}

function pluginExecutor(dbConnection: SQLiteDBConnection): MigrationExecutor {
  return {
    // One statement per run() call, never execute() on a joined script: the
    // plugin re-splits scripts with a naive lexer (split on ";\n", strip
    // everything after "--" on each line, even inside string literals),
    // which would corrupt a future migration that seeds data. run() takes
    // each statement whole, and the explicit transaction keeps the batch
    // atomic with the same semantics as the Node executor.
    executeBatch: async (statements) => {
      await dbConnection.beginTransaction();
      try {
        for (const statement of statements) {
          await dbConnection.run(statement, [], false);
        }
      } catch (error) {
        try {
          await dbConnection.rollbackTransaction();
        } catch {
          // The statement failure is the diagnosable error; a rollback
          // failure on top of it must not mask it.
        }
        throw error;
      }
      await dbConnection.commitTransaction();
    },
    queryValues: async (sql) => {
      const result = await dbConnection.query(sql);
      return toPositionalRows((result.values ?? []) as Record<string, unknown>[]);
    },
  };
}

// Bridges Drizzle to the plugin. Drizzle's method says what shape it wants
// back: plain writes arrive as method 'run' and go through run(); everything
// that asks for rows must be a pure read and goes through query(). A
// row-returning write (banned .returning() that slipped past lint) is
// rejected outright, because the plugin cannot execute it correctly (see
// src/db/proxy-statements.ts). The Node double (src/db/test-db.ts) mirrors
// these branches, so the rejection fires in vitest before it fires on
// device.
function drizzleCallback(dbConnection: SQLiteDBConnection): AsyncRemoteCallback {
  return async (sql, params, method) => {
    if (method === 'run') {
      // transaction=false: drizzle drives BEGIN/COMMIT itself through this
      // callback (db.transaction), so the plugin must not add its own
      // per-statement transaction wrapping.
      await dbConnection.run(sql, params, false);
      return { rows: [] };
    }

    if (isRowReturningWrite(sql)) {
      throw rowReturningWriteError(sql);
    }
    const objectRows = (await dbConnection.query(sql, params)).values ?? [];
    const rows = toPositionalRows(objectRows as Record<string, unknown>[]);

    if (method === 'get') {
      // A falsy rows value is the driver contract for "no row": it is what
      // makes drizzle's .get() resolve to undefined instead of an object
      // full of undefined columns.
      return { rows: rows[0] as unknown[] };
    }
    return { rows };
  };
}
