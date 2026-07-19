import { and, desc, eq, exists, isNotNull, isNull, ne, sql } from 'drizzle-orm';

import type { DbHandle } from '@/db/client';
import { newId } from '@/db/ids';
import { circuit, circuitItem, exercise, session, setLog } from '@/db/schema';
import type { CircuitRow, SessionRow, SetLogRow } from '@/db/schema';
import { nowIso } from '@/db/timestamps';

import { getCircuitById, listCircuitSlots, nextRotationOrder } from './builder';

// The workout-flow domain layer: up-next selection, session start/end
// writes, and the reads the workout screens render. Everything derives from
// persisted facts (session rows, set_log counts, rotation order); nothing
// here trusts UI state.

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

// What the start page and home CTA need. A non-null session means the CTA
// reads Resume.
export interface WorkoutStart {
  circuit: CircuitRow;
  session: SessionRow | null;
  exercises: StartExercise[];
}

// Newest-first: an orphaned session (its circuit archived/emptied) can
// linger until the next session start abandons it, so a second in-flight
// row is a real interim state, not a bug.
export async function getInFlightSession(db: DbHandle): Promise<SessionRow | undefined> {
  return db
    .select()
    .from(session)
    .where(isNull(session.endedAt))
    .orderBy(desc(session.startedAt))
    .limit(1)
    .get();
}

// Up next is the front of the rotation among startable circuits (active,
// workout kind, at least one slot; an empty circuit never blocks the queue).
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

// Reads the circuit's CURRENT slots, not a session snapshot, so an
// in-flight session picks up prescription/membership edits on resume.
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

// The lift page's subject: an ACTIVE workout exercise held by a circuit. A
// miss is a stale route (undefined, not an error); the kind filter keeps a
// manually-routed stretch exercise off the lift page.
interface OwnedExercise {
  exerciseId: string;
  name: string;
  sets: number;
  circuitId: string;
}

async function getOwnedExercise(
  db: DbHandle,
  exerciseId: string,
): Promise<OwnedExercise | undefined> {
  return db
    .select({
      exerciseId: exercise.id,
      name: exercise.name,
      sets: exercise.sets,
      circuitId: circuitItem.circuitId,
    })
    .from(exercise)
    .innerJoin(circuitItem, eq(circuitItem.exerciseId, exercise.id))
    .where(
      and(eq(exercise.id, exerciseId), eq(exercise.kind, 'workout'), isNull(exercise.archivedAt)),
    )
    .get();
}

// Scoped to the exercise's OWN circuit: another circuit's in-flight session
// must not lend its logged-set counts here.
async function getInFlightSessionForCircuit(
  db: DbHandle,
  circuitId: string,
): Promise<SessionRow | undefined> {
  return db
    .select()
    .from(session)
    .where(and(eq(session.circuitId, circuitId), isNull(session.endedAt)))
    .orderBy(desc(session.startedAt))
    .limit(1)
    .get();
}

export interface LastSessionSet {
  reps: number;
  weight: number;
  weightUnit: SetLogRow['weightUnit'];
}

// "Last Session" = the newest logged set from an ENDED session (excludes the
// in-flight set just done). setIndex breaks loggedAt ties. Bare column names
// stay distinct across the join - the plugin collapses same-named result
// columns (src/db/proxy-rows.ts).
async function getLastSessionSet(
  db: DbHandle,
  exerciseId: string,
): Promise<LastSessionSet | undefined> {
  return db
    .select({ reps: setLog.reps, weight: setLog.weight, weightUnit: setLog.weightUnit })
    .from(setLog)
    .innerJoin(session, eq(session.id, setLog.sessionId))
    .where(and(eq(setLog.exerciseId, exerciseId), isNotNull(session.endedAt)))
    .orderBy(desc(setLog.loggedAt), desc(setLog.setIndex))
    .limit(1)
    .get();
}

// What the lift (workout-set) screen renders.
export interface WorkoutSet {
  session: SessionRow | null;
  exerciseId: string;
  exerciseName: string;
  prescribedSets: number;
  loggedSets: number;
  // 1-based next unlogged set; null when the exercise is done this session.
  currentSet: number | null;
  // True when this is the SESSION's final unlogged set anywhere in the
  // circuit, so the action reads FINISH instead of START REST.
  isFinalSet: boolean;
  lastSession: LastSessionSet | null;
}

