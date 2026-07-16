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
} from './builder';
import { getInFlightSession, getWorkoutStart } from './workout';

describe('workout start', () => {
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
  ): Promise<void> {
    await testDb.db.insert(setLog).values({
      id: newId(),
      sessionId,
      exerciseId,
      setIndex,
      reps: 10,
      weight: 10,
      weightUnit: 'lb',
      loggedAt: '2026-07-16T10:05:00.000Z',
    });
  }

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
