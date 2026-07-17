import { and, eq, isNull, ne, notExists, sql } from 'drizzle-orm';

import type { DbHandle } from '@/db/client';
import { createExercise } from '@/db/exercises';
import type { ExerciseKind } from '@/db/exercises';
import { newId } from '@/db/ids';
import { circuit, circuitItem, exercise } from '@/db/schema';
import type { CircuitItemRow, CircuitRow, ExerciseRow } from '@/db/schema';
import { nowIso } from '@/db/timestamps';

// The circuit-builder domain layer: every operation the workbench and
// circuits screens perform, over an injected DbHandle so it runs
// identically on device and in Node tests. Business rules live here;
// components stay render-and-emit only.

export type CircuitKind = CircuitRow['kind'];

// Typed rule failures so the UI can branch on the rule that fired
// without parsing message strings. DB constraint violations are
// deliberately not translated: drizzle wraps them in DrizzleQueryError
// with the SQLite reason on the error.cause chain.
export type BuilderErrorCode =
  | 'blank-name'
  | 'circuit-not-found'
  | 'exercise-not-found'
  | 'kind-mismatch'
  | 'not-in-a-circuit'
  | 'already-in-circuit'
  | 'invalid-prescription'
  | 'reorder-mismatch';

export class BuilderError extends Error {
  constructor(
    readonly code: BuilderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BuilderError';
  }
}

export interface Prescription {
  sets: number;
  restSeconds: number;
}

// A fresh workout's starting prescription; the value lives in the
// schema as the columns' storage default. Sets/rest belong to the
// workout: moving it between circuits carries them.
export { DEFAULT_PRESCRIPTION } from '@/db/schema';

function requireValidName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new BuilderError('blank-name', 'name must not be blank');
  }
  return trimmed;
}

function requireValidPrescription(prescription: Prescription): void {
  const { sets, restSeconds } = prescription;
  if (!Number.isInteger(sets) || sets < 1 || !Number.isInteger(restSeconds) || restSeconds < 0) {
    throw new BuilderError(
      'invalid-prescription',
      `prescription must be integer sets >= 1 and restSeconds >= 0, got sets=${sets} restSeconds=${restSeconds}`,
    );
  }
}

async function requireActiveCircuit(db: DbHandle, id: string): Promise<CircuitRow> {
  const row = await db.select().from(circuit).where(eq(circuit.id, id)).get();
  if (!row || row.archivedAt !== null) {
    throw new BuilderError('circuit-not-found', `no active circuit with id ${id}`);
  }
  return row;
}

async function requireActiveExercise(db: DbHandle, id: string): Promise<ExerciseRow> {
  const row = await db.select().from(exercise).where(eq(exercise.id, id)).get();
  if (!row || row.archivedAt !== null) {
    throw new BuilderError('exercise-not-found', `no active exercise with id ${id}`);
  }
  return row;
}

// Cross-table rule the schema reserves for domain/: a circuit only holds
// exercises of its own kind.
function requireMatchingKind(target: CircuitRow, pooled: ExerciseRow): void {
  if (target.kind !== pooled.kind) {
    throw new BuilderError(
      'kind-mismatch',
      `circuit '${target.name}' is ${target.kind} but exercise '${pooled.name}' is ${pooled.kind}`,
    );
  }
}

async function nextPosition(db: DbHandle, circuitId: string): Promise<number> {
  const row = await db
    .select({
      next: sql<number>`coalesce(max(${circuitItem.position}), -1) + 1`.as('next_position'),
    })
    .from(circuitItem)
    .where(eq(circuitItem.circuitId, circuitId))
    .get();
  return row?.next ?? 0;
}

// The back of a kind's rotation queue. The max is taken over all rows of
// the kind, archived included: archived circuits keep their slot, so
// appends stay monotonic with no collision to reason about. Shared by
// createCircuit and the session-end rotation (domain/workout.ts) - the
// queue's monotonic-append invariant has exactly one author.
export async function nextRotationOrder(db: DbHandle, kind: CircuitKind): Promise<number> {
  const row = await db
    .select({
      next: sql<number>`coalesce(max(${circuit.rotationOrder}), -1) + 1`.as('next_rotation_order'),
    })
    .from(circuit)
    .where(eq(circuit.kind, kind))
    .get();
  return row?.next ?? 0;
}

