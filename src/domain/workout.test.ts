import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newId } from '@/db/ids';
import { exercise, session, setLog } from '@/db/schema';
import type { CircuitRow, ExerciseRow, SessionRow } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import type { TestDb } from '@/db/test-db';

import {
  addExerciseToCircuit,
  archiveCircuit,
  createCircuit,
  findOrCreateExercise,
  getCircuitById,
  listActiveCircuits,
  listCircuitSlots,
  removeCircuitItem,
  setPrescription,
  trashExercise,
} from './builder';
import {
  DEFAULT_SET_VALUES,
  abandonSession,
  arriveAtRest,
  finishSession,
  getInFlightSession,
  getResumePoint,
  getRotationView,
  getWorkoutSet,
  getWorkoutStart,
  reconcileWorkoutCompletion,
  rollBackRest,
  startRest,
  startWorkout,
  swapActiveCircuit,
  updateRestLog,
} from './workout';

let testDb: TestDb;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(() => {
  testDb.close();
});

async function makeCircuitWithWorkouts(
  name: string,
  workoutNames: string[],
): Promise<{ circuit: CircuitRow; exercises: ExerciseRow[] }> {
  const row = await createCircuit(testDb.db, { kind: 'workout', name });
  const exercises: ExerciseRow[] = [];
  for (const workoutName of workoutNames) {
    const exercise = await findOrCreateExercise(testDb.db, 'workout', workoutName);
    await addExerciseToCircuit(testDb.db, row.id, exercise.id);
    exercises.push(exercise);
  }
  return { circuit: row, exercises };
}

async function insertSession(
  circuitId: string,
  {
    startedAt = '2026-07-16T10:00:00.000Z',
    endedAt = null as string | null,
    // Ended seeds default to 'completed': endedAt and outcome are one
    // fact after migration 0002, so a bare endedAt would seed a row
    // the app can no longer produce.
    outcome = null as SessionRow['outcome'],
  } = {},
): Promise<SessionRow> {
  const row: SessionRow = {
    id: newId(),
    circuitId,
    startedAt,
    endedAt,
    outcome: outcome ?? (endedAt !== null ? 'completed' : null),
  };
  await testDb.db.insert(session).values(row);
  return row;
}

async function insertSetLog(
  sessionId: string,
  exerciseId: string,
  setIndex: number,
  {
    reps = 10,
    weight = 10,
    loggedAt = '2026-07-16T10:05:00.000Z',
  }: { reps?: number; weight?: number; loggedAt?: string } = {},
): Promise<void> {
  await testDb.db.insert(setLog).values({
    id: newId(),
    sessionId,
    exerciseId,
    setIndex,
    reps,
    weight,
    weightUnit: 'lb',
    loggedAt,
  });
}

