import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { archiveExercise, createExercise, listActiveExercises } from './exercises';
import { createTestDb } from './test-db';
import type { TestDb } from './test-db';

// crypto.randomUUID() produces v4 UUIDs.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('exercises', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it('creates a persisted exercise', async () => {
    const created = await createExercise(testDb.db, { kind: 'workout', name: 'Pushups' });

    expect(created.id).toMatch(UUID_V4);
    expect(created.createdAt).toMatch(ISO_UTC_MS);
    expect(await listActiveExercises(testDb.db, 'workout')).toEqual([created]);
  });

  it('trims surrounding whitespace but keeps the user casing', async () => {
    const created = await createExercise(testDb.db, { kind: 'workout', name: '  Pushups Heavy ' });

    expect(created.name).toBe('Pushups Heavy');
    expect(await listActiveExercises(testDb.db, 'workout')).toEqual([created]);
  });

  it('lists only active exercises of the requested kind, ordered case-insensitively', async () => {
    const wallStretch = await createExercise(testDb.db, { kind: 'stretch', name: 'Wall Stretch' });
    const squats = await createExercise(testDb.db, { kind: 'workout', name: 'Squats' });
    const pushups = await createExercise(testDb.db, { kind: 'workout', name: 'Pushups' });
    const dips = await createExercise(testDb.db, { kind: 'workout', name: 'Dips' });
    // Lowercase on purpose: BINARY collation would sort it after every
    // capitalized name; lower(name) ordering puts it first.
    const burpees = await createExercise(testDb.db, { kind: 'workout', name: 'burpees' });
    await archiveExercise(testDb.db, dips.id);

    expect(await listActiveExercises(testDb.db, 'workout')).toEqual([burpees, pushups, squats]);
    expect(await listActiveExercises(testDb.db, 'stretch')).toEqual([wallStretch]);
  });

  it('archives once and reports an already-archived or missing row', async () => {
    const created = await createExercise(testDb.db, { kind: 'workout', name: 'Rows' });

    expect(await archiveExercise(testDb.db, created.id)).toBe(true);
    expect(await archiveExercise(testDb.db, created.id)).toBe(false);
    expect(await archiveExercise(testDb.db, 'no-such-id')).toBe(false);
  });

  it('rolls back the whole transaction when it throws', async () => {
    const kept = await createExercise(testDb.db, { kind: 'workout', name: 'Keep' });

    await expect(
      testDb.db.transaction(async (tx) => {
        await createExercise(tx, { kind: 'workout', name: 'Lost' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await listActiveExercises(testDb.db, 'workout')).toEqual([kept]);
  });
});