// --- Circuits ---------------------------------------------------------------

export interface NewCircuit {
  kind: CircuitKind;
  name: string;
}

// New circuits append at the end of their kind's rotation
// (nextRotationOrder above owns the append rule).
export async function createCircuit(
  db: DbHandle,
  input: NewCircuit,
  createdAt = nowIso(),
): Promise<CircuitRow> {
  const name = requireValidName(input.name);
  return db.transaction(async (tx) => {
    const row: CircuitRow = {
      id: newId(),
      kind: input.kind,
      name,
      rotationOrder: await nextRotationOrder(tx, input.kind),
      createdAt,
      archivedAt: null,
    };
    await tx.insert(circuit).values(row);
    return row;
  });
}

// Plain row read, archived included; callers that need an active circuit go
// through the operations below, which check for themselves.
export async function getCircuitById(db: DbHandle, id: string): Promise<CircuitRow | undefined> {
  return db.select().from(circuit).where(eq(circuit.id, id)).get();
}

// The circuits screen's rotation list; "up next" is derived from this order.
export async function listActiveCircuits(db: DbHandle, kind: CircuitKind): Promise<CircuitRow[]> {
  return db
    .select()
    .from(circuit)
    .where(and(eq(circuit.kind, kind), isNull(circuit.archivedAt)))
    .orderBy(circuit.rotationOrder);
}

// Returns false when the row is missing or archived, mirroring
// archiveExercise's contract, so callers surface the problem.
export async function renameCircuit(db: DbHandle, id: string, name: string): Promise<boolean> {
  const trimmed = requireValidName(name);
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ archivedAt: circuit.archivedAt })
      .from(circuit)
      .where(eq(circuit.id, id))
      .get();
    if (!existing || existing.archivedAt !== null) {
      return false;
    }
    await tx.update(circuit).set({ name: trimmed }).where(eq(circuit.id, id));
    return true;
  });
}

// Soft delete (sessions reference circuits for provenance) that also
// hard-deletes the circuit's items in the same transaction: membership is
// exclusive, so an item left behind would keep its exercise out of the pool
// and block adding it anywhere else.
export async function archiveCircuit(
  db: DbHandle,
  id: string,
  archivedAt = nowIso(),
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ archivedAt: circuit.archivedAt })
      .from(circuit)
      .where(eq(circuit.id, id))
      .get();
    if (!existing || existing.archivedAt !== null) {
      return false;
    }
    await tx.delete(circuitItem).where(eq(circuitItem.circuitId, id));
    await tx.update(circuit).set({ archivedAt }).where(eq(circuit.id, id));
    return true;
  });
}

// Rewrites rotationOrder densely (0..n-1, in list order) from the given
// order. The id list must be exactly the ACTIVE circuits of the kind -
// same exact-permutation contract as reorderCircuitItems. Archived
// circuits keep their existing rotationOrder untouched: a collision with
// an archived row is harmless (archived rows never appear in any queue
// read) and nextRotationOrder's max-over-all-rows append stays monotonic.
export async function reorderCircuits(
  db: DbHandle,
  kind: CircuitKind,
  orderedCircuitIds: string[],
): Promise<void> {
  return db.transaction(async (tx) => {
    const current = await tx
      .select({ id: circuit.id })
      .from(circuit)
      .where(and(eq(circuit.kind, kind), isNull(circuit.archivedAt)));
    const currentIds = new Set(current.map((row) => row.id));
    const isExactPermutation =
      orderedCircuitIds.length === currentIds.size &&
      new Set(orderedCircuitIds).size === orderedCircuitIds.length &&
      orderedCircuitIds.every((id) => currentIds.has(id));
    if (!isExactPermutation) {
      throw new BuilderError(
        'reorder-mismatch',
        `reorder list does not match the active ${kind} circuits: ` +
          `expected the ${currentIds.size} active circuit ids exactly once each`,
      );
    }
    for (const [rotationOrder, id] of orderedCircuitIds.entries()) {
      await tx.update(circuit).set({ rotationOrder }).where(eq(circuit.id, id));
    }
  });
}

// --- Workout pool -----------------------------------------------------------

