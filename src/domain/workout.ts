import { and, desc, eq, exists, isNull, ne, sql } from 'drizzle-orm';

import type { DbHandle } from '@/db/client';
import { newId } from '@/db/ids';
import { circuit, circuitItem, exercise, session, setLog } from '@/db/schema';
import type { CircuitRow, SessionRow, SetLogRow } from '@/db/schema';
import { nowIso } from '@/db/timestamps';

import { getCircuitById, listCircuitSlots } from './builder';

// The workout-flow domain layer: which circuit is up next, how far the
// in-flight session has gotten, and the session-start writes -
// startWorkout minting the session row at the home CTA tap (the owner
// ruling: tapping Start Workout IS the workout starting, and the
// total-time readout anchors on the persisted startedAt so it survives
// restarts), with startRest keeping a stale-route fallback mint.
// Everything derives from persisted facts (session rows, set_log
// counts, rotation order); nothing here trusts UI state. Terminal
// session writes (outcome, rotation) land in 03-05.

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

// Newest-first. Sessions end only explicitly, so usually one row is in
// flight - but a session orphaned by archiving/emptying its circuit
// stays in flight BY DESIGN until 03-05's reap lands, so a second row
// is a real state, not a bug; the ordering picks the newest.
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

// The lift page's subject: an ACTIVE workout exercise held by a
// circuit. The grid only navigates to slots, so a miss is a stale
// route (an archive or removal since), answered with undefined rather
// than an error. The kind filter keeps a manually-routed stretch
// exercise off the lift page - and startRest's fallback mint off a
// stretch circuit (exercise and circuit kinds match by construction;
// addExerciseToCircuit rejects a mismatch).
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

// The lift page scopes its session to the exercise's OWN circuit: an
// in-flight session on another circuit must not lend its counts here.
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

// "Last Session" = the newest logged set from a previous visit to this
// exercise. Excluded: THIS circuit's in-flight session, or the card
// would echo the set just done. Another circuit's in-flight logs (the
// exercise was stolen mid-workout) still surface here - nothing can
// end a session until 03-05 lands, so an ended-sessions-only filter
// would blank all history today; tighten to it there. setIndex breaks
// loggedAt ties within one visit.
async function getLastSessionSet(
  db: DbHandle,
  exerciseId: string,
  excludeSessionId: string | null,
): Promise<LastSessionSet | undefined> {
  const conditions = [eq(setLog.exerciseId, exerciseId)];
  if (excludeSessionId !== null) {
    conditions.push(ne(setLog.sessionId, excludeSessionId));
  }
  return db
    .select({ reps: setLog.reps, weight: setLog.weight, weightUnit: setLog.weightUnit })
    .from(setLog)
    .where(and(...conditions))
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
  // 1-based next unlogged set; null when the exercise is done this
  // session (>= semantics, so a prescription lowered mid-session reads
  // done instead of stranding the screen).
  currentSet: number | null;
  // True when this is the SESSION's final unlogged set anywhere in the
  // circuit, so the action reads FINISH; the last set of a non-final
  // exercise keeps START REST.
  isFinalSet: boolean;
  lastSession: LastSessionSet | null;
}

// Resolves a circuit's current slots down to one exercise's facts:
// shared by getWorkoutSet (the lift page) and arriveAtRest (the rest
// page), which both need the same "how many sets are left, here and
// across the whole circuit" math on top of listStartExercises.
async function resolveSlotFacts(
  db: DbHandle,
  circuitId: string,
  exerciseId: string,
  sessionId: string | null,
): Promise<{ mine: StartExercise; remainingForExercise: number; remainingForSession: number }> {
  const slots = await listStartExercises(db, circuitId, sessionId);
  const mine = slots.find((slot) => slot.exerciseId === exerciseId);
  if (!mine) {
    // The caller's own read joined on this circuit's items, so the slot
    // list must contain the exercise; a miss means the DB changed
    // mid-read.
    throw new Error(`exercise ${exerciseId} vanished from circuit ${circuitId} mid-read`);
  }
  const remainingForExercise = Math.max(0, mine.sets - mine.loggedSets);
  const remainingForSession = slots.reduce(
    (total, slot) => total + Math.max(0, slot.sets - slot.loggedSets),
    0,
  );
  return { mine, remainingForExercise, remainingForSession };
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
    lastSession: (await getLastSessionSet(db, exerciseId, inFlight?.id ?? null)) ?? null,
  };
}

// What the rest screen needs from the transition: which set the lifter
// just finished, so its arrival can auto-log it (03-03).
export interface RestEntry {
  sessionId: string;
  exerciseId: string;
  setIndex: number;
}

// The prefill floor when neither history branch answers: a fresh
// exercise with no prior visit and no earlier set this session.
// weightUnit is a constant until the settings screen exists; it is
// still captured per row, so a future default swaps cleanly.
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