describe('workout start', () => {
  describe('up-next selection', () => {
    it('returns null when no circuits exist', async () => {
      expect(await getWorkoutStart(testDb.db)).toBeNull();
    });

    it('returns null when every circuit is empty', async () => {
      await createCircuit(testDb.db, { kind: 'workout', name: 'Empty' });
      expect(await getWorkoutStart(testDb.db)).toBeNull();
    });

    it('picks the front of the rotation queue', async () => {
      const front = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      await makeCircuitWithWorkouts('Pull', ['Cable Row']);

      const start = await getWorkoutStart(testDb.db);

      expect(start?.circuit.id).toBe(front.circuit.id);
      expect(start?.session).toBeNull();
    });

    it('skips an archived circuit at the front', async () => {
      const front = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const next = await makeCircuitWithWorkouts('Pull', ['Cable Row']);
      await archiveCircuit(testDb.db, front.circuit.id);

      const start = await getWorkoutStart(testDb.db);

      expect(start?.circuit.id).toBe(next.circuit.id);
    });

    it('skips an empty circuit at the front: only startable circuits queue', async () => {
      await createCircuit(testDb.db, { kind: 'workout', name: 'Empty Front' });
      const startable = await makeCircuitWithWorkouts('Pull', ['Cable Row']);

      const start = await getWorkoutStart(testDb.db);

      expect(start?.circuit.id).toBe(startable.circuit.id);
    });

    it('ignores stretch circuits', async () => {
      const stretch = await createCircuit(testDb.db, { kind: 'stretch', name: 'Mobility' });
      const hold = await findOrCreateExercise(testDb.db, 'stretch', 'Pigeon Hold');
      await addExerciseToCircuit(testDb.db, stretch.id, hold.id);

      expect(await getWorkoutStart(testDb.db)).toBeNull();
    });

    it('lets an in-flight session win over rotation order', async () => {
      await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const back = await makeCircuitWithWorkouts('Pull', ['Cable Row']);
      const inFlight = await insertSession(back.circuit.id);

      const start = await getWorkoutStart(testDb.db);

      expect(start?.circuit.id).toBe(back.circuit.id);
      expect(start?.session?.id).toBe(inFlight.id);
    });

    it('ignores ended sessions: the rotation front rules again', async () => {
      const front = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const back = await makeCircuitWithWorkouts('Pull', ['Cable Row']);
      await insertSession(back.circuit.id, { endedAt: '2026-07-16T11:00:00.000Z' });

      const start = await getWorkoutStart(testDb.db);

      expect(start?.circuit.id).toBe(front.circuit.id);
      expect(start?.session).toBeNull();
    });

    it('treats an in-flight session on an archived circuit as not resumable', async () => {
      const doomed = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const survivor = await makeCircuitWithWorkouts('Pull', ['Cable Row']);
      await insertSession(doomed.circuit.id);
      await archiveCircuit(testDb.db, doomed.circuit.id);

      const start = await getWorkoutStart(testDb.db);

      // Archiving deleted the circuit's items, so there is nothing to
      // resume into; the rotation rules as if the session had ended.
      // A later session start ends and reaps the orphaned session row.
      expect(start?.circuit.id).toBe(survivor.circuit.id);
      expect(start?.session).toBeNull();
    });

    it('treats an in-flight session on an emptied circuit as not resumable', async () => {
      const emptied = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const survivor = await makeCircuitWithWorkouts('Pull', ['Cable Row']);
      await insertSession(emptied.circuit.id);
      for (const slot of await listCircuitSlots(testDb.db, emptied.circuit.id)) {
        await removeCircuitItem(testDb.db, slot.id);
      }

      const start = await getWorkoutStart(testDb.db);

      // The other door into the same dead-end as archiving: removing
      // every workout in the workbench leaves nothing to resume into.
      // Derived per read, so re-adding a workout restores the resume.
      expect(start?.circuit.id).toBe(survivor.circuit.id);
      expect(start?.session).toBeNull();
    });
  });

  describe('startWorkout', () => {
    async function allSessions(): Promise<SessionRow[]> {
      return testDb.db.select().from(session);
    }

    it('mints the session for the front startable circuit at the CTA tap', async () => {
      const { circuit } = await makeCircuitWithWorkouts('Push', ['Bench Press']);

      const minted = await startWorkout(testDb.db, '2026-07-16T09:58:00.000Z');

      expect(minted).toMatchObject({
        circuitId: circuit.id,
        startedAt: '2026-07-16T09:58:00.000Z',
        endedAt: null,
      });
      expect(await allSessions()).toEqual([minted]);
    });

    it('rides the in-flight session on resume instead of minting a twin', async () => {
      const { circuit } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const inFlight = await insertSession(circuit.id);

      const resumed = await startWorkout(testDb.db);

      expect(resumed?.id).toBe(inFlight.id);
      expect(await allSessions()).toHaveLength(1);
    });

    it('answers null and mints nothing when no circuit is startable', async () => {
      await createCircuit(testDb.db, { kind: 'workout', name: 'Empty' });

      expect(await startWorkout(testDb.db)).toBeNull();
      expect(await allSessions()).toHaveLength(0);
    });

    it('mints past a non-resumable orphan and reaps it as abandoned', async () => {
      const doomed = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const survivor = await makeCircuitWithWorkouts('Pull', ['Cable Row']);
      const orphan = await insertSession(doomed.circuit.id);
      await archiveCircuit(testDb.db, doomed.circuit.id);

      const minted = await startWorkout(testDb.db, '2026-07-16T12:00:00.000Z');

      // The new workout starts on the circuit the rotation actually
      // offers, and beginning new work is the moment the orphaned row
      // stops being true: the mint abandons it in the same transaction.
      expect(minted?.circuitId).toBe(survivor.circuit.id);
      const reaped = (await allSessions()).find((row) => row.id === orphan.id);
      expect(reaped).toMatchObject({
        endedAt: '2026-07-16T12:00:00.000Z',
        outcome: 'abandoned',
      });
    });

    it('reaps an orphan on an EMPTIED circuit at the next mint, not before', async () => {
      const emptied = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const survivor = await makeCircuitWithWorkouts('Pull', ['Cable Row']);
      const orphan = await insertSession(emptied.circuit.id);
      for (const slot of await listCircuitSlots(testDb.db, emptied.circuit.id)) {
        await removeCircuitItem(testDb.db, slot.id);
      }
      // Emptying alone reaps nothing: refilling the circuit would make
      // the session resumable again, so its fate waits for a real mint.
      expect((await getInFlightSession(testDb.db))?.id).toBe(orphan.id);

      const minted = await startWorkout(testDb.db, '2026-07-16T12:00:00.000Z');

      expect(minted?.circuitId).toBe(survivor.circuit.id);
      const reaped = (await allSessions()).find((row) => row.id === orphan.id);
      expect(reaped).toMatchObject({ outcome: 'abandoned' });

      // The reap's rotation half is part of its contract, not a free
      // ride on endSessionRow: the emptied circuit moves behind the
      // survivor, so a refill starts at the back of the queue.
      const order = await listActiveCircuits(testDb.db, 'workout');
      expect(order.map((row) => row.name)).toEqual(['Pull', 'Push']);
    });

    it('resume reaps any OTHER in-flight row but never the resumed session', async () => {
      const doomed = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const live = await makeCircuitWithWorkouts('Pull', ['Cable Row']);
      const orphan = await insertSession(doomed.circuit.id, {
        startedAt: '2026-07-16T09:00:00.000Z',
      });
      await archiveCircuit(testDb.db, doomed.circuit.id);
      const inFlight = await insertSession(live.circuit.id);

      const resumed = await startWorkout(testDb.db, '2026-07-16T12:00:00.000Z');

      expect(resumed?.id).toBe(inFlight.id);
      const rows = await allSessions();
      expect(rows.find((row) => row.id === orphan.id)).toMatchObject({ outcome: 'abandoned' });
      expect(rows.find((row) => row.id === inFlight.id)).toMatchObject({
        endedAt: null,
        outcome: null,
      });
    });
  });

  describe('getInFlightSession', () => {
    it('finds the session with a null endedAt', async () => {
      const { circuit } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      await insertSession(circuit.id, {
        startedAt: '2026-07-15T10:00:00.000Z',
        endedAt: '2026-07-15T11:00:00.000Z',
      });
      const inFlight = await insertSession(circuit.id);

      expect((await getInFlightSession(testDb.db))?.id).toBe(inFlight.id);
    });
  });

  describe('exercise grid progress', () => {
    it('renders every tile pending when no session is in flight', async () => {
      const { exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press', 'Dips']);

      const start = await getWorkoutStart(testDb.db);

      expect(start?.exercises.map((tile) => tile.progress)).toEqual(['pending', 'pending']);
      expect(start?.exercises[0]).toMatchObject({
        exerciseId: exercises[0].id,
        name: 'Bench Press',
        loggedSets: 0,
      });
    });

    it("derives pending / in-progress / done from this session's logged counts", async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', [
        'Bench Press',
        'Dips',
        'Overhead Press',
      ]);
      await setPrescription(testDb.db, exercises[0].id, { sets: 4 });
      await setPrescription(testDb.db, exercises[1].id, { sets: 2 });
      const inFlight = await insertSession(circuit.id);
      await insertSetLog(inFlight.id, exercises[0].id, 1);
      await insertSetLog(inFlight.id, exercises[0].id, 2);
      await insertSetLog(inFlight.id, exercises[1].id, 1);
      await insertSetLog(inFlight.id, exercises[1].id, 2);

      const start = await getWorkoutStart(testDb.db);

      expect(start?.exercises).toMatchObject([
        { name: 'Bench Press', sets: 4, loggedSets: 2, progress: 'in-progress' },
        { name: 'Dips', sets: 2, loggedSets: 2, progress: 'done' },
        { name: 'Overhead Press', loggedSets: 0, progress: 'pending' },
      ]);
    });

    it('scopes counts to the in-flight session: stamps die with the session', async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const ended = await insertSession(circuit.id, {
        startedAt: '2026-07-15T10:00:00.000Z',
        endedAt: '2026-07-15T11:00:00.000Z',
      });
      await insertSetLog(ended.id, exercises[0].id, 1);
      await insertSetLog(ended.id, exercises[0].id, 2);
      await insertSetLog(ended.id, exercises[0].id, 3);

      const start = await getWorkoutStart(testDb.db);

      expect(start?.exercises[0]).toMatchObject({ loggedSets: 0, progress: 'pending' });
    });

    it('treats a prescription lowered mid-session as done, not stranded', async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const inFlight = await insertSession(circuit.id);
      await insertSetLog(inFlight.id, exercises[0].id, 1);
      await insertSetLog(inFlight.id, exercises[0].id, 2);
      await insertSetLog(inFlight.id, exercises[0].id, 3);
      await setPrescription(testDb.db, exercises[0].id, { sets: 2 });

      const start = await getWorkoutStart(testDb.db);

      expect(start?.exercises[0]).toMatchObject({ loggedSets: 3, progress: 'done' });
    });

    it('orders tiles by slot position', async () => {
      const { circuit } = await makeCircuitWithWorkouts('Push', ['Zecond', 'First']);

      const start = await getWorkoutStart(testDb.db);

      // Insertion order, not name order: the grid mirrors the circuit.
      expect(start?.circuit.id).toBe(circuit.id);
      expect(start?.exercises.map((tile) => tile.name)).toEqual(['Zecond', 'First']);
    });
  });
});

