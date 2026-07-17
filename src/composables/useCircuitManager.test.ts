import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbClient } from '@/db/client';
import { newId } from '@/db/ids';
import { session } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import type { TestDb } from '@/db/test-db';
import {
  addExerciseToCircuit,
  archiveCircuit,
  createCircuit,
  findOrCreateExercise,
  listActiveCircuits,
} from '@/domain/builder';

import { useCircuitManager } from './useCircuitManager';

// Against the real DB double (same driver as the device path), the same
// precedent useWorkbench.test.ts sets: the composable's job is
// optimistic state + serialized persistence, only provable with actual
// rows underneath.

let testDb: TestDb;
let db: DbClient;

async function seedQueue(): Promise<{ pushId: string; pullId: string; legsId: string }> {
  const push = await createCircuit(db, { kind: 'workout', name: 'Push' });
  const pull = await createCircuit(db, { kind: 'workout', name: 'Pull' });
  // Legs stays empty on purpose - the swap refusal test needs a
  // queued-but-unstartable target.
  const legs = await createCircuit(db, { kind: 'workout', name: 'Legs' });
  const bench = await findOrCreateExercise(db, 'workout', 'Bench Press');
  await addExerciseToCircuit(db, push.id, bench.id);
  return { pushId: push.id, pullId: pull.id, legsId: legs.id };
}

async function seedInFlightSession(circuitId: string): Promise<string> {
  const id = newId();
  await db.insert(session).values({
    id,
    circuitId,
    startedAt: '2026-07-17T10:00:00.000Z',
    endedAt: null,
    outcome: null,
  });
  return id;
}

beforeEach(async () => {
  testDb = await createTestDb();
  db = testDb.db;
});

afterEach(() => {
  testDb.close();
  vi.restoreAllMocks();
});

