import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { AsyncRemoteCallback } from 'drizzle-orm/sqlite-proxy';

import type { DbClient } from './client';
import { applyMigrations } from './migrate';
import type { MigrationBundle, MigrationExecutor } from './migrate';
import migrationBundle from './migrations/migrations';
import { toPositionalRows } from './proxy-rows';
import { isRowReturningWrite, rowReturningWriteError } from './proxy-statements';
import * as schema from './schema';

export interface TestDb {
  db: DbClient;
  close(): void;
}

// The Node stand-in for src/native/database.ts: the same sqlite-proxy
// driver, the same migration runner and bundle, the same object-row
// flattening, the same statement classification, with better-sqlite3 on a
// local file replacing the Capacitor plugin. Rows are deliberately
// materialized as column-name-keyed objects first, exactly as the plugin
// returns them, so a query whose SELECT list collides on a bare column name
// fails here in vitest instead of corrupting data on device (see
// src/db/proxy-rows.ts). Foreign keys are ON because the plugin enables them
// on every native open. Zero imports from src/native/: this file is the
// proof that db/ never depended on the plugin.
export async function createTestDb(): Promise<TestDb> {
  const dir = mkdtempSync(join(tmpdir(), 'odin-db-test-'));
  const sqlite = new Database(join(dir, 'odin.db'));
  const removeDir = (): void => {
    // On Windows a just-closed DB file can be transiently locked by the
    // AV/indexer; the retries absorb that. If deletion still fails after a
    // second, a handle really leaked and failing the test is correct.
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
  try {
    sqlite.pragma('foreign_keys = ON');
    await applyMigrations(migrationBundle, betterSqliteExecutor(sqlite));
  } catch (error) {
    // A leaked handle here would feed the exact Windows file-lock flake the
    // retries above exist to absorb.
    sqlite.close();
    removeDir();
    throw error;
  }
  return {
    db: drizzle(drizzleCallback(sqlite), { schema }),
    close: () => {
      sqlite.close();
      removeDir();
    },
  };
}

// Sliced migration bundle for populated-upgrade tests: seed at version
// count-1, then apply exactly the migration under test. A later
// migration joining the full bundle must not change what those tests
// execute - the full-bundle shortcut silently widens the subject the
// day the next migration lands.
export function bundleThrough(count: number): MigrationBundle {
  return {
    journal: { entries: migrationBundle.journal.entries.slice(0, count) },
    migrations: migrationBundle.migrations,
  };
}

export function betterSqliteExecutor(sqlite: Database.Database): MigrationExecutor {
  return {
    executeBatch: async (statements) => {
      sqlite.transaction(() => {
        for (const statement of statements) {
          sqlite.exec(statement);
        }
      })();
    },
    queryValues: async (sql) => sqlite.prepare(sql).raw(true).all() as unknown[][],
  };
}

// Mirrors src/native/database.ts's drizzleCallback branch for branch: plain
// writes via method 'run', row-returning writes rejected with the same
// error, reads materialized as plugin-style object rows and flattened
// positionally. On top of that, better-sqlite3's own compiler cross-checks
// the shared heuristic: a statement that reaches the read path but is not
// readonly means isRowReturningWrite() missed a write, and that drift must
// fail here, not on device.
function drizzleCallback(sqlite: Database.Database): AsyncRemoteCallback {
  return async (sql, params, method) => {
    const statement = sqlite.prepare(sql);
    if (method === 'run') {
      statement.run(...(params as unknown[]));
      return { rows: [] };
    }

    if (isRowReturningWrite(sql)) {
      throw rowReturningWriteError(sql);
    }
    if (!statement.readonly) {
      throw new Error(
        `classifier drift: isRowReturningWrite() classified a writing statement as a read: ${sql}`,
      );
    }

    const columns = statement.columns().map((column) => column.name);
    const rawRows = statement.raw(true).all(...(params as unknown[])) as unknown[][];
    const rows = toPositionalRows(toPluginStyleObjects(columns, rawRows));

    if (method === 'get') {
      // Falsy on no row, same contract as the device callback.
      return { rows: rows[0] as unknown[] };
    }
    return { rows };
  };
}

// Collapses duplicate column names exactly like the plugin's object rows do.
// Exported so the collapse itself is pinned by test: this lossiness is the
// safety mechanism that makes colliding SELECTs fail in vitest instead of
// corrupting data on device.
export function toPluginStyleObjects(
  columns: string[],
  rawRows: unknown[][],
): Record<string, unknown>[] {
  return rawRows.map((raw) => {
    const row: Record<string, unknown> = {};
    columns.forEach((name, index) => {
      row[name] = raw[index];
    });
    return row;
  });
}