describe('lift page', () => {
  describe('getWorkoutSet', () => {
    it('renders a fresh exercise: set 1 current, no session, no history', async () => {
      const { exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press', 'Dips']);
      await setPrescription(testDb.db, exercises[0].id, { sets: 4 });

      const workoutSet = await getWorkoutSet(testDb.db, exercises[0].id);

      expect(workoutSet).toMatchObject({
        session: null,
        exerciseId: exercises[0].id,
        exerciseName: 'Bench Press',
        prescribedSets: 4,
        loggedSets: 0,
        currentSet: 1,
        isFinalSet: false,
        lastSession: null,
      });
    });

    it("advances the current set from this session's logged count", async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      await setPrescription(testDb.db, exercises[0].id, { sets: 4 });
      const inFlight = await insertSession(circuit.id);
      await insertSetLog(inFlight.id, exercises[0].id, 1);
      await insertSetLog(inFlight.id, exercises[0].id, 2);

      const workoutSet = await getWorkoutSet(testDb.db, exercises[0].id);

      expect(workoutSet).toMatchObject({
        loggedSets: 2,
        currentSet: 3,
        isFinalSet: false,
      });
      expect(workoutSet?.session?.id).toBe(inFlight.id);
    });

    it('reads done as a null current set, including a lowered prescription', async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const inFlight = await insertSession(circuit.id);
      await insertSetLog(inFlight.id, exercises[0].id, 1);
      await insertSetLog(inFlight.id, exercises[0].id, 2);
      await insertSetLog(inFlight.id, exercises[0].id, 3);
      await setPrescription(testDb.db, exercises[0].id, { sets: 2 });

      const workoutSet = await getWorkoutSet(testDb.db, exercises[0].id);

      expect(workoutSet).toMatchObject({ loggedSets: 3, currentSet: null, isFinalSet: false });
    });

    it("flags the session's final unlogged set across the whole circuit", async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press', 'Dips']);
      await setPrescription(testDb.db, exercises[0].id, { sets: 2 });
      await setPrescription(testDb.db, exercises[1].id, { sets: 4 });
      const inFlight = await insertSession(circuit.id);
      await insertSetLog(inFlight.id, exercises[0].id, 1);
      await insertSetLog(inFlight.id, exercises[0].id, 2);
      await insertSetLog(inFlight.id, exercises[1].id, 1);
      await insertSetLog(inFlight.id, exercises[1].id, 2);
      await insertSetLog(inFlight.id, exercises[1].id, 3);

      const workoutSet = await getWorkoutSet(testDb.db, exercises[1].id);

      expect(workoutSet).toMatchObject({ currentSet: 4, isFinalSet: true });
    });

    it("keeps START REST on an exercise's last set while others remain", async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press', 'Dips']);
      await setPrescription(testDb.db, exercises[0].id, { sets: 2 });
      const inFlight = await insertSession(circuit.id);
      await insertSetLog(inFlight.id, exercises[0].id, 1);

      const workoutSet = await getWorkoutSet(testDb.db, exercises[0].id);

      expect(workoutSet).toMatchObject({ currentSet: 2, isFinalSet: false });
    });

    it('keeps the final flag honest next to an over-logged sibling', async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press', 'Dips']);
      await setPrescription(testDb.db, exercises[1].id, { sets: 1 });
      const inFlight = await insertSession(circuit.id);
      // Bench Press logged past a lowered prescription: its remainder
      // must clamp at zero, not go negative and cancel out Dips' true
      // final set.
      await insertSetLog(inFlight.id, exercises[0].id, 1);
      await insertSetLog(inFlight.id, exercises[0].id, 2);
      await insertSetLog(inFlight.id, exercises[0].id, 3);
      await setPrescription(testDb.db, exercises[0].id, { sets: 2 });

      const workoutSet = await getWorkoutSet(testDb.db, exercises[1].id);

      expect(workoutSet).toMatchObject({ currentSet: 1, isFinalSet: true });
    });

    it('flags a one-exercise one-set circuit final from the very first set', async () => {
      const { exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      await setPrescription(testDb.db, exercises[0].id, { sets: 1 });

      const workoutSet = await getWorkoutSet(testDb.db, exercises[0].id);

      expect(workoutSet).toMatchObject({ currentSet: 1, isFinalSet: true });
    });

    it("serves the newest PREVIOUS session's set as Last Session", async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const ended = await insertSession(circuit.id, {
        startedAt: '2026-07-14T10:00:00.000Z',
        endedAt: '2026-07-14T11:00:00.000Z',
      });
      await insertSetLog(ended.id, exercises[0].id, 1, {
        reps: 8,
        weight: 100,
        loggedAt: '2026-07-14T10:05:00.000Z',
      });
      await insertSetLog(ended.id, exercises[0].id, 2, {
        reps: 6,
        weight: 110,
        loggedAt: '2026-07-14T10:10:00.000Z',
      });
      // The in-flight session's own log must not echo back as history.
      const inFlight = await insertSession(circuit.id);
      await insertSetLog(inFlight.id, exercises[0].id, 1, { reps: 12, weight: 999 });

      const workoutSet = await getWorkoutSet(testDb.db, exercises[0].id);

      expect(workoutSet?.lastSession).toEqual({ reps: 6, weight: 110, weightUnit: 'lb' });
    });

    it('breaks equal loggedAt history ties on the higher set index', async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const ended = await insertSession(circuit.id, {
        startedAt: '2026-07-14T10:00:00.000Z',
        endedAt: '2026-07-14T11:00:00.000Z',
      });
      await insertSetLog(ended.id, exercises[0].id, 1, { reps: 8, weight: 100 });
      await insertSetLog(ended.id, exercises[0].id, 2, { reps: 6, weight: 110 });

      const workoutSet = await getWorkoutSet(testDb.db, exercises[0].id);

      expect(workoutSet?.lastSession).toEqual({ reps: 6, weight: 110, weightUnit: 'lb' });
    });

    it("ignores another circuit's in-flight session entirely", async () => {
      const { exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const other = await makeCircuitWithWorkouts('Pull', ['Cable Row']);
      const foreign = await insertSession(other.circuit.id);
      await insertSetLog(foreign.id, other.exercises[0].id, 1);

      const workoutSet = await getWorkoutSet(testDb.db, exercises[0].id);

      expect(workoutSet).toMatchObject({ session: null, loggedSets: 0, currentSet: 1 });
    });

    it('serves in-flight logs as Last Session only once that session ENDS', async () => {
      // The mid-workout steal: the exercise logged sets in another
      // circuit's session, then moved here. History is ended-sessions
      // only, so those logs stay invisible until the session ends.
      const { exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const other = await makeCircuitWithWorkouts('Pull', ['Cable Row']);
      const foreign = await insertSession(other.circuit.id);
      await insertSetLog(foreign.id, exercises[0].id, 1, { reps: 7, weight: 90 });

      expect((await getWorkoutSet(testDb.db, exercises[0].id))?.lastSession).toBeNull();

      await abandonSession(testDb.db, foreign.id);

      expect((await getWorkoutSet(testDb.db, exercises[0].id))?.lastSession).toEqual({
        reps: 7,
        weight: 90,
        weightUnit: 'lb',
      });
    });

    it('answers null for a missing, archived, or unheld exercise', async () => {
      const { exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const pooled = await findOrCreateExercise(testDb.db, 'workout', 'Poolside Curl');
      await trashExercise(testDb.db, exercises[0].id);

      expect(await getWorkoutSet(testDb.db, newId())).toBeNull();
      expect(await getWorkoutSet(testDb.db, exercises[0].id)).toBeNull();
      expect(await getWorkoutSet(testDb.db, pooled.id)).toBeNull();
    });
  });

  describe('startRest', () => {
    async function allSessions(): Promise<SessionRow[]> {
      return testDb.db.select().from(session);
    }

    it("mints the session on the workout's first rest", async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);

      const entry = await startRest(testDb.db, exercises[0].id, '2026-07-16T10:03:00.000Z');

      expect(entry).toMatchObject({ exerciseId: exercises[0].id, setIndex: 1 });
      const rows = await allSessions();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        id: entry?.sessionId,
        circuitId: circuit.id,
        startedAt: '2026-07-16T10:03:00.000Z',
        endedAt: null,
        outcome: null,
      });
    });

    it('rides the existing in-flight session and counts up the set index', async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      await setPrescription(testDb.db, exercises[0].id, { sets: 4 });
      const inFlight = await insertSession(circuit.id);
      await insertSetLog(inFlight.id, exercises[0].id, 1);
      await insertSetLog(inFlight.id, exercises[0].id, 2);

      const entry = await startRest(testDb.db, exercises[0].id);

      expect(entry).toEqual({
        sessionId: inFlight.id,
        exerciseId: exercises[0].id,
        setIndex: 3,
      });
      expect(await allSessions()).toHaveLength(1);
    });

    it('refuses a done exercise without minting anything', async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      await setPrescription(testDb.db, exercises[0].id, { sets: 2 });
      const inFlight = await insertSession(circuit.id);
      await insertSetLog(inFlight.id, exercises[0].id, 1);
      await insertSetLog(inFlight.id, exercises[0].id, 2);

      expect(await startRest(testDb.db, exercises[0].id)).toBeNull();
      expect(await allSessions()).toHaveLength(1);
    });

    it('refuses a missing or unheld exercise without minting anything', async () => {
      const pooled = await findOrCreateExercise(testDb.db, 'workout', 'Poolside Curl');

      expect(await startRest(testDb.db, newId())).toBeNull();
      expect(await startRest(testDb.db, pooled.id)).toBeNull();
      expect(await allSessions()).toHaveLength(0);
    });

    it('refuses a stretch exercise: no lift page, no fallback mint', async () => {
      const stretch = await createCircuit(testDb.db, { kind: 'stretch', name: 'Mobility' });
      const hold = await findOrCreateExercise(testDb.db, 'stretch', 'Pigeon Hold');
      await addExerciseToCircuit(testDb.db, stretch.id, hold.id);

      // A stretch circuit's exercise is reachable only by manual URL;
      // a session minted there would be invisible to resume and the
      // rotation (both are workout-kind scoped) - an orphan by
      // construction, so the subject query refuses the kind outright.
      expect(await getWorkoutSet(testDb.db, hold.id)).toBeNull();
      expect(await startRest(testDb.db, hold.id)).toBeNull();
      expect(await allSessions()).toHaveLength(0);
    });

    it("fallback mint abandons another circuit's in-flight session (the third door)", async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const other = await makeCircuitWithWorkouts('Pull', ['Cable Row']);
      const foreign = await insertSession(other.circuit.id);

      const entry = await startRest(testDb.db, exercises[0].id, '2026-07-16T12:00:00.000Z');

      // The only way in is a stale/manual route while another workout
      // is live. Starting a rest here IS starting new work, so the mint
      // converges the rows: the foreign session ends 'abandoned' and
      // exactly one session stays in flight.
      expect(entry?.setIndex).toBe(1);
      const rows = await allSessions();
      const mine = rows.find((row) => row.circuitId === circuit.id);
      expect(mine?.id).toBe(entry?.sessionId);
      expect(mine).toMatchObject({ endedAt: null, outcome: null });
      expect(rows.find((row) => row.id === foreign.id)).toMatchObject({
        endedAt: '2026-07-16T12:00:00.000Z',
        outcome: 'abandoned',
      });
    });
  });
});

