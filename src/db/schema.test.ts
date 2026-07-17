import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newId } from './ids';
import { circuit, circuitItem, exercise, session, setLog } from './schema';
import type { CircuitItemRow, CircuitRow, ExerciseRow, SessionRow, SetLogRow } from './schema';
import { createTestDb } from './test-db';
import type { TestDb } from './test-db';
import { expectRejectsWithCause } from './test-support';
import { nowIso } from './timestamps';

// These tests pin the schema's DB-enforced rules. They use drizzle
// directly instead of query functions on purpose: the thing under test
// is the generated migration's constraints, not the query layer.

function exerciseRow(overrides: Partial<ExerciseRow> = {}): ExerciseRow {
  return {
    id: newId(),
    kind: 'workout',
    name: `Exercise ${newId()}`,
    sets: 3,
    restSeconds: 60,
    createdAt: nowIso(),
    archivedAt: null,
    ...overrides,
  };
}

function circuitRow(overrides: Partial<CircuitRow> = {}): CircuitRow {
  return {
    id: newId(),
    kind: 'workout',
    name: `Circuit ${newId()}`,
    rotationOrder: 0,
    createdAt: nowIso(),
    archivedAt: null,
    ...overrides,
  };
}

function itemRow(circuitId: string, exerciseId: string): CircuitItemRow {
  return { id: newId(), circuitId, exerciseId, position: 0 };
}

function sessionRow(circuitId: string): SessionRow {
  return { id: newId(), circuitId, startedAt: nowIso(), endedAt: null, outcome: null };
}

function setLogRow(sessionId: string, exerciseId: string): SetLogRow {
  return {
    id: newId(),
    sessionId,
    exerciseId,
    setIndex: 1,
    reps: 10,
    weight: 135,
    weightUnit: 'lb',
    loggedAt: nowIso(),
  };
}

