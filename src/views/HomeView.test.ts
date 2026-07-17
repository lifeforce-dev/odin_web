import { flushPromises, mount } from '@vue/test-utils';
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
} from '@/domain/builder';

import HomeView from './HomeView.vue';

// Integration over the real DB double: the home CTA's mapping of
// getWorkoutStart onto label/disabled and its start-the-clock write on
// tap are view wiring the domain tests cannot see, and the RESUME path
// has no device walk until 03-05.

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

const routerPush = vi.hoisted(() => vi.fn());

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: routerPush,
  }),
}));

let testDb: TestDb;

beforeEach(async () => {
  testDb = await createTestDb();
  nativeState.isNative = true;
  nativeState.db = testDb.db;
  routerPush.mockClear();
  routerPush.mockResolvedValue(undefined);
});

afterEach(() => {
  nativeState.db = null;
  testDb.close();
});

async function seedStartableCircuit(): Promise<string> {
  const circuit = await createCircuit(testDb.db, { kind: 'workout', name: 'Legs' });
  const exercise = await findOrCreateExercise(testDb.db, 'workout', 'Lat Pulldown');
  await addExerciseToCircuit(testDb.db, circuit.id, exercise.id);
  return circuit.id;
}

function workoutCta(wrapper: ReturnType<typeof mount>) {
  const button = wrapper
    .findAll('button')
    .find((candidate) => /Start Workout|Resume/.test(candidate.text()));
  if (!button) {
    throw new Error('workout CTA not rendered');
  }
  return button;
}

describe('HomeView', () => {
  it('disables Start Workout when nothing is startable', async () => {
    const wrapper = mount(HomeView);
    await flushPromises();

    const cta = workoutCta(wrapper);
    expect(cta.text()).toContain('Start Workout');
    expect(cta.attributes('disabled')).toBeDefined();
  });

  it('starts the workout on tap: session minted, then navigate', async () => {
    const circuitId = await seedStartableCircuit();
    const wrapper = mount(HomeView);
    await flushPromises();

    const cta = workoutCta(wrapper);
    expect(cta.text()).toContain('Start Workout');
    expect(cta.attributes('disabled')).toBeUndefined();

    await cta.trigger('click');
    await flushPromises();

    // The tap IS the workout starting: the persisted startedAt is what
    // the total-time readout runs on from here.
    const rows = await testDb.db.select().from(session);
    expect(rows).toHaveLength(1);
    expect(rows[0].circuitId).toBe(circuitId);
    expect(rows[0].endedAt).toBeNull();
    expect(routerPush).toHaveBeenCalledWith({ name: 'workout-start' });
  });

  it('coalesces a double-tap into one clean start', async () => {
    await seedStartableCircuit();
    const wrapper = mount(HomeView);
    await flushPromises();

    const cta = workoutCta(wrapper);
    void cta.trigger('click');
    void cta.trigger('click');
    await flushPromises();

    expect(await testDb.db.select().from(session)).toHaveLength(1);
    // One row alone would also hold WITHOUT the guard - the shared
    // connection rejects the second BEGIN, which lands in the failure
    // note. The guard's actual promise is that the second tap joins
    // the first: no failure surfaced, exactly one navigation.
    expect(wrapper.text()).not.toContain("Couldn't start the workout");
    expect(routerPush).toHaveBeenCalledExactlyOnceWith({ name: 'workout-start' });
  });

  it('re-derives a stale CTA instead of navigating when nothing is startable anymore', async () => {
    const circuitId = await seedStartableCircuit();
    const wrapper = mount(HomeView);
    await flushPromises();
    await archiveCircuit(testDb.db, circuitId);

    await workoutCta(wrapper).trigger('click');
    await flushPromises();

    expect(routerPush).not.toHaveBeenCalled();
    expect(await testDb.db.select().from(session)).toHaveLength(0);
    expect(workoutCta(wrapper).attributes('disabled')).toBeDefined();
  });

  it('surfaces a failed start on the glass and stays home', async () => {
    await seedStartableCircuit();
    // Reads keep working; only the transition's transaction fails. The
    // view captures useDb() at setup, so the proxy must precede mount.
    nativeState.db = new Proxy(testDb.db as object, {
      get(target, prop, receiver) {
        if (prop === 'transaction') {
          return () => Promise.reject(new Error('injected write failure'));
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as DbClient;
    const wrapper = mount(HomeView);
    await flushPromises();

    await workoutCta(wrapper).trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain("Couldn't start the workout");
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('reads Resume while a session is in flight and rides it on tap', async () => {
    const circuitId = await seedStartableCircuit();
    await testDb.db.insert(session).values({
      id: newId(),
      circuitId,
      startedAt: '2026-07-16T10:00:00.000Z',
      endedAt: null,
    });

    const wrapper = mount(HomeView);
    await flushPromises();

    const cta = workoutCta(wrapper);
    expect(cta.text()).toContain('Resume');
    expect(cta.attributes('disabled')).toBeUndefined();

    await cta.trigger('click');
    await flushPromises();

    // Resume never mints a twin; the running clock is the old start.
    expect(await testDb.db.select().from(session)).toHaveLength(1);
    expect(routerPush).toHaveBeenCalledWith({ name: 'workout-start' });
  });

  it('surfaces a failed load as a Retry note, not as "nothing startable"', async () => {
    nativeState.db = {
      select: () => {
        throw new Error('injected read failure');
      },
    } as unknown as DbClient;

    const wrapper = mount(HomeView);
    await flushPromises();

    expect(wrapper.text()).toContain("Couldn't load workout state");
    expect(wrapper.text()).toContain('Retry');
    // The CTA still degrades to disabled underneath the note.
    expect(workoutCta(wrapper).attributes('disabled')).toBeDefined();
  });
});