describe('rest screen', () => {
  async function allSetLogs() {
    return testDb.db.select().from(setLog);
  }

  describe('arriveAtRest', () => {
    it('mints the row with the SAME exercise + setIndex from a COMPLETED session (branch a)', async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      await setPrescription(testDb.db, exercises[0].id, { sets: 4 });
      const older = await insertSession(circuit.id, {
        startedAt: '2026-07-14T10:00:00.000Z',
        endedAt: '2026-07-14T11:00:00.000Z',
      });
      await insertSetLog(older.id, exercises[0].id, 2, {
        reps: 8,
        weight: 100,
        loggedAt: '2026-07-14T10:05:00.000Z',
      });
      const newer = await insertSession(circuit.id, {
        startedAt: '2026-07-15T10:00:00.000Z',
        endedAt: '2026-07-15T11:00:00.000Z',
      });
      await insertSetLog(newer.id, exercises[0].id, 2, {
        reps: 6,
        weight: 110,
        loggedAt: '2026-07-15T10:05:00.000Z',
      });
      const inFlight = await insertSession(circuit.id);

      const arrival = await arriveAtRest(testDb.db, exercises[0].id, 2);

      expect(arrival).toMatchObject({ reps: 6, weight: 110, weightUnit: 'lb' });
      expect(arrival?.sessionId).toBe(inFlight.id);
    });

    it('skips an ABANDONED prior session and carries over within this session instead', async () => {
      // The device-testing case: a backed-out prior session (abandoned,
      // set 2 left at the default) is NOT a workout to progress from, so it
      // must not seed the slot - within-session carry-over (branch b) wins.
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      await setPrescription(testDb.db, exercises[0].id, { sets: 4 });
      const abandoned = await insertSession(circuit.id, {
        startedAt: '2026-07-15T10:00:00.000Z',
        endedAt: '2026-07-15T10:30:00.000Z',
        outcome: 'abandoned',
      });
      await insertSetLog(abandoned.id, exercises[0].id, 2, {
        reps: 10,
        weight: 10,
        loggedAt: '2026-07-15T10:05:00.000Z',
      });
      const inFlight = await insertSession(circuit.id);
      await insertSetLog(inFlight.id, exercises[0].id, 1, {
        reps: 8,
        weight: 135,
        loggedAt: '2026-07-16T10:05:00.000Z',
      });

      const arrival = await arriveAtRest(testDb.db, exercises[0].id, 2);

      expect(arrival).toMatchObject({ reps: 8, weight: 135, weightUnit: 'lb' });
      expect(arrival?.sessionId).toBe(inFlight.id);
    });

    it('falls back to the previous set THIS session when no completed session has this slot (branch b)', async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      await setPrescription(testDb.db, exercises[0].id, { sets: 4 });
      const inFlight = await insertSession(circuit.id);
      await insertSetLog(inFlight.id, exercises[0].id, 1, { reps: 9, weight: 95 });

      const arrival = await arriveAtRest(testDb.db, exercises[0].id, 2);

      expect(arrival).toMatchObject({ reps: 9, weight: 95, weightUnit: 'lb' });
    });

    it('falls back to DEFAULT_SET_VALUES with no history anywhere (branch c)', async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      await insertSession(circuit.id);

      const arrival = await arriveAtRest(testDb.db, exercises[0].id, 1);

      expect(arrival).toMatchObject(DEFAULT_SET_VALUES);
    });

    it('is idempotent: re-arrival returns the existing row, no second row', async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      await insertSession(circuit.id);

      const first = await arriveAtRest(testDb.db, exercises[0].id, 1, '2026-07-16T10:05:00.000Z');
      const second = await arriveAtRest(testDb.db, exercises[0].id, 1, '2026-07-16T10:06:00.000Z');

      expect(second?.setLogId).toBe(first?.setLogId);
      // The second call's loggedAt must NOT overwrite the anchor.
      expect(second?.loggedAt).toBe('2026-07-16T10:05:00.000Z');
      expect(await allSetLogs()).toHaveLength(1);
    });

    it('refuses with no in-flight session on this circuit: no write, no mint', async () => {
      const { exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);

      expect(await arriveAtRest(testDb.db, exercises[0].id, 1)).toBeNull();
      expect(await allSetLogs()).toHaveLength(0);
      expect(await testDb.db.select().from(session)).toHaveLength(0);
    });

    it('refuses a missing, archived, unheld, or stretch exercise', async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      await insertSession(circuit.id);
      const pooled = await findOrCreateExercise(testDb.db, 'workout', 'Poolside Curl');
      await trashExercise(testDb.db, exercises[0].id);
      const stretch = await createCircuit(testDb.db, { kind: 'stretch', name: 'Mobility' });
      const hold = await findOrCreateExercise(testDb.db, 'stretch', 'Pigeon Hold');
      await addExerciseToCircuit(testDb.db, stretch.id, hold.id);

      expect(await arriveAtRest(testDb.db, newId(), 1)).toBeNull();
      expect(await arriveAtRest(testDb.db, exercises[0].id, 1)).toBeNull();
      expect(await arriveAtRest(testDb.db, pooled.id, 1)).toBeNull();
      expect(await arriveAtRest(testDb.db, hold.id, 1)).toBeNull();
      expect(await allSetLogs()).toHaveLength(0);
    });

    it('isolates the archivedAt filter: archived but still held still refuses', async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      await insertSession(circuit.id);
      // Unlike trashExercise (which also unholds), this only flips
      // archivedAt: the circuit_item stays intact, so a query that
      // dropped the archivedAt predicate would still find this exercise
      // via the held join and wrongly resolve it.
      await testDb.db
        .update(exercise)
        .set({ archivedAt: '2026-07-16T09:00:00.000Z' })
        .where(eq(exercise.id, exercises[0].id));

      expect(await arriveAtRest(testDb.db, exercises[0].id, 1)).toBeNull();
      expect(await allSetLogs()).toHaveLength(0);
    });

    it('refuses an out-of-range setIndex on the insert path: a stale route mints no row', async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      await setPrescription(testDb.db, exercises[0].id, { sets: 2 });
      await insertSession(circuit.id);

      expect(await arriveAtRest(testDb.db, exercises[0].id, 0)).toBeNull();
      expect(await arriveAtRest(testDb.db, exercises[0].id, 3)).toBeNull();
      expect(await allSetLogs()).toHaveLength(0);
    });

    it('re-arrival still resolves an EXISTING row whose setIndex now exceeds a lowered prescription', async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      await setPrescription(testDb.db, exercises[0].id, { sets: 4 });
      const inFlight = await insertSession(circuit.id);
      await insertSetLog(inFlight.id, exercises[0].id, 3, { reps: 8, weight: 100 });
      await setPrescription(testDb.db, exercises[0].id, { sets: 2 });

      const arrival = await arriveAtRest(testDb.db, exercises[0].id, 3);

      // The find path is unguarded by design: only a brand-new insert
      // needs the range check, not a legitimate re-arrival at a row
      // that already exists.
      expect(arrival).toMatchObject({ reps: 8, weight: 100, sessionId: inFlight.id });
      expect(await allSetLogs()).toHaveLength(1);
    });

    it('derives countdown mode with unlogged sets left in the session', async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press', 'Dips']);
      await setPrescription(testDb.db, exercises[0].id, { sets: 4, restSeconds: 45 });
      await insertSession(circuit.id);

      const arrival = await arriveAtRest(testDb.db, exercises[0].id, 1);

      expect(arrival).toMatchObject({
        mode: 'countdown',
        restSeconds: 45,
        remainingForExercise: 3,
      });
    });

    it("derives final mode on the session's last unlogged set anywhere in the circuit", async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press', 'Dips']);
      await setPrescription(testDb.db, exercises[0].id, { sets: 1 });
      await setPrescription(testDb.db, exercises[1].id, { sets: 1 });
      const inFlight = await insertSession(circuit.id);
      await insertSetLog(inFlight.id, exercises[0].id, 1);

      const arrival = await arriveAtRest(testDb.db, exercises[1].id, 1);

      expect(arrival).toMatchObject({ mode: 'final', remainingForExercise: 0 });
    });
  });

  describe('updateRestLog', () => {
    it('updates reps/weight in place; loggedAt stays the anchor', async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      await insertSession(circuit.id);
      const arrival = await arriveAtRest(testDb.db, exercises[0].id, 1, '2026-07-16T10:05:00.000Z');

      const ok = await updateRestLog(testDb.db, arrival!.setLogId, { reps: 8, weight: 135 });

      expect(ok).toBe(true);
      const [row] = await allSetLogs();
      expect(row).toMatchObject({ reps: 8, weight: 135, loggedAt: '2026-07-16T10:05:00.000Z' });
    });

    it('refuses a vanished row', async () => {
      expect(await updateRestLog(testDb.db, newId(), { reps: 8, weight: 135 })).toBe(false);
    });

    it('rejects an invalid edit instead of writing garbage', async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      await insertSession(circuit.id);
      const arrival = await arriveAtRest(testDb.db, exercises[0].id, 1);

      await expect(
        updateRestLog(testDb.db, arrival!.setLogId, { reps: -1, weight: 10 }),
      ).rejects.toThrow('non-negative integer');
    });
  });

  describe('rollBackRest', () => {
    it('deletes the row outright, edits and all - aborting the set is the point', async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      await insertSession(circuit.id);
      const arrival = await arriveAtRest(testDb.db, exercises[0].id, 1);
      await updateRestLog(testDb.db, arrival!.setLogId, { reps: 8, weight: 135 });

      const ok = await rollBackRest(testDb.db, arrival!.setLogId);

      expect(ok).toBe(true);
      expect(await allSetLogs()).toHaveLength(0);
    });

    it('re-derives the lift page back to the pre-arrival state', async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      await setPrescription(testDb.db, exercises[0].id, { sets: 4 });
      await insertSession(circuit.id);
      const arrival = await arriveAtRest(testDb.db, exercises[0].id, 1);

      await rollBackRest(testDb.db, arrival!.setLogId);
      const workoutSet = await getWorkoutSet(testDb.db, exercises[0].id);

      expect(workoutSet).toMatchObject({ loggedSets: 0, currentSet: 1 });
    });

    it('deletes ONLY the target row: sibling logs in the same session survive', async () => {
      // A predicate widened to sessionId/exerciseId (or a dropped
      // where) would wipe the table and still pass every single-row
      // case above.
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', [
        'Bench Press',
        'Cable Row',
      ]);
      await insertSession(circuit.id);
      const firstSet = await arriveAtRest(testDb.db, exercises[0].id, 1);
      const secondSet = await arriveAtRest(testDb.db, exercises[0].id, 2);
      const otherExercise = await arriveAtRest(testDb.db, exercises[1].id, 1);

      const ok = await rollBackRest(testDb.db, secondSet!.setLogId);

      expect(ok).toBe(true);
      const survivors = (await allSetLogs()).map((row) => row.id).sort();
      expect(survivors).toEqual([firstSet!.setLogId, otherExercise!.setLogId].sort());
    });

    it('returns false and writes nothing for a missing id: the state already matches the intent', async () => {
      expect(await rollBackRest(testDb.db, newId())).toBe(false);
      expect(await allSetLogs()).toHaveLength(0);
    });

    it('leaves the session row untouched either way - no orphan-session mutation', async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const inFlight = await insertSession(circuit.id, { startedAt: '2026-07-16T10:00:00.000Z' });
      const arrival = await arriveAtRest(testDb.db, exercises[0].id, 1);

      await rollBackRest(testDb.db, arrival!.setLogId);
      await rollBackRest(testDb.db, newId());

      const [row] = await testDb.db.select().from(session);
      expect(row).toMatchObject({
        id: inFlight.id,
        startedAt: '2026-07-16T10:00:00.000Z',
        endedAt: null,
      });
    });

    it('a re-arrival after rollback inserts a FRESH row: the recovery path', async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      await insertSession(circuit.id);
      const arrival = await arriveAtRest(testDb.db, exercises[0].id, 1, '2026-07-16T10:05:00.000Z');

      await rollBackRest(testDb.db, arrival!.setLogId);
      const recovered = await arriveAtRest(
        testDb.db,
        exercises[0].id,
        1,
        '2026-07-16T10:06:00.000Z',
      );

      expect(recovered?.setLogId).not.toBe(arrival?.setLogId);
      expect(recovered?.loggedAt).toBe('2026-07-16T10:06:00.000Z');
      expect(await allSetLogs()).toHaveLength(1);
    });
  });

  describe('finishSession', () => {
    it('stamps endedAt and completed together, once', async () => {
      const { circuit } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const inFlight = await insertSession(circuit.id);

      const finished = await finishSession(testDb.db, inFlight.id, '2026-07-16T11:00:00.000Z');

      expect(finished).toMatchObject({
        id: inFlight.id,
        endedAt: '2026-07-16T11:00:00.000Z',
        outcome: 'completed',
      });
      const [row] = await testDb.db.select().from(session);
      expect(row).toMatchObject({ endedAt: '2026-07-16T11:00:00.000Z', outcome: 'completed' });
    });

    it('refuses a second call', async () => {
      const { circuit } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const inFlight = await insertSession(circuit.id);
      await finishSession(testDb.db, inFlight.id, '2026-07-16T11:00:00.000Z');

      expect(await finishSession(testDb.db, inFlight.id, '2026-07-16T12:00:00.000Z')).toBeNull();
      const [row] = await testDb.db.select().from(session);
      expect(row.endedAt).toBe('2026-07-16T11:00:00.000Z');
    });

    it('refuses a missing session', async () => {
      expect(await finishSession(testDb.db, newId())).toBeNull();
    });

    it('offers the rotation front again afterward: the CTA reads Start Workout', async () => {
      const { circuit } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const inFlight = await insertSession(circuit.id);

      await finishSession(testDb.db, inFlight.id);
      const start = await getWorkoutStart(testDb.db);

      expect(start?.circuit.id).toBe(circuit.id);
      expect(start?.session).toBeNull();
    });
  });
});