// Find-or-create on the normalized name. Matching folds both sides
// with SQLite's own lower() so the comparison is exactly the
// ASCII-only fold the active-name unique index uses; JS toLowerCase()
// disagrees on non-ASCII names. The index is global across kinds, so a
// name held by the other kind is a kind-mismatch error, never a second
// identity the index would then reject.
export async function findOrCreateExercise(
  db: DbHandle,
  kind: ExerciseKind,
  name: string,
): Promise<ExerciseRow> {
  const trimmed = requireValidName(name);
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(exercise)
      .where(and(isNull(exercise.archivedAt), sql`lower(${exercise.name}) = lower(${trimmed})`))
      .get();
    if (!existing) {
      return createExercise(tx, { kind, name: trimmed });
    }
    if (existing.kind !== kind) {
      throw new BuilderError(
        'kind-mismatch',
        `'${existing.name}' already exists as a ${existing.kind} exercise`,
      );
    }
    return existing;
  });
}

// Returns false when the row is missing or archived, mirroring
// renameCircuit's contract. A collision with another active name is
// not pre-checked: the active-name unique index is the rule, and the
// violation stays a DrizzleQueryError with the reason on error.cause.
export async function renameExercise(db: DbHandle, id: string, name: string): Promise<boolean> {
  const trimmed = requireValidName(name);
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ archivedAt: exercise.archivedAt })
      .from(exercise)
      .where(eq(exercise.id, id))
      .get();
    if (!existing || existing.archivedAt !== null) {
      return false;
    }
    await tx.update(exercise).set({ name: trimmed }).where(eq(exercise.id, id));
    return true;
  });
}

// What a trash gesture destroyed, in the shape its undo needs: the
// identity, and the slot a circuit was holding it in (exclusivity
// guarantees at most one).
export interface TrashedWorkout {
  exerciseId: string;
  held: { circuitId: string; position: number } | null;
}

// The drag-to-trash delete: one transaction frees the slot a circuit
// may hold and archives the identity - set_log history keeps
// referencing it, and the active-name index frees the name for reuse.
// Deliberately not guarded against held exercises: leaving the slot
// behind would strand a pointer at an archived identity. Resolves to
// the undo shape, or null when missing or already archived.
export async function trashExercise(
  db: DbHandle,
  exerciseId: string,
  archivedAt = nowIso(),
): Promise<TrashedWorkout | null> {
  return db.transaction(async (tx) => {
    const pooled = await tx.select().from(exercise).where(eq(exercise.id, exerciseId)).get();
    if (!pooled || pooled.archivedAt !== null) {
      return null;
    }
    const held = await tx
      .select({ circuitId: circuitItem.circuitId, position: circuitItem.position })
      .from(circuitItem)
      .where(eq(circuitItem.exerciseId, exerciseId))
      .get();
    await tx.delete(circuitItem).where(eq(circuitItem.exerciseId, exerciseId));
    await tx.update(exercise).set({ archivedAt }).where(eq(exercise.id, exerciseId));
    return { exerciseId, held: held ?? null };
  });
}

// The trash undo: restores the archived identity and, when a circuit
// held it, a slot at the old position. The position may collide with a
// row added since - ordering only needs monotonic values, and the next
// reorder rewrites them densely. If the owner circuit was archived in
// the meantime the identity restores into the pool. A name retaken
// while the undo sat violates the active-name index and surfaces as
// the constraint's DrizzleQueryError with nothing written. Returns
// false when the exercise is missing or already active.
export async function restoreExercise(db: DbHandle, trashed: TrashedWorkout): Promise<boolean> {
  return db.transaction(async (tx) => {
    const row = await tx.select().from(exercise).where(eq(exercise.id, trashed.exerciseId)).get();
    if (!row || row.archivedAt === null) {
      return false;
    }
    await tx.update(exercise).set({ archivedAt: null }).where(eq(exercise.id, trashed.exerciseId));
    if (trashed.held) {
      const owner = await tx
        .select({ archivedAt: circuit.archivedAt })
        .from(circuit)
        .where(eq(circuit.id, trashed.held.circuitId))
        .get();
      if (owner && owner.archivedAt === null) {
        await tx.insert(circuitItem).values({
          id: newId(),
          circuitId: trashed.held.circuitId,
          exerciseId: trashed.exerciseId,
          position: trashed.held.position,
        });
      }
    }
    return true;
  });
}

