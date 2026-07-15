import { ref } from 'vue';

import type { DbClient } from '@/db/client';
import {
  getCircuitById,
  listCircuitSlots,
  removeCircuitItem,
  reorderCircuitItems,
  setPrescription,
} from '@/domain/builder';
import type { CircuitSlot, Prescription } from '@/domain/builder';

// The workbench's domain adapter (task 02-04): reactive circuit-zone state
// over domain/builder.ts. Edits apply live - every stepper tick lands in
// the DB, there is no save button. Components stay render + emit; the
// rules (bounds, resync-on-failure, exact-permutation reorders) live here
// and below in domain/.

export type WorkbenchStatus = 'loading' | 'ready' | 'missing' | 'unavailable' | 'error';

export type PrescriptionField = keyof Prescription;

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
        slots.value = [];
        return;
      }
      circuitName.value = circuit.name;
      slots.value = await listCircuitSlots(db, circuit.id);
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
  // hold-to-ramp reads instantly; the write follows on the chain. Returns
  // the queued write so tests (and callers that care) can await it.
  function adjustPrescription(
    itemId: string,
    field: PrescriptionField,
    delta: number,
  ): Promise<void> {
    if (!db) {
      return Promise.resolve();
    }
    const slot = slots.value.find((entry) => entry.id === itemId);
    if (!slot) {
      return Promise.resolve();
    }
    const next = clampPrescriptionValue(field, slot[field] + delta);
    if (next === slot[field]) {
      return Promise.resolve();
    }
    slot[field] = next;
    const changes: Partial<Prescription> =
      field === 'sets' ? { sets: next } : { restSeconds: next };
    return enqueue(async () => {
      const updated = await setPrescription(db, itemId, changes);
      if (!updated) {
        // The item vanished underneath the edit (removed elsewhere).
        await resync(new Error(`circuit item ${itemId} disappeared during a live edit`));
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

  return { status, circuitName, slots, load, adjustPrescription, removeSlot, reorderSlots };
}
