import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { applyMigrations } from './migrate';
import { betterSqliteExecutor, bundleThrough } from './test-db';

// Migration 0002 adds session.outcome and BACKFILLS 'completed' onto
// sessions ended before outcomes existed (03-03's minimal finishSession
// stamped endedAt only). Fresh test DBs apply the full bundle over
// empty tables, so only this test executes the backfill against
// populated v2 data. It also pins that the migration runs as plain
// ALTERs: drizzle-kit generated a table REBUILD here, which cannot run
// on device - the executor wraps the batch in one transaction, where
// PRAGMA foreign_keys=OFF is a documented no-op, so the rebuild's DROP
// TABLE fails the moment a set_log row references a session.

describe('migration 0002 outcome backfill', () => {
  it('backfills completed onto ended sessions and leaves in-flight null', async () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    await applyMigrations(bundleThrough(2), betterSqliteExecutor(sqlite));

    // A populated v2 device: one session ended by the minimal
    // finishSession, one still in flight, and a set_log row whose FK
    // must survive the migration (the rebuild trap above).
    sqlite.exec(`
      INSERT INTO circuit (id, kind, name, rotation_order, created_at)
      VALUES ('c1', 'workout', 'Push', 0, '2026-01-01T00:00:00Z');
      INSERT INTO exercise (id, kind, name, created_at)
      VALUES ('e1', 'workout', 'Bench Press', '2026-01-01T00:00:00Z');
      INSERT INTO session (id, circuit_id, started_at, ended_at)
      VALUES
        ('s-ended', 'c1', '2026-01-02T10:00:00Z', '2026-01-02T10:30:00Z'),
        ('s-flight', 'c1', '2026-01-03T10:00:00Z', NULL);
      INSERT INTO set_log
        (id, session_id, exercise_id, set_index, reps, weight, weight_unit, logged_at)
      VALUES ('l1', 's-ended', 'e1', 1, 10, 100, 'lb', '2026-01-02T10:05:00Z');
    `);

    // Sliced through 0002, not the full bundle: a later migration must
    // not silently join this test's apply-under-test step.
    expect(await applyMigrations(bundleThrough(3), betterSqliteExecutor(sqlite))).toBe(1);

    const sessions = sqlite.prepare('SELECT id, ended_at, outcome FROM session ORDER BY id').all();
    expect(sessions).toEqual([
      { id: 's-ended', ended_at: '2026-01-02T10:30:00Z', outcome: 'completed' },
      { id: 's-flight', ended_at: null, outcome: null },
    ]);

    // The populated child table came through intact.
    expect(sqlite.prepare('SELECT id FROM set_log').pluck().all()).toEqual(['l1']);

    // The CHECK landed with the migration, named as the schema declares.
    expect(() =>
      sqlite.prepare("UPDATE session SET outcome = 'paused' WHERE id = 's-flight'").run(),
    ).toThrow(/CHECK constraint failed: session_outcome_check/);
    sqlite.close();
  });
});
