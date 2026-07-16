import { ref } from 'vue';

import type { DbClient } from '@/db/client';
import {
  BuilderError,
  addExerciseToCircuit,
  findOrCreateExercise,
  getCircuitById,
  getPool,
  listCircuitSlots,
  removeCircuitItem,
  renameExercise,
  reorderCircuitItems,
  restoreExercise,
  setPrescription,
  stealExercise,
  trashExercise,
} from '@/domain/builder';
import type {
  CircuitKind,
  CircuitSlot,
  PoolGroups,
  Prescription,
  TrashedWorkout,
} from '@/domain/builder';

import { orderAfterDrop } from './useWorkbenchDrag';

// The workbench's domain adapter (tasks 02-04/02-05): reactive circuit
// and pool state over domain/builder.ts. Edits apply live - every
// stepper tick lands in the DB, there is no save button. Components stay
// render + emit; the rules (bounds, resync-on-failure, exact-permutation
// reorders, create collision routing) live here and below in domain/.

export type WorkbenchStatus = 'loading' | 'ready' | 'missing' | 'unavailable' | 'error';

export type PrescriptionField = keyof Prescription;

// What became of an inline create, for the screen to route: reveal the
// pool row (created or already free - 02-07: create stays in the pool,
// nothing auto-adds), flash the slot (already here), open the owner's
// steal strip (create never silently steals), or show the domain's
// verdict on the name.
export type CreateWorkoutOutcome =
  | { kind: 'in-pool'; exerciseId: string }
  | { kind: 'already-in-circuit'; exerciseId: string }
  | { kind: 'held-elsewhere'; exerciseId: string }
  | { kind: 'rejected'; message: string }
  | { kind: 'failed' };

// What became of a pool-tray rename: rejected carries the message the
// tray shows (name taken / blank); failed means the chain resynced.
export type RenameWorkoutOutcome =
  { kind: 'renamed' } | { kind: 'rejected'; message: string } | { kind: 'failed' };

// The SQLite reason only travels on the wrapped error's cause chain
// (01-04 decision); reacting to a specific violation means walking it.
function isUniqueConstraintViolation(error: unknown): boolean {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if (/UNIQUE constraint failed/i.test(current.message)) {
      return true;
    }
  }
  return false;
}

// UI stepper bounds from the canonical workbench-slot ref. Domain
// validation is wider (sets >= 1, rest >= 0); these are the affordance
// limits the steppers stop at.
export const PRESCRIPTION_BOUNDS: Record<PrescriptionField, { min: number; max: number }> = {
  sets: { min: 1, max: 20 },
  restSeconds: { min: 0, max: 600 },
};

export function clampPrescriptionValue(field: PrescriptionField, value: number): number {
  const { min, max } = PRESCRIPTION_BOUNDS[field];
  return Math.min(max, Math.max(min, value));
}

