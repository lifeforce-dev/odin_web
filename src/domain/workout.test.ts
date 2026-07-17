import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newId } from '@/db/ids';
import { session, setLog } from '@/db/schema';
import type { CircuitRow, ExerciseRow, SessionRow } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import type { TestDb } from '@/db/test-db';

import {
  addExerciseToCircuit,
  archiveCircuit,
  createCircuit,
  findOrCreateExercise,
  listCircuitSlots,
  removeCircuitItem,
  setPrescription,
  trashExercise,
} from './builder';
import {
  getInFlightSession,
  getWorkoutSet,
  getWorkoutStart,
  startRest,
  startWorkout,
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
  { startedAt = '2026-07-16T10:00:00.000Z', endedAt = null as string | null } = {},
): Promise<SessionRow> {
  const row: SessionRow = { id: newId(), circuitId, startedAt, endedAt };
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
      // 03-05 owns ending/reaping the orphaned session row.
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

    it('mints on the front startable circuit past a non-resumable orphan', async () => {
      const doomed = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const survivor = await makeCircuitWithWorkouts('Pull', ['Cable Row']);
      await insertSession(doomed.circuit.id);
      await archiveCircuit(testDb.db, doomed.circuit.id);

      const minted = await startWorkout(testDb.db);

      // The orphaned row stays in flight until 03-05's reap; the new
      // workout starts on the circuit the rotation actually offers.
      expect(minted?.circuitId).toBe(survivor.circuit.id);
      expect(await allSessions()).toHaveLength(2);
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

    it("scopes to the exercise's own circuit even while another is in flight", async () => {
      const { circuit, exercises } = await makeCircuitWithWorkouts('Push', ['Bench Press']);
      const other = await makeCircuitWithWorkouts('Pull', ['Cable Row']);
      await insertSession(other.circuit.id);

      const entry = await startRest(testDb.db, exercises[0].id);

      // A second in-flight row is the honest fact here: the only way in
      // is a stale/manual route while another workout is live, and
      // 03-05's reap owns converging back to one. Same precedent as the
      // archived-circuit orphan.
      expect(entry?.setIndex).toBe(1);
      const mine = (await allSessions()).find((row) => row.circuitId === circuit.id);
      expect(mine?.id).toBe(entry?.sessionId);
      expect(await allSessions()).toHaveLength(2);
    });
  });
});