describe('session end', () => {
  async function activeOrder(): Promise<string[]> {
    const rows = await listActiveCircuits(testDb.db, 'workout');
    return rows.map((row) => row.name);
  }

  describe('abandonSession', () => {
    it('stamps endedAt + abandoned and keeps every set_log', async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const inFlight = await insertSession(circuit.id);
      await insertSetLog(inFlight.id, exercises[0].id, 1);
      await insertSetLog(inFlight.id, exercises[0].id, 2);

      const abandoned = await abandonSession(testDb.db, inFlight.id, '2026-07-16T11:00:00.000Z');

      expect(abandoned).toMatchObject({
        id: inFlight.id,
        endedAt: '2026-07-16T11:00:00.000Z',
        outcome: 'abandoned',
      });
      // The sets happened; abandoning records how it ended, never what
      // was done.
      expect(await testDb.db.select().from(setLog)).toHaveLength(2);
    });

    it('refuses an already-ended or missing session', async () => {
      const { circuit } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const inFlight = await insertSession(circuit.id);
      await finishSession(testDb.db, inFlight.id, '2026-07-16T11:00:00.000Z');

      expect(await abandonSession(testDb.db, inFlight.id)).toBeNull();
      expect(await abandonSession(testDb.db, newId())).toBeNull();
      const [row] = await testDb.db.select().from(session);
      expect(row.outcome).toBe('completed');
    });
  });

  describe('rotation on end', () => {
    it('either outcome rotates the circuit to the back of its kind', async () => {
      await makeCircuitWithWorkouts('A', ['Bench Press']);
      const b = await makeCircuitWithWorkouts('B', ['Cable Row']);
      await makeCircuitWithWorkouts('C', ['Goblet Squat']);
      // Another kind's queue must not move: rotation is kind-scoped.
      const stretch = await createCircuit(testDb.db, { kind: 'stretch', name: 'Mobility' });

      const inFlight = await insertSession(b.circuit.id);
      await abandonSession(testDb.db, inFlight.id);

      expect(await activeOrder()).toEqual(['A', 'C', 'B']);
      const stretchRow = await getCircuitById(testDb.db, stretch.id);
      expect(stretchRow?.rotationOrder).toBe(stretch.rotationOrder);
    });

    it('wraps around: ending each circuit in turn cycles the front back to the first', async () => {
      const a = await makeCircuitWithWorkouts('A', ['Bench Press']);
      const b = await makeCircuitWithWorkouts('B', ['Cable Row']);
      const c = await makeCircuitWithWorkouts('C', ['Goblet Squat']);

      await finishSession(testDb.db, (await insertSession(a.circuit.id)).id);
      expect(await activeOrder()).toEqual(['B', 'C', 'A']);

      await abandonSession(testDb.db, (await insertSession(b.circuit.id)).id);
      expect(await activeOrder()).toEqual(['C', 'A', 'B']);

      await finishSession(testDb.db, (await insertSession(c.circuit.id)).id);
      expect(await activeOrder()).toEqual(['A', 'B', 'C']);
      expect((await getWorkoutStart(testDb.db))?.circuit.id).toBe(a.circuit.id);
    });
  });
});

