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

// A fresh workout's starting prescription (the schema's column default).
// Sets/rest belong to the workout and move between circuits with it.
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
function requireMatchingKind(target: CircuitRow, exerciseRow: ExerciseRow): void {
  if (target.kind !== exerciseRow.kind) {
    throw new BuilderError(
      'kind-mismatch',
      `circuit '${target.name}' is ${target.kind} but exercise '${exerciseRow.name}' is ${exerciseRow.kind}`,
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

// The back of a kind's rotation queue: max over all rows of the kind,
// archived included, so appends stay monotonic. The sole author of that
// invariant (createCircuit and the session-end rotation both call it).
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

// Soft delete (sessions reference circuits for provenance), but hard-deletes
// the circuit's items too, same transaction: membership is exclusive, so a
// stranded item would lock its exercise out of the library.
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

// Rewrites rotationOrder densely (0..n-1) from the given order, which must be
// exactly the ACTIVE circuits of the kind (same exact-permutation contract as
// reorderCircuitItems). Archived rows keep their order - a collision is
// harmless since they never appear in a queue read.
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

// --- Workout library -----------------------------------------------------------

// Find-or-create on the normalized name, folded with SQLite's own lower() to
// match the active-name unique index exactly (JS toLowerCase() disagrees on
// non-ASCII). The index is global across kinds, so a name held by the other
// kind is a kind-mismatch.
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

// False when missing or archived (like renameCircuit). A name collision is
// not pre-checked - the active-name unique index is the rule, surfacing as a
// DrizzleQueryError with the reason on error.cause.
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

// What a delete destroyed, shaped for undo: the identity and the one slot a
// circuit held it in.
export interface TrashedWorkout {
  exerciseId: string;
  held: { circuitId: string; position: number } | null;
}

// The drag-to-trash delete: frees the slot a circuit may hold and archives
// the identity (history keeps referencing it; the name frees for reuse), one
// transaction. Must delete the slot too - a stranded pointer would reference
// an archived identity. Null when missing or already archived.
export async function trashExercise(
  db: DbHandle,
  exerciseId: string,
  archivedAt = nowIso(),
): Promise<TrashedWorkout | null> {
  return db.transaction(async (tx) => {
    const exerciseRow = await tx.select().from(exercise).where(eq(exercise.id, exerciseId)).get();
    if (!exerciseRow || exerciseRow.archivedAt !== null) {
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

// The delete undo: restores the identity and, if a circuit held it, a slot at
// the old position (a collision is fine - the next reorder redenses). If the
// owner was archived meanwhile, it restores to the library. A name retaken
// while undo sat surfaces as a constraint error, nothing written. False when
// missing or already active.
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

// Available entries carry their prescription: the library card is the same
// editable control as the circuit's.
export interface LibraryAvailableEntry {
  exerciseId: string;
  name: string;
  sets: number;
  restSeconds: number;
}

export interface LibraryElsewhereEntry {
  exerciseId: string;
  name: string;
  ownerCircuitId: string;
  ownerCircuitName: string;
}

export interface LibraryGroups {
  available: LibraryAvailableEntry[];
  heldElsewhere: LibraryElsewhereEntry[];
}

// Library groups are derived, never stored: AVAILABLE = an active exercise of
// the kind with no circuit_item anywhere; ELSEWHERE = its one item belongs to
// another circuit. This circuit's own exercises are slots, in neither group.
export async function getLibrary(db: DbHandle, circuitId: string): Promise<LibraryGroups> {
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
  // Owner circuits are always active (archiveCircuit deletes their items in
  // the same transaction). The circuit columns are aliased apart from the
  // exercise's bare id/name - the plugin collapses same-named columns
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

// The circuit zone's slot list; sets/rest come from the exercise (a slot is a
// pure association). Bare column names stay distinct - the plugin collapses
// same-named columns (src/db/proxy-rows.ts).
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

// Adds an AVAILABLE exercise to the end of the circuit (a pure association -
// the workout brings its prescription). No held-elsewhere pre-check:
// UNIQUE(exercise_id) is the duplicate rule, so adding a held one fails
// loudly. Moving a held one is stealExercise.
export async function addExerciseToCircuit(
  db: DbHandle,
  circuitId: string,
  exerciseId: string,
): Promise<CircuitItemRow> {
  return db.transaction(async (tx) => {
    const target = await requireActiveCircuit(tx, circuitId);
    const exerciseRow = await requireActiveExercise(tx, exerciseId);
    requireMatchingKind(target, exerciseRow);
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
// AVAILABLE. Remaining positions stay as-is - order only needs them monotonic.
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

// The live-apply prescription edit, keyed to the workout so it works from the
// circuit slot or the library card. Partial (steppers change one number), but
// validates the merged result so a partial edit can't leave an invalid pair.
// False when missing or archived.
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

// Rewrites every position (0-based, dense) from the given order, which must be
// exactly the circuit's current items - a stale drag fails loudly instead of
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

// The workbench steal: moves the exercise's single pointer from its owner to
// the target, one transaction. UNIQUE(exercise_id) turns a forgotten delete
// into a loud failure, not a silent duplicate. Prescription and history ride
// along (they key to the exercise, not the slot).
export async function stealExercise(
  db: DbHandle,
  exerciseId: string,
  toCircuitId: string,
): Promise<CircuitItemRow> {
  return db.transaction(async (tx) => {
    const target = await requireActiveCircuit(tx, toCircuitId);
    const exerciseRow = await requireActiveExercise(tx, exerciseId);
    requireMatchingKind(target, exerciseRow);
    const held = await tx
      .select()
      .from(circuitItem)
      .where(eq(circuitItem.exerciseId, exerciseId))
      .get();
    if (!held) {
      throw new BuilderError(
        'not-in-a-circuit',
        `exercise '${exerciseRow.name}' is not held by any circuit; add it instead of stealing`,
      );
    }
    if (held.circuitId === toCircuitId) {
      throw new BuilderError(
        'already-in-circuit',
        `exercise '${exerciseRow.name}' is already in circuit '${target.name}'`,
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
