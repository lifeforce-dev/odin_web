import { and, desc, eq, exists, isNull, sql } from 'drizzle-orm';

import type { DbHandle } from '@/db/client';
import { circuit, circuitItem, session, setLog } from '@/db/schema';
import type { CircuitRow, SessionRow } from '@/db/schema';

import { getCircuitById, listCircuitSlots } from './builder';

// The workout-flow domain layer, read side: which circuit is up next
// and how far the in-flight session has gotten. Everything derives
// from persisted facts (session rows, set_log counts, rotation order);
// nothing here trusts UI state. Session writes land in 03-05.

export type ExerciseProgress = 'pending' | 'in-progress' | 'done';

// One tile on the start page's exercise-select grid.
export interface StartExercise {
  exerciseId: string;
  name: string;
  sets: number;
  restSeconds: number;
  loggedSets: number;
  progress: ExerciseProgress;
}

// What the start page and the home CTA need: the up-next circuit, the
// in-flight session when one exists (non-null means the CTA reads
// Resume), and the grid with session-scoped progress.
export interface WorkoutStart {
  circuit: CircuitRow;
  session: SessionRow | null;
  exercises: StartExercise[];
}

// At most one in-flight session exists by construction (sessions end
// only explicitly); the ordering makes the answer deterministic anyway
// if a bug ever leaves two behind.
export async function getInFlightSession(db: DbHandle): Promise<SessionRow | undefined> {
  return db
    .select()
    .from(session)
    .where(isNull(session.endedAt))
    .orderBy(desc(session.startedAt))
    .limit(1)
    .get();
}

// Startable = active, workout kind, holding at least one slot: an
// empty circuit cannot be worked out, so it never blocks the queue.
// Up next is the front of the rotation among startable circuits.
async function getFrontStartableCircuit(db: DbHandle): Promise<CircuitRow | undefined> {
  return db
    .select()
    .from(circuit)
    .where(
      and(
        eq(circuit.kind, 'workout'),
        isNull(circuit.archivedAt),
        exists(
          db
            .select({ id: circuitItem.id })
            .from(circuitItem)
            .where(eq(circuitItem.circuitId, circuit.id)),
        ),
      ),
    )
    .orderBy(circuit.rotationOrder)
    .limit(1)
    .get();
}

async function countLoggedSetsByExercise(
  db: DbHandle,
  sessionId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      exerciseId: setLog.exerciseId,
      loggedSets: sql<number>`count(*)`.as('logged_sets'),
    })
    .from(setLog)
    .where(eq(setLog.sessionId, sessionId))
    .groupBy(setLog.exerciseId);
  return new Map(rows.map((row) => [row.exerciseId, row.loggedSets]));
}

function toProgress(loggedSets: number, prescribedSets: number): ExerciseProgress {
  if (loggedSets === 0) {
    return 'pending';
  }
  // >= not ===: a prescription lowered mid-session must not strand the
  // tile in-progress with nothing left to log.
  return loggedSets >= prescribedSets ? 'done' : 'in-progress';
}

// The grid reads the circuit's CURRENT slots, not a session snapshot:
// an in-flight session picks up prescription and membership edits on
// resume by design.
async function listStartExercises(
  db: DbHandle,
  circuitId: string,
  sessionId: string | null,
): Promise<StartExercise[]> {
  const slots = await listCircuitSlots(db, circuitId);
  const loggedCounts = sessionId
    ? await countLoggedSetsByExercise(db, sessionId)
    : new Map<string, number>();
  return slots.map((slot) => {
    const loggedSets = loggedCounts.get(slot.exerciseId) ?? 0;
    return {
      exerciseId: slot.exerciseId,
      name: slot.exerciseName,
      sets: slot.sets,
      restSeconds: slot.restSeconds,
      loggedSets,
      progress: toProgress(loggedSets, slot.sets),
    };
  });
}

// The up-next rule: an in-flight session wins and selects its circuit
// (its facts trump the rotation); otherwise the front startable
// circuit. Null means nothing is startable and the home CTA disables.
export async function getWorkoutStart(db: DbHandle): Promise<WorkoutStart | null> {
  const inFlight = await getInFlightSession(db);
  if (inFlight) {
    const owner = await getCircuitById(db, inFlight.circuitId);
    if (!owner) {
      // session.circuit_id is FK-restricted; a missing row means the DB
      // is corrupt, not a state to render around.
      throw new Error(`in-flight session ${inFlight.id} references missing circuit`);
    }
    // An archived owner means the circuit was discarded mid-session
    // (archiving also deletes its items, so there is nothing to resume
    // into): the session is not resumable and the rotation rules as if
    // it had ended. Ending/reaping the orphaned session row is 03-05's.
    if (owner.archivedAt === null) {
      return {
        circuit: owner,
        session: inFlight,
        exercises: await listStartExercises(db, owner.id, inFlight.id),
      };
    }
  }
  const front = await getFrontStartableCircuit(db);
  if (!front) {
    return null;
  }
  return {
    circuit: front,
    session: null,
    exercises: await listStartExercises(db, front.id, null),
  };
}