describe('useCircuitManager', () => {
  it('reload() flips to loading immediately and reads the rotation on the chain', async () => {
    const { pushId } = await seedQueue();
    const manager = useCircuitManager(db);

    const pending = manager.reload();

    expect(manager.status.value).toBe('loading');
    await pending;

    expect(manager.status.value).toBe('ready');
    expect(manager.queue.value.map((row) => row.id)).toContain(pushId);
    expect(manager.active.value).toBeNull();
  });

  it('reports the in-flight session', async () => {
    const { pushId } = await seedQueue();
    const sessionId = await seedInFlightSession(pushId);
    const manager = useCircuitManager(db);

    await manager.reload();

    expect(manager.active.value).toEqual({ sessionId, circuitId: pushId });
  });

  it('surfaces a failed load as an error status instead of hanging in loading', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const manager = useCircuitManager(db);
    testDb.close();

    await manager.reload();

    expect(manager.status.value).toBe('error');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('reports unavailable with no database and every operation no-ops', async () => {
    const manager = useCircuitManager(null);

    await manager.reload();
    await manager.reorder([]);
    expect(await manager.createAndOpen()).toBeNull();
    await manager.remove('anything');
    expect(await manager.abandon('anything')).toBe(false);
    expect(await manager.swap('anything', 'anything')).toBe(false);

    expect(manager.status.value).toBe('unavailable');
  });

  it('reorders optimistically and persists through a fresh read', async () => {
    const { pushId, pullId, legsId } = await seedQueue();
    const manager = useCircuitManager(db);
    await manager.reload();

    const pending = manager.reorder([legsId, pullId, pushId]);

    // Optimistic: the queue lands where dropped before the write settles.
    expect(manager.queue.value.map((row) => row.id)).toEqual([legsId, pullId, pushId]);
    await pending;

    const persisted = await listActiveCircuits(db, 'workout');
    expect(persisted.map((row) => row.id)).toEqual([legsId, pullId, pushId]);
  });

  it('reorder reloads after the write, so rotationOrder fields stay fresh', async () => {
    const { pushId, pullId, legsId } = await seedQueue();
    const manager = useCircuitManager(db);
    await manager.reload();

    await manager.reorder([legsId, pullId, pushId]);

    // The optimistic splice alone reorders the existing row objects but
    // carries their OLD rotationOrder values; only a post-write reload
    // reads the DB's dense 0..n-1 rewrite back in.
    const byId = new Map(manager.queue.value.map((row) => [row.id, row.rotationOrder]));
    expect(byId.get(legsId)).toBe(0);
    expect(byId.get(pullId)).toBe(1);
    expect(byId.get(pushId)).toBe(2);
  });

  it('resyncs from the DB when a reorder goes stale (reorder-mismatch)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { pushId, pullId, legsId } = await seedQueue();
    const manager = useCircuitManager(db);
    await manager.reload();
    await archiveCircuit(db, legsId);

    await manager.reorder([legsId, pullId, pushId]);

    expect(errorSpy).toHaveBeenCalled();
    // The DB's truth wins: the archived circuit is gone from the queue.
    expect(manager.queue.value.map((row) => row.id)).toEqual([pushId, pullId]);
  });

  it('createAndOpen appends an empty placeholder circuit and returns its id', async () => {
    await seedQueue();
    const manager = useCircuitManager(db);
    await manager.reload();

    const id = await manager.createAndOpen();

    expect(id).not.toBeNull();
    expect(manager.queue.value.at(-1)).toMatchObject({
      id,
      name: 'New Circuit',
      workoutCount: 0,
    });
  });

  it('createAndOpen returns null on a failed write', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const manager = useCircuitManager(db);
    await manager.reload();
    testDb.close();

    const id = await manager.createAndOpen();

    expect(id).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('remove archives the circuit and leaves its in-flight session untouched', async () => {
    const { pushId } = await seedQueue();
    const sessionId = await seedInFlightSession(pushId);
    const manager = useCircuitManager(db);
    await manager.reload();

    await manager.remove(pushId);

    expect(manager.queue.value.map((row) => row.id)).not.toContain(pushId);
    // The reap at next mint owns an orphaned session - delete never
    // touches it, ever.
    const rows = await db.select().from(session);
    expect(rows.find((row) => row.id === sessionId)).toMatchObject({
      endedAt: null,
      outcome: null,
    });
  });

  it('abandon ends the in-flight session and reports true', async () => {
    const { pushId } = await seedQueue();
    const sessionId = await seedInFlightSession(pushId);
    const manager = useCircuitManager(db);
    await manager.reload();

    const outcome = await manager.abandon(sessionId);

    expect(outcome).toBe(true);
    expect(manager.active.value).toBeNull();
  });

  it('abandon on an already-ended session reloads and reports false', async () => {
    const { pushId } = await seedQueue();
    const sessionId = await seedInFlightSession(pushId);
    const manager = useCircuitManager(db);
    await manager.reload();
    await manager.abandon(sessionId);

    const outcome = await manager.abandon(sessionId);

    expect(outcome).toBe(false);
  });

  it('swap fronts the target and reports true', async () => {
    const { pushId, pullId } = await seedQueue();
    const row = await findOrCreateExercise(db, 'workout', 'Cable Row');
    await addExerciseToCircuit(db, pullId, row.id);
    const sessionId = await seedInFlightSession(pushId);
    const manager = useCircuitManager(db);
    await manager.reload();

    const outcome = await manager.swap(sessionId, pullId);

    expect(outcome).toBe(true);
    expect(manager.active.value).toBeNull();
    expect(manager.queue.value[0].id).toBe(pullId);
  });

  it('swap refuses an empty target and reloads the truth', async () => {
    const { pushId, legsId } = await seedQueue();
    const sessionId = await seedInFlightSession(pushId);
    const manager = useCircuitManager(db);
    await manager.reload();

    const outcome = await manager.swap(sessionId, legsId);

    expect(outcome).toBe(false);
    expect(manager.active.value).toEqual({ sessionId, circuitId: pushId });
  });
});
