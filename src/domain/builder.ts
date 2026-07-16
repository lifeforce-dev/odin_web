import { and, eq, isNull, ne, notExists, sql } from 'drizzle-orm';

import type { DbHandle } from '@/db/client';
import { createExercise } from '@/db/exercises';
import type { ExerciseKind } from '@/db/exercises';
import { newId } from '@/db/ids';
import { circuit, circuitItem, exercise } from '@/db/schema';
import type { CircuitItemRow, CircuitRow, ExerciseRow } from '@/db/schema';
import { nowIso } from '@/db/timestamps';

// The circuit-builder domain layer (epic 02): every operation the workbench
// and circuits screens perform, over an injected DbHandle so it runs
// identically on device and in Node tests. Business rules live here
// (kind matching, name rules, steal semantics, reorder validation);
// components stay render-and-emit only. Spec:
// .claude/features/odin-design/design/schema-v2.md.

export type CircuitKind = CircuitRow['kind'];

// Typed rule failures so the UI can branch on the rule that fired without
// parsing message strings. DB constraint violations are deliberately NOT
// translated into these: drizzle wraps them in DrizzleQueryError and the
// SQLite reason stays on the error.cause chain (01-04 decision).
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

// A fresh workout's starting prescription. The value source is the
// schema (it is the columns' storage default); re-exported here because
// the UI thinks in domain terms. Sets/rest belong to the WORKOUT
// (2026-07-15 amendment): moving it between circuits carries them, and
// it is editable wherever it sits - the 02-03 "re-default on add and
// steal" rule is superseded.
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

// --- Circuits ---------------------------------------------------------------

export interface NewCircuit {
  kind: CircuitKind;
  name: string;
}

// New circuits append at the end of their kind's rotation. The max is taken
// over all rows of the kind, archived included: archived circuits keep their
// slot, so appends stay monotonic with no collision to reason about.
export async function createCircuit(
  db: DbHandle,
  input: NewCircuit,
  createdAt = nowIso(),
): Promise<CircuitRow> {
  const name = requireValidName(input.name);
  return db.transaction(async (tx) => {
    const order = await tx
      .select({
        next: sql<number>`coalesce(max(${circuit.rotationOrder}), -1) + 1`.as(
          'next_rotation_order',
        ),
      })
      .from(circuit)
      .where(eq(circuit.kind, input.kind))
      .get();
    const row: CircuitRow = {
      id: newId(),
      kind: input.kind,
      name,
      rotationOrder: order?.next ?? 0,
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

// --- Workout pool -----------------------------------------------------------

// Find-or-create on the normalized name. Matching folds BOTH sides with
// SQLite's own lower() so the comparison is exactly the ASCII-only fold the
// active-name unique index uses; JS toLowerCase() disagrees on non-ASCII
// names (01-04 review pin). The index is global across kinds, so a name held
// by the other kind is a kind-mismatch error, never a silent second identity
// that the index would then reject.
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

// The pool tray's rename. Returns false when the row is missing or
// archived, mirroring renameCircuit's contract. A collision with another
// active name is NOT pre-checked: the active-name unique index is the
// rule, and the violation stays a DrizzleQueryError with the reason on
// error.cause (01-04 decision).
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

// The drag-to-trash delete: the workout disappears entirely, from
// wherever it was. One transaction frees its slot (if a circuit holds
// it) and archives the identity - set_log history keeps referencing it,
// and the active-name index frees the name for reuse. Deliberately NOT
// guarded against held exercises: trashing is an explicit, whole-card
// gesture, and leaving the slot behind would strand a pointer at an
// archived identity. Returns false when missing/already archived.
export async function trashExercise(
  db: DbHandle,
  exerciseId: string,
  archivedAt = nowIso(),
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const pooled = await tx.select().from(exercise).where(eq(exercise.id, exerciseId)).get();
    if (!pooled || pooled.archivedAt !== null) {
      return false;
    }
    await tx.delete(circuitItem).where(eq(circuitItem.exerciseId, exerciseId));
    await tx.update(exercise).set({ archivedAt }).where(eq(exercise.id, exerciseId));
    return true;
  });
}

// Available entries carry their prescription: the pool card is the same
// editable control as the circuit's (2026-07-15 amendment).
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

// Pool group state is derived, never stored (schema-v2): AVAILABLE = active
// exercise of the circuit's kind with no circuit_item row anywhere;
// IN OTHER CIRCUITS = its one item belongs to another circuit, with the
// owner's name for the pill / steal strip / drag ghost. Exercises held by
// THIS circuit are its slots, not pool rows, so they appear in neither group.
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
// slot is a pure association). Selected bare column names stay distinct
// (id, exercise_id, name, position, sets, rest_seconds) because the
// plugin's object rows collapse same-named result columns
// (src/db/proxy-rows.ts).
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

// The live-apply prescription edit, keyed to the WORKOUT (2026-07-15
// amendment): the same edit works from the circuit slot and the pool
// card. Partial on purpose: the steppers change one number at a time.
// Validates the merged result so a partial edit can never leave an
// invalid pair behind. Returns false when missing or archived.
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
