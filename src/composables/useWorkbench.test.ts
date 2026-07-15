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
} from '@/domain/builder';
import type { CircuitRow } from '@/db/schema';

import { clampPrescriptionValue, useWorkbench } from './useWorkbench';

// Against the real DB double (same driver as the device path): the
// composable's job is optimistic state + serialized persistence, and both
// halves are only provable with actual rows underneath.

let testDb: TestDb;
let db: DbClient;
let circuit: CircuitRow;
let itemIds: string[];

async function seed(): Promise<void> {
  circuit = await createCircuit(db, { kind: 'workout', name: 'Legs' });
  itemIds = [];
  for (const name of ['Lat Pulldown', 'Cable Row', 'Cable Face Pull']) {
    const exercise = await findOrCreateExercise(db, 'workout', name);
    const item = await addExerciseToCircuit(db, circuit.id, exercise.id);
    itemIds.push(item.id);
  }
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

    expect(workbench.status.value).toBe('unavailable');
  });

  it('applies a stepper tick optimistically and persists it', async () => {
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    const write = workbench.adjustPrescription(itemIds[0], 'sets', 1);

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
      last = workbench.adjustPrescription(itemIds[1], 'restSeconds', 15);
    }
    await last;

    expect(workbench.slots.value[1].restSeconds).toBe(135);
    const persisted = await listCircuitSlots(db, circuit.id);
    expect(persisted[1].restSeconds).toBe(135);
  });

  it('clamps at the bounds without writing', async () => {
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    await workbench.adjustPrescription(itemIds[0], 'restSeconds', -60);

    // Already at the floor: the next tick must not reach the DB at all
    // (every prescription write opens a transaction; none may start).
    const txSpy = vi.spyOn(db, 'transaction');
    await workbench.adjustPrescription(itemIds[0], 'restSeconds', -15);
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
    void workbench.adjustPrescription(itemIds[0], 'sets', 1);
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

  it('resyncs from the DB when the edited item vanished underneath', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const workbench = useWorkbench(db, () => circuit.id);
    await workbench.load();

    await removeCircuitItem(db, itemIds[0]);
    await workbench.adjustPrescription(itemIds[0], 'sets', 1);

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