// The session's unlogged sets across a slot list, each clamped at zero (a
// lowered prescription must not push the total negative). Zero means done,
// FINISH tapped or not.
function totalRemainingSets(slots: StartExercise[]): number {
  return slots.reduce((total, slot) => total + Math.max(0, slot.sets - slot.loggedSets), 0);
}

// One exercise's facts plus how many sets are left (here and across the
// circuit); shared by getWorkoutSet and arriveAtRest.
async function resolveSlotFacts(
  db: DbHandle,
  circuitId: string,
  exerciseId: string,
  sessionId: string | null,
): Promise<{ mine: StartExercise; remainingForExercise: number; remainingForSession: number }> {
  const slots = await listStartExercises(db, circuitId, sessionId);
  const mine = slots.find((slot) => slot.exerciseId === exerciseId);
  if (!mine) {
    // The caller joined on this circuit's items, so a miss means the DB
    // changed mid-read.
    throw new Error(`exercise ${exerciseId} vanished from circuit ${circuitId} mid-read`);
  }
  const remainingForExercise = Math.max(0, mine.sets - mine.loggedSets);
  return { mine, remainingForExercise, remainingForSession: totalRemainingSets(slots) };
}

export async function getWorkoutSet(db: DbHandle, exerciseId: string): Promise<WorkoutSet | null> {
  const owned = await getOwnedExercise(db, exerciseId);
  if (!owned) {
    return null;
  }
  const inFlight = (await getInFlightSessionForCircuit(db, owned.circuitId)) ?? null;
  const { mine, remainingForExercise, remainingForSession } = await resolveSlotFacts(
    db,
    owned.circuitId,
    exerciseId,
    inFlight?.id ?? null,
  );
  return {
    session: inFlight,
    exerciseId,
    exerciseName: mine.name,
    prescribedSets: mine.sets,
    loggedSets: mine.loggedSets,
    currentSet: remainingForExercise === 0 ? null : mine.loggedSets + 1,
    isFinalSet: remainingForExercise === 1 && remainingForSession === 1,
    lastSession: (await getLastSessionSet(db, exerciseId)) ?? null,
  };
}

// What the rest screen needs from the transition: which set just finished,
// so its arrival can auto-log it.
export interface RestEntry {
  sessionId: string;
  exerciseId: string;
  setIndex: number;
}

// The fallback prefill when no history answers. weightUnit is constant until
// a settings screen exists, but still stored per row so a future default
// swaps in cleanly.
export const DEFAULT_SET_VALUES: {
  reps: number;
  weight: number;
  weightUnit: SetLogRow['weightUnit'];
} = {
  reps: 10,
  weight: 10,
  weightUnit: 'lb',
};

export type RestMode = 'countdown' | 'final';

// The rest screen's arrival read: the auto-logged row's facts plus what the
// screen renders and navigates on.
export interface RestArrival {
  setLogId: string;
  sessionId: string;
  // The session's persisted start, for the docked TOTAL TIME readout (a
  // separate clock from the rest countdown).
  sessionStartedAt: string;
  exerciseId: string;
  reps: number;
  weight: number;
  weightUnit: SetLogRow['weightUnit'];
  loggedAt: string;
  restSeconds: number;
  mode: RestMode;
  // Unlogged sets left on THIS exercise after this one: NEXT SET routes to
  // the lift page while > 0, else the grid.
  remainingForExercise: number;
}

async function findSetLog(
  db: DbHandle,
  sessionId: string,
  exerciseId: string,
  setIndex: number,
): Promise<SetLogRow | undefined> {
  return db
    .select()
    .from(setLog)
    .where(
      and(
        eq(setLog.sessionId, sessionId),
        eq(setLog.exerciseId, exerciseId),
        eq(setLog.setIndex, setIndex),
      ),
    )
    .get();
}

type SetValues = Pick<SetLogRow, 'reps' | 'weight' | 'weightUnit'>;

