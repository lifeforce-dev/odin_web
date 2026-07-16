import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { archiveExercise } from '@/db/exercises';
import { newId } from '@/db/ids';
import { createTestDb } from '@/db/test-db';
import type { TestDb } from '@/db/test-db';
import { expectRejectsWithCause } from '@/db/test-support';

import {
  BuilderError,
  DEFAULT_PRESCRIPTION,
  addExerciseToCircuit,
  archiveCircuit,
  createCircuit,
  findOrCreateExercise,
  getCircuitById,
  getPool,
  listActiveCircuits,
  listCircuitSlots,
  removeCircuitItem,
  renameCircuit,
  renameExercise,
  reorderCircuitItems,
  setPrescription,
  stealExercise,
  trashExercise,
} from './builder';

// Passthrough by default; the steal-atomicity test overrides one call to
// force a mid-transaction insert failure (see that test for why).
vi.mock('@/db/ids', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/ids')>();
  return { newId: vi.fn(actual.newId) };
});
const newIdMock = vi.mocked(newId);

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

async function expectBuilderError(promise: Promise<unknown>, code: BuilderError['code']) {
  const error = await promise.then(
    () => {
      throw new Error('expected the operation to reject, but it resolved');
    },
    (raised: unknown) => raised,
  );
  expect(error).toBeInstanceOf(BuilderError);
  expect((error as BuilderError).code).toBe(code);
}

