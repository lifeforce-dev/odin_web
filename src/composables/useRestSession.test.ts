import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DbClient } from '@/db/client';
import { newId } from '@/db/ids';
import { session } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import type { TestDb } from '@/db/test-db';
import {
  addExerciseToCircuit,
  createCircuit,
  findOrCreateExercise,
  setPrescription,
} from '@/domain/builder';

import { useRestSession } from './useRestSession';

// Bare-call harness (no component instance, no Vue Test Utils) - the
// useWorkbench.test.ts pattern. onMounted never fires outside setup(),
// so the composable's auto-refresh-on-mount never runs here: every
// test drives refresh() itself, which also proves the public surface
// works with no Vue tree at all.

let testDb: TestDb;

beforeEach(async () => {
  testDb = await createTestDb();
});

afterEach(() => {
  testDb.close();
});

async function seedArrivable(): Promise<{ exerciseId: string; sessionId: string }> {
  const circuit = await createCircuit(testDb.db, { kind: 'workout', name: 'Push' });
  const bench = await findOrCreateExercise(testDb.db, 'workout', 'Bench Press');
  await setPrescription(testDb.db, bench.id, { sets: 4, restSeconds: 90 });
  await addExerciseToCircuit(testDb.db, circuit.id, bench.id);
  const sessionId = newId();
  await testDb.db.insert(session).values({
    id: sessionId,
    circuitId: circuit.id,
    startedAt: '2026-07-16T10:00:00.000Z',
    endedAt: null,
  });
  return { exerciseId: bench.id, sessionId };
}

// Wraps db.transaction to record entry/exit order: two operations
// overlapping (a start before the previous end) would prove a second
// BEGIN raced the first, which this suite never sees. reset() clears
// both the log and the counter so a test can discard the setup read's
// entries and assert on a clean 1-based pair.
function instrumentTransactionOrder(db: DbClient): {
  db: DbClient;
  log: string[];
  reset: () => void;
} {
  const log: string[] = [];
  let callIndex = 0;
  const proxied = new Proxy(db as object, {
    get(target, prop, receiver) {
      if (prop !== 'transaction') {
        return Reflect.get(target, prop, receiver);
      }
      return async (...args: unknown[]) => {
        const index = (callIndex += 1);
        log.push(`start:${index}`);
        const original = Reflect.get(target, prop, receiver) as (
          ...a: unknown[]
        ) => Promise<unknown>;
        try {
          return await original.apply(target, args);
        } finally {
          log.push(`end:${index}`);
        }
      };
    },
  }) as DbClient;
  return {
    db: proxied,
    log,
    // Clears the SAME array in place (never reassigns it) so a caller
    // that destructured `log` up front still observes the reset.
    reset: () => {
      log.length = 0;
      callIndex = 0;
    },
  };
}

// Fails exactly the Nth db.transaction call ever made on this handle and
// lets every other call through untouched - the arrival read is always
// call 1, so failOnCall: 2 targets the very next write.
function failTransaction(db: DbClient, failOnCall: number): DbClient {
  let calls = 0;
  return new Proxy(db as object, {
    get(target, prop, receiver) {
      if (prop !== 'transaction') {
        return Reflect.get(target, prop, receiver);
      }
      return (...args: unknown[]) => {
        calls += 1;
        if (calls === failOnCall) {
          return Promise.reject(new Error('injected write failure'));
        }
        const original = Reflect.get(target, prop, receiver) as (...a: unknown[]) => unknown;
        return original.apply(target, args);
      };
    },
  }) as DbClient;
}

describe('useRestSession', () => {
  it('loads the arrival on a manually driven refresh', async () => {
    const { exerciseId } = await seedArrivable();
    const restSession = useRestSession(
      testDb.db,
      () => exerciseId,
      () => 1,
    );

    await restSession.refresh();

    expect(restSession.hasLoaded.value).toBe(true);
    expect(restSession.arrival.value).toMatchObject({ reps: 10, weight: 10 });
  });

  it('serializes an edit and finish() in call order: no interleaved transactions', async () => {
    const { exerciseId } = await seedArrivable();
    const { db, log, reset } = instrumentTransactionOrder(testDb.db);
    const restSession = useRestSession(
      db,
      () => exerciseId,
      () => 1,
    );
    await restSession.refresh();
    reset(); // Only the edit/finish pair below matters.

    const edit = restSession.commitEdit(9, 95);
    const finished = restSession.finish();
    await Promise.all([edit, finished]);

    expect(log).toEqual(['start:1', 'end:1', 'start:2', 'end:2']);
  });

  it('refresh() queues behind an in-flight edit write', async () => {
    const { exerciseId } = await seedArrivable();
    const { db, log, reset } = instrumentTransactionOrder(testDb.db);
    const restSession = useRestSession(
      db,
      () => exerciseId,
      () => 1,
    );
    await restSession.refresh();
    reset();

    const edit = restSession.commitEdit(9, 95);
    const retried = restSession.refresh();
    await Promise.all([edit, retried]);

    expect(log).toEqual(['start:1', 'end:1', 'start:2', 'end:2']);
  });

  it('a failed updateRestLog flips writeFailed and re-derives the arrival from DB truth', async () => {
    const { exerciseId } = await seedArrivable();
    const db = failTransaction(testDb.db, 2); // call 1: arrival; call 2: this edit
    const restSession = useRestSession(
      db,
      () => exerciseId,
      () => 1,
    );
    await restSession.refresh();

    await restSession.commitEdit(1, 1);

    expect(restSession.writeFailed.value).toBe(true);
    expect(restSession.arrival.value).toMatchObject({ reps: 10, weight: 10 });
  });

  it('a refused finish (already ended) resolves false, leaves finishFailed alone, and re-derives the arrival', async () => {
    const { exerciseId, sessionId } = await seedArrivable();
    const restSession = useRestSession(
      testDb.db,
      () => exerciseId,
      () => 1,
    );
    await restSession.refresh();
    await testDb.db
      .update(session)
      .set({ endedAt: '2026-07-16T11:00:00.000Z' })
      .where(eq(session.id, sessionId));

    const finished = await restSession.finish();

    expect(finished).toBe(false);
    expect(restSession.finishFailed.value).toBe(false);
    // The session is no longer in flight, so the re-derived truth is
    // that nothing is resting here anymore.
    expect(restSession.arrival.value).toBeNull();
  });

  it('a thrown finish sets finishFailed and resolves false', async () => {
    const { exerciseId } = await seedArrivable();
    const db = failTransaction(testDb.db, 2); // call 1: arrival; call 2: finish
    const restSession = useRestSession(
      db,
      () => exerciseId,
      () => 1,
    );
    await restSession.refresh();

    const finished = await restSession.finish();

    expect(finished).toBe(false);
    expect(restSession.finishFailed.value).toBe(true);
  });

  it('flushPendingWrites resolves true on a clean chain, false after a failed edit, then true again after the next clean edit', async () => {
    const { exerciseId } = await seedArrivable();
    const db = failTransaction(testDb.db, 2); // call 1: arrival; call 2: the one failing edit
    const restSession = useRestSession(
      db,
      () => exerciseId,
      () => 1,
    );
    await restSession.refresh();

    expect(await restSession.flushPendingWrites()).toBe(true);

    // Fire-and-forget, mirroring how the view calls commitEdit then
    // gates on flushPendingWrites without awaiting the edit directly.
    restSession.commitEdit(9, 95);
    expect(await restSession.flushPendingWrites()).toBe(false);

    restSession.commitEdit(9, 95);
    expect(await restSession.flushPendingWrites()).toBe(true);
  });
});