describe('schema constraints', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it('deleting a circuit cascades to its items and leaves exercises alone', async () => {
    const db = testDb.db;
    const ex = exerciseRow();
    const circ = circuitRow();
    await db.insert(exercise).values(ex);
    await db.insert(circuit).values(circ);
    await db.insert(circuitItem).values(itemRow(circ.id, ex.id));

    await db.delete(circuit).where(eq(circuit.id, circ.id));

    expect(await db.select().from(circuitItem)).toEqual([]);
    expect(await db.select().from(exercise)).toEqual([ex]);
  });

  it('blocks hard-deleting an exercise a slot still points at', async () => {
    const db = testDb.db;
    const ex = exerciseRow();
    const circ = circuitRow();
    await db.insert(exercise).values(ex);
    await db.insert(circuit).values(circ);
    await db.insert(circuitItem).values(itemRow(circ.id, ex.id));

    await expectRejectsWithCause(
      db.delete(exercise).where(eq(exercise.id, ex.id)),
      /FOREIGN KEY constraint failed/,
    );
  });

  it('blocks hard-deleting a circuit that has sessions', async () => {
    const db = testDb.db;
    const circ = circuitRow();
    await db.insert(circuit).values(circ);
    await db.insert(session).values(sessionRow(circ.id));

    await expectRejectsWithCause(
      db.delete(circuit).where(eq(circuit.id, circ.id)),
      /FOREIGN KEY constraint failed/,
    );
  });

  it('blocks hard-deleting an exercise that has logs', async () => {
    const db = testDb.db;
    const ex = exerciseRow();
    const circ = circuitRow();
    const sess = sessionRow(circ.id);
    await db.insert(exercise).values(ex);
    await db.insert(circuit).values(circ);
    await db.insert(session).values(sess);
    await db.insert(setLog).values(setLogRow(sess.id, ex.id));

    await expectRejectsWithCause(
      db.delete(exercise).where(eq(exercise.id, ex.id)),
      /FOREIGN KEY constraint failed/,
    );
  });

  it('blocks hard-deleting a session that has logs', async () => {
    const db = testDb.db;
    const ex = exerciseRow();
    const circ = circuitRow();
    const sess = sessionRow(circ.id);
    await db.insert(exercise).values(ex);
    await db.insert(circuit).values(circ);
    await db.insert(session).values(sess);
    await db.insert(setLog).values(setLogRow(sess.id, ex.id));

    await expectRejectsWithCause(
      db.delete(session).where(eq(session.id, sess.id)),
      /FOREIGN KEY constraint failed/,
    );
  });

  it('enforces exclusive membership: one circuit per exercise', async () => {
    const db = testDb.db;
    const ex = exerciseRow();
    const home = circuitRow();
    const away = circuitRow();
    await db.insert(exercise).values(ex);
    await db.insert(circuit).values([home, away]);
    await db.insert(circuitItem).values(itemRow(home.id, ex.id));

    await expectRejectsWithCause(
      db.insert(circuitItem).values(itemRow(away.id, ex.id)),
      /UNIQUE constraint failed: circuit_item\.exercise_id/,
    );
  });

  it('rejects a second ACTIVE exercise with the same name in any ASCII casing', async () => {
    const db = testDb.db;
    await db.insert(exercise).values(exerciseRow({ name: 'Pushups' }));

    await expectRejectsWithCause(
      db.insert(exercise).values(exerciseRow({ name: 'PUSHUPS' })),
      /UNIQUE constraint failed/,
    );
  });

  it('folds only ASCII in the active-name index: non-ASCII casings coexist', async () => {
    // SQLite ships without ICU here (better-sqlite3 AND the device
    // plugin), so lower() leaves the umlaut U unfolded and these two
    // names do NOT collide - while JS toLowerCase() folds them to the
    // same string. Find-or-create must match on the index's ASCII-only
    // form; this pin makes that divergence a visible fact instead of a
    // surprise.
    const db = testDb.db;
    await db.insert(exercise).values(exerciseRow({ name: 'über Rows' }));

    await expect(
      db.insert(exercise).values(exerciseRow({ name: 'ÜBER Rows' })),
    ).resolves.not.toThrow();
  });

  it('rejects out-of-domain values via CHECK, covering non-drizzle writers', async () => {
    // Raw SQL on purpose: drizzle's { enum } types stop TS callers, but
    // an import or restore flow writes rows the compiler never sees.
    // The CHECKs are what stand between those writers and garbage data.
    const db = testDb.db;
    const ex = exerciseRow();
    const circ = circuitRow();
    const sess = sessionRow(circ.id);
    await db.insert(exercise).values(ex);
    await db.insert(circuit).values(circ);
    await db.insert(session).values(sess);

    await expectRejectsWithCause(
      db.run(sql`
        INSERT INTO exercise (id, kind, name, created_at)
        VALUES (${newId()}, 'cardio', 'Rows', ${nowIso()})
      `),
      /CHECK constraint failed: exercise_kind_check/,
    );
    await expectRejectsWithCause(
      db.run(sql`
        INSERT INTO exercise (id, kind, name, created_at)
        VALUES (${newId()}, 'workout', '   ', ${nowIso()})
      `),
      /CHECK constraint failed: exercise_name_not_blank_check/,
    );
    await expectRejectsWithCause(
      db.run(sql`
        INSERT INTO set_log
          (id, session_id, exercise_id, set_index, reps, weight, weight_unit, logged_at)
        VALUES (${newId()}, ${sess.id}, ${ex.id}, 1, 10, 135, 'stone', ${nowIso()})
      `),
      /CHECK constraint failed: set_log_weight_unit_check/,
    );
    await expectRejectsWithCause(
      db.run(sql`
        UPDATE session SET outcome = 'paused' WHERE id = ${sess.id}
      `),
      /CHECK constraint failed: session_outcome_check/,
    );
  });

  it('frees an archived exercise name for reuse', async () => {
    const db = testDb.db;
    const original = exerciseRow({ name: 'Pushups' });
    await db.insert(exercise).values(original);
    await db.update(exercise).set({ archivedAt: nowIso() }).where(eq(exercise.id, original.id));

    await expect(
      db.insert(exercise).values(exerciseRow({ name: 'Pushups' })),
    ).resolves.not.toThrow();
  });
});