describe('builder', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  describe('circuits', () => {
    it('creates a circuit readable by id, trimmed, appended to its kind rotation', async () => {
      const db = testDb.db;
      const push = await createCircuit(db, { kind: 'workout', name: '  Push Day ' });
      const legs = await createCircuit(db, { kind: 'workout', name: 'Leg Day' });
      const bedtime = await createCircuit(db, { kind: 'stretch', name: 'Bedtime' });

      expect(push.id).toMatch(UUID_V4);
      expect(push.createdAt).toMatch(ISO_UTC_MS);
      expect(push.name).toBe('Push Day');
      // Rotation order is scoped per kind: the stretch circuit starts its own.
      expect([push.rotationOrder, legs.rotationOrder, bedtime.rotationOrder]).toEqual([0, 1, 0]);
      expect(await getCircuitById(db, push.id)).toEqual(push);
      expect(await listActiveCircuits(db, 'workout')).toEqual([push, legs]);
      expect(await listActiveCircuits(db, 'stretch')).toEqual([bedtime]);
    });

    it('appends the rotation past archived circuits, never reusing their slot', async () => {
      // The max is taken over ALL rows of the kind, archived included
      // (createCircuit's documented rule). Filtering archived out - the
      // obvious-looking "tidy" since every other query does - would hand
      // the new circuit the archived one's rotationOrder.
      const db = testDb.db;
      const push = await createCircuit(db, { kind: 'workout', name: 'Push Day' });
      await archiveCircuit(db, push.id);

      const legs = await createCircuit(db, { kind: 'workout', name: 'Leg Day' });

      expect(legs.rotationOrder).toBe(push.rotationOrder + 1);
    });

    it('rejects a blank circuit name', async () => {
      await expectBuilderError(
        createCircuit(testDb.db, { kind: 'workout', name: '   ' }),
        'blank-name',
      );
    });

    it('renames with trimming, refusing blank, missing, and archived targets', async () => {
      const db = testDb.db;
      const push = await createCircuit(db, { kind: 'workout', name: 'Push Day' });

      expect(await renameCircuit(db, push.id, '  Upper Body ')).toBe(true);
      expect((await getCircuitById(db, push.id))?.name).toBe('Upper Body');
      await expectBuilderError(renameCircuit(db, push.id, ' '), 'blank-name');
      expect(await renameCircuit(db, 'no-such-id', 'X')).toBe(false);
      await archiveCircuit(db, push.id);
      expect(await renameCircuit(db, push.id, 'Zombie')).toBe(false);
    });

    it('archives once, hides the circuit from the rotation, and reports repeats', async () => {
      const db = testDb.db;
      const push = await createCircuit(db, { kind: 'workout', name: 'Push Day' });

      expect(await archiveCircuit(db, push.id)).toBe(true);
      expect(await listActiveCircuits(db, 'workout')).toEqual([]);
      expect(await archiveCircuit(db, push.id)).toBe(false);
      expect(await archiveCircuit(db, 'no-such-id')).toBe(false);
    });

    it('archiving a circuit releases its exercises back to the pool', async () => {
      const db = testDb.db;
      const push = await createCircuit(db, { kind: 'workout', name: 'Push Day' });
      const legs = await createCircuit(db, { kind: 'workout', name: 'Leg Day' });
      const pushups = await findOrCreateExercise(db, 'workout', 'Pushups');
      await addExerciseToCircuit(db, push.id, pushups.id);

      await archiveCircuit(db, push.id);

      const pool = await getPool(db, legs.id);
      expect(pool.available).toEqual([
        { exerciseId: pushups.id, name: 'Pushups', sets: 3, restSeconds: 60 },
      ]);
      expect(pool.heldElsewhere).toEqual([]);
      // The released exercise is addable again - no orphaned pointer blocks it.
      await expect(addExerciseToCircuit(db, legs.id, pushups.id)).resolves.toMatchObject({
        circuitId: legs.id,
      });
    });
  });

  describe('workout pool find-or-create', () => {
    it('creates a new exercise with the trimmed name and user casing', async () => {
      const created = await findOrCreateExercise(testDb.db, 'workout', '  Pushups Heavy ');

      expect(created.id).toMatch(UUID_V4);
      expect(created.name).toBe('Pushups Heavy');
      expect(created.kind).toBe('workout');
    });

    it('finds an existing active exercise case-insensitively instead of duplicating', async () => {
      const db = testDb.db;
      const original = await findOrCreateExercise(db, 'workout', 'Pushups');

      const found = await findOrCreateExercise(db, 'workout', '  PUSHUPS ');

      expect(found).toEqual(original);
    });

    it('matches on the ASCII-only fold the unique index uses, not JS toLowerCase()', async () => {
      // Umlaut-U casings (escaped to keep this file ASCII): SQLite ships
      // without ICU here (better-sqlite3 AND the device plugin), so lower()
      // leaves the umlaut U unfolded and these are DIFFERENT identities -
      // while JS toLowerCase() would have merged them. Pinning the
      // divergence keeps find-or-create consistent with the index instead
      // of fighting it.
      const db = testDb.db;
      const upper = await findOrCreateExercise(db, 'workout', '\u00dcBER Rows');

      const lower = await findOrCreateExercise(db, 'workout', '\u00fcber rows');

      expect(lower.id).not.toBe(upper.id);
    });

    it('refuses a name already taken by the other kind', async () => {
      const db = testDb.db;
      await findOrCreateExercise(db, 'stretch', 'Hamstring');

      await expectBuilderError(findOrCreateExercise(db, 'workout', 'hamstring'), 'kind-mismatch');
    });

    it('frees an archived name for a fresh identity', async () => {
      const db = testDb.db;
      const original = await findOrCreateExercise(db, 'workout', 'Dips');
      await archiveExercise(db, original.id);

      const fresh = await findOrCreateExercise(db, 'workout', 'Dips');

      expect(fresh.id).not.toBe(original.id);
      expect(fresh.archivedAt).toBeNull();
    });

    it('rejects a blank name', async () => {
      await expectBuilderError(findOrCreateExercise(testDb.db, 'workout', ' '), 'blank-name');
    });
  });

  describe('adding and editing slots', () => {
    it('appends slots with the default prescription, listed in position order', async () => {
      const db = testDb.db;
      const push = await createCircuit(db, { kind: 'workout', name: 'Push Day' });
      const pushups = await findOrCreateExercise(db, 'workout', 'Pushups');
      const dips = await findOrCreateExercise(db, 'workout', 'Dips');

      const first = await addExerciseToCircuit(db, push.id, pushups.id);
      const second = await addExerciseToCircuit(db, push.id, dips.id);

      // A pure association: the slot carries no prescription of its own;
      // the listed sets/rest below come from the exercise rows.
      expect(first).toMatchObject({ position: 0 });
      expect(second).toMatchObject({ position: 1 });
      expect(await listCircuitSlots(db, push.id)).toEqual([
        {
          id: first.id,
          exerciseId: pushups.id,
          exerciseName: 'Pushups',
          position: 0,
          sets: DEFAULT_PRESCRIPTION.sets,
          restSeconds: DEFAULT_PRESCRIPTION.restSeconds,
        },
        {
          id: second.id,
          exerciseId: dips.id,
          exerciseName: 'Dips',
          position: 1,
          sets: DEFAULT_PRESCRIPTION.sets,
          restSeconds: DEFAULT_PRESCRIPTION.restSeconds,
        },
      ]);
    });

    it('an empty circuit is a legal state with no slots', async () => {
      const db = testDb.db;
      const fresh = await createCircuit(db, { kind: 'workout', name: 'Being Built' });

      expect(await listCircuitSlots(db, fresh.id)).toEqual([]);
    });

    it('refuses cross-kind adds and inactive targets', async () => {
      const db = testDb.db;
      const push = await createCircuit(db, { kind: 'workout', name: 'Push Day' });
      const hamstring = await findOrCreateExercise(db, 'stretch', 'Hamstring');
      const pushups = await findOrCreateExercise(db, 'workout', 'Pushups');

      await expectBuilderError(addExerciseToCircuit(db, push.id, hamstring.id), 'kind-mismatch');
      await expectBuilderError(
        addExerciseToCircuit(db, 'no-such-circuit', pushups.id),
        'circuit-not-found',
      );
      await expectBuilderError(
        addExerciseToCircuit(db, push.id, 'no-such-exercise'),
        'exercise-not-found',
      );
      await archiveExercise(db, pushups.id);
      await expectBuilderError(addExerciseToCircuit(db, push.id, pushups.id), 'exercise-not-found');
    });

    it('fails loudly at the DB when adding an exercise any circuit already holds', async () => {
      // The UNIQUE(exercise_id) constraint IS the duplicate rule (02-03
      // task decision), and the SQLite reason travels on the cause chain
      // (01-04 decision) - this is what the steal UI will branch on.
      const db = testDb.db;
      const push = await createCircuit(db, { kind: 'workout', name: 'Push Day' });
      const legs = await createCircuit(db, { kind: 'workout', name: 'Leg Day' });
      const pushups = await findOrCreateExercise(db, 'workout', 'Pushups');
      await addExerciseToCircuit(db, push.id, pushups.id);

      await expectRejectsWithCause(
        addExerciseToCircuit(db, legs.id, pushups.id),
        /UNIQUE constraint failed: circuit_item\.exercise_id/,
      );
      await expectRejectsWithCause(
        addExerciseToCircuit(db, push.id, pushups.id),
        /UNIQUE constraint failed: circuit_item\.exercise_id/,
      );
    });

    it('removes a slot, freeing the exercise, and reports a missing item', async () => {
      const db = testDb.db;
      const push = await createCircuit(db, { kind: 'workout', name: 'Push Day' });
      const pushups = await findOrCreateExercise(db, 'workout', 'Pushups');
      const item = await addExerciseToCircuit(db, push.id, pushups.id);

      expect(await removeCircuitItem(db, item.id)).toBe(true);
      expect(await listCircuitSlots(db, push.id)).toEqual([]);
      expect((await getPool(db, push.id)).available).toEqual([
        { exerciseId: pushups.id, name: 'Pushups', sets: 3, restSeconds: 60 },
      ]);
      expect(await removeCircuitItem(db, item.id)).toBe(false);
    });

    it('applies partial prescription edits to the WORKOUT and validates the merged result', async () => {
      const db = testDb.db;
      const push = await createCircuit(db, { kind: 'workout', name: 'Push Day' });
      const pushups = await findOrCreateExercise(db, 'workout', 'Pushups');
      await addExerciseToCircuit(db, push.id, pushups.id);

      expect(await setPrescription(db, pushups.id, { sets: 5 })).toBe(true);
      expect(await setPrescription(db, pushups.id, { restSeconds: 90 })).toBe(true);
      // The slot reads the workout's values.
      expect(await listCircuitSlots(db, push.id)).toMatchObject([{ sets: 5, restSeconds: 90 }]);

      await expectBuilderError(
        setPrescription(db, pushups.id, { sets: 0 }),
        'invalid-prescription',
      );
      await expectBuilderError(
        setPrescription(db, pushups.id, { restSeconds: -1 }),
        'invalid-prescription',
      );
      await expectBuilderError(
        setPrescription(db, pushups.id, { sets: 2.5 }),
        'invalid-prescription',
      );
      expect(await setPrescription(db, 'no-such-exercise', { sets: 4 })).toBe(false);
      // Failed edits left the stored prescription untouched.
      expect(await listCircuitSlots(db, push.id)).toMatchObject([{ sets: 5, restSeconds: 90 }]);
    });

    it('edits an unheld (pool) workout the same way, refusing archived rows', async () => {
      const db = testDb.db;
      const push = await createCircuit(db, { kind: 'workout', name: 'Push Day' });
      const dips = await findOrCreateExercise(db, 'workout', 'Dips');

      expect(await setPrescription(db, dips.id, { sets: 4, restSeconds: 45 })).toBe(true);
      expect((await getPool(db, push.id)).available).toMatchObject([
        { name: 'Dips', sets: 4, restSeconds: 45 },
      ]);

      await archiveExercise(db, dips.id);
      expect(await setPrescription(db, dips.id, { sets: 5 })).toBe(false);
    });
  });

  describe('reorder', () => {
    it('rewrites positions densely from the given order', async () => {
      const db = testDb.db;
      const push = await createCircuit(db, { kind: 'workout', name: 'Push Day' });
      const a = await addExerciseToCircuit(
        db,
        push.id,
        (await findOrCreateExercise(db, 'workout', 'Pushups')).id,
      );
      const b = await addExerciseToCircuit(
        db,
        push.id,
        (await findOrCreateExercise(db, 'workout', 'Dips')).id,
      );
      const c = await addExerciseToCircuit(
        db,
        push.id,
        (await findOrCreateExercise(db, 'workout', 'Rows')).id,
      );

      await reorderCircuitItems(db, push.id, [c.id, a.id, b.id]);

      expect(await listCircuitSlots(db, push.id)).toMatchObject([
        { id: c.id, position: 0 },
        { id: a.id, position: 1 },
        { id: b.id, position: 2 },
      ]);
    });

    it('rejects any list that is not exactly the current items, changing nothing', async () => {
      const db = testDb.db;
      const push = await createCircuit(db, { kind: 'workout', name: 'Push Day' });
      const a = await addExerciseToCircuit(
        db,
        push.id,
        (await findOrCreateExercise(db, 'workout', 'Pushups')).id,
      );
      const b = await addExerciseToCircuit(
        db,
        push.id,
        (await findOrCreateExercise(db, 'workout', 'Dips')).id,
      );

      // Missing an item, carrying a stranger, and duplicating an id all fail.
      await expectBuilderError(reorderCircuitItems(db, push.id, [a.id]), 'reorder-mismatch');
      await expectBuilderError(
        reorderCircuitItems(db, push.id, [a.id, b.id, 'stranger']),
        'reorder-mismatch',
      );
      await expectBuilderError(reorderCircuitItems(db, push.id, [a.id, a.id]), 'reorder-mismatch');
      expect(await listCircuitSlots(db, push.id)).toMatchObject([
        { id: a.id, position: 0 },
        { id: b.id, position: 1 },
      ]);
    });
  });

  describe('steal', () => {
    it('moves the pointer in one step; the prescription travels with the workout', async () => {
      const db = testDb.db;
      const push = await createCircuit(db, { kind: 'workout', name: 'Push Day' });
      const legs = await createCircuit(db, { kind: 'workout', name: 'Leg Day' });
      const pushups = await findOrCreateExercise(db, 'workout', 'Pushups');
      await addExerciseToCircuit(db, push.id, pushups.id);
      await setPrescription(db, pushups.id, { sets: 5, restSeconds: 90 });
      await addExerciseToCircuit(
        db,
        legs.id,
        (await findOrCreateExercise(db, 'workout', 'Squats')).id,
      );

      const moved = await stealExercise(db, pushups.id, legs.id);

      // Old pointer gone, new one appended at the target's end - and the
      // 5x90 rides along (2026-07-15 amendment: sets/rest belong to the
      // workout, so a move can never reset them).
      expect(await listCircuitSlots(db, push.id)).toEqual([]);
      expect(await listCircuitSlots(db, legs.id)).toMatchObject([
        { exerciseName: 'Squats', position: 0, sets: 3, restSeconds: 60 },
        { id: moved.id, exerciseName: 'Pushups', position: 1, sets: 5, restSeconds: 90 },
      ]);
    });

    it('refuses stealing what is not held, already here, cross-kind, or into a dead circuit', async () => {
      const db = testDb.db;
      const push = await createCircuit(db, { kind: 'workout', name: 'Push Day' });
      const legs = await createCircuit(db, { kind: 'workout', name: 'Leg Day' });
      const bedtime = await createCircuit(db, { kind: 'stretch', name: 'Bedtime' });
      const pushups = await findOrCreateExercise(db, 'workout', 'Pushups');

      await expectBuilderError(stealExercise(db, pushups.id, legs.id), 'not-in-a-circuit');
      await addExerciseToCircuit(db, push.id, pushups.id);
      await expectBuilderError(stealExercise(db, pushups.id, push.id), 'already-in-circuit');
      await expectBuilderError(stealExercise(db, pushups.id, bedtime.id), 'kind-mismatch');
      await expectBuilderError(stealExercise(db, pushups.id, 'no-such-id'), 'circuit-not-found');
      // Nothing moved.
      expect(await listCircuitSlots(db, push.id)).toMatchObject([{ exerciseName: 'Pushups' }]);
    });

    it('rolls back the delete when the insert fails: old pointer intact, or both moved', async () => {
      // Forces a failure BETWEEN the delete and the insert by making the new
      // row's id collide with an existing item's primary key. If the steal
      // were two transactions, this would strand the exercise nowhere; one
      // transaction must roll the delete back.
      const db = testDb.db;
      const push = await createCircuit(db, { kind: 'workout', name: 'Push Day' });
      const legs = await createCircuit(db, { kind: 'workout', name: 'Leg Day' });
      const pushups = await findOrCreateExercise(db, 'workout', 'Pushups');
      const squats = await findOrCreateExercise(db, 'workout', 'Squats');
      await addExerciseToCircuit(db, push.id, pushups.id);
      const squatsItem = await addExerciseToCircuit(db, legs.id, squats.id);

      newIdMock.mockReturnValueOnce(squatsItem.id);
      await expectRejectsWithCause(
        stealExercise(db, pushups.id, legs.id),
        /UNIQUE constraint failed: circuit_item\.id/,
      );

      // Neither half happened: pushups still belongs to Push Day.
      expect(await listCircuitSlots(db, push.id)).toMatchObject([{ exerciseName: 'Pushups' }]);
      expect(await listCircuitSlots(db, legs.id)).toMatchObject([{ exerciseName: 'Squats' }]);
      expect((await getPool(db, legs.id)).heldElsewhere).toMatchObject([
        { exerciseId: pushups.id, ownerCircuitId: push.id },
      ]);
    });
  });

  describe('pool groups', () => {
    it('derives available and held-elsewhere with owner names, kind-scoped and ordered', async () => {
      const db = testDb.db;
      const push = await createCircuit(db, { kind: 'workout', name: 'Push Day' });
      const legs = await createCircuit(db, { kind: 'workout', name: 'Leg Day' });
      const pushups = await findOrCreateExercise(db, 'workout', 'Pushups');
      const squats = await findOrCreateExercise(db, 'workout', 'Squats');
      // Lowercase on purpose: lower(name) ordering puts it first, BINARY last.
      const burpees = await findOrCreateExercise(db, 'workout', 'burpees');
      const dips = await findOrCreateExercise(db, 'workout', 'Dips');
      const hamstring = await findOrCreateExercise(db, 'stretch', 'Hamstring');
      const archived = await findOrCreateExercise(db, 'workout', 'Old Move');
      await archiveExercise(db, archived.id);
      await addExerciseToCircuit(db, push.id, pushups.id);
      await addExerciseToCircuit(db, legs.id, squats.id);
      await addExerciseToCircuit(db, legs.id, burpees.id);

      const pool = await getPool(db, push.id);

      // In this circuit -> a slot, not a pool row. Other kind and archived
      // rows never appear. Both groups order by the same lower(name) fold.
      expect(pool.available).toEqual([
        { exerciseId: dips.id, name: 'Dips', sets: 3, restSeconds: 60 },
      ]);
      expect(pool.heldElsewhere).toEqual([
        {
          exerciseId: burpees.id,
          name: 'burpees',
          ownerCircuitId: legs.id,
          ownerCircuitName: 'Leg Day',
        },
        {
          exerciseId: squats.id,
          name: 'Squats',
          ownerCircuitId: legs.id,
          ownerCircuitName: 'Leg Day',
        },
      ]);
      expect(pool.available.map((entry) => entry.exerciseId)).not.toContain(hamstring.id);
    });

    it('refuses a pool for a missing or archived circuit', async () => {
      const db = testDb.db;
      const push = await createCircuit(db, { kind: 'workout', name: 'Push Day' });
      await archiveCircuit(db, push.id);

      await expectBuilderError(getPool(db, 'no-such-id'), 'circuit-not-found');
      await expectBuilderError(getPool(db, push.id), 'circuit-not-found');
    });
  });

  describe('workout rename / trash', () => {
    it('renames an active exercise, trimmed; misses and archived rows report false', async () => {
      const db = testDb.db;
      const pushups = await findOrCreateExercise(db, 'workout', 'Pushups');

      expect(await renameExercise(db, pushups.id, '  Pushups Heavy ')).toBe(true);
      expect((await findOrCreateExercise(db, 'workout', 'pushups heavy')).id).toBe(pushups.id);

      expect(await renameExercise(db, 'no-such-exercise', 'Anything')).toBe(false);
      await archiveExercise(db, pushups.id);
      expect(await renameExercise(db, pushups.id, 'Anything')).toBe(false);
      await expectBuilderError(renameExercise(db, pushups.id, '   '), 'blank-name');
    });

    it('surfaces a rename collision as the active-name constraint, untranslated', async () => {
      const db = testDb.db;
      await findOrCreateExercise(db, 'workout', 'Dips');
      const pushups = await findOrCreateExercise(db, 'workout', 'Pushups');

      await expectRejectsWithCause(renameExercise(db, pushups.id, 'dips'), /UNIQUE constraint/);
    });

    it('trashes an unheld workout out of the pool; repeats and misses report false', async () => {
      const db = testDb.db;
      const push = await createCircuit(db, { kind: 'workout', name: 'Push Day' });
      const dips = await findOrCreateExercise(db, 'workout', 'Dips');

      expect(await trashExercise(db, dips.id)).toBe(true);
      expect((await getPool(db, push.id)).available).toEqual([]);
      expect(await trashExercise(db, dips.id)).toBe(false);
      expect(await trashExercise(db, 'no-such-exercise')).toBe(false);
      // The archived identity frees its name: a re-create is a NEW
      // identity (find-or-create matches active rows only), not a revival.
      expect((await findOrCreateExercise(db, 'workout', 'Dips')).id).not.toBe(dips.id);
    });

    it('trashes a held workout in one step: the slot frees and the identity archives together', async () => {
      const db = testDb.db;
      const push = await createCircuit(db, { kind: 'workout', name: 'Push Day' });
      const pushups = await findOrCreateExercise(db, 'workout', 'Pushups');
      await addExerciseToCircuit(db, push.id, pushups.id);

      expect(await trashExercise(db, pushups.id)).toBe(true);

      // No stranded pointer at an archived identity, no pool row left.
      expect(await listCircuitSlots(db, push.id)).toEqual([]);
      expect((await getPool(db, push.id)).available).toEqual([]);
      expect((await getPool(db, push.id)).heldElsewhere).toEqual([]);
    });
  });
});