describe('circuit manager', () => {
  async function allSessions(): Promise<SessionRow[]> {
    return testDb.db.select().from(session);
  }

  describe('getRotationView', () => {
    it('counts workouts and orders the queue by rotationOrder, and reports active null with no session in flight', async () => {
      const push = await makeCircuitWithWorkouts('Push', ['Bench Press', 'Dips']);
      const pull = await makeCircuitWithWorkouts('Pull', ['Cable Row']);
      const empty = await createCircuit(testDb.db, { kind: 'workout', name: 'Empty' });

      const view = await getRotationView(testDb.db);

      expect(view.queue).toEqual([
        {
          id: push.circuit.id,
          name: 'Push',
          rotationOrder: push.circuit.rotationOrder,
          workoutCount: 2,
        },
        {
          id: pull.circuit.id,
          name: 'Pull',
          rotationOrder: pull.circuit.rotationOrder,
          workoutCount: 1,
        },
        { id: empty.id, name: 'Empty', rotationOrder: empty.rotationOrder, workoutCount: 0 },
      ]);
      expect(view.active).toBeNull();
    });

    it('excludes archived and stretch-kind circuits from the queue', async () => {
      const push = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const archived = await makeCircuitWithWorkouts('Archived', ['Rows']);
      await archiveCircuit(testDb.db, archived.circuit.id);
      const stretch = await createCircuit(testDb.db, { kind: 'stretch', name: 'Mobility' });

      const view = await getRotationView(testDb.db);

      expect(view.queue.map((row) => row.id)).toEqual([push.circuit.id]);
      expect(view.queue.map((row) => row.id)).not.toContain(stretch.id);
    });

    it('reports active when a session is in flight on a queued circuit', async () => {
      const { circuit } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const inFlight = await insertSession(circuit.id);

      const view = await getRotationView(testDb.db);

      expect(view.active).toEqual({ sessionId: inFlight.id, circuitId: circuit.id });
    });

    it("reports active null when the in-flight session's circuit is archived", async () => {
      const { circuit } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      await insertSession(circuit.id);
      await archiveCircuit(testDb.db, circuit.id);

      expect((await getRotationView(testDb.db)).active).toBeNull();
    });

    it('still reports active on an empty-but-active circuit (resumable by refill)', async () => {
      const { circuit } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const inFlight = await insertSession(circuit.id);
      for (const slot of await listCircuitSlots(testDb.db, circuit.id)) {
        await removeCircuitItem(testDb.db, slot.id);
      }

      const view = await getRotationView(testDb.db);

      expect(view.active).toEqual({ sessionId: inFlight.id, circuitId: circuit.id });
      expect(view.queue.find((row) => row.id === circuit.id)?.workoutCount).toBe(0);
    });
  });

  describe('swapActiveCircuit', () => {
    it('ends the session, rotates the old circuit back, fronts the target, mints nothing new', async () => {
      const from = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const to = await makeCircuitWithWorkouts('Pull', ['Cable Row']);
      const third = await makeCircuitWithWorkouts('Legs', ['Squat']);
      const inFlight = await insertSession(from.circuit.id);

      const ended = await swapActiveCircuit(testDb.db, inFlight.id, to.circuit.id);

      expect(ended).toMatchObject({
        id: inFlight.id,
        circuitId: from.circuit.id,
        outcome: 'abandoned',
      });
      expect(ended?.endedAt).not.toBeNull();
      // Swap never mints - Start Workout stays the single entry point.
      expect(await allSessions()).toHaveLength(1);
      const order = await listActiveCircuits(testDb.db, 'workout');
      expect(order.map((row) => row.id)).toEqual([
        to.circuit.id,
        third.circuit.id,
        from.circuit.id,
      ]);
    });

    it('refuses every invalid target, writing nothing', async () => {
      const from = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const to = await makeCircuitWithWorkouts('Pull', ['Cable Row']);
      const empty = await createCircuit(testDb.db, { kind: 'workout', name: 'Empty' });
      const archived = await makeCircuitWithWorkouts('Archived', ['Rows']);
      await archiveCircuit(testDb.db, archived.circuit.id);
      const stretchCircuit = await createCircuit(testDb.db, { kind: 'stretch', name: 'Mobility' });
      const stretchHold = await findOrCreateExercise(testDb.db, 'stretch', 'Pigeon Hold');
      await addExerciseToCircuit(testDb.db, stretchCircuit.id, stretchHold.id);

      const inFlight = await insertSession(from.circuit.id);
      const alreadyEnded = await insertSession(to.circuit.id, {
        endedAt: '2026-07-15T11:00:00.000Z',
      });

      expect(await swapActiveCircuit(testDb.db, alreadyEnded.id, to.circuit.id)).toBeNull();
      expect(await swapActiveCircuit(testDb.db, 'no-such-session', to.circuit.id)).toBeNull();
      expect(await swapActiveCircuit(testDb.db, inFlight.id, archived.circuit.id)).toBeNull();
      expect(await swapActiveCircuit(testDb.db, inFlight.id, empty.id)).toBeNull();
      expect(await swapActiveCircuit(testDb.db, inFlight.id, from.circuit.id)).toBeNull();
      expect(await swapActiveCircuit(testDb.db, inFlight.id, stretchCircuit.id)).toBeNull();
      expect(await swapActiveCircuit(testDb.db, inFlight.id, 'no-such-circuit')).toBeNull();

      const rows = await allSessions();
      expect(rows.find((row) => row.id === inFlight.id)).toMatchObject({
        endedAt: null,
        outcome: null,
      });
      expect(await listActiveCircuits(testDb.db, 'workout')).toMatchObject([
        { id: from.circuit.id },
        { id: to.circuit.id },
        { id: empty.id },
      ]);
    });
  });
});

