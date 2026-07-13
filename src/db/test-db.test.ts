import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { toPositionalRows } from './proxy-rows';
import { createTestDb, toPluginStyleObjects } from './test-db';

// Pins the double's core fidelity mechanism. The device plugin returns each
// row as one object keyed by column name, so two selected columns sharing a
// bare name collapse into one key and misalign every later column. The
// double reproduces that collapse ON PURPOSE (a colliding query must fail in
// vitest, not corrupt data on device); this test is what keeps a well-meaning
// "simplification" from silently disabling the safety mechanism.
describe('toPluginStyleObjects', () => {
  it('collapses duplicate bare column names exactly like the plugin', () => {
    const columns = ['id', 'name', 'id'];
    const rawRows = [['exercise-1', 'Pushups', 'item-9']];

    const rows = toPositionalRows(toPluginStyleObjects(columns, rawRows));

    // Three selected columns come back as two values: the last duplicate
    // wins the shared key, and the row is silently misaligned.
    expect(rows).toEqual([['item-9', 'Pushups']]);
  });

  it('keeps distinct column names aligned in column order', () => {
    const columns = ['id', 'name'];
    const rawRows = [
      ['exercise-1', 'Pushups'],
      ['exercise-2', 'Squats'],
    ];

    const rows = toPositionalRows(toPluginStyleObjects(columns, rawRows));

    expect(rows).toEqual([
      ['exercise-1', 'Pushups'],
      ['exercise-2', 'Squats'],
    ]);
  });
});

describe('row-returning write backstop', () => {
  it('rejects a RETURNING write with the same error the device driver throws', async () => {
    // Raw SQL on purpose: the .returning() builder is lint-banned, and this
    // pins the runtime backstop that catches whatever slips past lint.
    // Drizzle wraps driver errors, so the backstop's message sits on the
    // cause chain, not the top-level message.
    const testDb = await createTestDb();
    try {
      const rejection = await testDb.db
        .all(sql`UPDATE exercise SET archived_at = NULL WHERE 1 = 0 RETURNING id`)
        .then(
          () => {
            throw new Error('expected the write to be rejected, but it resolved');
          },
          (raised: unknown) => raised,
        );
      const messages: string[] = [];
      for (let current: unknown = rejection; current instanceof Error; current = current.cause) {
        messages.push(current.message);
      }
      expect(messages.join(' | ')).toMatch(
        /row-returning writes are not supported on the device SQLite plugin/,
      );
    } finally {
      testDb.close();
    }
  });
});