// db is null in browser dev mode (no on-device SQLite; see main.ts):
// status reports 'unavailable' and every operation is a no-op.
export function useWorkbench(db: DbClient | null, circuitId: () => string) {
  const status = ref<WorkbenchStatus>(db ? 'loading' : 'unavailable');
  const circuitName = ref('');
  const slots = ref<CircuitSlot[]>([]);
  const pool = ref<PoolGroups>({ available: [], heldElsewhere: [] });

  // The circuit's kind, held for find-or-create (the pool only ever
  // shows this kind, so a created workout inherits it).
  let circuitKind: CircuitKind | null = null;

  // EVERY mutation rides one chain, in emit order. Ordering matters for
  // hold-to-ramp bursts (the last write decides the row), but the chain
  // is also a driver invariant: sqlite-proxy transactions are raw
  // BEGIN/COMMIT over the single shared connection, so two concurrent
  // db.transaction calls cannot both succeed - the second BEGIN rejects.
  let writeChain: Promise<void> = Promise.resolve();

  function enqueue(operation: () => Promise<void>): Promise<void> {
    writeChain = writeChain.then(operation).catch(resync);
    return writeChain;
  }

  async function load(): Promise<void> {
    if (!db) {
      return;
    }
    try {
      const circuit = await getCircuitById(db, circuitId());
      if (!circuit || circuit.archivedAt !== null) {
        status.value = 'missing';
        circuitName.value = '';
        circuitKind = null;
        slots.value = [];
        pool.value = { available: [], heldElsewhere: [] };
        return;
      }
      circuitName.value = circuit.name;
      circuitKind = circuit.kind;
      slots.value = await listCircuitSlots(db, circuit.id);
      pool.value = await getPool(db, circuit.id);
      status.value = 'ready';
    } catch (error) {
      // A failed read must fail on the glass, not only in logcat: the
      // screen renders this status with a retry (repo rule: loud on
      // device). Also keeps the write chain unbreakable - resync awaits
      // load, so load must never reject.
      console.error('[odin] workbench load failed', error);
      status.value = 'error';
    }
  }

  // On any failed or stale write the DB is the truth: reload rather than
  // guess, so the screen can never drift from what is persisted.
  async function resync(error: unknown): Promise<void> {
    console.error('[odin] workbench operation failed; reloading from DB', error);
    await load();
  }

  // Optimistic: the displayed value moves on the same tick as the tap so
  // hold-to-ramp reads instantly; the write follows on the chain. Keyed
  // to the WORKOUT, so the same edit works from a circuit slot and a
  // pool card (2026-07-15 amendment). Returns the queued write so tests
  // (and callers that care) can await it.
  function adjustPrescription(
    exerciseId: string,
    field: PrescriptionField,
    delta: number,
  ): Promise<void> {
    if (!db) {
      return Promise.resolve();
    }
    const card =
      slots.value.find((entry) => entry.exerciseId === exerciseId) ??
      pool.value.available.find((entry) => entry.exerciseId === exerciseId);
    if (!card) {
      return Promise.resolve();
    }
    const next = clampPrescriptionValue(field, card[field] + delta);
    if (next === card[field]) {
      return Promise.resolve();
    }
    card[field] = next;
    const changes: Partial<Prescription> =
      field === 'sets' ? { sets: next } : { restSeconds: next };
    return enqueue(async () => {
      const updated = await setPrescription(db, exerciseId, changes);
      if (!updated) {
        // The workout vanished underneath the edit (trashed elsewhere).
        await resync(new Error(`workout ${exerciseId} disappeared during a live edit`));
      }
    });
  }

  function removeSlot(itemId: string): Promise<void> {
    if (!db) {
      return Promise.resolve();
    }
    return enqueue(async () => {
      await removeCircuitItem(db, itemId);
      await load();
    });
  }

  function reorderSlots(orderedItemIds: string[]): Promise<void> {
    if (!db) {
      return Promise.resolve();
    }
    // A card dropped back where it came from writes nothing (02-04
    // decision); display order is array order, so the comparison is
    // against the current array.
    const unchanged =
      orderedItemIds.length === slots.value.length &&
      orderedItemIds.every((id, index) => slots.value[index]?.id === id);
    if (unchanged) {
      return Promise.resolve();
    }
    // Optimistic: the rows land where they were dropped immediately. The
    // stale local `position` values are refreshed by the next load.
    const byId = new Map(slots.value.map((slot) => [slot.id, slot]));
    const reordered = orderedItemIds.flatMap((id) => byId.get(id) ?? []);
    const applied = reordered.length === slots.value.length;
    if (applied) {
      slots.value = reordered;
    }
    // A stale drag (reorder-mismatch) rejects into resync: the DB wins.
    return enqueue(async () => {
      await reorderCircuitItems(db, circuitId(), orderedItemIds);
      if (!applied) {
        // The optimistic map missed (the list changed under the gesture,
        // e.g. a queued remove) but the write still landed: reload so
        // the screen matches what was persisted.
        await load();
      }
    });
  }

  // A drag-in landed at a gap index: the new item appends (domain rule),
  // then one reorder moves it to the previewed position. Runs on the
  // chain, so the fresh id list read here cannot race another mutation.
  async function placeItemAt(handle: DbClient, itemId: string, insertAt: number): Promise<void> {
    const ids = (await listCircuitSlots(handle, circuitId())).map((slot) => slot.id);
    const ordered = orderAfterDrop(ids, itemId, insertAt);
    const unchanged = ordered.every((id, index) => ids[index] === id);
    if (!unchanged) {
      await reorderCircuitItems(handle, circuitId(), ordered);
    }
  }

  // Tap appends (no insertAt); a drag-in places at the previewed gap.
  // Resolves to the new item id so the screen can flash it, or null when
  // the write failed (the chain already resynced from the DB).
  function addFromPool(exerciseId: string, insertAt?: number): Promise<string | null> {
    if (!db) {
      return Promise.resolve(null);
    }
    let itemId: string | null = null;
    return enqueue(async () => {
      const row = await addExerciseToCircuit(db, circuitId(), exerciseId);
      if (insertAt !== undefined) {
        await placeItemAt(db, row.id, insertAt);
      }
      await load();
      itemId = row.id;
    }).then(() => itemId);
  }

  // The steal: domain moves the exercise's one pointer transactionally;
  // both circuits' state is correct the moment it lands. Same placement
  // and flash contract as addFromPool.
  function stealFromPool(exerciseId: string, insertAt?: number): Promise<string | null> {
    if (!db) {
      return Promise.resolve(null);
    }
    let itemId: string | null = null;
    return enqueue(async () => {
      const row = await stealExercise(db, exerciseId, circuitId());
      if (insertAt !== undefined) {
        await placeItemAt(db, row.id, insertAt);
      }
      await load();
      itemId = row.id;
    }).then(() => itemId);
  }

  // Inline create: find-or-create on the normalized name, then route by
  // where that name already lives. The created (or matched free)
  // workout lands in the AVAILABLE group and STAYS there (02-07 ruling:
  // no auto-add - tap +, drag, or the tray from here). A name held
  // elsewhere comes back as held-elsewhere so the screen can open that
  // row's steal strip; stealing must always state its consequence.
  function createWorkout(name: string): Promise<CreateWorkoutOutcome> {
    if (!db) {
      return Promise.resolve({ kind: 'failed' });
    }
    let outcome: CreateWorkoutOutcome = { kind: 'failed' };
    return enqueue(async () => {
      if (circuitKind === null) {
        return;
      }
      let exerciseId: string;
      try {
        exerciseId = (await findOrCreateExercise(db, circuitKind, name)).id;
      } catch (error) {
        if (error instanceof BuilderError) {
          outcome = { kind: 'rejected', message: error.message };
          return;
        }
        throw error;
      }
      if (slots.value.some((slot) => slot.exerciseId === exerciseId)) {
        outcome = { kind: 'already-in-circuit', exerciseId };
        return;
      }
      if (pool.value.heldElsewhere.some((entry) => entry.exerciseId === exerciseId)) {
        outcome = { kind: 'held-elsewhere', exerciseId };
        return;
      }
      await load();
      outcome = { kind: 'in-pool', exerciseId };
    }).then(() => outcome);
  }

  // The pool tray's rename. A collision with another active name is the
  // constraint's verdict (reason on the cause chain); it comes back as a
  // rejected outcome for the tray's notice instead of a resync, because
  // nothing was written and the screen is not stale.
  function renameWorkout(exerciseId: string, name: string): Promise<RenameWorkoutOutcome> {
    if (!db) {
      return Promise.resolve({ kind: 'failed' });
    }
    let outcome: RenameWorkoutOutcome = { kind: 'failed' };
    return enqueue(async () => {
      try {
        const renamed = await renameExercise(db, exerciseId, name);
        if (!renamed) {
          // Vanished or archived underneath the tray: the DB is the truth.
          await load();
          return;
        }
        await load();
        outcome = { kind: 'renamed' };
      } catch (error) {
        if (isUniqueConstraintViolation(error)) {
          outcome = { kind: 'rejected', message: `'${name.trim()}' is already taken` };
          return;
        }
        if (error instanceof BuilderError && error.code === 'blank-name') {
          outcome = { kind: 'rejected', message: 'Name must not be blank' };
          return;
        }
        throw error;
      }
    }).then(() => outcome);
  }

  // The drag-to-trash delete: the workout disappears entirely, from
  // whichever zone it was lifted out of (domain frees a held slot and
  // archives in one transaction; history is kept). Resolves to the undo
  // token the consume snackbar holds, or null when nothing was trashed.
  function trashWorkout(exerciseId: string): Promise<TrashedWorkout | null> {
    if (!db) {
      return Promise.resolve(null);
    }
    let trashed: TrashedWorkout | null = null;
    return enqueue(async () => {
      trashed = await trashExercise(db, exerciseId);
      await load();
    }).then(() => trashed);
  }

  // The snackbar's UNDO: restore the identity and its held slot. False
  // when the undo has expired underneath the snackbar - a double tap, or
  // the freed name re-taken (the constraint's verdict); either way the
  // reload has already told the screen the truth.
  function undoTrash(trashed: TrashedWorkout): Promise<boolean> {
    if (!db) {
      return Promise.resolve(false);
    }
    let restored = false;
    return enqueue(async () => {
      try {
        restored = await restoreExercise(db, trashed);
      } catch (error) {
        if (!isUniqueConstraintViolation(error)) {
          throw error;
        }
      }
      await load();
    }).then(() => restored);
  }

  return {
    status,
    circuitName,
    slots,
    pool,
    load,
    adjustPrescription,
    removeSlot,
    reorderSlots,
    addFromPool,
    stealFromPool,
    createWorkout,
    renameWorkout,
    trashWorkout,
    undoTrash,
  };
}