// The prefill chain (insert only): (a) same exercise + setIndex from a
// COMPLETED prior session, newest first; else (b) the previous set logged
// THIS session (carry-over within a visit); else (c) the app default. Only
// COMPLETED sessions count - an abandoned or in-flight one would mask (b).
async function prefillSetValues(
  tx: DbHandle,
  sessionId: string,
  exerciseId: string,
  setIndex: number,
): Promise<SetValues> {
  const sameSlotLastSession = await tx
    .select({ reps: setLog.reps, weight: setLog.weight, weightUnit: setLog.weightUnit })
    .from(setLog)
    .innerJoin(session, eq(session.id, setLog.sessionId))
    .where(
      and(
        eq(setLog.exerciseId, exerciseId),
        eq(setLog.setIndex, setIndex),
        ne(setLog.sessionId, sessionId),
        eq(session.outcome, 'completed'),
      ),
    )
    // The where-clause already pins setIndex, so loggedAt desc alone picks
    // the newest.
    .orderBy(desc(setLog.loggedAt))
    .limit(1)
    .get();
  if (sameSlotLastSession) {
    return sameSlotLastSession;
  }
  const previousThisSession = await tx
    .select({ reps: setLog.reps, weight: setLog.weight, weightUnit: setLog.weightUnit })
    .from(setLog)
    .where(and(eq(setLog.exerciseId, exerciseId), eq(setLog.sessionId, sessionId)))
    .orderBy(desc(setLog.loggedAt), desc(setLog.setIndex))
    .limit(1)
    .get();
  return previousThisSession ?? DEFAULT_SET_VALUES;
}

// The START REST / FINISH landing: auto-logs the set that just happened
// (find-then-insert stands in for an upsert - no unique index on
// session/exercise/setIndex) and is idempotent, so re-arrival finds the
// existing row. Null on a stale route (no in-flight session here, or the
// exercise missing/archived/unheld/stretch) - no write.
export async function arriveAtRest(
  db: DbHandle,
  exerciseId: string,
  setIndex: number,
  loggedAt = nowIso(),
): Promise<RestArrival | null> {
  return db.transaction(async (tx) => {
    const owned = await getOwnedExercise(tx, exerciseId);
    if (!owned) {
      return null;
    }
    const inFlight = await getInFlightSessionForCircuit(tx, owned.circuitId);
    if (!inFlight) {
      return null;
    }
    let row = await findSetLog(tx, inFlight.id, exerciseId, setIndex);
    if (!row) {
      // Guard only the insert path: a re-arrival at an existing row survives
      // a since-lowered prescription, but a stale or manual route inserting a
      // spurious row would corrupt the remaining-sets math below.
      if (!Number.isInteger(setIndex) || setIndex < 1 || setIndex > owned.sets) {
        return null;
      }
      const prefill = await prefillSetValues(tx, inFlight.id, exerciseId, setIndex);
      row = {
        id: newId(),
        sessionId: inFlight.id,
        exerciseId,
        setIndex,
        reps: prefill.reps,
        weight: prefill.weight,
        weightUnit: prefill.weightUnit,
        loggedAt,
      };
      await tx.insert(setLog).values(row);
    }
    const { mine, remainingForExercise, remainingForSession } = await resolveSlotFacts(
      tx,
      owned.circuitId,
      exerciseId,
      inFlight.id,
    );
    return {
      setLogId: row.id,
      sessionId: inFlight.id,
      sessionStartedAt: inFlight.startedAt,
      exerciseId,
      reps: row.reps,
      weight: row.weight,
      weightUnit: row.weightUnit,
      loggedAt: row.loggedAt,
      restSeconds: mine.restSeconds,
      mode: remainingForSession === 0 ? 'final' : 'countdown',
      remainingForExercise,
    };
  });
}

export interface RestLogEdit {
  reps: number;
  weight: number;
}

function requireValidRestLogEdit(changes: RestLogEdit): void {
  if (!Number.isInteger(changes.reps) || changes.reps < 0) {
    throw new Error(`updateRestLog: reps must be a non-negative integer, got ${changes.reps}`);
  }
  if (!Number.isFinite(changes.weight) || changes.weight < 0) {
    throw new Error(`updateRestLog: weight must be a non-negative number, got ${changes.weight}`);
  }
}