describe('reconcileWorkoutCompletion', () => {
  it('completes a session stranded by a lowered prescription, with rotation', async () => {
    const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
    await makeCircuitWithWorkouts('Pull', ['Cable Row']);
    const inFlight = await insertSession(circuit.id);
    await insertSetLog(inFlight.id, exercises[0].id, 1);
    await insertSetLog(inFlight.id, exercises[0].id, 2);
    // The workbench edit that zeroes the remaining sets: 3 prescribed,
    // 2 logged, lowered to 2 - no lift page offers FINISH anymore.
    await setPrescription(testDb.db, exercises[0].id, { sets: 2 });

    const completed = await reconcileWorkoutCompletion(testDb.db, '2026-07-16T11:00:00.000Z');

    expect(completed).toMatchObject({
      id: inFlight.id,
      endedAt: '2026-07-16T11:00:00.000Z',
      outcome: 'completed',
    });
    const circuits = await listActiveCircuits(testDb.db, 'workout');
    expect(circuits.map((row) => row.name)).toEqual(['Pull', 'Push']);
    // Afterwards nothing is in flight: the home CTA reads Start Workout.
    expect((await getWorkoutStart(testDb.db))?.session).toBeNull();
  });

  it('completes a session stranded by deleting the last unfinished workout', async () => {
    const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press', 'Fly']);
    await setPrescription(testDb.db, exercises[0].id, { sets: 2 });
    const inFlight = await insertSession(circuit.id);
    await insertSetLog(inFlight.id, exercises[0].id, 1);
    await insertSetLog(inFlight.id, exercises[0].id, 2);
    // Bench is fully logged; deleting the untouched Fly zeroes the
    // session's remaining sets while the circuit stays startable.
    const flySlot = (await listCircuitSlots(testDb.db, circuit.id)).find(
      (slot) => slot.exerciseId === exercises[1].id,
    );
    await removeCircuitItem(testDb.db, flySlot!.id);

    const completed = await reconcileWorkoutCompletion(testDb.db);

    expect(completed).toMatchObject({ id: inFlight.id, outcome: 'completed' });
  });

  it('does nothing while sets remain', async () => {
    const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
    const inFlight = await insertSession(circuit.id);
    await insertSetLog(inFlight.id, exercises[0].id, 1);

    expect(await reconcileWorkoutCompletion(testDb.db)).toBeNull();
    expect((await getInFlightSession(testDb.db))?.id).toBe(inFlight.id);
  });

  it('does nothing with no in-flight session', async () => {
    await makeCircuitWithWorkouts('Push', ['Bench Press']);
    expect(await reconcileWorkoutCompletion(testDb.db)).toBeNull();
  });

  it('never completes an orphan on an emptied circuit: zero slots is not a finished workout', async () => {
    const { circuit } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
    const orphan = await insertSession(circuit.id);
    for (const slot of await listCircuitSlots(testDb.db, circuit.id)) {
      await removeCircuitItem(testDb.db, slot.id);
    }

    expect(await reconcileWorkoutCompletion(testDb.db)).toBeNull();
    expect((await getInFlightSession(testDb.db))?.id).toBe(orphan.id);
  });
});

