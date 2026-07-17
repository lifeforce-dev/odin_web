import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteLocationRaw, Router } from 'vue-router';

import type { DbClient } from '@/db/client';
import { newId } from '@/db/ids';
import { session, setLog } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import type { TestDb } from '@/db/test-db';
import { addExerciseToCircuit, createCircuit, findOrCreateExercise } from '@/domain/builder';

import appRouter from './index';
import { restoreWhereLeftOff } from './restore';

// The restore step's wiring over the real DB double: getResumePoint's
// fact-derivation is Node-test-pinned in domain/workout.test.ts; what
// lives here is the mapping onto router.replace and the guards around
// it (no db, no session, an explicit non-home landing before or during
// the read). Captured payloads are re-resolved through the REAL route
// table: the fake router accepts anything, so resolvability - the
// thing a route-param change would break - must be pinned separately.

const nativeState: { isNative: boolean; db: DbClient | null } = { isNative: true, db: null };

vi.mock('@/native', () => ({
  get isNative() {
    return nativeState.isNative;
  },
  getDb: () => {
    if (!nativeState.db) {
      throw new Error('test database not prepared');
    }
    return nativeState.db;
  },
}));

let testDb: TestDb;

beforeEach(async () => {
  testDb = await createTestDb();
  nativeState.isNative = true;
  nativeState.db = testDb.db;
});

afterEach(() => {
  nativeState.db = null;
  testDb.close();
});

function fakeRouter(initialRouteName = 'home') {
  const replace = vi.fn().mockResolvedValue(undefined);
  const router = {
    isReady: vi.fn().mockResolvedValue(undefined),
    currentRoute: { value: { name: initialRouteName } },
    replace,
  } as unknown as Router;
  return { router, replace };
}

// Simulates a tap landing inside the getResumePoint read window: the
// pre-read guard sees home, every later read sees the user's explicit
// destination.
function fakeRouterLeavingHomeAfterFirstRead() {
  const replace = vi.fn().mockResolvedValue(undefined);
  let reads = 0;
  const router = {
    isReady: vi.fn().mockResolvedValue(undefined),
    currentRoute: {
      get value() {
        reads += 1;
        return { name: reads === 1 ? 'home' : 'circuits' };
      },
    },
    replace,
  } as unknown as Router;
  return { router, replace };
}

function resolveCapturedPayload(replace: ReturnType<typeof vi.fn>) {
  return appRouter.resolve(replace.mock.calls[0][0] as RouteLocationRaw);
}

async function seedSession(): Promise<{
  circuitId: string;
  exerciseId: string;
  sessionId: string;
}> {
  const circuit = await createCircuit(testDb.db, { kind: 'workout', name: 'Legs' });
  const exercise = await findOrCreateExercise(testDb.db, 'workout', 'Lat Pulldown');
  await addExerciseToCircuit(testDb.db, circuit.id, exercise.id);
  const sessionId = newId();
  await testDb.db.insert(session).values({
    id: sessionId,
    circuitId: circuit.id,
    startedAt: '2026-07-16T10:00:00.000Z',
    endedAt: null,
    outcome: null,
  });
  return { circuitId: circuit.id, exerciseId: exercise.id, sessionId };
}

describe('restoreWhereLeftOff', () => {
  it('does nothing in browser dev mode (no db)', async () => {
    nativeState.isNative = false;
    const { router, replace } = fakeRouter();

    await restoreWhereLeftOff(router);

    expect(replace).not.toHaveBeenCalled();
  });

  it('does nothing without an in-flight session', async () => {
    const { router, replace } = fakeRouter();

    await restoreWhereLeftOff(router);

    expect(replace).not.toHaveBeenCalled();
  });

  it('restores the grid when the session has no logged sets', async () => {
    await seedSession();
    const { router, replace } = fakeRouter();

    await restoreWhereLeftOff(router);

    expect(replace).toHaveBeenCalledExactlyOnceWith({ name: 'workout-start' });
    expect(resolveCapturedPayload(replace).name).toBe('workout-start');
  });

  it('restores the rest screen for the newest logged set', async () => {
    const { exerciseId, sessionId } = await seedSession();
    await testDb.db.insert(setLog).values({
      id: newId(),
      sessionId,
      exerciseId,
      setIndex: 2,
      reps: 10,
      weight: 10,
      weightUnit: 'lb',
      loggedAt: '2026-07-16T10:05:00.000Z',
    });
    const { router, replace } = fakeRouter();

    await restoreWhereLeftOff(router);

    expect(replace).toHaveBeenCalledExactlyOnceWith({
      name: 'rest',
      params: { exerciseId, setIndex: 2 },
    });
    // The rest route requires exerciseId + a numeric setIndex; a param
    // added or renamed there must fail here, not as a swallowed
    // console.error at cold open on device.
    const resolved = resolveCapturedPayload(replace);
    expect(resolved.name).toBe('rest');
    expect(resolved.params).toEqual({ exerciseId, setIndex: '2' });
  });

  it('never hijacks an explicit non-home landing', async () => {
    await seedSession();
    const { router, replace } = fakeRouter('gallery');

    await restoreWhereLeftOff(router);

    expect(replace).not.toHaveBeenCalled();
  });

  it('never hijacks a navigation that lands during the resume-point read', async () => {
    await seedSession();
    const { router, replace } = fakeRouterLeavingHomeAfterFirstRead();

    await restoreWhereLeftOff(router);

    expect(replace).not.toHaveBeenCalled();
  });
});