// The one legitimate set_log mutation: a pre-advance correction to what
// auto-logged. loggedAt (the rest countdown's anchor) is never touched.
// False means the row is gone, so the caller re-derives.
export async function updateRestLog(
  db: DbHandle,
  setLogId: string,
  changes: RestLogEdit,
): Promise<boolean> {
  requireValidRestLogEdit(changes);
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: setLog.id })
      .from(setLog)
      .where(eq(setLog.id, setLogId))
      .get();
    if (!existing) {
      return false;
    }
    await tx
      .update(setLog)
      .set({ reps: changes.reps, weight: changes.weight })
      .where(eq(setLog.id, setLogId));
    return true;
  });
}

// Back-as-rollback: deletes the arrival auto-log outright, edits and all -
// discarding the set is the point. False means the row is already gone,
// which already matches the intent, not an error.
export async function rollBackRest(db: DbHandle, setLogId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: setLog.id })
      .from(setLog)
      .where(eq(setLog.id, setLogId))
      .get();
    if (!existing) {
      return false;
    }
    await tx.delete(setLog).where(eq(setLog.id, setLogId));
    return true;
  });
}

// Appends the circuit to the back of its kind's rotation queue. Rotating an
// archived/emptied circuit is harmless - startable keeps it out anyway.
async function rotateCircuitToBack(tx: DbHandle, circuitId: string): Promise<void> {
  const target = await tx
    .select({ kind: circuit.kind })
    .from(circuit)
    .where(eq(circuit.id, circuitId))
    .get();
  if (!target) {
    // session.circuit_id is FK-restricted; a missing row means the DB
    // is corrupt, not a state to write around.
    throw new Error(`cannot rotate missing circuit ${circuitId}`);
  }
  await tx
    .update(circuit)
    .set({ rotationOrder: await nextRotationOrder(tx, target.kind) })
    .where(eq(circuit.id, circuitId));
}

export type SessionOutcome = NonNullable<SessionRow['outcome']>;

// The one session-ending write: stamp endedAt + outcome and rotate the
// circuit to the back of its queue, same transaction. set_logs are never
// touched - the sets happened.
async function endSessionRow(
  tx: DbHandle,
  row: SessionRow,
  outcome: SessionOutcome,
  endedAt: string,
): Promise<SessionRow> {
  await tx.update(session).set({ endedAt, outcome }).where(eq(session.id, row.id));
  await rotateCircuitToBack(tx, row.circuitId);
  return { ...row, endedAt, outcome };
}

// Abandons every OTHER in-flight session at each session start. This is the
// sole enforcer of "at most one in-flight session" - no editing lock, so an
// emptied circuit's session stays resumable-by-refill until a new workout
// actually starts.
async function abandonOtherInFlightSessions(
  tx: DbHandle,
  keepSessionId: string | null,
  endedAt: string,
): Promise<void> {
  const conditions = [isNull(session.endedAt)];
  if (keepSessionId !== null) {
    conditions.push(ne(session.id, keepSessionId));
  }
  const orphans = await tx
    .select()
    .from(session)
    .where(and(...conditions));
  for (const orphan of orphans) {
    await endSessionRow(tx, orphan, 'abandoned', endedAt);
  }
}

// One transaction shared by both explicit session-ending calls: look the
// row up, refuse an already-ended session (null), end it.
async function endSessionById(
  db: DbHandle,
  sessionId: string,
  outcome: SessionOutcome,
  endedAt: string,
): Promise<SessionRow | null> {
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(session).where(eq(session.id, sessionId)).get();
    if (!existing || existing.endedAt !== null) {
      return null;
    }
    return endSessionRow(tx, existing, outcome, endedAt);
  });
}

// The FINISH transition (also written by reconcileWorkoutCompletion):
// 'completed' + rotation, refusing a second call.
export async function finishSession(
  db: DbHandle,
  sessionId: string,
  endedAt = nowIso(),
): Promise<SessionRow | null> {
  return endSessionById(db, sessionId, 'completed', endedAt);
}

// The circuits screen's explicit abandon: the session-ending path with
// outcome 'abandoned'. set_logs are kept - the sets happened.
export async function abandonSession(
  db: DbHandle,
  sessionId: string,
  endedAt = nowIso(),
): Promise<SessionRow | null> {
  return endSessionById(db, sessionId, 'abandoned', endedAt);
}

