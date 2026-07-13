// Startup migration runner over drizzle-kit's expo-driver bundle
// (src/db/migrations/migrations.js). Drizzle ships no migrator this app can
// use directly: the fs-based ones cannot read .sql files on device, and the
// expo one imports react at module scope. This reimplements the same
// semantics over an injected executor: journal entries newer than the last
// applied created_at run in idx order, split on drizzle's
// statement-breakpoint marker, and are recorded in __drizzle_migrations
// (same table name and columns as drizzle's own migrators, so a later switch
// to an official runner finds compatible state).

export interface MigrationJournalEntry {
  idx: number;
  when: number;
  tag: string;
  breakpoints: boolean;
}

export interface MigrationBundle {
  journal: { entries: MigrationJournalEntry[] };
  migrations: Record<string, string>;
}

// Who talks to SQLite is injected: the Capacitor plugin connection on device
// (src/native/database.ts), better-sqlite3 in Node tests (src/db/test-db.ts).
export interface MigrationExecutor {
  // Runs a batch of statements atomically: all of them apply or none do.
  executeBatch(statements: string[]): Promise<void>;
  // Runs one SELECT and returns rows as positional value arrays.
  queryValues(sql: string): Promise<unknown[][]>;
}

const MIGRATIONS_TABLE = '__drizzle_migrations';
const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

// Returns how many migrations were applied.
export async function applyMigrations(
  bundle: MigrationBundle,
  executor: MigrationExecutor,
): Promise<number> {
  await executor.executeBatch([
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (` +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)',
  ]);

  const rows = await executor.queryValues(
    `SELECT created_at FROM ${MIGRATIONS_TABLE} ORDER BY created_at DESC LIMIT 1`,
  );
  const lastAppliedMillis = rows.length > 0 ? Number(rows[0][0]) : 0;

  const pending = bundle.journal.entries
    .filter((entry) => entry.when > lastAppliedMillis)
    .sort((a, b) => a.idx - b.idx);

  const statements = pending.flatMap((entry) => [
    ...migrationStatements(bundle, entry),
    recordAppliedStatement(entry),
  ]);
  if (statements.length > 0) {
    await executor.executeBatch(statements);
  }
  return pending.length;
}

function migrationStatements(bundle: MigrationBundle, entry: MigrationJournalEntry): string[] {
  const key = `m${String(entry.idx).padStart(4, '0')}`;
  const sql = bundle.migrations[key];
  if (!sql) {
    throw new Error(`migration bundle is missing ${key} (journal tag ${entry.tag})`);
  }
  return sql
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function recordAppliedStatement(entry: MigrationJournalEntry): string {
  // The executor API has no bind parameters, so values are inlined. Tags are
  // drizzle-generated identifiers; the check keeps the inlining honest. The
  // tag goes in the hash column (drizzle's expo migrator writes '' there, so
  // nothing depends on real hashes and the tag is far more diagnosable).
  if (!/^[A-Za-z0-9_]+$/.test(entry.tag)) {
    throw new Error(`unexpected migration tag format: ${entry.tag}`);
  }
  return `INSERT INTO ${MIGRATIONS_TABLE} (hash, created_at) VALUES ('${entry.tag}', ${entry.when})`;
}