// The rest screen's arrival read: the auto-logged row's facts flattened
// alongside what the screen needs to render and navigate - no separate
// row/facts split, mirroring WorkoutSet's shape.
export interface RestArrival {
  setLogId: string;
  sessionId: string;
  // The session's persisted start, for the docked TOTAL TIME readout
  // (a separate clock from the rest countdown; see domain/rest-timer.ts).
  sessionStartedAt: string;
  exerciseId: string;
  reps: number;
  weight: number;
  weightUnit: SetLogRow['weightUnit'];
  loggedAt: string;
  restSeconds: number;
  mode: RestMode;
  // Unlogged sets left on THIS exercise after this one (clamped >= 0):
  // NEXT SET routes back to the lift page while this is > 0, else the
  // grid.
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

// The prefill chain (insert only, so re-arrival never re-derives it):
// (a) the same exercise + setIndex from a DIFFERENT session, newest
// first - the most relevant history for "what did I lift here last
// time"; else (b) the previous set logged THIS session (progression
// within one visit); else (c) the app default.
async function prefillSetValues(
  tx: DbHandle,
  sessionId: string,
  exerciseId: string,
  setIndex: number,
): Promise<SetValues> {
  const sameSlotElsewhere = await tx
    .select({ reps: setLog.reps, weight: setLog.weight, weightUnit: setLog.weightUnit })
    .from(setLog)
    .where(
      and(
        eq(setLog.exerciseId, exerciseId),
        eq(setLog.setIndex, setIndex),
        ne(setLog.sessionId, sessionId),
      ),
    )
    // Every row here already shares setIndex (the where-clause pins it),
    // so ordering by it too would be a no-op tiebreaker; loggedAt desc
    // alone picks the newest.
    .orderBy(desc(setLog.loggedAt))
    .limit(1)
    .get();
  if (sameSlotElsewhere) {
    return sameSlotElsewhere;
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

// The START REST / FINISH transition's landing: auto-logs the set that
// just happened (find-then-insert inside one transaction stands in for
// an upsert - there is no unique index on the (session, exercise,
// setIndex) triple) and derives the screen's mode from session facts.
// Idempotent by construction: re-arrival finds the existing row instead
// of prefilling again. Null when the route is stale - no in-flight
// session on this exercise's circuit (the lift page owns the fallback
// mint) or the exercise is missing/archived/unheld/stretch - so no
// write and no session mint ever happens here.
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
      // Only the insert path needs guarding against a route-carried
      // setIndex the caller never validated: a legitimate re-arrival at
      // an EXISTING row survives a since-lowered prescription (the find
      // above already resolved it), but a stale/manual route minting a
      // phantom row here would corrupt the remaining-sets math below
      // and could force final mode early.
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

// The one legitimate mutation of a set_log row: a pre-advance
// correction to what auto-logged. loggedAt (the rest anchor) is never
// touched. Returns false when the row is gone (stale edit racing a
// change elsewhere), so the caller can re-derive rather than guess.
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

// The rest screen's back-as-rollback: undoes the arrival auto-log
// outright, edits and all - aborting the set is the point. Touches ONLY
// this row: no session mint, no outcome stamp, no other row ever moves.
// False means the row is already gone - the state already matches the
// intent, not an error the caller needs to handle differently.
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

// The FINISH transition's minimal completion: stamps endedAt once and
// refuses a second call (null). Deliberately does not set an outcome or
// rotate the queue - a later domain change owns both and will backfill
// outcome for sessions ended before it lands. This alone lets the run
// today go start -> lift -> rest -> FINISH -> home, where the CTA reads
// Start Workout again because getWorkoutStart only resumes a session
// with a null endedAt.
export async function finishSession(
  db: DbHandle,
  sessionId: string,
  endedAt = nowIso(),
): Promise<SessionRow | null> {
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(session).where(eq(session.id, sessionId)).get();
    if (!existing || existing.endedAt !== null) {
      return null;
    }
    await tx.update(session).set({ endedAt }).where(eq(session.id, sessionId));
    return { ...existing, endedAt };
  });
}

// The START REST / FINISH transition. The normal flow arrives with a
// session already minted by startWorkout; the mint below is a fallback
// for a stale or manual route onto a lift page with no session, so a
// set that physically happened is never unrecordable (its startedAt is
// then the rest tap, the closest surviving fact). Null when the
// exercise is not liftable (missing, archived, unheld) or has no
// unlogged set left - stale-screen races, not errors.
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
      inFlight = { id: newId(), circuitId: owned.circuitId, startedAt, endedAt: null };
      await tx.insert(session).values(inFlight);
    }
    return { sessionId: inFlight.id, exerciseId, setIndex: loggedSets + 1 };
  });
}

// The Start Workout transition: tapping the home CTA IS the workout
// starting, so the session row is minted here and its persisted
// startedAt anchors the total-time readout across restarts. A tap
// while a session is in flight is a resume and rides the existing row.
// Null when nothing is startable (the CTA was stale). One transaction:
// a double-tap must not mint twins.
export async function startWorkout(db: DbHandle, startedAt = nowIso()): Promise<SessionRow | null> {
  return db.transaction(async (tx) => {
    const start = await getWorkoutStart(tx);
    if (!start) {
      return null;
    }
    if (start.session) {
      return start.session;
    }
    const minted: SessionRow = {
      id: newId(),
      circuitId: start.circuit.id,
      startedAt,
      endedAt: null,
    };
    await tx.insert(session).values(minted);
    return minted;
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
    // Resume only into a circuit that is still STARTABLE - the same
    // predicate the rotation uses (active, workout kind, at least one
    // slot). Archiving or emptying a circuit mid-session leaves nothing
    // to resume into, so the rotation rules as if the session had
    // ended; derived per read, so re-adding a workout restores the
    // resume. Ending/reaping the orphaned session row is 03-05's.
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