// One row of the circuits screen's queue.
export interface RotationQueueRow {
  id: string;
  name: string;
  rotationOrder: number;
  workoutCount: number;
}

// The circuits screen's one read: the queue in play order plus which
// circuit (if any) is in flight.
export interface RotationView {
  queue: RotationQueueRow[];
  active: { sessionId: string; circuitId: string } | null;
}

// The circuits screen's one read. workoutCount is a correlated scalar
// subquery built through drizzle's own query builder, not a raw sql
// template: drizzle-orm 0.45.2 only qualifies a correlated column reference
// correctly via db.select().from().where(), not ${column} interpolation
// spanning two tables. Also safe against the same-named-bare-column
// collision (src/db/proxy-rows.ts).
export async function getRotationView(db: DbHandle): Promise<RotationView> {
  const workoutCountSubquery = db
    .select({ n: sql<number>`count(*)`.as('n') })
    .from(circuitItem)
    .where(eq(circuitItem.circuitId, circuit.id));

  const queue = await db
    .select({
      id: circuit.id,
      name: circuit.name,
      rotationOrder: circuit.rotationOrder,
      workoutCount: sql<number>`(${workoutCountSubquery})`.as('workout_count'),
    })
    .from(circuit)
    .where(and(eq(circuit.kind, 'workout'), isNull(circuit.archivedAt)))
    .orderBy(circuit.rotationOrder);

  const inFlight = await getInFlightSession(db);
  const active =
    inFlight && queue.some((row) => row.id === inFlight.circuitId)
      ? { sessionId: inFlight.id, circuitId: inFlight.circuitId }
      : null;

  return { queue, active };
}

// The active-circuit box's swap: ends the in-flight session and moves the
// chosen circuit to the front, one transaction. Never starts a session
// (Start Workout is the only entry point); every refusal returns null with
// zero writes.
export async function swapActiveCircuit(
  db: DbHandle,
  sessionId: string,
  toCircuitId: string,
): Promise<SessionRow | null> {
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(session).where(eq(session.id, sessionId)).get();
    if (!existing || existing.endedAt !== null) {
      return null;
    }
    if (toCircuitId === existing.circuitId) {
      return null;
    }
    const target = await tx.select().from(circuit).where(eq(circuit.id, toCircuitId)).get();
    if (!target || target.archivedAt !== null || target.kind !== 'workout') {
      return null;
    }
    const targetHasItems = await tx
      .select({ id: circuitItem.id })
      .from(circuitItem)
      .where(eq(circuitItem.circuitId, toCircuitId))
      .get();
    if (!targetHasItems) {
      // An empty target would make "Start Workout will start X" a lie -
      // the startable predicate skips empties.
      return null;
    }

    const endedAt = nowIso();
    const ended = await endSessionRow(tx, existing, 'abandoned', endedAt);
    const frontRow = await tx
      .select({
        min: sql<number>`coalesce(min(${circuit.rotationOrder}), 0)`.as('min_rotation_order'),
      })
      .from(circuit)
      .where(eq(circuit.kind, target.kind))
      .get();
    // Negative values are fine (INTEGER column; ordering is relative).
    await tx
      .update(circuit)
      .set({ rotationOrder: (frontRow?.min ?? 0) - 1 })
      .where(eq(circuit.id, toCircuitId));
    return ended;
  });
}

// Ends an in-flight session whose remaining sets already hit zero through
// workbench edits, with no final rest to FINISH it - otherwise it can never
// end.
export async function reconcileWorkoutCompletion(
  db: DbHandle,
  endedAt = nowIso(),
): Promise<SessionRow | null> {
  return db.transaction(async (tx) => {
    const start = await getWorkoutStart(tx);
    if (!start?.session) {
      return null;
    }
    if (totalRemainingSets(start.exercises) > 0) {
      return null;
    }
    return endSessionRow(tx, start.session, 'completed', endedAt);
  });
}

