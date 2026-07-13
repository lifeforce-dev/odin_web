import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { applyMigrations } from './migrate';
import type { MigrationBundle } from './migrate';
import { betterSqliteExecutor } from './test-db';

function bundleWith(entryCount: number): MigrationBundle {
  const full: MigrationBundle = {
    journal: {
      entries: [
        { idx: 0, when: 100, tag: '0000_first', breakpoints: true },
        { idx: 1, when: 200, tag: '0001_second', breakpoints: true },
      ],
    },
    migrations: {
      m0000:
        'CREATE TABLE alpha (id text PRIMARY KEY);\n--> statement-breakpoint\n' +
        'CREATE TABLE beta (id text PRIMARY KEY);',
      m0001: "INSERT INTO alpha (id) VALUES ('seeded');",
    },
  };
  return {
    journal: { entries: full.journal.entries.slice(0, entryCount) },
    migrations: full.migrations,
  };
}

describe('applyMigrations', () => {
  it('applies pending migrations in order and records them', async () => {
    const sqlite = new Database(':memory:');

    const applied = await applyMigrations(bundleWith(2), betterSqliteExecutor(sqlite));

    expect(applied).toBe(2);
    expect(sqlite.prepare('SELECT id FROM alpha').pluck().all()).toEqual(['seeded']);
    expect(sqlite.prepare('SELECT count(*) FROM beta').pluck().get()).toBe(0);
    expect(
      sqlite.prepare('SELECT hash FROM __drizzle_migrations ORDER BY created_at').pluck().all(),
    ).toEqual(['0000_first', '0001_second']);
  });

  it('is idempotent: a second run applies nothing', async () => {
    const sqlite = new Database(':memory:');
    await applyMigrations(bundleWith(2), betterSqliteExecutor(sqlite));

    expect(await applyMigrations(bundleWith(2), betterSqliteExecutor(sqlite))).toBe(0);
    expect(sqlite.prepare('SELECT count(*) FROM alpha').pluck().get()).toBe(1);
  });

  it('applies only entries newer than the last applied one', async () => {
    const sqlite = new Database(':memory:');
    await applyMigrations(bundleWith(1), betterSqliteExecutor(sqlite));

    expect(await applyMigrations(bundleWith(2), betterSqliteExecutor(sqlite))).toBe(1);
    expect(sqlite.prepare('SELECT id FROM alpha').pluck().all()).toEqual(['seeded']);
  });

  it('fails loudly when the bundle is missing a journal entry key', async () => {
    const sqlite = new Database(':memory:');
    const broken = bundleWith(2);
    delete broken.migrations.m0001;

    await expect(applyMigrations(broken, betterSqliteExecutor(sqlite))).rejects.toThrow(
      'missing m0001',
    );
  });

  it('applies nothing when a statement fails mid-batch, and recovers on retry', async () => {
    // The executor contract (all-or-none) is what the recovery story rests
    // on: without it, a mid-batch failure would leave a half-applied schema
    // PLUS its journal row, and idempotency would skip the broken migration
    // forever. This pins the rollback of both the DDL and the journal rows.
    const sqlite = new Database(':memory:');
    const broken = bundleWith(2);
    broken.migrations.m0001 =
      "INSERT INTO alpha (id) VALUES ('seeded');\n--> statement-breakpoint\n" +
      "INSERT INTO no_such_table (id) VALUES ('boom');";

    await expect(applyMigrations(broken, betterSqliteExecutor(sqlite))).rejects.toThrow();

    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('alpha', 'beta')")
      .pluck()
      .all();
    expect(tables).toEqual([]);
    expect(sqlite.prepare('SELECT count(*) FROM __drizzle_migrations').pluck().get()).toBe(0);

    expect(await applyMigrations(bundleWith(2), betterSqliteExecutor(sqlite))).toBe(2);
    expect(sqlite.prepare('SELECT id FROM alpha').pluck().all()).toEqual(['seeded']);
  });

  it('rejects a journal tag that would break the inlined record insert', async () => {
    // The tag is inlined into SQL (the executor API has no binds); the
    // format guard is what keeps that inlining honest.
    const sqlite = new Database(':memory:');
    const poisoned = bundleWith(1);
    poisoned.journal.entries[0].tag = "0000'; DROP TABLE alpha; --";

    await expect(applyMigrations(poisoned, betterSqliteExecutor(sqlite))).rejects.toThrow(
      'unexpected migration tag format',
    );
  });
});