describe('getResumePoint', () => {
  it('answers null with no in-flight session', async () => {
    await makeCircuitWithWorkouts('Push', ['Bench Press']);
    expect(await getResumePoint(testDb.db)).toBeNull();
  });

  it('answers null when the in-flight session is not resumable', async () => {
    const doomed = await makeCircuitWithWorkouts('Push', ['Bench Press']);
    await insertSession(doomed.circuit.id);
    await archiveCircuit(testDb.db, doomed.circuit.id);

    expect(await getResumePoint(testDb.db)).toBeNull();
  });

  it('restores the grid when the session has no logged sets yet', async () => {
    const { circuit } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
    await insertSession(circuit.id);

    expect(await getResumePoint(testDb.db)).toEqual({ screen: 'workout-start' });
  });

  it('restores the rest screen for the newest logged set, however long expired', async () => {
    const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press', 'Fly']);
    const inFlight = await insertSession(circuit.id);
    await insertSetLog(inFlight.id, exercises[0].id, 1, { loggedAt: '2026-07-16T10:05:00.000Z' });
    // The newest fact wins regardless of which exercise it belongs to.
    await insertSetLog(inFlight.id, exercises[1].id, 1, { loggedAt: '2026-07-16T10:15:00.000Z' });

    expect(await getResumePoint(testDb.db)).toEqual({
      screen: 'rest',
      exerciseId: exercises[1].id,
      setIndex: 1,
    });
  });

  it('breaks equal loggedAt ties on the higher set index', async () => {
    const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
    const inFlight = await insertSession(circuit.id);
    await insertSetLog(inFlight.id, exercises[0].id, 1, { loggedAt: '2026-07-16T10:05:00.000Z' });
    await insertSetLog(inFlight.id, exercises[0].id, 2, { loggedAt: '2026-07-16T10:05:00.000Z' });

    expect(await getResumePoint(testDb.db)).toEqual({
      screen: 'rest',
      exerciseId: exercises[0].id,
      setIndex: 2,
    });
  });

  it("falls back to the grid when the newest set's exercise left the circuit", async () => {
    const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press', 'Fly']);
    const inFlight = await insertSession(circuit.id);
    await insertSetLog(inFlight.id, exercises[0].id, 1);
    const benchSlot = (await listCircuitSlots(testDb.db, circuit.id)).find(
      (slot) => slot.exerciseId === exercises[0].id,
    );
    await removeCircuitItem(testDb.db, benchSlot!.id);

    // The rest route for the logged set would refuse to resolve
    // (arriveAtRest needs the exercise held by the session's circuit),
    // so the grid is the honest landing.
    expect(await getResumePoint(testDb.db)).toEqual({ screen: 'workout-start' });
  });
});
