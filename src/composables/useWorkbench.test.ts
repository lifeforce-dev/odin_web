import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbClient } from '@/db/client';
import { createTestDb } from '@/db/test-db';
import type { TestDb } from '@/db/test-db';
import {
  addExerciseToCircuit,
  archiveCircuit,
  createCircuit,
  findOrCreateExercise,
  listCircuitSlots,
  removeCircuitItem,
  trashExercise,
} from '@/domain/builder';
import type { CircuitRow, ExerciseRow } from '@/db/schema';

import { clampPrescriptionValue, useWorkbench } from './useWorkbench';

// Against the real DB double (same driver as the device path): the
// composable's job is optimistic state + serialized persistence, and both
// halves are only provable with actual rows underneath.

let testDb: TestDb;
let db: DbClient;
let circuit: CircuitRow;
let itemIds: string[];
let exerciseIds: string[];
let otherCircuit: CircuitRow;
let pushups: ExerciseRow;
let gobletSquat: ExerciseRow;

async function seed(): Promise<void> {
  circuit = await createCircuit(db, { kind: 'workout', name: 'Legs' });
  itemIds = [];
  exerciseIds = [];
  for (const name of ['Lat Pulldown', 'Cable Row', 'Cable Face Pull']) {
    const exercise = await findOrCreateExercise(db, 'workout', name);
    const item = await addExerciseToCircuit(db, circuit.id, exercise.id);
    itemIds.push(item.id);
    exerciseIds.push(exercise.id);
  }
  // The pool around it: one workout held by another circuit, two free.
  otherCircuit = await createCircuit(db, { kind: 'workout', name: 'Upper Body' });
  pushups = await findOrCreateExercise(db, 'workout', 'Pushups');
  await addExerciseToCircuit(db, otherCircuit.id, pushups.id);
  gobletSquat = await findOrCreateExercise(db, 'workout', 'Goblet Squat');
  await findOrCreateExercise(db, 'workout', 'Kb Swing');
}

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
  await seed();
});

afterEach(() => {
  testDb.close();
  vi.restoreAllMocks();
});

describe('clampPrescriptionValue', () => {
  it('holds the stepper bounds from the canonical ref', () => {
    expect(clampPrescriptionValue('sets', 0)).toBe(1);
    expect(clampPrescriptionValue('sets', 21)).toBe(20);
    expect(clampPrescriptionValue('restSeconds', -15)).toBe(0);
    expect(clampPrescriptionValue('restSeconds', 615)).toBe(600);
  });
});