// Available entries carry their prescription: the pool card is the
// same editable control as the circuit's.
export interface PoolAvailableEntry {
  exerciseId: string;
  name: string;
  sets: number;
  restSeconds: number;
}

export interface PoolElsewhereEntry {
  exerciseId: string;
  name: string;
  ownerCircuitId: string;
  ownerCircuitName: string;
}

export interface PoolGroups {
  available: PoolAvailableEntry[];
  heldElsewhere: PoolElsewhereEntry[];
}

// Pool group state is derived, never stored: AVAILABLE is an active
// exercise of the circuit's kind with no circuit_item row anywhere;
// IN OTHER CIRCUITS means its one item belongs to another circuit.
// Exercises held by THIS circuit are its slots, not pool rows, so they
// appear in neither group.
export async function getPool(db: DbHandle, circuitId: string): Promise<PoolGroups> {
  const viewing = await requireActiveCircuit(db, circuitId);
  const available = await db
    .select({
      exerciseId: exercise.id,
      name: exercise.name,
      sets: exercise.sets,
      restSeconds: exercise.restSeconds,
    })
    .from(exercise)
    .where(
      and(
        eq(exercise.kind, viewing.kind),
        isNull(exercise.archivedAt),
        notExists(
          db
            .select({ id: circuitItem.id })
            .from(circuitItem)
            .where(eq(circuitItem.exerciseId, exercise.id)),
        ),
      ),
    )
    .orderBy(sql`lower(${exercise.name})`);
  // Owner circuits are always active: archiveCircuit deletes the circuit's
  // items in the same transaction, so no item can point at an archived
  // circuit. The circuit columns are aliased apart from the exercise's bare
  // id/name - the plugin's object rows collapse same-named result columns
  // (src/db/proxy-rows.ts).
  const heldElsewhere = await db
    .select({
      exerciseId: exercise.id,
      name: exercise.name,
      ownerCircuitId: sql<string>`${circuit.id}`.as('owner_circuit_id'),
      ownerCircuitName: sql<string>`${circuit.name}`.as('owner_circuit_name'),
    })
    .from(circuitItem)
    .innerJoin(exercise, eq(exercise.id, circuitItem.exerciseId))
    .innerJoin(circuit, eq(circuit.id, circuitItem.circuitId))
    .where(
      and(
        ne(circuitItem.circuitId, circuitId),
        eq(exercise.kind, viewing.kind),
        isNull(exercise.archivedAt),
      ),
    )
    .orderBy(sql`lower(${exercise.name})`);
  return { available, heldElsewhere };
}

// --- Circuit items ----------------------------------------------------------

export interface CircuitSlot {
  id: string;
  exerciseId: string;
  exerciseName: string;
  position: number;
  sets: number;
  restSeconds: number;
}

// The circuit zone's slot list; sets/rest read from the exercise (the
// slot is a pure association). The selected bare column names are all
// distinct because the plugin's object rows collapse same-named result
// columns (src/db/proxy-rows.ts).
export async function listCircuitSlots(db: DbHandle, circuitId: string): Promise<CircuitSlot[]> {
  return db
    .select({
      id: circuitItem.id,
      exerciseId: circuitItem.exerciseId,
      exerciseName: exercise.name,
      position: circuitItem.position,
      sets: exercise.sets,
      restSeconds: exercise.restSeconds,
    })
    .from(circuitItem)
    .innerJoin(exercise, eq(exercise.id, circuitItem.exerciseId))
    .where(eq(circuitItem.circuitId, circuitId))
    .orderBy(circuitItem.position);
}

// Adds an AVAILABLE exercise to the end of the circuit: a pure
// association - the workout brings its own prescription with it. There
// is no held-elsewhere pre-check on purpose: the DB's UNIQUE(exercise_id)
// IS the duplicate rule, and adding an exercise some circuit already
// holds fails loudly as a constraint violation (reason on error.cause).
// Moving a held exercise is stealExercise.
export async function addExerciseToCircuit(
  db: DbHandle,
  circuitId: string,
  exerciseId: string,
): Promise<CircuitItemRow> {
  return db.transaction(async (tx) => {
    const target = await requireActiveCircuit(tx, circuitId);
    const pooled = await requireActiveExercise(tx, exerciseId);
    requireMatchingKind(target, pooled);
    const row: CircuitItemRow = {
      id: newId(),
      circuitId,
      exerciseId,
      position: await nextPosition(tx, circuitId),
    };
    await tx.insert(circuitItem).values(row);
    return row;
  });
}