// The START REST / FINISH transition. Normally the session already exists
// (startWorkout); the insert below is a fallback for a stale route with no
// session, so a set that physically happened is never unrecordable. Null
// when the exercise is not liftable or has no unlogged set left.
export async function startRest(
  db: DbHandle,
  exerciseId: string,
  startedAt = nowIso(),
): Promise<RestEntry | null> {
  return db.transaction(async (tx) => {
    const owned = await getOwnedExercise(tx, exerciseId);
    if (!owned) {
      return null;
    }
    let inFlight = await getInFlightSessionForCircuit(tx, owned.circuitId);
    const loggedSets = inFlight
      ? ((await countLoggedSetsByExercise(tx, inFlight.id)).get(exerciseId) ?? 0)
      : 0;
    if (loggedSets >= owned.sets) {
      return null;
    }
    if (!inFlight) {
      // The fallback insert starts a session like any other path, abandoning
      // any other in-flight session so the rows converge to one.
      await abandonOtherInFlightSessions(tx, null, startedAt);
      inFlight = {
        id: newId(),
        circuitId: owned.circuitId,
        startedAt,
        endedAt: null,
        outcome: null,
      };
      await tx.insert(session).values(inFlight);
    }
    return { sessionId: inFlight.id, exerciseId, setIndex: loggedSets + 1 };
  });
}

// The Start Workout transition: creates the session row (its persisted
// startedAt drives the total-time readout across restarts), or rides the
// existing one on a resume. One transaction, so a double-tap can't create
// two rows; null when nothing is startable.
export async function startWorkout(db: DbHandle, startedAt = nowIso()): Promise<SessionRow | null> {
  return db.transaction(async (tx) => {
    const start = await getWorkoutStart(tx);
    if (!start) {
      return null;
    }
    await abandonOtherInFlightSessions(tx, start.session?.id ?? null, startedAt);
    if (start.session) {
      return start.session;
    }
    const newSession: SessionRow = {
      id: newId(),
      circuitId: start.circuit.id,
      startedAt,
      endedAt: null,
      outcome: null,
    };
    await tx.insert(session).values(newSession);
    return newSession;
  });
}

// The up-next rule: an in-flight session selects its own circuit; otherwise
// the front startable circuit. Null means nothing is startable.
export async function getWorkoutStart(db: DbHandle): Promise<WorkoutStart | null> {
  const inFlight = await getInFlightSession(db);
  if (inFlight) {
    const owner = await getCircuitById(db, inFlight.circuitId);
    if (!owner) {
      // session.circuit_id is FK-restricted; a missing row means the DB
      // is corrupt, not a state to render around.
      throw new Error(`in-flight session ${inFlight.id} references missing circuit`);
    }
    // Resume only into a still-STARTABLE circuit. Archiving/emptying it
    // mid-session leaves nothing to resume into (derived per read, so
    // re-adding a workout restores the resume); the orphaned row is
    // abandoned at the next session start.
    if (owner.archivedAt === null && owner.kind === 'workout') {
      const exercises = await listStartExercises(db, owner.id, inFlight.id);
      if (exercises.length > 0) {
        return { circuit: owner, session: inFlight, exercises };
      }
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

export type ResumePoint =
  { screen: 'workout-start' } | { screen: 'rest'; exerciseId: string; setIndex: number };

// The cold-open restore read: which screen the session's facts imply. Any
// logged set restores the rest screen for the newest - "resting" includes an
// expired rest at 0:00, since backgrounding mid-rest is normal and re-landing
// is idempotent. No sets (or the newest set's exercise no longer held)
// restores the exercise grid.
export async function getResumePoint(db: DbHandle): Promise<ResumePoint | null> {
  const start = await getWorkoutStart(db);
  if (!start?.session) {
    return null;
  }
  const newest = await db
    .select({ exerciseId: setLog.exerciseId, setIndex: setLog.setIndex })
    .from(setLog)
    .where(eq(setLog.sessionId, start.session.id))
    .orderBy(desc(setLog.loggedAt), desc(setLog.setIndex))
    .limit(1)
    .get();
  if (!newest || !start.exercises.some((slot) => slot.exerciseId === newest.exerciseId)) {
    return { screen: 'workout-start' };
  }
  return { screen: 'rest', exerciseId: newest.exerciseId, setIndex: newest.setIndex };
}
