import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { applyMigrations } from './migrate';
import { betterSqliteExecutor, bundleThrough } from './test-db';

// Migration 0001 moves sets/rest_seconds from circuit_item onto
// exercise and CARRIES existing per-slot values across (the correlated
// UPDATE). Every other test applies the full bundle to a fresh file, so
// that carry only ever ran over empty tables; this is the one test that
// executes it against populated v1 data - the longest-failure-distance
// lines in the repo (a swapped column pair or a broken correlation
// would corrupt every existing device on upgrade with every other test
// green, and migrated data cannot be hotfixed back).

describe('migration 0001 data carry', () => {
  it('carries each held slot prescription onto its exercise; unheld get defaults', async () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    await applyMigrations(bundleThrough(1), betterSqliteExecutor(sqlite));

    // A populated v1 device: two held workouts with DISTINCT non-default
    // prescriptions (a swapped sets/rest pair or a broken correlation
    // must produce a visible mismatch), plus one never held.
    sqlite.exec(`
      INSERT INTO circuit (id, kind, name, rotation_order, created_at)
      VALUES ('c1', 'workout', 'Legs', 0, '2026-01-01T00:00:00Z');
      INSERT INTO exercise (id, kind, name, created_at)
      VALUES
        ('e1', 'workout', 'Lat Pulldown', '2026-01-01T00:00:00Z'),
        ('e2', 'workout', 'Cable Row', '2026-01-01T00:00:00Z'),
        ('e3', 'workout', 'Goblet Squat', '2026-01-01T00:00:00Z');
      INSERT INTO circuit_item (id, circuit_id, exercise_id, position, sets, rest_seconds)
      VALUES
        ('i1', 'c1', 'e1', 0, 5, 45),
        ('i2', 'c1', 'e2', 1, 2, 120);
    `);

    expect(await applyMigrations(bundleThrough(2), betterSqliteExecutor(sqlite))).toBe(1);

    const carried = sqlite.prepare('SELECT id, sets, rest_seconds FROM exercise ORDER BY id').all();
    expect(carried).toEqual([
      { id: 'e1', sets: 5, rest_seconds: 45 },
      { id: 'e2', sets: 2, rest_seconds: 120 },
      // Never held: the storage defaults, not another slot's values.
      { id: 'e3', sets: 3, rest_seconds: 60 },
    ]);

    // The association is pure afterwards: the per-slot columns are gone.
    const itemColumns = sqlite
      .prepare("SELECT name FROM pragma_table_info('circuit_item')")
      .pluck()
      .all();
    expect(itemColumns).toEqual(['id', 'circuit_id', 'exercise_id', 'position']);
    sqlite.close();
  });
});