// Hard delete; nothing references items. The freed exercise derives back to
// AVAILABLE with no further bookkeeping. Remaining positions keep their
// values - ordering only needs them monotonic, and the next reorder rewrites
// them densely anyway.
export async function removeCircuitItem(db: DbHandle, itemId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: circuitItem.id })
      .from(circuitItem)
      .where(eq(circuitItem.id, itemId))
      .get();
    if (!existing) {
      return false;
    }
    await tx.delete(circuitItem).where(eq(circuitItem.id, itemId));
    return true;
  });
}

// The live-apply prescription edit, keyed to the workout so the same
// edit works from the circuit slot and the pool card. Partial on
// purpose: the steppers change one number at a time. Validates the
// merged result so a partial edit can never leave an invalid pair
// behind. Returns false when missing or archived.
export async function setPrescription(
  db: DbHandle,
  exerciseId: string,
  changes: Partial<Prescription>,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({
        sets: exercise.sets,
        restSeconds: exercise.restSeconds,
        archivedAt: exercise.archivedAt,
      })
      .from(exercise)
      .where(eq(exercise.id, exerciseId))
      .get();
    if (!existing || existing.archivedAt !== null) {
      return false;
    }
    const next: Prescription = {
      sets: changes.sets ?? existing.sets,
      restSeconds: changes.restSeconds ?? existing.restSeconds,
    };
    requireValidPrescription(next);
    await tx.update(exercise).set(next).where(eq(exercise.id, exerciseId));
    return true;
  });
}

// Rewrites every position from the given order (0-based, dense). The id list
// must be exactly the circuit's current items: a stale drag result (an item
// added or removed since the gesture started) fails loudly instead of
// scrambling positions.
export async function reorderCircuitItems(
  db: DbHandle,
  circuitId: string,
  orderedItemIds: string[],
): Promise<void> {
  return db.transaction(async (tx) => {
    const current = await tx
      .select({ id: circuitItem.id })
      .from(circuitItem)
      .where(eq(circuitItem.circuitId, circuitId));
    const currentIds = new Set(current.map((row) => row.id));
    const isExactPermutation =
      orderedItemIds.length === currentIds.size &&
      new Set(orderedItemIds).size === orderedItemIds.length &&
      orderedItemIds.every((id) => currentIds.has(id));
    if (!isExactPermutation) {
      throw new BuilderError(
        'reorder-mismatch',
        `reorder list does not match circuit ${circuitId}: ` +
          `expected the circuit's ${currentIds.size} item ids exactly once each`,
      );
    }
    for (const [position, id] of orderedItemIds.entries()) {
      await tx.update(circuitItem).set({ position }).where(eq(circuitItem.id, id));
    }
  });
}

// The workbench steal: one transaction moves the exercise's single pointer
// from its owner circuit to the target. UNIQUE(exercise_id) turns a
// forgotten delete into a loud constraint failure instead of a silent
// duplicate. The workout's prescription and history both ride along
// automatically - they key to the exercise, not the slot.
export async function stealExercise(
  db: DbHandle,
  exerciseId: string,
  toCircuitId: string,
): Promise<CircuitItemRow> {
  return db.transaction(async (tx) => {
    const target = await requireActiveCircuit(tx, toCircuitId);
    const pooled = await requireActiveExercise(tx, exerciseId);
    requireMatchingKind(target, pooled);
    const held = await tx
      .select()
      .from(circuitItem)
      .where(eq(circuitItem.exerciseId, exerciseId))
      .get();
    if (!held) {
      throw new BuilderError(
        'not-in-a-circuit',
        `exercise '${pooled.name}' is not held by any circuit; add it instead of stealing`,
      );
    }
    if (held.circuitId === toCircuitId) {
      throw new BuilderError(
        'already-in-circuit',
        `exercise '${pooled.name}' is already in circuit '${target.name}'`,
      );
    }
    await tx.delete(circuitItem).where(eq(circuitItem.id, held.id));
    const row: CircuitItemRow = {
      id: newId(),
      circuitId: toCircuitId,
      exerciseId,
      position: await nextPosition(tx, toCircuitId),
    };
    await tx.insert(circuitItem).values(row);
    return row;
  });
}
