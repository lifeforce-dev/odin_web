import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbClient } from '@/db/client';
import { newId } from '@/db/ids';
import { session } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import type { TestDb } from '@/db/test-db';
import { addExerciseToCircuit, createCircuit, findOrCreateExercise } from '@/domain/builder';

import HomeView from './HomeView.vue';

// Integration over the real DB double: the home CTA's mapping of
// getWorkoutStart onto label/disabled is view wiring the domain tests
// cannot see, and the RESUME path has no device walk until 03-05.

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

  it('enables Start Workout for a startable circuit and navigates', async () => {
    await seedStartableCircuit();
    const wrapper = mount(HomeView);
    await flushPromises();

    const cta = workoutCta(wrapper);
    expect(cta.text()).toContain('Start Workout');
    expect(cta.attributes('disabled')).toBeUndefined();

    await cta.trigger('click');
    expect(routerPush).toHaveBeenCalledWith({ name: 'workout-start' });
  });

  it('reads Resume while a session is in flight', async () => {
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