describe('useWorkbench', () => {
  it('loads the circuit name and its slots in position order', async () => {
    const workbench = useWorkbench(db, () => circuit.id);

    await workbench.load();

    expect(workbench.status.value).toBe('ready');
    expect(workbench.circuitName.value).toBe('Legs');
    expect(workbench.slots.value.map((slot) => slot.exerciseName)).toEqual([
      'Lat Pulldown',
      'Cable Row',
      'Cable Face Pull',
    ]);
  });

  it('reports missing for an unknown circuit id', async () => {
    const workbench = useWorkbench(db, () => 'no-such-circuit');

    await workbench.load();

    expect(workbench.status.value).toBe('missing');
    expect(workbench.slots.value).toEqual([]);
  });

  it('reports missing for an archived circuit, never an editable empty one', async () => {
    await archiveCircuit(db, circuit.id);
    const workbench = useWorkbench(db, () => circuit.id);

    await workbench.load();

    expect(workbench.status.value).toBe('missing');
    expect(workbench.slots.value).toEqual([]);
  });

  it('surfaces a failed load as an error status instead of hanging in loading', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const workbench = useWorkbench(db, () => circuit.id);
    testDb.close();

    await workbench.load();

    expect(workbench.status.value).toBe('error');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('reports unavailable with no database and every operation no-ops', async () => {
    const workbench = useWorkbench(null, () => circuit.id);

    await workbench.load();
    await workbench.adjustPrescription('anything', 'sets', 1);
    await workbench.removeSlot('anything');
    await workbench.reorderSlots([]);
    expect(await workbench.addFromPool('anything')).toBeNull();
    expect(await workbench.stealFromPool('anything')).toBeNull();
    expect(await workbench.createWorkout('anything')).toEqual({ kind: 'failed' });
    expect(await workbench.renameWorkout('anything', 'New Name')).toEqual({ kind: 'failed' });
    expect(await workbench.trashWorkout('anything')).toBe(false);

    expect(workbench.status.value).toBe('unavailable');
  });

  it('applies a stepper tick optimistically and persists it', async () => {
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    const write = workbench.adjustPrescription(exerciseIds[0], 'sets', 1);

    // Optimistic: the displayed value moved before the write settled.
    expect(workbench.slots.value[0].sets).toBe(4);

    await write;
    const persisted = await listCircuitSlots(db, circuit.id);
    expect(persisted[0].sets).toBe(4);
  });

  it('serializes a hold-to-ramp burst so the last tick wins in the DB', async () => {
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    let last: Promise<void> = Promise.resolve();
    for (let tick = 0; tick < 5; tick += 1) {
      last = workbench.adjustPrescription(exerciseIds[1], 'restSeconds', 15);
    }
    await last;

    expect(workbench.slots.value[1].restSeconds).toBe(135);
    const persisted = await listCircuitSlots(db, circuit.id);
    expect(persisted[1].restSeconds).toBe(135);
  });

  it('clamps at the bounds without writing', async () => {
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    await workbench.adjustPrescription(exerciseIds[0], 'restSeconds', -60);

    // Already at the floor: the next tick must not reach the DB at all
    // (every prescription write opens a transaction; none may start).
    const txSpy = vi.spyOn(db, 'transaction');
    await workbench.adjustPrescription(exerciseIds[0], 'restSeconds', -15);
    expect(txSpy).not.toHaveBeenCalled();

    expect(workbench.slots.value[0].restSeconds).toBe(0);
    const persisted = await listCircuitSlots(db, circuit.id);
    expect(persisted[0].restSeconds).toBe(0);
  });

  it('writes nothing when a reorder lands back in the same order', async () => {
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    const txSpy = vi.spyOn(db, 'transaction');
    await workbench.reorderSlots(itemIds);

    expect(txSpy).not.toHaveBeenCalled();
    expect(workbench.slots.value.map((slot) => slot.id)).toEqual(itemIds);
  });

  it('serializes mixed mutations so their transactions cannot collide', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    // Fired back-to-back with no awaits between them, the way a fast
    // thumb produces them. Each opens a real transaction on the one
    // shared connection; only the chain keeps the later BEGINs off the
    // wire until the earlier COMMITs land.
    void workbench.adjustPrescription(exerciseIds[0], 'sets', 1);
    void workbench.removeSlot(itemIds[1]);
    await workbench.reorderSlots([itemIds[2], itemIds[0]]);

    // No collision, no resync: every mutation landed, in emit order.
    expect(errorSpy).not.toHaveBeenCalled();
    const persisted = await listCircuitSlots(db, circuit.id);
    expect(persisted.map((slot) => slot.id)).toEqual([itemIds[2], itemIds[0]]);
    expect(persisted[1].sets).toBe(4);
    // And the screen converged on the same order (no silent drift).
    expect(workbench.slots.value.map((slot) => slot.id)).toEqual([itemIds[2], itemIds[0]]);
  });

  it('resyncs from the DB when the edited workout vanished underneath', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    // Trashed under the screen (the only way a workout truly vanishes):
    // the write reports false and the DB wins.
    await trashExercise(db, exerciseIds[0]);
    await workbench.adjustPrescription(exerciseIds[0], 'sets', 1);

    expect(errorSpy).toHaveBeenCalled();
    expect(workbench.slots.value.map((slot) => slot.id)).toEqual([itemIds[1], itemIds[2]]);
  });

  it('removes a slot and reloads the remaining ones', async () => {
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    await workbench.removeSlot(itemIds[1]);

    expect(workbench.slots.value.map((slot) => slot.id)).toEqual([itemIds[0], itemIds[2]]);
    const persisted = await listCircuitSlots(db, circuit.id);
    expect(persisted).toHaveLength(2);
  });

  it('reorders optimistically and persists through app-restart reads', async () => {
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    const newOrder = [itemIds[2], itemIds[0], itemIds[1]];
    const pending = workbench.reorderSlots(newOrder);

    expect(workbench.slots.value.map((slot) => slot.id)).toEqual(newOrder);

    await pending;
    // A fresh reader (= relaunch) sees the same order.
    const persisted = await listCircuitSlots(db, circuit.id);
    expect(persisted.map((slot) => slot.id)).toEqual(newOrder);
  });

  it('resyncs when a reorder went stale (reorder-mismatch)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    await removeCircuitItem(db, itemIds[0]);
    await workbench.reorderSlots([itemIds[2], itemIds[0], itemIds[1]]);

    expect(errorSpy).toHaveBeenCalled();
    // The DB order won: the removed item is gone, the others untouched.
    expect(workbench.slots.value.map((slot) => slot.id)).toEqual([itemIds[1], itemIds[2]]);
  });
});

