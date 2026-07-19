import { ref } from 'vue';

import type { DbClient } from '@/db/client';
import { archiveCircuit, createCircuit, reorderCircuits } from '@/domain/builder';
import { abandonSession, getRotationView, swapActiveCircuit } from '@/domain/workout';
import type { RotationQueueRow, RotationView } from '@/domain/workout';

// The circuits screen's domain adapter: reactive queue + active-session
// state over domain/workout.ts and domain/builder.ts. Mirrors
// useWorkbench's shape (status enum, one serialized write chain,
// db-null no-ops) but smaller - this screen has no per-instance id and,
// unlike the workbench's stepper/reorder pair, exactly one optimistic
// op (reorder). Every mutation, reorder included, reloads after its
// write: the one optimistic op just repaints DB truth on settle like
// everything else, so no generation bookkeeping is needed to guard a
// stale repaint.

export type CircuitManagerStatus = 'loading' | 'ready' | 'unavailable' | 'error';

// db is null in browser dev mode (no on-device SQLite; see main.ts):
// status reports 'unavailable' and every operation is a no-op.
export function useCircuitManager(db: DbClient | null) {
  const status = ref<CircuitManagerStatus>(db ? 'loading' : 'unavailable');
  const queue = ref<RotationQueueRow[]>([]);
  const active = ref<RotationView['active']>(null);

  // EVERY mutation and the load ride one chain, in emit order - the
  // same driver invariant useWorkbench documents: sqlite-proxy
  // transactions are raw BEGIN/COMMIT over the single shared
  // connection, so two concurrent db.transaction calls cannot both
  // succeed.
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
      const view = await getRotationView(db);
      queue.value = view.queue;
      active.value = view.active;
      status.value = 'ready';
    } catch (error) {
      // A failed read must fail on the screen, not only in the log: the
      // screen renders this status with a retry. Also keeps the write
      // chain unbreakable - resync awaits load, so load must never
      // reject.
      console.error('[odin] circuit manager load failed', error);
      status.value = 'error';
    }
  }

  // On any failed write the DB is the truth: reload rather than guess,
  // so the screen can never drift from what is persisted.
  async function resync(error: unknown): Promise<void> {
    console.error('[odin] circuit manager operation failed; reloading from DB', error);
    await load();
  }

  // The mount entry point: flips the screen to loading NOW (a stale tap
  // must not enqueue against the old paint) and rides the chain, so the
  // read cannot interleave with an in-flight write transaction on the
  // single shared connection.
  function reload(): Promise<void> {
    if (!db) {
      return Promise.resolve();
    }
    status.value = 'loading';
    return enqueue(load);
  }

  // Optimistic: the drop already showed the user this order, so the
  // queue moves on the same tick; the write follows on the chain. Any
  // throw (reorder-mismatch included) resyncs via the chain's own
  // catch, which repaints the DB's truth.
  function reorder(orderedCircuitIds: string[]): Promise<void> {
    if (!db) {
      return Promise.resolve();
    }
    const byId = new Map(queue.value.map((row) => [row.id, row]));
    const reordered = orderedCircuitIds.flatMap((id) => byId.get(id) ?? []);
    if (reordered.length === queue.value.length) {
      queue.value = reordered;
    }
    return enqueue(async () => {
      await reorderCircuits(db, 'workout', orderedCircuitIds);
      await load();
    });
  }

  // + ADD CIRCUIT: appends an empty, placeholder-named circuit and
  // resolves its id so the screen can navigate straight into the
  // workbench - no name prompt; the workbench pencil is the naming
  // step. Null means the write failed (the chain already resynced) so
  // the screen shows a notice instead of navigating.
  function createAndOpen(): Promise<string | null> {
    if (!db) {
      return Promise.resolve(null);
    }
    let createdId: string | null = null;
    return enqueue(async () => {
      const row = await createCircuit(db, { kind: 'workout', name: 'New Circuit' });
      createdId = row.id;
      await load();
    }).then(() => createdId);
  }

  // Archives the circuit; the session is deliberately NOT touched here
  // - an orphaned session (its circuit gone) is the mint-time reap's
  // job, never a delete-time write.
  function remove(circuitId: string): Promise<void> {
    if (!db) {
      return Promise.resolve();
    }
    return enqueue(async () => {
      await archiveCircuit(db, circuitId);
      await load();
    });
  }

  // Ends the in-flight session as 'abandoned'; false means it was
  // already ended (a stale strip), which the reload alone answers - the
  // view just closes the strip either way.
  function abandon(sessionId: string): Promise<boolean> {
    if (!db) {
      return Promise.resolve(false);
    }
    let outcome = false;
    return enqueue(async () => {
      outcome = (await abandonSession(db, sessionId)) !== null;
      await load();
    }).then(() => outcome);
  }

  // Fronts toCircuitId after abandoning the in-flight session; false
  // means a refusal (stale screen), which the reload repaints truth
  // for.
  function swap(sessionId: string, toCircuitId: string): Promise<boolean> {
    if (!db) {
      return Promise.resolve(false);
    }
    let outcome = false;
    return enqueue(async () => {
      outcome = (await swapActiveCircuit(db, sessionId, toCircuitId)) !== null;
      await load();
    }).then(() => outcome);
  }

  return { status, queue, active, reload, reorder, createAndOpen, remove, abandon, swap };
}
