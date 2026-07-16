import { and, eq, isNull, sql } from 'drizzle-orm';

import type { DbHandle } from './client';
import { newId } from './ids';
import { DEFAULT_PRESCRIPTION, exercise } from './schema';
import type { ExerciseRow } from './schema';
import { nowIso } from './timestamps';

export type ExerciseKind = ExerciseRow['kind'];

export interface NewExercise {
  kind: ExerciseKind;
  name: string;
}

// Stores the user's casing; surrounding whitespace is never data. A new
// exercise starts on the default prescription and gets edited in place
// from there.
export async function createExercise(
  db: DbHandle,
  input: NewExercise,
  createdAt = nowIso(),
): Promise<ExerciseRow> {
  const row: ExerciseRow = {
    id: newId(),
    kind: input.kind,
    name: input.name.trim(),
    sets: DEFAULT_PRESCRIPTION.sets,
    restSeconds: DEFAULT_PRESCRIPTION.restSeconds,
    createdAt,
    archivedAt: null,
  };
  await db.insert(exercise).values(row);
  return row;
}

export async function getExerciseById(db: DbHandle, id: string): Promise<ExerciseRow | undefined> {
  return db.select().from(exercise).where(eq(exercise.id, id)).get();
}

export async function listActiveExercises(
  db: DbHandle,
  kind: ExerciseKind,
): Promise<ExerciseRow[]> {
  return (
    db
      .select()
      .from(exercise)
      .where(and(eq(exercise.kind, kind), isNull(exercise.archivedAt)))
      // lower(name): the same normalization the active-name unique index uses,
      // so the list order matches the identity story instead of BINARY
      // collation putting "Zebra" before "apple".
      .orderBy(sql`lower(${exercise.name})`)
  );
}

// Soft delete: set_log history keeps referencing the exercise identity.
// Returns false when the row is missing or already archived, so callers can
// surface the problem instead of double-archiving silently.
// Read-then-write instead of UPDATE ... RETURNING: RETURNING is broken on
// the device SQLite plugin (see src/db/proxy-statements.ts), and the
// transaction keeps the outcome check and the write atomic.
export async function archiveExercise(
  db: DbHandle,
  id: string,
  archivedAt = nowIso(),
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ archivedAt: exercise.archivedAt })
      .from(exercise)
      .where(eq(exercise.id, id))
      .get();
    if (!existing || existing.archivedAt !== null) {
      return false;
    }
    await tx.update(exercise).set({ archivedAt }).where(eq(exercise.id, id));
    return true;
  });
}