describe('useWorkbench / pool', () => {
  it('loads both pool groups; the circuit holds its own workouts in neither', async () => {
    const workbench = useWorkbench(db, () => circuit.id);

    await workbench.load();

    // Available cards carry their own prescription (the same editable
    // control as the circuit's).
    expect(workbench.pool.value.available).toEqual([
      { exerciseId: gobletSquat.id, name: 'Goblet Squat', sets: 3, restSeconds: 60 },
      { exerciseId: expect.any(String), name: 'Kb Swing', sets: 3, restSeconds: 60 },
    ]);
    expect(workbench.pool.value.heldElsewhere).toEqual([
      {
        exerciseId: pushups.id,
        name: 'Pushups',
        ownerCircuitId: otherCircuit.id,
        ownerCircuitName: 'Upper Body',
      },
    ]);
  });

  it('edits a pool workout in place, and the values ride the add into the circuit', async () => {
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    await workbench.adjustPrescription(gobletSquat.id, 'sets', 2);
    await workbench.adjustPrescription(gobletSquat.id, 'restSeconds', 30);
    expect(workbench.pool.value.available[0]).toMatchObject({ sets: 5, restSeconds: 90 });

    await workbench.addFromPool(gobletSquat.id);

    // The workout arrives as configured in the pool - never a re-default.
    const added = workbench.slots.value.find((slot) => slot.exerciseId === gobletSquat.id);
    expect(added).toMatchObject({ sets: 5, restSeconds: 90 });
  });

  it('tap-adds an available workout to the end and refreshes both zones', async () => {
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    const itemId = await workbench.addFromPool(gobletSquat.id);

    expect(itemId).not.toBeNull();
    expect(workbench.slots.value.map((slot) => slot.exerciseName)).toEqual([
      'Lat Pulldown',
      'Cable Row',
      'Cable Face Pull',
      'Goblet Squat',
    ]);
    expect(workbench.pool.value.available.map((entry) => entry.name)).toEqual(['Kb Swing']);
    // And it persisted: a fresh reader sees the same list.
    const persisted = await listCircuitSlots(db, circuit.id);
    expect(persisted.map((slot) => slot.exerciseName)).toContain('Goblet Squat');
  });

  it('drag-adds at the previewed gap position', async () => {
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    const itemId = await workbench.addFromPool(gobletSquat.id, 1);

    expect(workbench.slots.value.map((slot) => slot.exerciseName)).toEqual([
      'Lat Pulldown',
      'Goblet Squat',
      'Cable Row',
      'Cable Face Pull',
    ]);
    const persisted = await listCircuitSlots(db, circuit.id);
    expect(persisted.map((slot) => slot.id)[1]).toBe(itemId);
  });

  it('steals a held workout: this circuit gains it, the owner loses it', async () => {
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    const itemId = await workbench.stealFromPool(pushups.id, 0);

    expect(itemId).not.toBeNull();
    expect(workbench.slots.value[0].exerciseName).toBe('Pushups');
    expect(workbench.pool.value.heldElsewhere).toEqual([]);
    // Both circuits' persisted state moved in the one transaction.
    const ownerSlots = await listCircuitSlots(db, otherCircuit.id);
    expect(ownerSlots).toEqual([]);
  });

  it('resyncs instead of drifting when an add hits the exclusivity constraint', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    // A stale screen tap-adds a workout some circuit already holds: the
    // DB constraint is the rule; the screen reloads rather than guesses.
    const itemId = await workbench.addFromPool(pushups.id);

    expect(itemId).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    expect(workbench.slots.value.map((slot) => slot.exerciseName)).not.toContain('Pushups');
  });

  it('creates a brand-new workout into AVAILABLE and leaves the circuit alone', async () => {
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    const outcome = await workbench.createWorkout('Dead Bug');

    expect(outcome.kind).toBe('in-pool');
    // 02-07 ruling: no auto-add - the workout waits in the pool.
    expect(workbench.pool.value.available.map((entry) => entry.name)).toContain('Dead Bug');
    expect(workbench.slots.value.map((slot) => slot.exerciseName)).not.toContain('Dead Bug');
    expect(await listCircuitSlots(db, circuit.id)).toHaveLength(3);
  });

  it('reuses an available identity on a case-insensitive name match', async () => {
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    const outcome = await workbench.createWorkout('goblet squat');

    // One identity, one history: the existing exercise is pointed at,
    // never a lowercase twin created beside it.
    expect(outcome).toEqual({ kind: 'in-pool', exerciseId: gobletSquat.id });
    expect(workbench.pool.value.available.map((entry) => entry.name)).toEqual([
      'Goblet Squat',
      'Kb Swing',
    ]);
  });

  it('renames a pool workout in place', async () => {
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    const outcome = await workbench.renameWorkout(gobletSquat.id, 'Goblet Squat Heavy');

    expect(outcome).toEqual({ kind: 'renamed' });
    expect(workbench.pool.value.available.map((entry) => entry.name)).toEqual([
      'Goblet Squat Heavy',
      'Kb Swing',
    ]);
  });

  it('rejects a rename onto a taken name with a notice, nothing written', async () => {
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    const outcome = await workbench.renameWorkout(gobletSquat.id, 'kb swing');

    expect(outcome).toEqual({ kind: 'rejected', message: "'kb swing' is already taken" });
    expect(workbench.pool.value.available.map((entry) => entry.name)).toEqual([
      'Goblet Squat',
      'Kb Swing',
    ]);
  });

  it('trashes a pool workout (archive; history kept, name freed)', async () => {
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    const trashed = await workbench.trashWorkout(gobletSquat.id);

    expect(trashed).toBe(true);
    expect(workbench.pool.value.available.map((entry) => entry.name)).toEqual(['Kb Swing']);
    // The archived identity keeps its history but frees the name:
    // find-or-create matches ACTIVE rows only, so a re-create is a new
    // identity, not a revival.
    const recreated = await findOrCreateExercise(db, 'workout', 'Goblet Squat');
    expect(recreated.id).not.toBe(gobletSquat.id);
  });

  it('trashes a circuit workout: the slot frees and both zones refresh', async () => {
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    const trashed = await workbench.trashWorkout(exerciseIds[1]);

    expect(trashed).toBe(true);
    expect(workbench.slots.value.map((slot) => slot.id)).toEqual([itemIds[0], itemIds[2]]);
    const persisted = await listCircuitSlots(db, circuit.id);
    expect(persisted.map((slot) => slot.exerciseName)).toEqual(['Lat Pulldown', 'Cable Face Pull']);
  });

  it('points at the existing card when the created name is already in this circuit', async () => {
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    const outcome = await workbench.createWorkout('Cable Row');

    expect(outcome).toEqual({ kind: 'already-in-circuit', exerciseId: exerciseIds[1] });
    expect(workbench.slots.value).toHaveLength(3);
  });

  it('routes a name held by another circuit to the steal flow, never a silent steal', async () => {
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    const outcome = await workbench.createWorkout('Pushups');

    expect(outcome).toEqual({ kind: 'held-elsewhere', exerciseId: pushups.id });
    // Still on the owner's rack; nothing moved.
    const ownerSlots = await listCircuitSlots(db, otherCircuit.id);
    expect(ownerSlots).toHaveLength(1);
  });

  it('rejects a name that exists as the other kind, with the domain verdict', async () => {
    await findOrCreateExercise(db, 'stretch', 'Cat Cow');
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    const outcome = await workbench.createWorkout('Cat Cow');

    expect(outcome.kind).toBe('rejected');
    expect(outcome.kind === 'rejected' && outcome.message).toContain('stretch');
  });
});
